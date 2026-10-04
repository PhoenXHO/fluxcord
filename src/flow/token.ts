/**
 * Flows: a flow's id and registration facts, attached to its
 * declaration.
 *
 * `flow('<name>', options, meta?)` authors the id bare, right where the
 * flow lives: one declaration, at the thing it names. No registry entry,
 * no module prefix to keep honest. The loader owns module identity; it
 * assembles `'<module>/<name>'` into the runtime `MountToken` at boot,
 * so the prefix is derived, never hand-typed.
 *
 * The second argument is the plain `FlowOptions` shape (screens, first,
 * components). `flow` runs it through {@link defineFlow} and keeps the
 * definition. That definition is also what another flow's handler hands
 * `event.call`: one flow kind, opened like a function, returning through
 * `ui.exit`.
 *
 * The third argument carries registration facts that belong to the flow
 * as an independently mounted panel: its default policy gate and its
 * session lifecycle hooks (`onSessionStart` / `onSessionEnd`). A flow
 * opened by `event.call` runs inside the caller's session: its hooks
 * stay dormant (birth and death belong to the root flow), while policy
 * still hears its flowId for as long as one of its screens is the
 * visible surface.
 *
 * @module flow/token
 */

import type { PermissionPolicy } from '../pipeline/types.js';
import type { EndReason } from '../state/types.js';
import type { MountHandle } from '../runtime/types.js';
import { defineFlow } from './define.js';
import type { FlowDefinition, FlowOptions } from './types.js';

/** What a death hands the flow's `onSessionEnd` hook: identity plus cause. */
export interface SessionEnd {
	readonly sessionId: string;
	readonly messageId: string;
	readonly flowId: string;
	readonly reason: EndReason;
}

/**
 * Registration facts a flow declares about itself. They attach to the
 * flow as an independently mounted panel: the session hooks fire for the
 * flow that owns the session, so a flow opened by `event.call` keeps its
 * hooks dormant.
 */
export interface FlowMeta<TData = unknown> {
	/**
	 * The flow's default gate, declared where the flow lives: the
	 * same idea as a control's policy prop, one level up. A static
	 * object only; a resolver needs request context a declaration
	 * does not have. The module's `policies.ts` `flows` map is the
	 * other legal home, and declaring in both is a load-time error
	 * (one home per gate).
	 */
	readonly policy?: PermissionPolicy;
	/**
	 * Runs inside `mount`, once the session is fully born: screen
	 * landed, frame written, rehydrate row saved. This is the flow's
	 * own bind moment: connect services, start pushes, and land
	 * invocation-dependent values via `handle.redraw`. Sync void; catch
	 * your own async work. A throw fails the mount, loudly. Revived
	 * sessions never re-run it (they are born in the store, not `mount`;
	 * rehydrate is their bind).
	 *
	 * The context is the mounter's to define (the bridge passes the
	 * command invocation) and is opaque to the engine. Annotate the
	 * parameter to type the hook body; the engine checks bivariantly,
	 * exactly like `MountHandle.redraw`, so correctness is the mounter's
	 * contract.
	 */
	onSessionStart?(handle: MountHandle<TData>, context: unknown): void;
	/**
	 * Runs on every death path (explicit close, remount replace, TTL
	 * sweep) with the dying session's identity and the cause. The
	 * cleanup hook: drop service refs, stop pushes. Sync void; a throw
	 * is logged and never breaks the death path.
	 */
	onSessionEnd?(end: SessionEnd): void;
}

/**
 * A flow as authored: its bare name plus its definition. Modules export
 * these as constants and list them in their manifest's `flows` field, or a
 * `command`'s leaf mounts one.
 *
 * The second type parameter is the flow's exit value: what a caller's
 * `event.call(flow, ...)` resolves with. It defaults to void (a flow that
 * ends its panel), and it is phantom only: the runtime value is whatever
 * the flow's screens hand `ui.exit`, so a flow promising a typed exit
 * annotates its constant with the pair.
 */
export interface Flow<TData = never, TExit = void> {
	/** The flow's name within its module: the only id the author writes. */
	readonly id: string;
	/** The built definition: `screens`, `initialData`, ttl and the rest. */
	readonly definition: FlowDefinition<TData>;
	/** Registration facts declared on the flow; absent when it declares none. */
	readonly meta?: FlowMeta<TData>;
	/** Phantom carry for the exit value type; never present at runtime. */
	readonly exit?: (value: TExit) => void;
}

/**
 * A flow as registered: the loader-assembled runtime twin of a
 * `Flow`. `flowId` is `'<moduleId>/<name>'`; sessions, wire ids and
 * the revive path key off it.
 */
export interface MountToken<TData = never> {
	/** `'<moduleId>/<name>'`, assembled by the boot catalog; never authored. */
	readonly flowId: string;
	/** The `flowId`'s module prefix: the namespace its screens register under. */
	readonly moduleId: string;
	readonly definition: FlowDefinition<TData>;
	/** The flow's registration facts (policy, session hooks), carried as-is. */
	readonly meta?: FlowMeta;
	/**
	 * The mounting command's invocation path, when a command leaf
	 * contributed this flow: the default parting hint. Absent for
	 * manifest-registered flows.
	 */
	readonly commandHint?: string;
}

const BARE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Declares a flow: bare name, options, and optional registration facts.
 * Pure; runs at module load.
 *
 * @param id The flow's bare kebab name within its module; the loader
 *   assembles `'<module>/<name>'` from it.
 * @param options Screens, `first`, `initialData` (omit for a stateless
 *   flow), and the optional pieces.
 * @param meta Registration facts: the default policy gate and the
 *   session lifecycle hooks.
 * @returns The `Flow` to list in the module manifest's `flows`, or mount
 *   from a command leaf.
 * @throws When the name is not a bare kebab name, or the options fail
 *   {@link defineFlow}'s validation.
 */
export function flow<TData = void, const TScreens extends string = string>(
	id: string,
	options: FlowOptions<TData, TScreens>,
	meta?: FlowMeta<TData>,
): Flow<TData> {
	if (!BARE_NAME.test(id)) {
		throw new Error(`flow: flow name '${id}' must be a bare kebab name (no '/', ':', '#', '~' or '.'); the loader assembles '<module>/<name>'`);
	}
	return Object.freeze({
		id,
		definition: defineFlow(options),
		...(meta !== undefined ? { meta: Object.freeze({ ...meta }) } : {}),
	});
}
