/**
 * createUiRuntime: the assembler.
 *
 * Wires every layer into one object: the session store (with the
 * death-map onEnd wiring), the shared per-session queue (dispatch clicks
 * and handle redraws line up together), the commit phase, the dispatch
 * core with the revive seam, mount, and the sweeper timer. The host app
 * (the bridge) supplies the ports; nothing Discord-shaped is
 * constructed here.
 *
 * mount's order of operations (render-first, create-with-id): generate
 * the id -> render the first payload from a DRAFT session (messageRef
 * pending; the draft never reaches the store) -> send via the target arm
 * -> create the real session -> write the rehydrate row -> run the flow's
 * onSessionStart hook -> return the handle. A failed send throws to the
 * caller; no session was born.
 *
 * @module runtime/create
 */

import { asScreenRegistry } from '../flow/registry.js';
import type { FlowToken } from '../flow/token.js';
import { viewOf } from '../commit/commit.js';
import { createCommit } from '../commit/commit.js';
import { createMakeUi } from '../commit/ui.js';
import { materializeTree } from '../commit/frame.js';
import { createOnEnd } from '../commit/onEnd.js';
import { createDispatch } from '../pipeline/dispatch.js';
import { createSessionQueue } from '../pipeline/queue.js';
import { renderV2Message } from '../render/v2.js';
import { createSessionStore, generateId, isExpired } from '../state/store.js';
import type { MessageRef, RehydrateRow, Session } from '../state/types.js';
import type { IncomingEvent, PlatformPort } from '../pipeline/types.js';
import type { V2MessagePayload } from '../render/v2.js';
import type { MountHandle, MountOptions, MountTarget, RuntimeOptions, UiRuntime } from './types.js';
import { defaultOnError } from '../pipeline/dispatch.js';
import { ErrorSource } from '../pipeline/types.js';

/** Default sweeper cadence: 15 seconds. */
export const DEFAULT_SWEEP_INTERVAL_MS = 15_000;

/**
 * Assembles the runtime: store, queue, commit phase, dispatch, mount and
 * the sweeper, wired over the ports the host supplies.
 *
 * @param options The platform ports, the boot-built flow catalog and the
 *   optional rehydrate store, error unit and clock.
 * @returns The runtime: mount, dispatch, startSweeper, stopSweeper.
 */
