/**
 * Command declarations: the ownership tree above the flow.
 *
 * module > commands > subcommands > flow: each thing owns the next, nothing
 * reaches upwards. A command owns its leaves; a leaf names the flow it
 * opens: nothing more. The data bag is the flow's own initialData, and
 * the session lifecycle (bind on start, clean up on end) lives on the
 * flow's meta hooks. Flows stay command-free: they are id, structure,
 * policy and lifecycle, mountable by anything.
 *
 * `command(name, description, spec)` pairs with `flow`: pure, runs at
 * module load, validates its own tree. The Discord-shaped BotCommand is
 * derived from the command by the binding (`discord/derive.ts`); this module
 * never touches the platform.
 *
 * @module command/declare
 */

import { setCommandHint } from '../flow/registry.js';
import type { Flow } from '../flow/token.js';
import type { Policy } from '../pipeline/types.js';
import type { MountHandle } from '../runtime/types.js';
import { validateArgs } from './args.js';
import type { AnyArg, ArgValues } from './args.js';

/** Command and subcommand names must be Discord-valid bare names. */
const BARE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * What one mount point knows beyond the flow itself: the picker
 * description, whether it opens ephemeral, its door gate, the arguments
 * the invoker types, and the resolver that seeds the flow's bag. The data
 * bag defaults to the flow's own initialData, and session lifecycle lives
 * on the flow's meta hooks; a command is pure declaration.
 */
export interface MountSpec<TArgs extends readonly AnyArg[] = readonly [], TData = unknown> {
	/**
	 * What the subcommand shows in the command picker. Required on
	 * subcommand leaves; a bare leaf may carry its own, which overrides
	 * the command's.
	 */
	readonly description?: string;
	/**
	 * Opens the flow on an ephemeral reply (the interaction line): every
	 * edit rides the command's webhook and the panel dies at the platform
	 * wall. Omitted: the reply is a public message living the flow's own
	 * sliding TTL. The door decides, not the flow: the same flow can be
	 * mounted both ways.
	 */
	readonly ephemeral?: boolean;
	/**
	 * The door gate: evaluated before the flow mounts, from the command
	 * invocation's identity alone (no session exists, so `policy.owner()`
	 * is vacuously false). Deny = an ephemeral reply, no panel. Same
	 * vocabulary as the control and flow gates.
	 */
	readonly policy?: Policy;
	/**
	 * The arguments the invoker types after the command, declared with the
	 * `arg` helpers in the order the command line shows them (required ones
	 * first). Their values reach `data` as its second parameter, typed from
	 * this list.
	 */
	readonly args?: TArgs;
	/**
	 * Builds the flow's bag for this invocation, before the first payload
	 * exists: the seed overrides `initialData`, and `first` resolves on
	 * it at birth, so an async-read panel (a wizard that needs the
	 * guild's settings row) opens on the screen its data calls for with
	 * no loading flash. Receives the invocation as the opaque context
	 * (the host types it at authoring time, like onSessionStart) and the
	 * parsed arguments; may be async. A throw fails the command loudly,
	 * like any mount failure.
	 */
	data?(context: unknown, args: ArgValues<TArgs>): TData | Promise<TData>;
	/**
	 * The rehydrate ref for a flow that declares a `rehydrate` callback,
	 * read from the bag `data` built: the panel then outlives its session
	 * like any other persistent mount. Needs `data`; a public mount only.
	 */
	rehydrateRef?(data: TData): string;
	/**
	 * Runs once the panel is posted, with the bag and the mount's handle
	 * (its `messageId` among them): the place to remember the message.
	 * A throw goes on to the host; the panel stays posted. Needs `data`.
	 */
	onMounted?(data: TData, handle: MountHandle<TData>): unknown;
	/**
	 * Runs when the panel could not be posted, with the bag and the error:
	 * the place to undo what `data` wrote. The error is thrown again after
	 * it, so the host still hears of it. Needs `data`.
	 */
	onMountFailed?(data: TData, error: unknown): unknown;
}

/** The erased leaf mounts() returns; readers treat the leaf generically. */
export interface MountLeaf {
	readonly flow: Flow<never>;
	readonly description?: string;
	readonly ephemeral?: boolean;
	readonly policy?: Policy;
	readonly args?: readonly AnyArg[];
	data?(context: unknown, args: Record<string, unknown>): unknown;
	rehydrateRef?(data: unknown): string;
	onMounted?(data: unknown, handle: MountHandle): unknown;
	onMountFailed?(data: unknown, error: unknown): unknown;
}

/**
 * Builds a mount leaf. Most leaves are just `mounts(flow)`; the spec
 * exists for descriptions: subcommand leaves need one, a bare leaf can
 * override with one.
 */
