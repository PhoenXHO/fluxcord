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
 * commits the final screen).
 * exit routes through the injected call engine: below the root it pops
 * the frame and wakes the parent's `event.call`; at the root it closes
 * through the store, whose onEnd wiring freezes the message or renders
 * the goodbye view.
 * showModal records the running handler as the submit's destination and
 * renders the modal with a fresh nonce-stamped customId per open, so a
 * stale draft from an earlier view instance bounces and the client never
 * serves an old draft back as prefill.
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
import { activeFrame } from '../state/types.js';
import type { FlowFrame, Session } from '../state/types.js';
import type { ComponentResult } from '../tree/types.js';
import { normalizeModalRoot } from '../tree/normalize.js';
import type { EventTools, PlatformPort, UiToolkit } from '../pipeline/types.js';

export interface MakeUiOptions {
	/**
	 * The call engine's exit seam: what `ui.exit` does. Below the root it
	 * pops the frame and wakes the parent's `event.call`; at the root it
	 * closes the session (the store's onEnd wiring does the farewell).
	 */
	readonly exit: (session: Session<unknown>, value: unknown, final?: ComponentResult) => void;
}

/** Builds the event-bound toolkit: ui effects plus the task/mutate hooks. */
export type MakeUi = (session: Session<unknown>, address: ActionAddress, platform: PlatformPort) => EventTools;

export function createMakeUi(options: MakeUiOptions): MakeUi {
	return (session, address, platform) => {
		// Sealing. Every verb looks the top frame up when it runs and
		// touches nothing else on the stack, so a parent's pages stay out
		// of reach for a child handler and the other way around. The
		// stack can grow without a verb ever crossing a flow boundary.
		const top = (): FlowFrame => activeFrame(session);
		// Backstop: typed screens cannot reach the throw, but stringly
		// handlers (factories) can. Fail loud rather than navigate to
		// nothing.
		const resolve = (verb: 'go' | 'push', frame: FlowFrame, view: string): string => {
			if (frame.token.definition.screens[view] === undefined) {
				throw new Error(`ui.${verb}('${view}') targets no screen of flow '${frame.flowId}' (a renamed screen key?)`);
			}
			return view;
		};
		const ui: UiToolkit = {
			go(view: string): void {
				const frame = top();
				const target = resolve('go', frame, view);
				// Navigating to the current screen is a no-op.
				if (target === frame.screen) return;
				// Already in history: pop to its topmost occurrence (the
				// branch above is pruned). Otherwise push.
				const at = frame.history.lastIndexOf(target);
				if (at === -1) {
					frame.history = [...frame.history, frame.screen];
					frame.screen = target;
				} else {
					frame.screen = frame.history[at];
					frame.history = frame.history.slice(0, at);
				}
				frame.modalNonce = generateId();
			},
			push(view: string): void {
				const frame = top();
				const target = resolve('push', frame, view);
				if (target === frame.screen) return;
				frame.history = [...frame.history, frame.screen];
				frame.screen = target;
				frame.modalNonce = generateId();
			},
			back(): void {
				navigateBack(session);
			},
			exit(exitOptions?: { readonly value?: unknown; readonly final?: ComponentResult }): void {
				options.exit(session, exitOptions?.value, exitOptions?.final);
			},
			showModal(modal: ComponentResult): Promise<void> {
				const frame = top();
				// A fresh nonce per open: the client keeps drafts per custom_id,
				// so a reused id would serve an older unsubmitted draft back as
				// prefill (renderV2Modal's contract says the same).
				frame.modalNonce = generateId();
				const customId = `${encodeActionId({
					sessionId: session.id,
					screenKey: address.screenKey,
					actionHash: address.actionHash,
				})}~${frame.modalNonce}`;
				// Element roots fold to a modal node at this seam: anything
				// else (fragment, dropped) throws loudly. Rendering runs before
				// the opener record below, so a failed open leaves no pending
				// submit destination behind.
				const payload = renderV2Modal(normalizeModalRoot(modal), customId);
				// Record the opener: the running handler, which the action
				// map resolved (this click came through it). The submit runs this
				// handler after the nonce check, so a ui.go() before showModal
				// does not strand the submitted values. The opener's own
				// policy rides along: the submit re-asks policy and must
				// answer under the same gate that admitted the opener.
				const opener = frame.actions[address.actionHash];
				frame.modalHandler = opener?.handler;
				frame.modalPolicy = opener?.policy;
				return platform.showModal(payload);
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
			resetPhase(): void {
				mutated = false;
			},
		};
		return tools;
	};
}

/**
 * Pops one history entry back onto the screen and regenerates the modal
 * nonce: the machinery behind ui.back().
 * No-op when history is empty (the entry screen has nothing under it).
 */
export function navigateBack(session: Session<unknown>): void {
	const frame = activeFrame(session);
	if (frame.history.length === 0) return;
	frame.screen = frame.history[frame.history.length - 1];
	frame.history = frame.history.slice(0, -1);
	frame.modalNonce = generateId();
}