export function createUiRuntime(options: RuntimeOptions): UiRuntime {
	const now = options.now ?? Date.now;
	const queue = createSessionQueue();
	// Death-path failures (lifecycle hooks, final commits, rehydrate row
	// writes) carry no click, but they are the host's business all the
	// same: they flow through the same error unit, guarded so a failing
	// unit can never break the death path it rides. No unit supplied means
	// the shipped default: fail loud, exactly like dispatch.
	const reportDeathFailure = (error: unknown, context: string): void => {
		const unit = options.onError ?? defaultOnError;
		try {
			unit({
				error: new Error(`${context}: ${String(error)}`, { cause: error }),
				source: ErrorSource.Framework,
				reply: (): Promise<void> => Promise.resolve(),
			});
		} catch {
			// The error unit itself failed; nothing is left to tell.
		}
	};
	const screens = asScreenRegistry(options.flows.entries);
	const commit = createCommit({ platform: options.platform, screens });
	const store = createSessionStore({
		...(options.now !== undefined ? { now: options.now } : {}),
		onEnd: createOnEnd({
			commit,
			screens,
			// The flow's onSessionEnd hook, resolved per dying session from
			// the catalog. Caught here: a throwing cleanup is logged, never
			// allowed to break the death path it rides (store.end is sync).
			onSessionEnd: (session, reason) => {
				const hook = options.flows.byFlowId.get(session.flowId)?.meta?.onSessionEnd;
				if (hook === undefined) return;
				try {
					hook({ sessionId: session.id, messageId: session.messageRef.messageId, flowId: session.flowId, reason });
				} catch (error) {
					reportDeathFailure(error, `onSessionEnd hook failed for session '${session.id}'`);
				}
			},
			...(options.rehydrate !== undefined ? { rehydrate: options.rehydrate } : {}),
			onError: (error, session, reason): void => {
				reportDeathFailure(error, `${reason} commit failed for session '${session.id}'`);
			},
		}),
	});
	const makeUi = createMakeUi({ store, screens });
	// The host supplies the bridge (editMessage, replyToActor, showModal);
	// the commit phase owns redraw and the parting edit. Compose them once;
	// dispatch, mount and the toolkit all see this one port.
	const platform: PlatformPort = {
		...options.platform,
		redraw: commit.redraw,
		commitParting: commit.commitParting,
	};

	/** Sends the first payload through the target arm; returns where it landed. */
	async function send(target: MountTarget, payload: V2MessagePayload): Promise<MessageRef> {
		if ('channel' in target) return options.sendToChannel(target.channel, payload);
		if ('reply' in target) return target.reply.send(payload);
		await platform.editMessage(target.existing, payload);
		return target.existing;
	}

	/**
	 * The revive seam: rebuild a dead session from its rehydrate row.
	 * Resolves undefined when no row exists, the flow is unknown, a live
	 * successor of the same flow already exists, or the callback declines;
	 * the caller then takes the dead path.
	 */
	async function tryRevive(sessionId: string, messageId: string): Promise<Session<unknown> | undefined> {
		const store_ = options.rehydrate;
		if (store_ === undefined) return undefined;
		const row = await store_.get(messageId);
		if (row === undefined) return undefined;
		const token = options.flows.byFlowId.get(row.flowId);
		if (token === undefined) return undefined;
		// The old message yields: a live successor of the same flow owned by
		// the row's owner wins, and this click gets the parting screen.
		if (store.findLive(row.flowId, row.ownerId) !== undefined) return undefined;
		const data = await token.definition.rehydrate?.(row.ref);
		if (data === undefined) return undefined;
		return store.create({
			id: sessionId,
			flowId: row.flowId,
			moduleId: token.moduleId,
			ownerId: row.ownerId,
			messageRef: { channelId: row.channelId, messageId: row.messageId },
			data,
			screen: token.definition.first,
			ttlMs: token.definition.ttlMs,
			remount: token.definition.remount,
			rehydrate: { ref: row.ref },
		});
	}

	const dispatch = createDispatch({
		store,
		policy: options.policy,
		platform,
		screens,
		tryRevive,
		makeUi,
		queue,
		...(options.onError !== undefined ? { onError: options.onError } : {}),
		...(options.now !== undefined ? { now: options.now } : {}),
	});

	async function mount<TData>(token: FlowToken<TData>, mountOptions: MountOptions): Promise<MountHandle<TData>> {
		// The authored token resolves to its assembled twin; a flow the boot
		// catalog doesn't know is a manifest gap, not a runtime state.
		const registered = options.flows.byToken.get(token);
		if (registered === undefined) {
			throw new Error(`mount: flow '${token.id}' is not in the boot catalog, list it in its module's manifest uiFlows`);
		}
		const flowId = registered.flowId;
		const moduleId = registered.moduleId;
		const def = token.definition;
		// Rehydration pairing: loud in every miswired direction.
		if (def.rehydrate !== undefined) {
			if (options.rehydrate === undefined) {
				throw new Error(`mount: flow '${flowId}' opted into rehydration but the runtime has no rehydrate store`);
			}
			if (mountOptions.rehydrateRef === undefined) {
				throw new Error(`mount: flow '${flowId}' opted into rehydration but no rehydrateRef was given`);
			}
		} else if (mountOptions.rehydrateRef !== undefined) {
			throw new Error(`mount: got rehydrateRef but flow '${flowId}' declares no rehydrate callback`);
		}
		// A wall-limited surface (an ephemeral line) cannot rehydrate: the
		// row would point at a message no late click can revive. Resume
		// means rerunning the command, which is the flow's business.
		const ceiling = 'reply' in mountOptions.to ? mountOptions.to.reply.ceilingMs : undefined;
		if (ceiling !== undefined && (def.rehydrate !== undefined || mountOptions.rehydrateRef !== undefined)) {
			throw new Error(`mount: flow '${flowId}' cannot rehydrate on an ephemeral mount (rerun the command to resume)`);
		}

		// The bag: the flow's own initialData, cloned per mount. Two sessions
		// must never share mutable bag state (an in-place push on a nested
		// array would leak across panels), and a non-cloneable bag (functions,
		// class instances) throws here, loudly; plain JSON-ish data is the
		// contract. structuredClone gives the draft and the real session one
		// shared object: the send renders from the draft, the store keeps it.
		// (The unknown->TData assertion is the definition-boundary erase; the
		// author's initialData was checked against TData at defineFlow time.)
		const data = structuredClone(def.initialData) as TData;

		// Draft session: same shape the store will create, messageRef pending.
		// It exists only so viewOf/wrap have a full session to read; it is
		// never stored, and the real record carries the ref the send returns.
		const at = now();
		const id = generateId();
		const draft: Session<TData> = {
			id,
			flowId,
			moduleId,
			ownerId: mountOptions.ownerId,
			messageRef: { channelId: 'pending', messageId: 'pending' },
			createdAt: at,
			ttlMs: def.ttlMs,
			...(ceiling !== undefined ? { expiresAt: at + ceiling } : {}),
			...(mountOptions.rehydrateRef !== undefined ? { rehydrate: { ref: mountOptions.rehydrateRef } } : {}),
			lastActivityAt: at,
			data,
			screen: def.first,
			history: [],
			modalNonce: generateId(),
			frame: {},
		};
		const firstTree = viewOf(draft, screens);
		const materialized = materializeTree(firstTree);
		const payload = renderV2Message(firstTree, id, `${moduleId}/${def.first}`, materialized.stampOf);

		const ref = await send(mountOptions.to, payload); // throws -> no session, caller owns the failure

		const session = store.create<TData>({
			id,
			flowId,
			moduleId,
			ownerId: mountOptions.ownerId,
			messageRef: ref,
			data,
			screen: def.first,
			ttlMs: def.ttlMs,
			...(ceiling !== undefined ? { expiresAt: at + ceiling } : {}),
			remount: def.remount,
			...(mountOptions.rehydrateRef !== undefined ? { rehydrate: { ref: mountOptions.rehydrateRef } } : {}),
		});
		// The message went out carrying firstTree's controls; the session's
		// frame must be that tree's materialization, or its own buttons would
		// be stale to dispatch. (Same tick as create: no click can land between.)
		session.frame = materialized.frame;

		if (mountOptions.rehydrateRef !== undefined && options.rehydrate !== undefined) {
			const row: RehydrateRow = {
				messageId: ref.messageId,
				channelId: ref.channelId,
				flowId,
				ref: mountOptions.rehydrateRef,
				ownerId: mountOptions.ownerId,
			};
			// Message out, session alive: a row failure cannot throw; the
			// degradation is late clicks seeing the parting screen.
			options.rehydrate.put(row).catch((error: unknown) => {
				reportDeathFailure(error, 'rehydrate row write failed, late clicks will see the parting screen');
			});
		}

		const handle: MountHandle<TData> = {
			sessionId: session.id,
			messageId: ref.messageId,
			redraw: (mutate?: (data: TData) => void): Promise<boolean> =>
				queue.enqueue(session.id, async () => {
					const live = store.get(session.id);
					if (live === undefined || isExpired(live, now())) return false;
					mutate?.(live.data as TData);
					store.touch(session.id);
					await commit.redraw(live);
					return true;
				}),
		};
		// The flow's own bind moment: the session is fully born (screen
		// landed, frame written, row saved). A throw fails the mount loudly,
		// same failure family as the send. Revived sessions never re-run it:
		// they are born in the store, not mount (rehydrate is their bind).
		registered.meta?.onSessionStart?.(handle, mountOptions.context);
		return handle;
	}

	let sweeperTimer: ReturnType<typeof setInterval> | undefined;

	function stopSweeper(): void {
		if (sweeperTimer !== undefined) {
			clearInterval(sweeperTimer);
			sweeperTimer = undefined;
		}
	}

	return {
		mount,
		dispatch: (incoming: IncomingEvent): Promise<void> => dispatch(incoming),
		startSweeper(intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
			stopSweeper();
			sweeperTimer = setInterval(() => {
				store.sweep();
			}, intervalMs);
			sweeperTimer.unref?.();
		},
		stopSweeper,
	};
}
