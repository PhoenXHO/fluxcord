/**
 * Command derivation: a `Command` becomes the binding's own
 * DerivedCommand.
 *
 * This is the binding's read of the ownership tree: the slash-command
 * builder (bare or grouped), the derived registration facts (devOnly, and
 * memberPermissions mapping to both Discord's default gate and the runtime
 * requirement), and the execute arms that mount each leaf's flow onto the
 * interaction's reply. Grouped commands route by subcommand name to the
 * owning leaf. A leaf's declared arguments are registered on its builder
 * and parsed back into the typed values its data resolver receives.
 *
 * The erased leaf meets the typed host here: the one place invocation
 * objects cross from the platform into a flow's onSessionStart hook (as
 * the opaque mount context).
 *
 * @module discord/derive
 */

import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type {
	ChatInputCommandInteraction,
	SlashCommandBooleanOption,
	SlashCommandChannelOption,
	SlashCommandIntegerOption,
	SlashCommandNumberOption,
	SlashCommandRoleOption,
	SlashCommandStringOption,
	SlashCommandUserOption,
} from 'discord.js';
import type { AnyArg } from '../command/args.js';
import type { Command, MountLeaf } from '../command/declare.js';
import type { Flow } from '../flow/token.js';
import { DEFAULT_DENY_MESSAGE } from '../pipeline/dispatch.js';
import { uiHost } from './ui-host.js';

/**
 * The binding's command product: what `deriveCommand` hands the host. The
 * host adapts this into its own registration machinery; nothing here knows
 * the host exists.
 */
export interface DerivedCommand {
	/** The slash-command builder (bare or grouped), registration-ready. */
	readonly data: SlashCommandBuilder;
	/** Dev-only registration hint, as authored on the command. */
	readonly devOnly: boolean;
	/** The Discord permission members need to use the command, if authored. */
	readonly requiresDiscordPermissions?: bigint;
	/** Mounts the flow behind the (sub)command onto the invocation's reply. */
	readonly execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * What a command or subcommand builder offers for adding arguments. Both
 * builders have these methods; this is the slice the binding uses, so one
 * function serves both.
 */
interface ArgTarget {
	addStringOption(fn: (option: SlashCommandStringOption) => SlashCommandStringOption): unknown;
	addIntegerOption(fn: (option: SlashCommandIntegerOption) => SlashCommandIntegerOption): unknown;
	addNumberOption(fn: (option: SlashCommandNumberOption) => SlashCommandNumberOption): unknown;
	addBooleanOption(fn: (option: SlashCommandBooleanOption) => SlashCommandBooleanOption): unknown;
	addUserOption(fn: (option: SlashCommandUserOption) => SlashCommandUserOption): unknown;
	addChannelOption(fn: (option: SlashCommandChannelOption) => SlashCommandChannelOption): unknown;
	addRoleOption(fn: (option: SlashCommandRoleOption) => SlashCommandRoleOption): unknown;
}

/** Registers a leaf's declared arguments on its builder, in declaration order. */
function applyArgs(target: ArgTarget, args: readonly AnyArg[] | undefined): void {
	for (const def of args ?? []) {
		switch (def.kind) {
			case 'string':
				target.addStringOption((option) => {
					option.setName(def.name).setDescription(def.description).setRequired(def.required);
					if (def.minLength !== undefined) option.setMinLength(def.minLength);
					if (def.maxLength !== undefined) option.setMaxLength(def.maxLength);
					if (def.choices !== undefined) option.addChoices(...def.choices.map((c) => ({ name: c.name, value: String(c.value) })));
					return option;
				});
				break;
			case 'integer':
				target.addIntegerOption((option) => {
					option.setName(def.name).setDescription(def.description).setRequired(def.required);
					if (def.min !== undefined) option.setMinValue(def.min);
					if (def.max !== undefined) option.setMaxValue(def.max);
					if (def.choices !== undefined) option.addChoices(...def.choices.map((c) => ({ name: c.name, value: Number(c.value) })));
					return option;
				});
				break;
			case 'number':
				target.addNumberOption((option) => {
					option.setName(def.name).setDescription(def.description).setRequired(def.required);
					if (def.min !== undefined) option.setMinValue(def.min);
					if (def.max !== undefined) option.setMaxValue(def.max);
					if (def.choices !== undefined) option.addChoices(...def.choices.map((c) => ({ name: c.name, value: Number(c.value) })));
					return option;
				});
				break;
			case 'boolean':
				target.addBooleanOption((option) => option.setName(def.name).setDescription(def.description).setRequired(def.required));
				break;
			case 'user':
				target.addUserOption((option) => option.setName(def.name).setDescription(def.description).setRequired(def.required));
				break;
			case 'channel':
				target.addChannelOption((option) => option.setName(def.name).setDescription(def.description).setRequired(def.required));
				break;
			case 'role':
				target.addRoleOption((option) => option.setName(def.name).setDescription(def.description).setRequired(def.required));
				break;
		}
	}
}

/**
 * Reads what the invoker typed back into the values object the resolver
 * receives: one key per argument that was given. User, channel and role
 * arguments are their ids.
 */
function readArgs(interaction: ChatInputCommandInteraction, args: readonly AnyArg[] | undefined): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const def of args ?? []) {
		const given = interaction.options.get(def.name);
		if (given?.value !== undefined && given.value !== null) values[def.name] = given.value;
	}
	return values;
}

