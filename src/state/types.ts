/**
 * The state layer's data shapes: one session per live message.
 *
 * A session is the framework's whole memory of one live screen: its
 * identity, the message it lives on, the flow's one shared data object, the
 * navigation trail, and sliding-TTL bookkeeping. Sessions live in memory
 * only and die on expiry or close; anything that must outlive them belongs
 * in the host app's database, reached only through the injected
 * {@link RehydrateStore}. The framework never touches a database API
 * itself, so where rows live is entirely the host's business.
 *
 * `ownerId` is bookkeeping: access is decided per event by policy, never
 * by session ownership.
 *
 * Only shapes live here; the store's behavior contract and implementation
 * sit together in `store.ts`.
 *
 * @module state/types
 */

import type { ViewNode } from '../tree/types.js';
import type { ActionHandler, ActionRecord, PermissionPolicy } from '../pipeline/types.js';
import type { MountToken } from '../flow/token.js';

// --- Live-message shapes ---------------------------------------------------------

/**
 * The click registry of one drawn message, keyed by handler source hash.
 * One entry per interactive control on screen.
 *
 * Rebuilt on every draw (first draw, redraw, freeze), so it always
 * matches what the message actually shows. A click whose hash is missing
 * here is stale and bounces.
 */
export type ActionMap = Readonly<Record<string, ActionRecord>>;

/** Where a session's message lives. */
export interface MessageRef {
	readonly channelId: string;
	readonly messageId: string;
}

// --- Policies & defaults ---------------------------------------------------------

/** What mounting a flow again does to the owner's live sessions of that same flow; chosen per flow at definition time. */
export const RemountPolicy = {
	/** Mounting the flow again closes every session of it the owner already holds. */
	Replace: 'replace',
	/** Sessions of the same flow stack up and stay alive. */
	Coexist: 'coexist',
} as const;
export type RemountPolicy = (typeof RemountPolicy)[keyof typeof RemountPolicy];

/** The default sliding TTL: 30 minutes. A flow overrides it per definition with its own `ttlMs`. */
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Why a session ended: `'close'` is a deliberate end, `'expire'` is the TTL running out. The commit-phase wiring decides what each reason does to the message. */
export const EndReason = {
	Close: 'close',
	Expire: 'expire',
} as const;
export type EndReason = (typeof EndReason)[keyof typeof EndReason];

// --- The session -----------------------------------------------------------------

/**
 * One running flow instance. A session's panel is a stack of these, the
 * mounted flow's frame at the bottom and one frame per called flow on
 * top. Each frame owns its current screen, back trail, click registry
 * and modal state, so navigation never crosses a flow boundary; only the
 * top frame renders, and only its records are clickable. The event
 * pipeline and the `ui` toolkit write everything here, and the identity
 * fields are fixed at frame creation.
 */
export interface FlowFrame {
	readonly id: string;
	readonly flowId: string;
	readonly moduleId: string;
	/** The current screen (a view id). */
	screen: string;
	/** The back trail: screens stacked by `push`, oldest first. The current screen is not in it (it lives in `screen`), and `back` pops the newest entry. */
	history: readonly string[];
	/**
	 * Fresh identity for this screen instance's modal, drawn from
	 * `generateId`. Flips on every screen change and again on every modal
	 * open, but survives redraws: a redraw must not orphan a modal the
	 * user still has open. It rides the modal's custom id as a `~nonce`
	 * suffix, and a submit whose nonce no longer matches bounces as stale.
	 * The flip on open keeps every modal's custom id fresh, which matters
	 * because Discord keeps unsent draft text per custom id: a reused id
	 * would bleed an old draft into the new modal's prefill.
	 */
	modalNonce: string;
	/** The last draw's click registry ({@link ActionMap}): the whole truth about what is clickable on the message right now. */
	actions: ActionMap;
	/**
	 * The handler awaiting this screen instance's modal submit. `showModal`
	 * records it when the modal opens; when the user submits, dispatch
	 * matches the submit's `~nonce` suffix to the frame and calls this
	 * handler with the input values. One modal can be open per frame at a
	 * time.
	 */
	modalHandler?: ActionHandler;
	/**
	 * A copy of the opener control's policy gate, taken when `showModal`
	 * opens the modal. A submit is a new interaction with no control
	 * behind it, and the screen may have been redrawn since the modal
	 * opened, so the gate cannot be looked up again at submit time; it is
	 * snapshotted next to `modalHandler` and the submit answers under it.
	 */
	modalPolicy?: PermissionPolicy;
	/**
	 * The bag path this frame's data lives at under the root bag: empty
	 * for the root frame, one more key per `event.call` that opened this
	 * flow. Dispatch lenses the frame's handlers and views to this path.
	 */
	slot: readonly string[];
	/**
	 * The flow's assembled token: screens, wrap, parting copy, hooks and
	 * command hint travel with the frame, so drawing, navigation and the
	 * death paths read this frame's own flow and no global registry
	 * exists. Fixed at frame creation.
	 */
	readonly token: MountToken;
}

/**
 * One running `event.call`: the parent handler's suspended continuation,
 * keyed by the child frame's id in `Session.pending`. The child's
 * `ui.exit` resolves it with the exit value; a crash or session death
 * rejects it (or, on death, drops it without settling).
 */
