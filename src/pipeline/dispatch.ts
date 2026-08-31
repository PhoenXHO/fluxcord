/**
 * The dispatch core: receives a click, gets it to the handler.
 *
 * One journey per event:
 *
 * ```plaintext
 *   decode -> per-session line -> session lookup -> expiry -> revive-or-parting
 *   -> touch -> frame resolution -> AUTHORIZE -> deny = actor reply -> handler
 *   -> auto-redraw (if the session still lives)
 * ```
 *
 * Standing rules:
 * - The session is the truth; the customId is just an address. The frame
 *   (the handler map of the last draw) decides what runs: a stamp the frame
 *   does not carry is stale (or forged) and runs nothing; the current
 *   screen is redrawn so the client snaps to reality.
 * - Every delivered event asks the policy seam exactly one question, even
 *   when no policy ref exists anywhere. Deny is the only framework-initiated
 *   actor reply besides the error socket's.
 * - A dead click edits its message into the parting screen (the click
 *   buries its own corpse); revive is consulted first, and a revived
 *   session is drawn once before its click resolves (a revived session has
 *   no frame until drawn).
 * - Events on one session id line up FIFO: handlers never interleave over
 *   the session's single data object.
 * - After a successful handler, exactly one redraw: the current screen,
 *   re-rendered from the session's data, edited in place. No redraw on
 *   deny, stale paths, close, or failure; each of those owns its own
 *   message fate.
 * - Dispatch never sends error copy itself. Every failure becomes an
 *   ErrorReport and routes to the error socket (onError ?? defaultOnError);
 *   the reply tool rides in the report.
 *
 * The screen key and action hash come from components the session itself
 * rendered, so the decoded address is trusted by construction; a
 * hand-forged customId cannot originate from a Discord interaction.
 *
 * @module pipeline/dispatch
 */

import type { ActionAddress } from '../render/id-codec.js';
import { decodeActionId } from '../render/id-codec.js';
import { isExpired } from '../state/store.js';
import type { SessionStore } from '../state/store.js';
import type { Session } from '../state/types.js';
import { getPath, lensSession } from '../flow/lens.js';
import { EventKind, ErrorSource } from './types.js';
import type {
	ActionRecord,
	ErrorHandler,
	ErrorReport,
	EventTools,
	FlowContext,
	IncomingEvent,
	PlatformPort,
	PolicyPort,
	ScreenRegistry,
	TryRevive,
} from './types.js';
import { createSessionQueue } from './queue.js';
import type { SessionQueue } from './queue.js';

/** Deny copy when the app's decision carries none. */
export const DEFAULT_DENY_MESSAGE = "You don't have permission to do that.";

/** Generic handler-failure copy: details go to the log through the error socket, never to the user. */
export const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Try again; if it keeps failing, ping a host.';

/**
 * The shipped error-unit default: log everything; for handler failures only,
 * reply to the clicker, with the failing flow's chosen copy when it decided
 * on one, generic copy otherwise (a failed redraw after a successful
 * handler gets NO reply: 'try again' advice would rerun the action).
 * Replace wholesale via DispatchOptions.onError; compose by calling this
 * inside your own unit.
 */
export function defaultOnError(report: ErrorReport): void {
	console.error(`[fluxcord] ${report.source} failure:`, report.error);
	if (report.source === ErrorSource.Handler) {
		report.reply(report.suggestedReply ?? DEFAULT_ERROR_MESSAGE).catch((error: unknown) => {
			console.error('[fluxcord] error reply failed:', error);
		});
	}
}

export interface DispatchOptions {
	/** The live session store. */
	readonly store: SessionStore;
	/** The injected permission seam: one authorize question per delivered event. */
	readonly policy: PolicyPort;
	/** The outgoing side: actor replies, redraws, parting edits. */
	readonly platform: PlatformPort;
	/** Resolves screen keys to screens. */
	readonly screens: ScreenRegistry;
	/** The dead-click revive seam. */
	readonly tryRevive: TryRevive;
	/**
	 * Builds the event-bound toolkit handed to handlers: ui effects plus the
	 * task/mutate hooks. The commit phase's createMakeUi is the real one;
	 * tests inject a stand-in.
	 */
	readonly makeUi: (session: Session<unknown>, address: ActionAddress, platform: PlatformPort) => EventTools;
	/**
	 * The error socket. Omit it and the shipped default runs (log everything,
	 * generic actor reply for handler failures); provide it and the default
	 * never does; your unit receives every failure as an ErrorReport.
	 *
	 * Example:
	 * ```ts
	 * onError: (report) => {
	 * 	logger.error(report.error, { source: report.source, dirty: report.dirtyKeys });
	 * 	if (report.source === ErrorSource.Handler) {
	 * 		report.reply('Custom copy.').catch(() => undefined);
	 * 	}
	 * },
	 * ```
	 */
	readonly onError?: ErrorHandler;
	/** Injectable clock for honest expiry tests. */
	readonly now?: () => number;
	/**
	 * Shared per-session queue. The runtime injects one so mount handles
	 * (handle.redraw) line up behind the same per-session FIFO as clicks;
	 * omitted = a private queue.
	 */
	readonly queue?: SessionQueue;
}