/** Mounts one leaf's flow onto the interaction's reply. */
async function mountLeaf(leaf: MountLeaf, interaction: ChatInputCommandInteraction): Promise<void> {
	const host = uiHost();
	// The door: a leaf gate is evaluated before anything mounts, from the
	// invocation's identity alone (no session exists yet, so
	// `policy.owner()` is vacuously false there). Deny = an ephemeral
	// reply, no panel; the host without a policy option never asks.
	if (leaf.policy !== undefined && host.checkDoor !== undefined) {
		const decision = await host.checkDoor(leaf.flow as Flow<unknown>, leaf.policy, interaction);
		if (!decision.allowed) {
			await interaction.reply({
				content: decision.denyMessage ?? DEFAULT_DENY_MESSAGE,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
	}
	// The never-to-unknown cast of the leaf's flow: the same object, widened
	// for mount's generic (the phantom __data channel makes them distinct
	// to the checker). This file is the one place it happens. The bag is
	// the leaf's data resolver's seed when authored (built per invocation,
	// so the birth payload already carries the state the command read —
	// the seed overrides initialData and first resolves on it), else the
	// flow's own initialData. The resolver also gets the arguments the
	// invoker typed. The invocation rides along as the mount context: the
	// flow's onSessionStart hook receives it.
	const data = leaf.data !== undefined ? await leaf.data(interaction, readArgs(interaction, leaf.args)) : undefined;
	await host.mount(leaf.flow as Flow<unknown>, {
		to: { reply: host.replySender(interaction, { ephemeral: leaf.ephemeral === true }) },
		ownerId: interaction.user.id,
		context: interaction,
		...(data !== undefined ? { data } : {}),
	});
}

/**
 * Derives the binding's registration-ready command from an authored
 * command. Pure; the host calls it once per command at registration time.
 *
 * @param command The command to derive.
 * @returns The builder, registration facts and execute arms.
 */
export function deriveCommand(command: Command): DerivedCommand {
	const { spec } = command;
	const builder = new SlashCommandBuilder()
		.setName(command.name)
		.setDescription(command.description);
	if (spec.memberPermissions !== undefined) {
		builder.setDefaultMemberPermissions(spec.memberPermissions);
	}
	const derived = {
		devOnly: spec.devOnly === true,
		...(spec.memberPermissions !== undefined
			? { requiresDiscordPermissions: spec.memberPermissions }
			: {}),
	};

	if (spec.mount !== undefined) {
		const leaf = spec.mount;
		// A bare leaf's own description wins when authored; the command's
		// description (set above) stays the default.
		if (leaf.description !== undefined) builder.setDescription(leaf.description);
		applyArgs(builder, leaf.args);
		return {
			data: builder,
			...derived,
			async execute(interaction: ChatInputCommandInteraction): Promise<void> {
				await mountLeaf(leaf, interaction);
			},
		};
	}

	const leaves = spec.subcommands ?? {};
	for (const [key, leaf] of Object.entries(leaves)) {
		builder.addSubcommand((sub) => {
			// Subcommand descriptions are required at declare time (declare
			// rejects a missing one), so the optional type is the leaf's
			// shape, not a real gap.
			sub.setName(key).setDescription(leaf.description as string);
			applyArgs(sub, leaf.args);
			return sub;
		});
	}
	return {
		data: builder,
		...derived,
		async execute(interaction: ChatInputCommandInteraction): Promise<void> {
			// Discord only sends declared subcommands; the key always hits.
			const leaf = leaves[interaction.options.getSubcommand()];
			await mountLeaf(leaf, interaction);
		},
	};
}
