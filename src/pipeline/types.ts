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

import type { ViewSession } from '../flow/types.js';
import type { V2MessagePayload, V2ModalPayload } from '../render/v2.js';
import type { MessageRef, Session } from '../state/types.js';
import type { ScreenKit } from '../tree/kit.js';
import type { ComponentResult, ViewNode } from '../tree/types.js';

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
	 * End the session; the message is tidied by the commit phase. Without
	 * an argument the final screen is frozen (controls stripped). With a
	 * view, that authored goodbye is left on the message instead, rendered
	 * as-is with no wrap around it: the ending for flows whose last step
	 * has its own parting words (a wizard's "you're all set").
	 */
	close(final?: ComponentResult): void;
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
	/** The effects toolkit for this event: navigation, `close`, `showModal`. */
	readonly ui: UiToolkit<TKeys>;
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
	 * its own admin/mod/config concepts.
	 */
	readonly actorRoleIds?: readonly string[];
	/**
	 * The session's owner, as identity only: `ownerOnly` rules compare the
	 * actor against the user who started the session. Access control is
	 * still per-event policy.
	 */
	readonly ownerId: string;
	/** The interaction's guild; absent in DMs. */
	readonly guildId?: string;
	/** The channel the interaction fired in. */
	readonly channelId?: string;
	/** The owning flow's full id (`'<moduleId>/<name>'`). */
	readonly flowId: string;
	/** '<moduleId>/<screenId>' of the screen the event is delivered to. */
	readonly view: string;
	/**
	 * The clicked control's own policy, when it declared one (the `policy`
	 * prop). Replaces the flow's authored entry for this action alone; a
	 * control may widen or narrow its own identity gate. Guild layers
	 * (global + module) still apply underneath.
	 */
	readonly actionPolicy?: PermissionPolicy;
}

/** The app engine's answer. */
export interface PolicyDecision {
	/** Whether the action may run. */
	readonly allowed: boolean;
	/** Shown to the actor as an ephemeral reply when denied. */
	readonly denyMessage?: string;
}

// --- Authored policy vocabulary ----------------------------------------------------
// The declaration shape flows and controls author (the policy prop on
// buttons/selects, a flow's catalog entry). The framework carries these
// objects across its seams; everything downstream of a declaration
// (resolution, merge, evaluation) stays on the host side of the line,
// behind the PolicyPort.

/**
 * How a layer policy should combine with lower-precedence layers.
 *
 * - `merge` (default): this layer's rules are merged with lower layers, with deny rules taking precedence over allow.
 * - `replace`: this layer completely replaces lower layers, ignoring them entirely.
 *   This is useful for "override" policies that want to ignore global defaults.
 */
export type PolicyMergeMode = 'merge' | 'replace';

/**
 * Access-list mode for users/channels/roles direct policy sections.
 *
 * - `allow`: only items in the list pass this section.
 * - `deny`: items in the list are blocked by this section.
 */
export type AccessListMode = 'allow' | 'deny';

/** Owner/session-based access controls. */
export interface PermissionOwnerPolicy {
	/** Restrict action to the flow/page owner. */
	ownerOnly?: boolean;
	/** Allow bot admins to bypass ownerOnly. */
	allowAdminOverride?: boolean;
	/** Allow bot mods to bypass ownerOnly (implies admin override). */
	allowModOverride?: boolean;
}

/** User allow/deny controls (by Discord user ID). */
export interface PermissionUsersPolicy {
	/** How to interpret `userIds`. */
	mode?: AccessListMode;
	/** IDs evaluated according to `mode`. */
	userIds?: string[];
	/** Allow bot admins to bypass this user section. */
	allowAdminBypass?: boolean;
	/** Allow bot mods to bypass this user section (implies admin bypass). */
	allowModBypass?: boolean;
}

/** Channel allow/deny controls (by Discord channel ID). */
export interface PermissionChannelsPolicy {
	/** How to interpret `channelIds`. */
	mode?: AccessListMode;
	channelIds?: string[];
	/** Allow bot admins to bypass this channel section. */
	allowAdminBypass?: boolean;
	/** Allow bot mods to bypass this channel section (implies admin bypass). */
	allowModBypass?: boolean;
}

/** Role-based controls (by Discord role ID). */
export interface PermissionRolesPolicy {
	/** How to interpret `roleIds`. */
	mode?: AccessListMode;
	roleIds?: string[];
	/** Allow bot admins to bypass this role section. */
	allowAdminBypass?: boolean;
	/** Allow bot mods to bypass this role section (implies admin bypass). */
	allowModBypass?: boolean;
}