export interface PendingCall {
	/** The frame that called, and whose handler awaits the outcome. */
	readonly parentFrameId: string;
	resolve(value: unknown): void;
	reject(error: unknown): void;
	/** Clears the parent's task/mutate phase machine so work is legal again after the resume. */
	resetParentPhase(): void;
}

/**
 * The running flow on top of the session's stack. Its screen is what
 * renders, and its click records are what accept clicks. Navigation,
 * drawing and dispatch all act on this frame.
 */
export function activeFrame(session: Session<unknown>): FlowFrame {
	return session.frames[session.frames.length - 1];
}

/**
 * One live session. The identity fields above the blank line are fixed at
 * creation; the live state below it is written by the event pipeline and
 * the `ui` toolkit as the user navigates. Screen and history live on the
 * frames (one per running flow instance); the session exposes the top
 * frame's as read-only views, and writes go through `frames`.
 */
export interface Session<TData> {
	readonly id: string;
	readonly flowId: string;
	readonly moduleId: string;
	/** Discord ID of the user who invoked the flow. */
	readonly ownerId: string;
	readonly messageRef: MessageRef;
	readonly createdAt: number;
	/** The sliding TTL window. Expiry is derived on demand as `lastActivityAt + ttlMs`, never stored as a date. */
	readonly ttlMs: number;
	/**
	 * Optional absolute death line (epoch ms), set when the surface itself
	 * has a wall (an ephemeral line). Unlike the sliding TTL it never
	 * moves: an actively used panel still dies here, so its final edits
	 * land before the wall. Omitted on ordinary surfaces.
	 */
	readonly expiresAt?: number;
	/**
	 * Present when the flow opted into rehydration. `ref` is the flow's own
	 * pointer into its database (same meaning as in {@link RehydrateRow});
	 * at revive, the flow's rehydrate function turns it back into fresh
	 * data. A session carrying this field is left untouched at expiry, so
	 * a late click can still revive it.
	 */
	readonly rehydrate?: { readonly ref: string };

	/** Timestamp of the last accepted event; every bump restarts the TTL window. */
	lastActivityAt: number;
	/** The flow's one shared data object; handlers mutate it directly. */
	data: TData;
	/** The frame stack, the root flow's frame first and the running one last. */
	readonly frames: FlowFrame[];
	/**
	 * One entry per running `event.call`, keyed by the child frame id.
	 * The caller's continuation resolves through it; `ui.exit` settles it,
	 * a crash rejects it, and the death paths drop entries without
	 * settling.
	 */
	readonly pending: Map<string, PendingCall>;
	/** The top frame's current screen. A read-only view over the stack; navigation writes the frame. */
	readonly screen: string;
	/** The top frame's back trail. A read-only view over the stack. */
	readonly history: readonly string[];
	/**
	 * The goodbye a root-level `ui.exit({ final: view })` authored: the
	 * close death path renders it through the parting seam (final edit,
	 * done-set dedupe) instead of freezing the current screen. Absent:
	 * close freezes as usual.
	 */
	finalView?: ViewNode;
}

/** Everything the store needs to create a session; the caller resolves flow options first. */
export interface CreateSessionInput<TData> {
	/**
	 * Pre-generated session id, used in two places: mount renders the first
	 * payload (which embeds the id) before the message exists, and revive
	 * reuses the id the click's custom id already carries. Omitted means
	 * the store generates one.
	 */
	readonly id?: string;
	readonly flowId: string;
	readonly moduleId: string;
	readonly ownerId: string;
	readonly messageRef: MessageRef;
	/** Seeds the flow's shared data object. */
	readonly data: TData;
	/** First screen (view id). */
	readonly screen: string;
	/** Sliding TTL in ms: a flow override, or `DEFAULT_TTL_MS`. Finite and positive; the store throws otherwise. */
	readonly ttlMs: number;
	/** Optional absolute death line (epoch ms). @see {@link Session.expiresAt}. */
	readonly expiresAt?: number;
	/** The flow's remount policy ({@link RemountPolicy}). */
	readonly remount: RemountPolicy;
	/** The flow's assembled token; the root frame carries it. */
	readonly token: MountToken;
	/** Present when the flow opted into rehydration. */
	readonly rehydrate?: {
		/** The flow's pointer into its own database, e.g. `'lotto:8421'`. */
		readonly ref: string
	};
}

// --- Rehydration -----------------------------------------------------------------

/**
 * One row of the rehydration DB table: which domain object a live message
 * points at.
 */
export interface RehydrateRow {
	/** The live message this row maps. */
	readonly messageId: string;
	/** Where the message lives. */
	readonly channelId: string;
	/** Which flow definition owns the message. */
	readonly flowId: string;
	/** The flow's own pointer into its database, e.g. `'lotto:8421'`. */
	readonly ref: string;
	/** The original invoker. */
	readonly ownerId: string;
}

/**
 * The persistence interface for rehydration, and the only place the
 * framework meets a database. It is an interface on purpose: the host app
 * injects whatever storage it likes, and no framework code beyond these
 * three methods knows or cares how rows are kept.
 *
 * Rows are written at mount, deleted at close, and deliberately survive
 * TTL death, so a click that arrives after the session is gone can still
 * rebuild from domain truth. When no implementation is injected, the
 * feature is simply inactive: no rows are written, and late clicks bounce
 * as unknown.
 */
export interface RehydrateStore {
	put(row: RehydrateRow): Promise<void>;
	get(messageId: string): Promise<RehydrateRow | undefined>;
	delete(messageId: string): Promise<void>;
}
