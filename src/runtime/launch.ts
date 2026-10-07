/**
 * The launch engine: detached work the framework tracks.
 *
 * `event.launch(work)` starts the closure outside the session's queue and
 * returns immediately: the handler settles, the click acks, the panel stays
 * interactive. The job owns nothing but its writes: `job.mutate` re-enters
 * the session's FIFO as one short entry that applies the change to the
 * flow's bag (the launching frame's slot path) and, only when that frame is
 * the one on screen, asks the coalescing redraw scheduler for a render.
 * The scheduler keeps at most one edit in flight per session: writes that
 * land mid-edit only schedule the next round, rendered from the current
 * bag, so a chatty job paces itself to what the platform accepts instead
 * of backing the FIFO up behind rate-limited edits.
 *
 * The frame is the registry. A write whose frame is still in the stack but
 * not on top lands in the bag and renders nothing: screens are stateless
 * renders of the bag, so the change is already waiting for the user's next
 * navigation. A write whose frame has left the stack (the flow exited) or
 * whose session is gone is dropped quietly: the job died with its frame.
 * The frame check is identity-based, so a revive-replaced session (a new
 * object under the same id) counts as gone.
 *
 * A settled return value with an `as` slot lands in the bag under the same
 * rules (write always, redraw only on top); a throw routes to the error
 * socket as a framework failure with no click bound, so the shipped default
 * logs it and stays silent toward the user. Job writes never touch the
 * sliding TTL: a polling job must not keep its own panel alive (the flow's
 * `ttlMs` is the policy knob; `Infinity` opts out of expiry entirely).
 *
 * Jobs are memory-only. A restart drops them; a revived session starts
 * clean, and its screens must already survive a stale pending flag.
 *
 * @module runtime/launch
 */

import { getPath, setPath } from '../flow/lens.js';
import { isExpired } from '../state/store.js';
import type { SessionStore } from '../state/store.js';
import { activeFrame } from '../state/types.js';
import type { FlowFrame, Session } from '../state/types.js';
import type { SessionQueue } from '../pipeline/queue.js';
import type { JobHandle, LaunchEngine, PlatformPort } from '../pipeline/types.js';

/** What the launch engine runs against. */
export interface LaunchOptions {
	/** The live session store: the aliveness and identity checks every write starts from. */
	readonly store: SessionStore;
	/** The shared per-session queue: every job write lines up behind clicks. */
	readonly queue: SessionQueue;
	/** The draw arm: the on-screen write's redraw. */
	readonly platform: Pick<PlatformPort, 'redraw'>;
	/** Injectable clock for honest expiry tests. */
	readonly now?: () => number;
	/**
	 * The error socket for job failures, already shaped as the host's unit.
	 * Omit it and the shipped default runs (log only: a job failure carries
	 * no click, so there is nobody to reply to).
	 */
	readonly onError?: (error: unknown, session: Session<unknown>) => void;
}

/** Per-session redraw drain state: at most one edit in flight, plus the frame whose writes asked for the next one. */
interface RedrawState {
	/** The frame whose on-screen write is waiting for the next drain round; undefined means nothing new. */
	pendingFrame: FlowFrame | undefined;
}

/**
 * Builds the launch engine. One instance per runtime, shared by dispatch
 * (which binds `launch` into each delivered event).
 *
 * @param options The store, queue, draw arm and optional error unit.
 * @returns The engine: launch.
 */
export function createLaunch(options: LaunchOptions): LaunchEngine {
	const now = options.now ?? Date.now;
	/** The alive check every job write starts from: the store still holds THIS session object, unexpired. */
	const alive = (session: Session<unknown>): boolean =>
		options.store.get(session.id) === session && !isExpired(session, now());
	const reportJobFailure = (error: unknown, session: Session<unknown>): void => {
		if (options.onError !== undefined) {
			options.onError(error, session);
			return;
		}
		console.error('[fluxcord] job failure:', error);
	};

	/**
	 * The coalescing redraw scheduler, keyed by session id. A write never
	 * awaits its edit inside the session FIFO: it applies to the bag and
	 * asks here. At most one edit is in flight per session; writes that
	 * land while it runs only set the pending frame, and the drain renders
	 * again from the CURRENT bag afterwards. A chatty job therefore paces
	 * itself to what the platform accepts (one edit per edit-duration,
	 * self-rate-limited) instead of backing the FIFO up behind
	 * rate-limited edits, which is what made clicks wait past Discord's
	 * response window. Renders always read the current bag, so collapsing
	 * intermediate states loses nothing; the edit seam's identical-payload
	 * drop still guards each round.
	 */
	const drains = new Map<string, RedrawState>();

	function requestRedraw(session: Session<unknown>, frame: FlowFrame): void {
		const state = drains.get(session.id);
		if (state !== undefined) {
			state.pendingFrame = frame;
			return;
		}
		drains.set(session.id, { pendingFrame: frame });
		void drainRedraw(session);
	}

	async function drainRedraw(session: Session<unknown>): Promise<void> {
		for (;;) {
			const state = drains.get(session.id);
			if (state === undefined) return;
			const frame = state.pendingFrame;
			if (frame === undefined) {
				drains.delete(session.id);
				return;
			}
			state.pendingFrame = undefined;
			// The death rules apply per round: a dead session, or a frame that
			// left the top of the stack, stops the drain (that job's writes no
			// longer render; the last good screen stays).
			if (!alive(session) || activeFrame(session) !== frame) {
				drains.delete(session.id);
				return;
			}
			try {
				await options.platform.redraw(session);
			} catch (error) {
				// A failed edit is a job failure like any other: reported, and
				// the drain stops rather than hammering a broken platform.
				reportJobFailure(error, session);
				drains.delete(session.id);
				return;
			}
		}
	}

	return {
		launch(
			session: Session<unknown>,
			frame: FlowFrame,
			work: (job: JobHandle<unknown>) => Promise<unknown>,
			launchOptions: { readonly as?: string } = {},
		): void {
			const job: JobHandle<unknown> = {
				mutate: (fn: (data: unknown) => void): void => {
					void options.queue.enqueue(session.id, async () => {
						if (!alive(session)) return;
						// The frame is the registry: off the stack = the flow exited,
						// the job died with it. In the stack but not on top = the
						// user is elsewhere: the write lands, no render.
						if (!session.frames.includes(frame)) return;
						try {
							fn(frame.slot.length > 0 ? getPath(session.data, frame.slot) : session.data);
						} catch (error) {
							// An authoring bug (an unseeded slot, a throwing fn) is a
							// job failure like any other: the socket owns it, the
							// queue line stays clean, no redraw follows.
							reportJobFailure(error, session);
							return;
						}
						if (activeFrame(session) === frame) {
							requestRedraw(session, frame);
						}
					});
				},
			};
			void (async (): Promise<void> => {
				try {
					const value = await work(job);
					const as = launchOptions.as;
					if (as === undefined) return;
					// Settle delivery: same rules as a mutate (the write lands
					// even while the user is elsewhere; only an on-screen frame
					// redraws; a dead frame drops the value).
					await options.queue.enqueue(session.id, async () => {
						if (!alive(session)) return;
						if (!session.frames.includes(frame)) return;
						try {
							setPath(session.data, [...frame.slot, as], value);
						} catch (error) {
							reportJobFailure(error, session);
							return;
						}
						if (activeFrame(session) === frame) {
							requestRedraw(session, frame);
						}
					});
				} catch (error) {
					reportJobFailure(error, session);
				}
			})();
		},
	};
}
