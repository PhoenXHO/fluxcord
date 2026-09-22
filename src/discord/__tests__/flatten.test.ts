/**
 * Flatten tests: one Discord interaction to the pipeline's plain-facts
 * IncomingEvent. Structural fakes only (the discriminator methods the
 * flattener reads); no discord.js runtime needed.
 *
 * @module discord/__tests__/flatten
 */

import { describe, expect, it } from 'vitest';
import { flattenInteraction } from '../flatten.js';
import type { UiComponentInteraction } from '../flatten.js';
import type { ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction } from 'discord.js';

/** Minimal structural fake: only the fields flattenInteraction reads. */
function fakeButton(fields: Partial<{ customId: string; guildId?: string }> = {}): ButtonInteraction {
	return {
		isButton: () => true,
		isAnySelectMenu: () => false,
		isModalSubmit: () => false,
		customId: fields.customId ?? 'ui2:s1:lotto/main#join',
		user: { id: 'u1' },
		guildId: fields.guildId,
		channelId: 'c1',
		message: { id: 'm1' },
	} as unknown as ButtonInteraction;
}

describe('flattenInteraction', () => {
	it('flattens a button click to a button event', () => {
		const event = flattenInteraction(fakeButton() as UiComponentInteraction);

		expect(event).toEqual({
			kind: 'button',
			customId: 'ui2:s1:lotto/main#join',
			actorId: 'u1',
			guildId: undefined,
			channelId: 'c1',
			messageId: 'm1',
		});
	});

	it('keeps the guild id when the click came from a guild', () => {
		const event = flattenInteraction(fakeButton({ guildId: 'g9' }) as UiComponentInteraction);
		expect(event?.guildId).toBe('g9');
	});

	it('reads the clicker\'s role ids off a hydrated member - a real Map, receiver intact', () => {
		// Regression: extracting `keys` off the cache detached it from its
		// receiver and crashed live ("Map.prototype.keys called on
		// incompatible receiver"). A real Map here proves the binding survives.
		const interaction = fakeButton({ guildId: 'g9' }) as UiComponentInteraction;
		(interaction as unknown as { member: unknown }).member = {
			roles: { cache: new Map([['r-1', {}], ['r-2', {}]]) },
		};

		const event = flattenInteraction(interaction);

		expect(event?.actorRoleIds).toEqual(['r-1', 'r-2']);
	});

	it('flattens a select with its values, in pick order', () => {
		const interaction = {
			isButton: () => false,
			isAnySelectMenu: () => true,
			isModalSubmit: () => false,
			customId: 'ui2:s1:lotto/main#pick',
			user: { id: 'u1' },
			guildId: 'g1',
			channelId: 'c1',
			message: { id: 'm1' },
			values: ['a', 'b'],
		} as unknown as StringSelectMenuInteraction;

		const event = flattenInteraction(interaction as UiComponentInteraction);

		expect(event).toMatchObject({ kind: 'select', values: ['a', 'b'] });
	});

	it('flattens a modal submit with its field values keyed by input id', () => {
		const interaction = {
			isButton: () => false,
			isAnySelectMenu: () => false,
			isModalSubmit: () => true,
			customId: 'ui2:s1:lotto/main#submit~n1',
			user: { id: 'u1' },
			guildId: 'g1',
			channelId: 'c1',
			message: { id: 'm1' },
			fields: {
				fields: new Map([
					['amount', { value: '10' }],
					['note', { value: 'hi' }],
					['lucky', { value: true }],
					['skipped', { value: false }],
					['picks', { values: ['red', 'blue'] }],
					['empty', { values: [] }],
					['broken', { value: undefined }],
				]),
			},
		} as unknown as ModalSubmitInteraction;

		const event = flattenInteraction(interaction as UiComponentInteraction);

		// Each value keeps its field's shape: booleans stay boolean, pick
		// lists arrive as arrays, nullish answers are dropped.
		expect(event).toMatchObject({
			kind: 'modal-submit',
			inputs: { amount: '10', note: 'hi', lucky: true, skipped: false, picks: ['red', 'blue'] },
		});
		expect(event?.inputs).not.toHaveProperty('empty');
		expect(event?.inputs).not.toHaveProperty('broken');
	});

	it('returns undefined for a modal submit with no backing message (command-fired)', () => {
		const interaction = {
			isButton: () => false,
			isAnySelectMenu: () => false,
			isModalSubmit: () => true,
			customId: 'ui2:s1:lotto/main#submit~n1',
			user: { id: 'u1' },
			channelId: 'c1',
			message: null,
			fields: { fields: new Map() },
		} as unknown as ModalSubmitInteraction;

		expect(flattenInteraction(interaction as UiComponentInteraction)).toBeUndefined();
	});
});
