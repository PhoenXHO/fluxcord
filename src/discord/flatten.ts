/**
 * Interaction flattening: one Discord component interaction to the
 * framework's plain-facts IncomingEvent.
 *
 * The pipeline accepts references only (no Discord objects cross the seam),
 * so this is the single place that reads Discord-shaped fields: kind from
 * the interaction type, values from selects, inputs from modal fields.
 * Returns undefined for interactions the framework cannot address (a modal
 * submit with no backing message; ours never are: modals open from
 * component clicks).
 *
 * @module discord/flatten
 */

import type {
	ButtonInteraction,
	ChannelSelectMenuInteraction,
	MentionableSelectMenuInteraction,
	ModalSubmitInteraction,
	RoleSelectMenuInteraction,
	StringSelectMenuInteraction,
	UserSelectMenuInteraction,
} from 'discord.js';
import { EventKind } from '../pipeline/types.js';
import type { IncomingEvent } from '../pipeline/types.js';

/** Every component interaction kind the framework understands. */
export type NewUiComponentInteraction =
	| ButtonInteraction
	| StringSelectMenuInteraction
	| RoleSelectMenuInteraction
	| ChannelSelectMenuInteraction
	| UserSelectMenuInteraction
	| MentionableSelectMenuInteraction
	| ModalSubmitInteraction;

/** Modal field values keyed by input id, read defensively off the flat field collection. */
function modalInputs(interaction: ModalSubmitInteraction): Record<string, string> {
	const inputs: Record<string, string> = {};
	// The payload was authored by the framework's own renderer; the cast read
	// keeps extraction independent of d.js typing drift on field components.
	for (const [id, field] of interaction.fields.fields) {
		const value = (field as { value?: unknown }).value;
		if (typeof value === 'string') inputs[id] = value;
	}
	return inputs;
}

/**
 * The clicker's role IDs, read defensively off the guild member. Plain
 * facts only: which IDs mean admin/mod is the app's snapshot knowledge,
 * never the bridge's. Absent outside guilds or on partial member payloads.
 */
function memberRoleIds(interaction: NewUiComponentInteraction): string[] | undefined {
	// The member may be absent, partial (API shape), or fully hydrated:
	// read defensively so partial payloads and test fakes pass through.
	const member = interaction.member as
		| { roles?: { cache?: { keys: () => Iterable<string> } } }
		| string
		| null
		| undefined;
	if (member === null || member === undefined || typeof member === 'string') return undefined;
	const cache = member.roles?.cache;
	// Method call on its receiver: extracting `keys` off the cache would
	// detach it and lose `this` at call time.
	return cache === undefined ? undefined : Array.from(cache.keys());
}

/**
 * Flattens one interaction. undefined = not addressable (no backing message);
 * the caller drops it.
 */
export function flattenInteraction(interaction: NewUiComponentInteraction): IncomingEvent | undefined {
	if (interaction.message === null) return undefined;
	const base = {
		actorId: interaction.user.id,
		actorRoleIds: memberRoleIds(interaction),
		guildId: interaction.guildId ?? undefined,
		channelId: interaction.channelId ?? undefined,
		messageId: interaction.message.id,
	};
	if (interaction.isButton()) {
		return { kind: EventKind.Button, customId: interaction.customId, ...base };
	}
	if (interaction.isAnySelectMenu()) {
		return { kind: EventKind.Select, customId: interaction.customId, values: interaction.values, ...base };
	}
	return {
		kind: EventKind.ModalSubmit,
		customId: interaction.customId,
		inputs: modalInputs(interaction),
		...base,
	};
}