/** The wired pipeline: one call per incoming interaction. */
export interface Dispatch {
	(incoming: IncomingEvent): Promise<void>;
}

/** The decode outcome: the action's address (plus modal nonce) or the failure. */
type Decoded =
	| { readonly ok: true; readonly address: ActionAddress; readonly nonce?: string }
	| { readonly ok: false; readonly error: unknown };

/**
 * Decodes the wire customId. Modal submits carry one trailing '~<nonce>'
 * after the action id; input ids stay untouched. The nonce is split off
 * here so it can be compared against the session's current one.
 */
function decodeIncoming(incoming: IncomingEvent): Decoded {
	try {
		if (incoming.kind !== EventKind.ModalSubmit) {
			return { ok: true, address: decodeActionId(incoming.customId) };
		}
		const tilde = incoming.customId.lastIndexOf('~');
		if (tilde === -1) {
			throw new Error('malformed modal customId (no nonce suffix)');
		}
		const nonce = incoming.customId.slice(tilde + 1);
		if (nonce.length === 0) {
			throw new Error('malformed modal customId (empty nonce)');
		}
		return { ok: true, address: decodeActionId(incoming.customId.slice(0, tilde)), nonce };
	} catch (error) {
		return { ok: false, error };
	}
}

/** Deep copy for the throw-path diagnostic. A snapshot failure (non-plain data) disables the diagnostic for that event, never dispatch. */
function snapshotData(data: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
	try {
		return { ok: true, value: structuredClone(data) };
	} catch {
		return { ok: false };
	}
}

/** Top-level data keys whose JSON differs between the snapshot and the live bag. */
function changedKeys(before: unknown, after: unknown): readonly string[] {
	if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
		return JSON.stringify(before) === JSON.stringify(after) ? [] : ['<root>'];
	}
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	const changed: string[] = [];
	for (const key of keys) {
		if (JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((after as Record<string, unknown>)[key])) {
			changed.push(key);
		}
	}
	return changed;
}

