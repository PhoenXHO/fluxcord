/**
 * Command derivation: a CommandToken becomes the binding's own
 * DerivedCommand.
 *
 * This is the binding's read of the ownership tree: the slash-command
 * builder (bare or grouped), the derived registration facts (devOnly, and
 * memberPermissions mapping to both Discord's default gate and the runtime
 * requirement), and the execute arms that mount each leaf's flow onto the
 * interaction's reply. Grouped commands route by subcommand name to the
 * owning leaf.
 *
 * The erased leaf meets the typed host here: the one place invocation
 * objects cross from the platform into a flow's onSessionStart hook (as
 * the opaque mount context).
 *
 * @module discord/derive
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { CommandToken, MountLeaf } from '../command/declare.js';
import type { FlowToken } from '../flow/token.js';
import { uiHost } from './ui-host.js';

/**
 * The binding's command product: what deriveUiCommand hands the host. The
 * host adapts this into its own registration machinery; nothing here knows
 * the host exists.
 */
export interface DerivedCommand {
	/** The slash-command builder (bare or grouped), registration-ready. */
	readonly data: SlashCommandBuilder;
	/** Dev-only registration hint, as authored on the uiCommand. */
	readonly devOnly: boolean;
	/** The Discord permission members need to use the command, if authored. */
	readonly requiresDiscordPermissions?: bigint;
	/** Mounts the flow behind the (sub)command onto the invocation's reply. */
	readonly execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/** Mounts one leaf's flow onto the interaction's reply. */
async function mountLeaf(leaf: MountLeaf, interaction: ChatInputCommandInteraction): Promise<void> {
	const host = uiHost();
	// The never-to-unknown cast of the leaf's token: the same object, widened
	// for mount's generic (the phantom __data channel makes them distinct
	// to the checker). This file is the one place it happens. The bag comes
	// from the flow's own initialData, and the invocation rides along as
	// the mount context: the flow's onSessionStart hook receives it.
	await host.mount(leaf.flow as FlowToken<unknown>, {
		to: { reply: host.replySender(interaction, { ephemeral: leaf.ephemeral === true }) },
		ownerId: interaction.user.id,
		context: interaction,
	});
}

/**
 * Derives the binding's registration-ready command from an authored
 * token. Pure; the host calls it once per command at registration time.
 *
 * @param token The command as authored via uiCommand.
 * @returns The builder, registration facts and execute arms.
 */
export function deriveUiCommand(token: CommandToken): DerivedCommand {
	const { spec } = token;
	const builder = new SlashCommandBuilder()
		.setName(token.name)
		.setDescription(token.description);
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
		builder.addSubcommand((sub) => sub
			.setName(key)
			.setDescription(leaf.description ?? token.description));
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
