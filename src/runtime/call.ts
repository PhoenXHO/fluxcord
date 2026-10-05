/**
 * The call engine: flows called like functions.
 *
 * `event.call(flow, { as, args })` seeds the child's bag at the parent's
 * slot path, pushes a frame, draws the child's first screen, and cuts the
 * session's queue line: the parent's deliver stays parked on the child's
 * exit, so later clicks must not line up behind it. The child's clicks
 * chain among themselves on the fresh line that forms.
 *
 * `ui.exit({ value, final })` is the other half. Below the root it pops the
 * frame and queues a resume job that presses the parked call's resolve
 * (after resetting the caller's task/mutate phase machine); at the root
 * it ends the session through the store's close path, `final` riding as
 * the goodbye view. The parent's screen redraw comes from ordinary
 * machinery, not from the resume: the child deliver's post-handler
 * auto-redraw draws the newly top frame, and the parent deliver's own
 * auto-redraw covers anything its continuation changes after.
 *
 * A throw from a child frame's handler is a crash of that call: the
 * frame pops and the parent's await rejects, so the rejection surfaces
 * inside the parent's handler, where a try/catch can own it. An uncaught
 * one crashes the parent's frame in turn; a root crash is an ordinary
 * handler failure and reports as always.
 *
 * @module runtime/call
 */

import { setPath } from '../flow/lens.js';
import type { Flow, MountToken } from '../flow/token.js';
import type { CommitPhase } from '../commit/commit.js';
import type { SessionQueue } from '../pipeline/queue.js';
import type { CallEngine, EventTools } from '../pipeline/types.js';
import type { SessionStore } from '../state/store.js';
import { generateId } from '../state/store.js';
import type { FlowFrame, PendingCall, Session } from '../state/types.js';
import type { ComponentResult } from '../tree/types.js';
import { normalizeViewRoot } from '../tree/normalize.js';

/** What the call engine runs against. */
export interface CallOptions {
	/** The live session store; the root exit closes through it. */
	readonly store: SessionStore;
	/** The shared per-session queue; resume jobs enqueue on the current line. */
	readonly queue: SessionQueue;
	/** Draw arm for the child's first screen. */
	readonly commit: Pick<CommitPhase, 'redraw'>;
	/**
	 * Acks the caller's click right before the park; see
	 * PlatformPort.ack. Omitted when the host's bridge has no ack.
	 */
	readonly ack?: () => Promise<void>;
	/** The boot catalog's flow-to-token map: the flows `event.call` may open. */
	readonly byToken: ReadonlyMap<object, MountToken>;
}

/** Resumes one parked call: legal phases again, then settle the await. */
function resume(pending: PendingCall, settle: (pending: PendingCall) => void): () => Promise<void> {
	return async () => {
		pending.resetParentPhase();
		settle(pending);
	};
}

/**
 * Builds the call engine. One instance per runtime, shared by dispatch
 * (which binds `call` into each event and consults `crash` on the
 * handler-throw path) and the toolkit (whose `ui.exit` delegates here).
 *
 * @param options The store, queue, draw arm and boot catalog.
 * @returns The engine: call, exit, crash.
 */
export function createCall(options: CallOptions): CallEngine {
	/** Drops the top frame and settles its parked call, if it still has one. */
	function unwind(session: Session<unknown>, settle: (pending: PendingCall) => void): void {
		const frame = session.frames.pop();
		if (frame === undefined) return;
		const pending = session.pending.get(frame.id);
		session.pending.delete(frame.id);
		if (pending !== undefined) {
			// The resume is queue work like any other: it runs behind
			// everything already on the line, so a click racing the exit
			// still lands before the parent continuation does.
			void options.queue.enqueue(session.id, resume(pending, settle));
		}
	}

	return {
		async call(
			session: Session<unknown>,
			frame: FlowFrame,
			tools: EventTools,
			flow: Flow<unknown, unknown>,
			callOptions: { readonly as: string; readonly args?: unknown },
		): Promise<unknown> {
			// One call per frame, judged against the frame the handler was
			// delivered to: the stack top has already moved onto the child by
			// the time a second call runs, so the top would never match.
			for (const pending of session.pending.values()) {
				if (pending.parentFrameId === frame.id) {
					throw new Error(`event.call: flow '${frame.flowId}' already awaits a call (one call per frame)`);
				}
			}
			const token = options.byToken.get(flow);
			if (token === undefined) {
				throw new Error(`event.call: flow '${flow.id}' is not in the boot catalog, list it in its module's manifest flows`);
			}
			const slot = [...frame.slot, callOptions.as];
			// The child's bag: the caller's args, else the child's own seed.
			// Cloned either way, so parent and child never share mutable
			// state (a nested array push must not leak across frames).
			const bag = structuredClone(callOptions.args ?? token.definition.initialData ?? {});
			setPath(session.data, slot, bag);
			const child: FlowFrame = {
				id: generateId(),
				flowId: token.flowId,
				moduleId: token.moduleId,
				screen: token.definition.first,
				history: [],
				modalNonce: generateId(),
				actions: {},
				slot,
				token,
			};
			// The parked promise. Its resolve/reject are the buttons: they
			// sit in session.pending under the child frame's id until an
			// exit or a crash presses one.
			let resolve!: (value: unknown) => void;
			let reject!: (error: unknown) => void;
			const result = new Promise<unknown>((res, rej) => {
				resolve = res;
				reject = rej;
			});
			const pending: PendingCall = {
				parentFrameId: frame.id,
				resolve,
				reject,
				resetParentPhase: (): void => tools.resetPhase(),
			};
			session.pending.set(child.id, pending);
			session.frames.push(child);
			// Draw first: the child's screen goes out while this click still
			// holds the line, so a click racing the draw queues behind it and
			// lands after the parent is parked. Then cut the line: later
			// clicks start fresh instead of deadlocking behind the parked
			// parent.
			await options.commit.redraw(session);
			// The parked dispatch finishes only when the child exits, far past
			// Discord's response window, so the caller's click is acked here.
			if (options.ack !== undefined) await options.ack();
			options.queue.suspend(session.id);
			return result;
		},

		exit(session: Session<unknown>, value: unknown, final?: ComponentResult): void {
			if (session.frames.length <= 1) {
				// Root exit: end the session. The authored goodbye rides the
				// session to the store's onEnd, which renders it through the
				// parting seam instead of freezing the screen under the user.
				if (final !== undefined) {
					session.finalView = normalizeViewRoot(final);
				}
				options.store.close(session.id);
				return;
			}
			if (final !== undefined) {
				throw new Error('ui.exit: a final view only works at the root (a called flow returns a value; the parent owns the goodbye)');
			}
			unwind(session, (pending) => pending.resolve(value));
		},

		crash(session: Session<unknown>, error: unknown): boolean {
			// Root (or not yet on a frame stack): an ordinary handler failure.
			if (session.frames.length <= 1) return false;
			unwind(session, (pending) => pending.reject(error));
			return true;
		},
	};
}
