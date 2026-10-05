/**
 * Pipeline types: the dispatch core's contracts.
 *
 * Everything here is plain data or a function-type seam. The core receives
 * `IncomingEvent`s (built bot-side, one per Discord interaction, flattened
 * to plain fields), asks exactly one authorize question per delivered
 * event, and reaches the outside world only through injected ports:
 * policy, platform, screen registry, revive. Nothing in this folder
 * imports discord.js.
 *
 * @module pipeline/types
 */

import type { Flow } from '../flow/token.js';
import type { V2MessagePayload, V2ModalPayload } from '../render/v2.js';
import type { FlowFrame, MessageRef, Session } from '../state/types.js';
import type { ComponentResult } from '../tree/types.js';

// used in docs
/* eslint-disable @typescript-eslint/no-unused-vars */
import { createMakeUi } from '../commit/ui.js';
/* eslint-enable */

/** The three interaction kinds the framework understands. */
export const EventKind = {
	Button: 'button',
	Select: 'select',
	ModalSubmit: 'modal-submit',
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

/**
 * What the bot-side bridge hands the dispatch core: one interaction
 * flattened to plain fields. References only: no Discord objects cross
 * this line.
 */
export interface IncomingEvent {
	readonly kind: EventKind;
	/**
	 * Wire customId: `ui2:<sessionId>:<screenKey>#<actionHash>`; modal
	 * submits carry one extra '~<nonce>' suffix after the action id.
	 */
	readonly customId: string;
	/** The clicker's Discord ID. */
	readonly actorId: string;
	/** The clicker's Discord role IDs. */
	readonly actorRoleIds?: readonly string[];
	/** The interaction's guild; absent in DMs. */
	readonly guildId?: string;
	/** The channel the interaction fired in. */
	readonly channelId?: string;
	/** The id of the message the interaction fired on. */
	readonly messageId: string;
	/** Select choices, in pick order. */
	readonly values?: readonly string[];
	/** Modal field values, keyed by input node id; each value keeps its field's shape (string, boolean, or pick array). */
	readonly inputs?: Readonly<Record<string, string | boolean | readonly string[]>>;
}

/**
 * The effects toolkit bound to one delivered event. The dispatch core treats
 * it as opaque; the commit phase's factory ({@link createMakeUi}) implements it.
 */
export interface UiToolkit<TKeys extends string = string> {
	/**
	 * Switch screen, smart: when the target already sits in history, pop
	 * back to its topmost occurrence and prune the branch above it;
	 * otherwise push. Hub-and-spoke panels keep a flat history by
	 * construction. Navigating to the current screen is a no-op.
	 */
	go(view: TKeys): void;
	/**
	 * Switch screen, plain: always appends to history, for journeys where
	 * revisiting a screen is meaningful (wizards, step chains).
	 */
	push(view: TKeys): void;
	/**
	 * Pop one history entry, no target name; no-op when history is empty
	 * (the entry screen). The one-word Back.
	 */
	back(): void;
	/**
	 * Leave this flow. Hand the caller a value with `{ value }`: in a flow
	 * another flow called, this pops the frame and wakes the waiting
	 * `event.call` with it; the parent's screen redraws through the
	 * ordinary machinery. At the root the flow ends the session: the
	 * message is tidied by the commit phase, and without `{ final }` the
	 * last screen freezes (controls stripped). With `{ final: view }`,
	 * that authored goodbye is left on the message instead, rendered
	 * as-is with no wrap around it: the ending for flows whose last step
	 * has its own parting words (a wizard's "you're all set"). `final`
	 * below the root throws: goodbyes belong to the panel's root.
	 */
	exit(options?: { readonly value?: unknown; readonly final?: ComponentResult }): void;
	/**
	 * Open a modal; resolves once opened. Submitted values arrive as the
	 * modal-submit event to the same action; dismissal is Discord silence
	 * (there is no dismiss interaction to hang an outcome on). Accepts the
	 * element union (TSX roots are flat); folded to a modal node at the seam.
	 */
	showModal(modal: ComponentResult): Promise<void>;
}

/**
 * The author-facing event, delivered to action handlers. References only:
 * `event.session` is the store's live record (mutating it is the point), `ui`
 * is bound to this interaction, values and inputs are fresh from the wire.
 */
export interface ActionEvent<TData = unknown, TKeys extends string = string> {
	readonly kind: EventKind;
	/** The action's authored label: diagnostics only (logs, error reports); never a wire identity. */
	readonly name: string;
	/** The clicker's Discord ID. */
	readonly actorId: string;
	/** The session's live record, exactly as the store holds it. */
	readonly session: Session<TData>;
	/** Select choices, in pick order; set on select events. */
	readonly values?: readonly string[];
	/** Modal field values, keyed by input node id in each field's natural shape (string, boolean, or pick array); set on modal-submit events. */
	readonly inputs?: Readonly<Record<string, string | boolean | readonly string[]>>;
	/** The effects toolkit for this event: navigation, `exit`, `showModal`. */
	readonly ui: UiToolkit<TKeys>;
	/**
	 * Call another flow like a function: the child's first screen draws on
	 * this panel, this handler freezes at the await, and the value the
	 * child hands `ui.exit` resolves here. `as` names the child's bag slot
	 * in this flow's data (the child lives at that key, readable and
	 * writable from the parent), and `args` seeds the child's bag when
	 * given (its own initialData seeds otherwise). The child must be
	 * listed in its module's manifest flows. A second `call` while one is
	 * still awaited from the same frame throws: one call per frame.
	 *
	 * A method on purpose: method parameters check bivariantly, which
	 * keeps the erased `ActionEvent<never>` of the registration forms
	 * comparable with a fully typed `ActionEvent<TData>` across the
	 * framework's type-erase boundary.
	 */
	call<K extends string & keyof TData, TExit>(
		flow: Flow<TData[K], TExit>,
		options: { readonly as: K; readonly args?: TData[K] },
	): Promise<TExit>;
	/**
	 * The work hook: run fallible calls (services, APIs) here, before any
	 * mutation. Throws if called after a mutate; the work phase ends when
	 * the commit phase begins.
	 */
	readonly task: <T>(fn: () => Promise<T>) => Promise<T>;
	/** The commit hook: apply one synchronous mutation to the shared data. */
	readonly mutate: (fn: (data: TData) => void) => void;
}

/**
 * The per-event bundle the wiring's makeUi returns: the effects toolkit plus
 * the work/commit hooks sharing one phase machine. Dispatch spreads these
 * onto the ActionEvent it hands the handler.
 */
export interface EventTools<TData = unknown> {
	/** Navigation and modal effects. */
	readonly ui: UiToolkit;
	/** The work hook @see {@link ActionEvent.task}. */
	readonly task: <T>(fn: () => Promise<T>) => Promise<T>;
	/** The commit hook. @see {@link ActionEvent.mutate}. */
	readonly mutate: (fn: (data: TData) => void) => void;
	/**
	 * Engine seam: clears this event's task/mutate phase machine, so a
	 * handler resumed from an `event.call` may run work and mutations
	 * again after the child flow returns. The call engine invokes it
	 * through the parked call; ordinary handlers never need it.
	 */
	readonly resetPhase: () => void;
}

/**
 * The engine behind `event.call` and `ui.exit`, plus the crash path that
 * turns a child handler's throw into a rejection of the parent's await.
 * The runtime builds one (runtime/call); dispatch binds `call` into each
 * delivered event and consults `crash` before reporting a handler
 * failure. Flow and bag types are erased here; the author-facing
 * generics live on {@link ActionEvent.call}.
 */
export interface CallEngine {
	/**
	 * Opens a child flow on the session: seed the child's bag at the
	 * parent's slot path, push a frame, draw the child's first screen,
	 * then cut the session's queue line (the caller's deliver is parked on
	 * the child's exit, so later clicks must not line up behind it).
	 * Resolves when the child exits, with its exit value.
	 */
	call(
		session: Session<unknown>,
		frame: FlowFrame,
		tools: EventTools,
		flow: Flow<unknown, unknown>,
		options: { readonly as: string; readonly args?: unknown },
	): Promise<unknown>;
	/**
	 * Leaves the flow on top. Depth > 0 pops the frame and resolves the
	 * parked call (queued, so clicks already on the line land first);
	 * depth 0 ends the session through the store's close path, `final`
	 * riding as the goodbye view.
	 */
	exit(session: Session<unknown>, value: unknown, final?: ComponentResult): void;
	/**
	 * Crashes the top frame's call when there is one to crash: pops the
	 * frame and rejects the parked call with the error. `false` means the
	 * thrower sat at the root (or on no frame stack yet) and the failure
	 * is an ordinary handler report.
	 */
	crash(session: Session<unknown>, error: unknown): boolean;
}

/** Whose code failed: the only fork with behavioral consequences for error policy. */
export const ErrorSource = {
	/** The app's action handler threw. */
	Handler: 'handler',
	/** Anything else in the pipeline: framework machinery or injected adapters. */
	Framework: 'framework',
} as const;
export type ErrorSource = (typeof ErrorSource)[keyof typeof ErrorSource];

/**
 * Everything an error unit needs to decide and act: the failure, whose code
 * it came from, the click that triggered it, and a reply tool bound to that
 * click's actor. Visibility of the reply is the bridge's choice.
 */
export interface ErrorReport {
	readonly error: unknown;
	readonly source: ErrorSource;
	/** The click that triggered the failure, absent on death-path failures (sweeper, lifecycle hooks, rehydrate writes). */
	readonly incoming?: IncomingEvent;
	readonly session?: Session<unknown>;
	/** Top-level data keys that changed during a failed handler: the throw-path diagnostic (catches direct writes too). */
	readonly dirtyKeys?: readonly string[];
	/** The flow hook's chosen reply text, when the failing screen's flow decided on one. The default unit prefers it over generic copy. */
	readonly suggestedReply?: string;
	/** The screen key ('<moduleId>/<screenId>') the event was delivered to, when it got that far. */
	readonly screen?: string;
	/** The action's authored label, when the event got that far: diagnostics only. */
	readonly action?: string;
	/** Get text to the actor of this interaction. */
	readonly reply: (text: string) => Promise<void>;
}

/** The error socket's plug shape. Omit it and the shipped default runs; provide it and the default never does. */
export type ErrorHandler = (report: ErrorReport) => void;

/**
 * The one permission question (framework to app), asked per delivered
 * event. No session data crosses the seam: resolvers needing domain
 * truth query their own database.
 */
export interface PolicyRequest {
	/** The clicker's Discord ID. */
	readonly actorId: string;
	/**
	 * The clicker's role IDs, when the platform supplied them: the generic
	 * roles socket. The framework assigns no meaning; the app maps IDs to
	 * its own concepts. The shipped engine never reads it: privileges are
	 * the host's naming layer over roles.
	 */
	readonly actorRoleIds?: readonly string[];
	/**
	 * The session's owner, as identity only: `policy.owner()` compares the
	 * actor against the user who started the session. Absent on door
	 * requests (a command run before any session exists), where owner is
	 * vacuously false.
	 */
	readonly ownerId?: string;
	/** The interaction's guild; absent in DMs. */
	readonly guildId?: string;
	/** The channel the interaction fired in. */
	readonly channelId?: string;
	/** The owning flow's full id (`'<moduleId>/<name>'`). */
	readonly flowId: string;
	/** '<flowId>/<screenId>' of the screen the event is delivered to. */
	readonly view: string;
	/**
	 * The flow's own gate (the flow's `meta.policy`), as the frame's token
	 * carries it. The shipped engine evaluates it whenever the control
	 * declared no policy of its own; nearest policy wins.
	 */
	readonly flowPolicy?: Policy;
	/**
	 * The clicked control's own policy, when it declared one (the `policy`
	 * prop). Replaces the flow's gate for this action alone; a control may
	 * widen or narrow its own identity gate.
	 */
	readonly actionPolicy?: Policy;
}

/** The app engine's answer. */
export interface PolicyDecision {
	/** Whether the action may run. */
	readonly allowed: boolean;
	/** Shown to the actor as an ephemeral reply when denied. */
	readonly denyMessage?: string;
}

// --- Authored policy vocabulary ----------------------------------------------------
// What flows and controls author (the policy prop, a flow's meta gate, a
// command's door gate). Inert values, built through the `policy`
// namespace; the shipped engine evaluates them over the host's
// privilege facts, and a custom PolicyPort may evaluate or ignore them.

/**
 * One inert permission gate. Build with the {@link policy} namespace:
 * `policy.owner()`, `policy.privilege('mod')`, `policy.allow`, `policy.deny`,
 * `policy.any(...)`, `policy.all(...)`. Combinators nest to arbitrary
 * depth; there is no negation. Every variant except allow carries an
 * optional deny message, shown to the actor instead of the generic copy.
 */
export type Policy =
	| { readonly kind: 'owner'; readonly denyMessage?: string }
	| { readonly kind: 'privilege'; readonly name: string; readonly denyMessage?: string }
	| { readonly kind: 'any'; readonly of: readonly Policy[]; readonly denyMessage?: string }
	| { readonly kind: 'all'; readonly of: readonly Policy[]; readonly denyMessage?: string }
	| { readonly kind: 'deny'; readonly denyMessage?: string }
	| { readonly kind: 'allow' };

/** The injected permission seam: the host's engine answers; the framework only asks. */
export interface PolicyPort {
	/** Asks the one permission question for a delivered event. */
	authorize(request: PolicyRequest): Promise<PolicyDecision>;
}

/**
 * The outgoing side: everything user-visible the pipeline does. The bridge
 * supplies a per-interaction instance: replyToActor and showModal are bound
 * to the actor of the click being processed; redraw and commitParting are
 * implemented by the commit phase and only assembled bot-side.
 */
export interface PlatformPort {
	/**
	 * Get this text to the actor of the current interaction (policy denials,
	 * error copy). Visibility is the bridge's choice: production bridges
	 * usually reply ephemeral; dev-mode bridges may send public followups
	 * for observability.
	 */
	replyToActor(text: string): Promise<void>;
	/** Re-render the session's current screen and edit the message in place. */
	redraw(session: Session<unknown>): Promise<void>;
	/**
	 * Edit a dead message into the parting screen (the flow's bundle or the framework default).
	 * No-op for an already-parted message. The command hint is the mounting command's
	 * invocation path: the fallback when the flow declares no parting.command of its own.
	 */
	commitParting(messageRef: MessageRef, parting?: PartingOptions, commandHint?: string): Promise<void>;
	/** The bridge's message-edit seam: the commit phase renders, the bridge delivers. */
	editMessage(ref: MessageRef, payload: V2MessagePayload): Promise<void>;
	/** The bridge's modal-open seam: the commit phase renders, the bridge opens. */
	showModal(payload: V2ModalPayload): Promise<void>;
	/**
	 * Closes Discord's response window for the in-flight interaction. The
	 * call engine acks a caller's click right before its dispatch parks on
	 * `event.call`, because that dispatch only finishes when the child
	 * exits, far past the window. Optional: bridges without interaction
	 * acks omit it.
	 */
	ack?(): Promise<void>;
}

/**
 * The host bridge's arm of the port: the three per-interaction seams the
 * runtime cannot supply itself. The commit phase implements the other two
 * (`redraw`, `commitParting`); the runtime composes the full `PlatformPort`
 * from both.
 */
export type BridgePort = Pick<PlatformPort, 'replyToActor' | 'editMessage' | 'showModal' | 'ack'>;

/** One clickable in an action map: its handler plus the control's label text for diagnostics. */
export interface ActionRecord<TData = unknown> {
	readonly handler: ActionHandler<TData>;
	/** The control's label (a button's label, a select's placeholder); logs and error reports only, never on the wire. */
	readonly label: string;
	/** The control's own gate, when it declared one, rides the record to the policy consult. */
	readonly policy?: Policy;
	/**
	 * Draw-phase ownership tag copied from the frame: the bag path the
	 * handler lenses to at click time. `[]` is a real tag meaning the root
	 * bag; absent means no lens and the handler reads the whole session.
	 */
	readonly slot?: readonly string[];
}

/** The flow-authored death copy: command restart hint, extra note, or a whole custom screen. */
export interface PartingOptions {
	/** Command name without the slash (e.g. 'lotto'): renders "Run /lotto to start a new one." */
	readonly command?: string;
	/** Extra line under the default copy (e.g. why it expired). */
	readonly note?: string;
	/** Replaces the default parting screen entirely. No data: a builder; element roots fold engine-side. */
	readonly view?: () => ComponentResult;
}

/**
 * Dead-click revive seam: rebuild a session from domain truth via the
 * flow's rehydrate callback, registered in the store under the SAME id the
 * customId carries. Returning undefined means the message is genuinely
 * dead: the caller commits the parting screen instead.
 */
export type TryRevive = (sessionId: string, messageId: string) => Promise<Session<unknown> | undefined>;

/**
 * What a clicked control runs: the delivered event in, nothing out.
 * Async is fine; a rejection routes to the error socket, never to the
 * clicker as a raw stack.
 */
export type ActionHandler<TData = unknown, TKeys extends string = string> = (event: ActionEvent<TData, TKeys>) => void | Promise<void>;