/** Message rendering hints for denied outcomes. */
export interface PermissionResponsePolicy {
	/** Optional human-readable label for denial context. */
	reasonLabel?: string;
	/** Optional user hint for how to proceed. */
	hint?: string;
}

/**
 * Raw policy object declared at any layer: a flow's entry in a policies
 * catalog, or a control's own gate via the `policy` prop.
 *
 * `mode` controls whether this layer merges into parents (default) or replaces them.
 */
export interface PermissionPolicy {
	mode?: PolicyMergeMode;
	owner?: PermissionOwnerPolicy;
	users?: PermissionUsersPolicy;
	channels?: PermissionChannelsPolicy;
	roles?: PermissionRolesPolicy;
	response?: PermissionResponsePolicy;
}

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
}

/**
 * The host bridge's arm of the port: the three per-interaction seams the
 * runtime cannot supply itself. The commit phase implements the other two
 * (`redraw`, `commitParting`); the runtime composes the full `PlatformPort`
 * from both.
 */
export type BridgePort = Pick<PlatformPort, 'replyToActor' | 'editMessage' | 'showModal'>;

/** One clickable in a frame: its handler plus the control's label text for diagnostics. */
export interface ActionRecord<TData = unknown> {
	readonly handler: ActionHandler<TData>;
	/** The control's label (a button's label, a select's placeholder); logs and error reports only, never on the wire. */
	readonly label: string;
	/** The control's own gate, when it declared one, rides the record to the policy consult. */
	readonly policy?: PermissionPolicy;
	/**
	 * Draw-phase ownership tag copied from the control: the bag path the
	 * handler lenses to at click time. `[]` is a real tag meaning the root
	 * bag (flow-wrap controls); absent means the screen's own slot — the
	 * historical lens a subflow screen's controls keep.
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
 * The flow-level facts dispatch and the commit phase need from a screen's
 * owning flow. The real FlowDefinition (flow/types) satisfies this
 * structurally after type erase; registry entries carry this form so
 * pipeline code never imports flow/ (no cycles).
 */
export interface FlowContext {
	/** Draws around every screen's content (components compose into this). */
	readonly wrap?: (tree: ViewNode, session: Session<unknown>, kit: ScreenKit<unknown, string>) => ComponentResult;
	/** Subflow namespace roots: root name to the screen id `ui.go(root)` opens. */
	readonly roots?: Readonly<Record<string, string>>;
	/** The flow's parting copy, consulted before the framework defaults. */
	readonly parting?: PartingOptions;
	/**
	 * The mounting command's invocation path: the default parting hint for
	 * a command-mounted flow. An explicit parting.command always wins.
	 * Absent for job-mounted flows.
	 */
	readonly commandHint?: string;
	/** Decides error copy per failure from its own screens; undefined = default copy. */
	readonly onError?: (report: ErrorReport) => string | undefined;
}

/** One screen: its view template, keyed '<moduleId>/<screenId>'. */
export interface RegisteredScreen<TData = unknown> {
	/**
	 * Pure template: session data in, view tree out. The second parameter
	 * is the erased screen kit; the third is the session's read-only
	 * facts (see {@link ViewSession}). Authored views receive all three
	 * typed through `screen()` factories (flow/screen.ts). The return is
	 * the element union (TSX roots are flat); the commit phase folds it
	 * to a view node at the one draw seam.
	 */
	readonly view: (data: TData, controls: ScreenKit<unknown, string>, session: ViewSession) => ComponentResult;
	/** Subflow screens only: the bag path this screen's view is lensed to. Absent = parent bag. */
	readonly slot?: readonly string[];
	/** The owning flow's consultation slice. Absent on hand-built test screens; real registration always sets it. */
	readonly flow?: FlowContext;
}

/**
 * Resolves '<moduleId>/<screenId>' to that screen. The core treats it as a
 * plain lookup table; population (and the type-safe erase from a module's
 * own TData) belongs to the flow and manifest wiring.
 */
export interface ScreenRegistry {
	/**
	 * Resolves a screen key to the screen's view template.
	 * 
	 * @param viewKey `'<moduleId>/<screenId>'`, as stamped on the wire.
	 * @returns The screen, or undefined when unregistered.
	 */
	resolve(viewKey: string): RegisteredScreen | undefined;
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