export function createDispatch(options: DispatchOptions): Dispatch {
	const now = options.now ?? Date.now;
	const queue = options.queue ?? createSessionQueue();
	const handleError: ErrorHandler = options.onError ?? defaultOnError;

	/** Where a failure happened, when the event got that far. */
	interface FailureSite {
		readonly screenKey: string;
		readonly action?: string;
		readonly flow?: FlowContext;
	}

	/**
	 * Routes one failure into the error socket, with a reply bound to this
	 * click's actor. When the event reached a screen, its flow's copy hook
	 * runs first; its chosen text rides the report as suggestedReply (the
	 * default unit prefers it); a throwing hook is logged and treated as
	 * "no opinion".
	 */
	function reportFailure(
		error: unknown,
		incoming: IncomingEvent,
		source: ErrorSource = ErrorSource.Framework,
		session?: Session<unknown>,
		dirtyKeys?: readonly string[],
		site?: FailureSite,
	): void {
		const report: ErrorReport = {
			error,
			source,
			incoming,
			...(session !== undefined ? { session } : {}),
			...(dirtyKeys !== undefined && dirtyKeys.length > 0 ? { dirtyKeys } : {}),
			...(site !== undefined ? { screen: site.screenKey } : {}),
			...(site?.action !== undefined ? { action: site.action } : {}),
			reply: (text: string) => options.platform.replyToActor(text),
		};
		let suggestedReply: string | undefined;
		if (site?.flow?.onError !== undefined) {
			try {
				suggestedReply = site.flow.onError(report);
			} catch (hookError) {
				console.error('[fluxcord] flow onError hook failed:', hookError);
			}
		}
		handleError(suggestedReply !== undefined ? { ...report, suggestedReply } : report);
	}

	async function parting(incoming: IncomingEvent, address?: ActionAddress): Promise<void> {
		if (incoming.channelId === undefined) {
			reportFailure(new Error('dead path without a channelId; cannot commit the parting view'), incoming);
			return;
		}
		// The click's address identifies the screen even on a dead session:
		// its flow's parting bundle rides along, so a dead click and the
		// sweeper produce the same goodbye. The command hint (from the
		// mounting command) is the fallback copy when the flow stays silent.
		const flow = address !== undefined
			? options.screens.resolve(address.screenKey)?.flow
			: undefined;
		await options.platform.commitParting(
			{ channelId: incoming.channelId, messageId: incoming.messageId },
			flow?.parting,
			flow?.commandHint,
		);
	}

	async function deliver(address: ActionAddress, nonce: string | undefined, incoming: IncomingEvent): Promise<void> {
		let site: FailureSite | undefined;
		try {
			const existing = options.store.get(address.sessionId);
			let session = existing && !isExpired(existing, now()) ? existing : undefined;
			let justRevived = false;
			if (!session) {
				const revived = await options.tryRevive(address.sessionId, incoming.messageId);
				if (!revived) {
					await parting(incoming, address);
					return;
				}
				session = revived;
				justRevived = true;
				// A revived session has no frame until drawn. Draw the current
				// screen once (building the frame and snapping the client to
				// reality), then resolve the click against that frame. The
				// stale paths below skip their own redraw: it would edit the
				// same pixels twice.
				await options.platform.redraw(session);
			}
			options.store.touch(session.id);

			// Stale modal draft: the nonce identifies the view instance the
			// modal was opened for. A mismatch means the draft is stale:
			// run nothing.
			if (incoming.kind === EventKind.ModalSubmit && nonce !== session.modalNonce) {
				if (!justRevived) await options.platform.redraw(session);
				return;
			}

			const screenKey = `${session.moduleId}/${session.screen}`;
			const screen = options.screens.resolve(screenKey);
			if (screen === undefined) {
				throw new Error(`no screen registered for '${screenKey}'`);
			}

			// Frame resolution: the last draw is the whole truth about what
			// is clickable. Modal submits run the handler showModal recorded
			// (nonce proven above; the id's hash segment goes unread, so a
			// ui.go() before showModal does not strand the values). Any
			// other click must find its handler in the frame; a miss is a
			// stale or forged id and earns stale semantics, never a run.
			let record: ActionRecord<unknown>;
			if (incoming.kind === EventKind.ModalSubmit) {
				if (session.modalHandler === undefined) {
					if (!justRevived) await options.platform.redraw(session);
					return;
				}
				record = {
					handler: session.modalHandler,
					label: session.frame[address.actionHash]?.label ?? 'modal',
					...(session.modalPolicy !== undefined ? { policy: session.modalPolicy } : {}),
				};
			} else {
				const found = session.frame[address.actionHash];
				if (found === undefined) {
					if (!justRevived) await options.platform.redraw(session);
					return;
				}
				record = found;
			}
			site = { screenKey, action: record.label, flow: screen.flow };

			const decision = await options.policy.authorize({
				actorId: incoming.actorId,
				...(incoming.actorRoleIds !== undefined ? { actorRoleIds: incoming.actorRoleIds } : {}),
				ownerId: session.ownerId,
				guildId: incoming.guildId,
				channelId: incoming.channelId,
				flowId: session.flowId,
				view: screenKey,
				...(record.policy !== undefined ? { actionPolicy: record.policy } : {}),
			});
			if (!decision.allowed) {
				await options.platform.replyToActor(decision.denyMessage ?? DEFAULT_DENY_MESSAGE);
				return;
			}

			const tools = options.makeUi(session, address, options.platform);
			// Subflow screens (slot set) receive a lensed session: data reads
			// and writes land in the bag slot their screen owns; every other
			// property is the live record itself.
			const slot = screen.slot;
			const handlerSession: Session<unknown> = slot === undefined ? session : lensSession(session, slot);
			const mutate = slot === undefined
				? tools.mutate
				: (fn: (data: unknown) => void): void => tools.mutate((bag: unknown) => {
					fn(getPath(bag, slot));
				});
			const snapshot = snapshotData(session.data);
			try {
				await record.handler({
					kind: incoming.kind,
					name: record.label,
					actorId: incoming.actorId,
					session: handlerSession,
					values: incoming.values,
					inputs: incoming.inputs,
					ui: tools.ui,
					task: tools.task,
					mutate,
				});
			} catch (error) {
				// Handler failure: the clicker's copy goes through the error
				// socket (the flow's hook may have decided one), the message
				// keeps its last good render, and the session survives for a
				// fresh retry. dirtyKeys reports data changes the failure
				// stranded, direct writes included, which the hooks cannot
				// see.
				reportFailure(
					error,
					incoming,
					ErrorSource.Handler,
					session,
					snapshot.ok ? changedKeys(snapshot.value, session.data) : undefined,
					site,
				);
				return;
			}

			// Auto-redraw: exactly one edit per successful event, the final
			// screen winning. Only while the session lives: close already
			// froze the message, and expiry hands it to the sweeper's parting.
			const alive = options.store.get(session.id) === session && !isExpired(session, now());
			if (alive) {
				await options.platform.redraw(session);
			}
		} catch (error) {
			reportFailure(error, incoming, ErrorSource.Framework, undefined, undefined, site);
		}
	}

	return async function dispatch(incoming: IncomingEvent): Promise<void> {
		const decoded = decodeIncoming(incoming);
		if (!decoded.ok) {
			reportFailure(decoded.error, incoming);
			await parting(incoming).catch((error: unknown) => {
				reportFailure(error, incoming);
			});
			return;
		}
		const { address, nonce } = decoded;
		await queue.enqueue(address.sessionId, () => deliver(address, nonce, incoming));
	};
}