export function mounts<TData, const TArgs extends readonly AnyArg[] = readonly []>(
	flow: Flow<TData>,
	spec: MountSpec<TArgs, TData> = {},
): MountLeaf {
	// The flow is widened to the erased leaf shape here: the same
	// object, retyped for readers that treat leaves generically. The
	// resolver's typed second parameter widens the same way: the binding
	// builds the values from the very list that typed them.
	return Object.freeze({
		flow,
		...(spec.description !== undefined ? { description: spec.description } : {}),
		...(spec.ephemeral !== undefined ? { ephemeral: spec.ephemeral } : {}),
		...(spec.policy !== undefined ? { policy: spec.policy } : {}),
		...(spec.args !== undefined ? { args: spec.args } : {}),
		...(spec.data !== undefined ? { data: spec.data as MountLeaf['data'] } : {}),
		...(spec.rehydrateRef !== undefined ? { rehydrateRef: spec.rehydrateRef as MountLeaf['rehydrateRef'] } : {}),
		...(spec.onMounted !== undefined ? { onMounted: spec.onMounted as MountLeaf['onMounted'] } : {}),
		...(spec.onMountFailed !== undefined ? { onMountFailed: spec.onMountFailed as MountLeaf['onMountFailed'] } : {}),
	});
}

/** What `command` accepts, exactly one leaf home: `mount` (bare) or `subcommands` (grouped). */
export interface CommandSpec {
	/** Registers the command outside production only (dev tools). */
	readonly devOnly?: boolean;
	/**
	 * Discord-native gate: maps to BOTH the command's default member
	 * permissions and the runtime permission requirement.
	 */
	readonly memberPermissions?: bigint;
	/** The single leaf for a command that opens one flow directly. */
	readonly mount?: MountLeaf;
	/** Grouped leaves, keyed by subcommand name; each leaf needs its own description. */
	readonly subcommands?: Readonly<Record<string, MountLeaf>>;
}

/** A command as authored: name, description, spec. Modules list these in their manifest's `commands` field. */
export interface Command {
	readonly name: string;
	readonly description: string;
	readonly spec: CommandSpec;
}

/**
 * Declares a slash command that mounts flows. Pure; runs at module load.
 * The loader derives the platform BotCommand from the command, and each
 * leaf's flow learns the command line that mounts it (its default parting
 * hint).
 */
export function command(name: string, description: string, spec: CommandSpec): Command {
	if (!BARE_NAME.test(name)) {
		throw new Error(`command: command name '${name}' must be a bare kebab name (no '/', ':', '#', '~' or '.')`);
	}
	if (description.length === 0) {
		throw new Error(`command: command '${name}' must declare a description`);
	}
	const hasMount = spec.mount !== undefined;
	const hasSubcommands = spec.subcommands !== undefined;
	if (hasMount === hasSubcommands) {
		throw new Error(`command '${name}': exactly one of 'mount' or 'subcommands' is required`);
	}
	if (hasSubcommands) {
		const keys = Object.keys(spec.subcommands);
		if (keys.length === 0) {
			throw new Error(`command '${name}': 'subcommands' is empty: declare at least one`);
		}
		for (const key of keys) {
			if (!BARE_NAME.test(key)) {
				throw new Error(`command '${name}': subcommand name '${key}' must be a bare kebab name`);
			}
			if (spec.subcommands[key].description === undefined) {
				throw new Error(`command '${name}': subcommand '${key}' requires a description`);
			}
		}
	}
	for (const { leaf, commandHint } of commandLeaves({ name, description, spec })) {
		if (leaf.args !== undefined) validateArgs(commandHint, leaf.args);
		validateMountHooks(commandHint, leaf);
		setCommandHint(leaf.flow, commandHint);
	}
	return Object.freeze({ name, description, spec: Object.freeze(spec) });
}

/**
 * The persistence fields read the bag the `data` resolver builds, so they
 * need one; and an ephemeral panel dies at the platform wall, so it has
 * nothing to rehydrate.
 */
function validateMountHooks(commandHint: string, leaf: MountLeaf): void {
	const hooks = (['rehydrateRef', 'onMounted', 'onMountFailed'] as const).filter((key) => leaf[key] !== undefined);
	if (hooks.length > 0 && leaf.data === undefined) {
		throw new Error(`command '${commandHint}': ${hooks.join(', ')} read the bag the data resolver builds; declare data`);
	}
	if (leaf.rehydrateRef !== undefined && leaf.ephemeral === true) {
		throw new Error(`command '${commandHint}': an ephemeral panel cannot rehydrate; drop rehydrateRef or ephemeral`);
	}
}

/** One harvested leaf: the mount point plus its invocation path ('sync', 'lotto start'). */
export interface CommandLeaf {
	readonly leaf: MountLeaf;
	/**
	 * How the command line invokes this leaf: the bare command name, or
	 * '<command> <subcommand>'. The flow carries it as its default parting
	 * hint.
	 */
	readonly commandHint: string;
}

/** A command's leaves in declaration order: one for a bare mount, one per subcommand. */
export function commandLeaves(command: Command): readonly CommandLeaf[] {
	if (command.spec.mount !== undefined) {
		return [{ leaf: command.spec.mount, commandHint: command.name }];
	}
	return Object.entries(command.spec.subcommands ?? {}).map(([key, leaf]) => ({
		leaf,
		commandHint: `${command.name} ${key}`,
	}));
}
