/**
 * Flows: a flow's id and registration facts, attached to its
 * declaration.
 *
 * `flow('<name>', options, meta?)` authors the id right where the flow
 * lives: one declaration, at the thing it names. The call registers the
 * flow, so there is no list to keep in step with it: a flow that exists is
 * a flow the runtime can mount, call and revive. Names are global across
 * the app, and a second flow with the same name throws at its declaration.
 * `flow()` is the only way to make a `Flow`; the runtime refuses an object
 * it did not register.
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

import type { Policy } from '../pipeline/types.js';
import type { EndReason } from '../state/types.js';
import type { MountHandle } from '../runtime/types.js';
import { defineFlow } from './define.js';
import { registerFlow } from './registry.js';
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
	 * same idea as a control's policy prop, one level up. The shipped
	 * engine evaluates it whenever the clicked control declares no
	 * policy of its own (nearest policy wins), and it rides the
	 * frame's token, so a static object only — a resolver needs
	 * request context a declaration does not have.
	 */
	readonly policy?: Policy;
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

const flowBrand: unique symbol = Symbol('fluxcord.flow');

/**
 * A flow as authored: its name plus its definition. Modules export these
 * as constants; a `command`'s leaf mounts one, or the host mounts it
 * directly. Only `flow()` makes them.
 *
 * The second type parameter is the flow's exit value: what a caller's
 * `event.call(flow, ...)` resolves with. It defaults to void (a flow that
 * ends its panel), and it is phantom only: the runtime value is whatever
 * the flow's screens hand `ui.exit`, so a flow promising a typed exit
 * annotates its constant with the pair.
 */
export interface Flow<TData = never, TExit = void> {
	/** Private brand: the symbol is not exported, so only `flow()` can produce a value of this type. The runtime also refuses any object it did not register. */
	readonly [flowBrand]: true;
	/** The flow's name: the only id the author writes, and the id on its buttons and rehydrate rows. Unique across the app. */
	readonly id: string;
	/** The built definition: `screens`, `initialData`, ttl and the rest. */
	readonly definition: FlowDefinition<TData>;
	/** Registration facts declared on the flow; absent when it declares none. */
	readonly meta?: FlowMeta<TData>;
	/** Phantom carry for the exit value type; never present at runtime. */
	readonly exit?: (value: TExit) => void;
}

/**
 * A flow as registered: the runtime twin of a `Flow`, made by `flow()`.
 * `flowId` is the flow's name; sessions, wire ids and the revive path key
 * off it.
 */
export interface MountToken<TData = never> {
	/** The flow's name, as authored. */
	readonly flowId: string;
	readonly definition: FlowDefinition<TData>;
	/** The flow's registration facts (policy, session hooks), carried as-is. */
	readonly meta?: FlowMeta;
	/**
	 * The mounting command's invocation path, when a command leaf mounts
	 * this flow: the default parting hint. Set once, by `command()`, when
	 * the command is declared; absent for a flow the host mounts directly.
	 */
	commandHint?: string;
}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Declares a flow: name, options, and optional registration facts, and
 * registers it. Runs at module load.
 *
 * @param id The flow's kebab name, unique across the app. Prefix it with
 *   its feature when a bare word would collide (`'staff-tickets'`).
 * @param options Screens, `first`, `initialData` (omit for a stateless
 *   flow), and the optional pieces.
 * @param meta Registration facts: the default policy gate and the
 *   session lifecycle hooks.
 * @returns The `Flow`, to mount from a command leaf or from the host.
 * @throws When the name is not a kebab name or is already declared, the
 *   options fail {@link defineFlow}'s validation, or a `static` flow
 *   declares session hooks.
 */
export function flow<TData = void, const TScreens extends string = string>(
	id: string,
	options: FlowOptions<TData, TScreens>,
	meta?: FlowMeta<TData>,
): Flow<TData> {
	if (!NAME.test(id)) {
		throw new Error(`flow: flow name '${id}' must be a kebab name (lowercase words joined by '-'; no '/', ':', '#', '~' or '.')`);
	}
	const definition = defineFlow(options);
	if (definition.static && (meta?.onSessionStart !== undefined || meta?.onSessionEnd !== undefined)) {
		throw new Error(`flow: static flow '${id}' keeps no session, so it cannot declare onSessionStart or onSessionEnd`);
	}
	const frozenMeta = meta !== undefined ? Object.freeze({ ...meta }) : undefined;
	const declared: Flow<TData> = Object.freeze({
		[flowBrand]: true as const,
		id,
		definition,
		...(frozenMeta !== undefined ? { meta: frozenMeta } : {}),
	});
	registerFlow(declared as Flow, {
		flowId: id,
		definition: definition as FlowDefinition,
		...(frozenMeta !== undefined ? { meta: frozenMeta as FlowMeta } : {}),
	});
	return declared;
}
