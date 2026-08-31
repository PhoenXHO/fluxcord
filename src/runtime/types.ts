/**
 * Runtime types: the assembled whole a host app receives.
 *
 * createUiRuntime wires store, queue, commit phase, dispatch, revive and
 * mount into one object; these are the shapes crossing that boundary.
 * Nothing here touches Discord; the bridge implements the ports.
 *
 * @module runtime/types
 */

import type { V2MessagePayload } from '../render/v2.js';
import type { MessageRef, RehydrateStore, Session } from '../state/types.js';
import type { BridgePort, ErrorHandler, IncomingEvent, PolicyPort } from '../pipeline/types.js';
import type { FlowCatalog } from '../boot/build.js';
import type { FlowToken } from '../flow/token.js';

/**
 * The bridge's reply path for one live interaction: sends the first
 * payload as that interaction's reply and reports where it landed. Built
 * bot-side from the interaction object (a raw id cannot be replied to;
 * the token lives only on the live object).
 */
export interface InteractionSender {
	/** Sends the payload as the interaction's reply and reports where it landed. */
	send(payload: V2MessagePayload): Promise<MessageRef>;
}

/**
 * Where the first screen goes: a channel (new message), an interaction
 * (its reply, command invocations), or an existing message (edited in
 * place, service panels rebinding after a restart).
 */
export type MountTarget =
	/** A channel: the payload goes out as a new message there. */
	| { readonly channel: string }
	/** A live interaction: the payload goes out as that interaction's reply. */
	| { readonly reply: InteractionSender }
	/** An existing message: the payload edits it in place (service panels rebinding after a restart). */
	| { readonly existing: MessageRef };

/** What mount needs besides the flow itself; the bag comes from the flow's own initialData, cloned per mount. */
export interface MountOptions {
	/** Where the first payload goes. */
	readonly to: MountTarget;
	/** Discord ID of the user who owns the session. */
	readonly ownerId: string;
	/**
	 * Identifies the rehydrate row: required exactly when the flow declared
	 * a rehydrate callback, rejected exactly when it did not.
	 */
	readonly rehydrateRef?: string;
	/**
	 * The mounter's context, handed to the flow's onSessionStart hook (the
	 * bridge passes the command invocation). Opaque to the runtime; the
	 * flow types it at authoring time.
	 */
	readonly context?: unknown;
}

/**
 * What mount returns: identity for rehydration binding, plus redraw for
 * services that keep a panel updated over time. Close is deliberately
 * inside-only: ui.close from a handler.
 */
export interface MountHandle<TData = unknown> {
	readonly sessionId: string;
	readonly messageId: string;
	/**
	 * Re-render the current screen and edit the message, serialized with
	 * clicks on the same session's queue. Push-redraw counts as activity.
	 * Resolves false when the session is gone (stop watching); an edit
	 * failure rejects to the caller; APIs throw, pipelines report.
	 */
	redraw(mutate?: (data: TData) => void): Promise<boolean>;
}

export interface RuntimeOptions {
	/** The bridge's arm of the platform port; redraw/commitParting are composed in by the runtime. */
	readonly platform: BridgePort;
	/** The bridge's channel-send seam (the { channel } target arm). */
	readonly sendToChannel: (channelId: string, payload: V2MessagePayload) => Promise<MessageRef>;
	/** The injected permission seam: one authorize question per delivered event. */
	readonly policy: PolicyPort;
	/** The boot-built flow catalog (loader-side registration; immutable from here on). */
	readonly flows: FlowCatalog;
	/** Backs rehydration; omit and rehydratable flows fail loudly at mount. */
	readonly rehydrate?: RehydrateStore;
	/** Reports handler and death-path failures; omit and the shipped default fails loud. */
	readonly onError?: ErrorHandler;
	/** Injectable clock for tests; defaults to Date.now. */
	readonly now?: () => number;
}

export interface UiRuntime {
	/**
	 * Opens a session: renders the flow's first screen, sends it to the
	 * target, creates the session. Rejects when the send fails (no session
	 * was born) or the flow/token pairing is miswired.
	 */
	mount<TData>(token: FlowToken<TData>, options: MountOptions): Promise<MountHandle<TData>>;
	/** The dispatch core: the bridge feeds it one IncomingEvent per interaction. */
	dispatch(incoming: IncomingEvent): Promise<void>;
	/**
	 * Starts the expiry sweeper on an interval; explicit lifecycle so the
	 * host registers stop in its own shutdown registry (no hidden timers).
	 */
	startSweeper(intervalMs?: number): void;
	/** Stops the sweeper timer; safe when it was never started. */
	stopSweeper(): void;
}

/** Session shape mount builds its first-render draft on (never stored). */
export type DraftSession<TData> = Session<TData>;
