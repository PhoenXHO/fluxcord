/**
 * The real effects toolkit: what handlers receive as event.ui, plus the
 * task/mutate hooks sharing one per-event phase machine.
 *
 * Navigation is three verbs over the history stack: go is smart, popping
 * to the target's topmost occurrence when it is already in history
 * (pruning the branch above) and pushing otherwise, so hub-and-spoke
 * panels keep a flat history by construction. push is plain: it always
 * appends, for journeys where revisiting is meaningful. back pops one
 * entry without naming a target. All three are pure state changes
 * (screen, history, nonce: no draw; the auto-redraw after the handler
 * commits the final screen). Subflow roots resolve through the screen
 * registry: ui.go('pick') opens the plugged subflow at its first screen.
 * close routes through the store, whose onEnd wiring freezes the message.
 * showModal records the running handler as the submit's destination and
 * renders the modal with a nonce-stamped customId, so a stale draft from
 * an earlier view instance bounces.
 *
 * The phase machine: task is the work phase and throws once any mutate has
 * run; mutate applies synchronous changes to the shared data and ends the
 * work phase on its first call. Direct bag writes stay legal; the hooks
 * are the recommended path, not a requirement.
 *
 * @module commit/ui
 */

import { encodeActionId } from '../render/id-codec.js';
import type { ActionAddress } from '../render/id-codec.js';
import { renderV2Modal } from '../render/v2.js';
import { generateId } from '../state/store.js';
import type { SessionStore } from '../state/store.js';
import type { Session } from '../state/types.js';
import type { ComponentResult } from '../tree/types.js';
import { normalizeModalRoot, normalizeViewRoot } from '../tree/normalize.js';
import type { EventTools, PlatformPort, ScreenRegistry, UiToolkit } from '../pipeline/types.js';

export interface MakeUiOptions {
	/** The live session store. */
	readonly store: SessionStore;
	/** Resolves ui.go('<root>') to a plugged subflow's entry screen. Needed only when flows use subflows. */
	readonly screens?: ScreenRegistry;
}

/** Builds the event-bound toolkit: ui effects plus the task/mutate hooks. */
export type MakeUi = (session: Session<unknown>, address: ActionAddress, platform: PlatformPort) => EventTools;

export function createMakeUi(options: MakeUiOptions): MakeUi {
	return (session, address, platform) => {
		// A subflow root name (ui.go('pick')) resolves to the plugged
		// subflow's first screen; anything else is a screen id as-is.
		// Resolution runs BEFORE any dedup lookup, so go('<root>') dedups
		// against the root's entry screen. Backstop: typed screens cannot
		// reach the throw, but stringly handlers (factories, subflow
		// roots) can: fail loud rather than navigate to nothing.
		const resolve = (verb: 'go' | 'push', view: string): string => {
			const key = `${session.moduleId}/${session.screen}`;
			const current = options.screens?.resolve(key);
			const target = current?.flow?.roots?.[view] ?? view;
			if (options.screens !== undefined && current !== undefined) {
				const root = current.flow?.roots?.[view];
				if (root === undefined && options.screens.resolve(`${session.moduleId}/${target}`) === undefined) {
					throw new Error(`ui.${verb}('${view}') targets no screen or subflow root in module '${session.moduleId}' (a renamed screen key?)`);
				}
			}
			return target;
		};
		const ui: UiToolkit = {
			go(view: string): void {
				const target = resolve('go', view);
				// Navigating to the current screen is a no-op.
				if (target === session.screen) return;
				// Already in history: pop to its topmost occurrence (the
				// branch above is pruned). Otherwise push.
				const at = session.history.lastIndexOf(target);
				if (at === -1) {
					session.history = [...session.history, session.screen];
					session.screen = target;
				} else {
					session.screen = session.history[at];
					session.history = session.history.slice(0, at);
				}
				session.modalNonce = generateId();
			},
			push(view: string): void {
				const target = resolve('push', view);
				if (target === session.screen) return;
				session.history = [...session.history, session.screen];
				session.screen = target;
				session.modalNonce = generateId();
			},
			back(): void {
				navigateBack(session);
			},
			close(final?: ComponentResult): void {
				if (final !== undefined) {
					// The authored goodbye rides the session to the store's onEnd,
					// which renders it through the parting seam instead of
					// freezing the screen under the user.
					session.finalView = normalizeViewRoot(final);
				}
				options.store.close(session.id);
			},
			showModal(modal: ComponentResult): Promise<void> {
				// Record the opener: the running handler, which the frame
				// resolved (this click came through it). The submit runs this
				// handler after the nonce check, so a ui.go() before showModal
				// does not strand the submitted values. The opener's own
				// policy rides along: the submit re-asks policy and must
				// answer under the same gate that admitted the opener.
				const opener = session.frame[address.actionHash];
				session.modalHandler = opener?.handler;
				session.modalPolicy = opener?.policy;
				const customId = `${encodeActionId({
					sessionId: session.id,
					screenKey: address.screenKey,
					actionHash: address.actionHash,
				})}~${session.modalNonce}`;
				// Element roots fold to a modal node at this seam: anything
				// else (fragment, dropped) throws loudly.
				return platform.showModal(renderV2Modal(normalizeModalRoot(modal), customId));
			},
		};

		let mutated = false;
		const tools: EventTools = {
			ui,
			task<T>(fn: () => Promise<T>): Promise<T> {
				if (mutated) {
					throw new Error('event.task() after event.mutate(); do fallible work before mutating');
				}
				return fn();
			},
			mutate(fn: (data: unknown) => void): void {
				mutated = true;
				fn(session.data);
			},
		};
		return tools;
	};
}

/**
 * Pops one history entry back onto the screen and regenerates the modal
 * nonce: the machinery behind ui.back() and the subflow done action.
 * No-op when history is empty (the entry screen has nothing under it).
 */
export function navigateBack(session: Session<unknown>): void {
	if (session.history.length === 0) return;
	session.screen = session.history[session.history.length - 1];
	session.history = session.history.slice(0, -1);
	session.modalNonce = generateId();
}
