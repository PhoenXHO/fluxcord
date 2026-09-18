/**
 * onEnd wiring: the death map.
 *
 * The store reports every session death with a reason and stays out of the
 * message business; this wiring decides what each death does to the message:
 *
 * ```plaintext
 *   close, authored      -> parting edit with the goodbye view (once; the
 *                           done-set dedupes); delete the rehydrate row
 *   close, plain         -> freeze the final screen; delete the rehydrate row
 *   expire, no rehydrate -> parting edit (once; the done-set dedupes)
 *   expire, rehydrate    -> untouched; the row survives for late-click revive
 * ```
 *
 * The store's hook is synchronous, so the async commit work is
 * fire-and-forget; failures route to the injected logger instead of dying
 * as unhandled rejections.
 *
 * @module commit/onEnd
 */

import { EndReason } from '../state/types.js';
import type { RehydrateStore, Session } from '../state/types.js';
import type { ScreenRegistry } from '../pipeline/types.js';
import type { CommitPhase } from './commit.js';

export interface OnEndOptions {
	readonly commit: CommitPhase;
	/** Present when the host app backed rehydration; close deletes the row. */
	readonly rehydrate?: RehydrateStore;
	/** Resolves the dying session's flow for its parting overrides; omit = framework default copy. */
	readonly screens?: ScreenRegistry;
	/** The flow's onSessionEnd hook delivery, resolved per dying session by the runtime. */
	readonly onSessionEnd?: (session: Session<unknown>, reason: EndReason) => void;
	/** Routes commit failures on death paths; the store hook cannot await. */
	readonly onError?: (error: unknown, session: Session<unknown>, reason: EndReason) => void;
}

/** The store's onEnd hook shape (SessionStoreOptions.onEnd). */
export type OnEnd = (session: Session<unknown>, reason: EndReason) => void;

export function createOnEnd(options: OnEndOptions): OnEnd {
	return (session, reason) => {
		const fail = (error: unknown): void => options.onError?.(error, session, reason);

		// The flow's own cleanup runs first, on every death path, before any
		// message work: drop service refs, stop pushes.
		options.onSessionEnd?.(session, reason);

		if (reason === EndReason.Close) {
			const finalView = session.finalView;
			if (finalView !== undefined) {
				// The handler authored the goodbye: the parting seam renders it
				// as-is and marks the message done, so no later path edits it.
				options.commit.commitParting(session.messageRef, { view: () => finalView }).catch(fail);
			} else {
				options.commit.commitFreeze(session).catch(fail);
			}
			options.rehydrate?.delete(session.messageRef.messageId).catch(fail);
			return;
		}
		// Expiry: rehydratable messages stay untouched for late-click revive.
		if (session.rehydrate === undefined) {
			const key = `${session.moduleId}/${session.screen}`;
			const flow = options.screens?.resolve(key)?.flow;
			options.commit.commitParting(session.messageRef, flow?.parting, flow?.commandHint).catch(fail);
		}
	};
}
