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
 * uiCommand(name, description, spec) pairs with uiFlow: pure, runs at
 * module load, validates its own tree. The Discord-shaped BotCommand is
 * derived from the token by the binding (bridge/derive.ts); this module
 * never touches the platform.
 *
 * @module command/declare
 */

import type { FlowToken } from '../flow/token.js';

/** Command and subcommand names must be Discord-valid bare names. */
const BARE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * What one mount point knows beyond the flow itself: just the picker
 * description. The data bag is the flow's own initialData, and session
 * lifecycle lives on the flow's meta hooks; a command is pure declaration.
 */
export interface MountSpec {
	/**
	 * What the subcommand shows in the command picker. Required on
	 * subcommand leaves; a bare leaf inherits the command's description.
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
}

/** The erased leaf mounts() returns; readers treat the leaf generically. */
export interface MountLeaf {
	readonly flow: FlowToken<never>;
	readonly description?: string;
	readonly ephemeral?: boolean;
}

/**
 * Builds a mount leaf. Most leaves are just `mounts(flow)`; the spec
 * exists for subcommand descriptions.
 */
export function mounts<TData>(
	flow: FlowToken<TData>,
	spec: MountSpec = {},
): MountLeaf {
	// The token is widened to the erased leaf shape here: the same
	// object, retyped for readers that treat leaves generically.
	return Object.freeze({
		flow,
		...(spec.description !== undefined ? { description: spec.description } : {}),
		...(spec.ephemeral !== undefined ? { ephemeral: spec.ephemeral } : {}),
	});
}

/** What uiCommand accepts, exactly one leaf home: `mount` (bare) or `subcommands` (grouped). */
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

/** A command as authored: name, description, spec. Modules list these in their manifest's uiCommands field. */
export interface CommandToken {
	readonly name: string;
	readonly description: string;
	readonly spec: CommandSpec;
}

/**
 * Declares a slash command that mounts flows. Pure; runs at module load.
 * The loader derives the platform BotCommand from the token and harvests
 * each leaf's flow into the boot catalog.
 */
export function uiCommand(name: string, description: string, spec: CommandSpec): CommandToken {
	if (!BARE_NAME.test(name)) {
		throw new Error(`uiCommand: command name '${name}' must be a bare kebab name (no '/', ':', '#', '~' or '.')`);
	}
	if (description.length === 0) {
		throw new Error(`uiCommand: command '${name}' must declare a description`);
	}
	const hasMount = spec.mount !== undefined;
	const hasSubcommands = spec.subcommands !== undefined;
	if (hasMount === hasSubcommands) {
		throw new Error(`uiCommand '${name}': exactly one of 'mount' or 'subcommands' is required`);
	}
	if (hasSubcommands) {
		const keys = Object.keys(spec.subcommands);
		if (keys.length === 0) {
			throw new Error(`uiCommand '${name}': 'subcommands' is empty: declare at least one`);
		}
		for (const key of keys) {
			if (!BARE_NAME.test(key)) {
				throw new Error(`uiCommand '${name}': subcommand name '${key}' must be a bare kebab name`);
			}
			if (spec.subcommands[key].description === undefined) {
				throw new Error(`uiCommand '${name}': subcommand '${key}' requires a description`);
			}
		}
	}
	return Object.freeze({ name, description, spec: Object.freeze(spec) });
}

/** One harvested leaf: the mount point plus its invocation path ('sync', 'lotto start'). */
export interface CommandLeaf {
	readonly leaf: MountLeaf;
	/**
	 * How the command line invokes this leaf: the bare command name, or
	 * '<command> <subcommand>'. The boot catalog carries it as the flow's
	 * default parting hint.
	 */
	readonly commandHint: string;
}

/** A command's leaves in declaration order: one for a bare mount, one per subcommand. */
export function commandLeaves(command: CommandToken): readonly CommandLeaf[] {
	if (command.spec.mount !== undefined) {
		return [{ leaf: command.spec.mount, commandHint: command.name }];
	}
	return Object.entries(command.spec.subcommands ?? {}).map(([key, leaf]) => ({
		leaf,
		commandHint: `${command.name} ${key}`,
	}));
}
