/**
 * Bridge platform tests: the jobs that are real logic and worth unit
 * coverage: interaction binding (replyToActor/showModal reach the live
 * interaction of the dispatch in flight), the success ack (every unanswered
 * interaction is deferUpdated once its dispatch ends), and dispatch
 * serialization (the singleton binding never sees two dispatches at once).
 * Delivery seams (editMessage/sendToChannel/replySender) are thin Discord
 * glue, asserted here on fakes, proven live by the pilot.
 *
 * @module discord/__tests__/platform
 */

import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { createUiBridge } from '../platform.js';
import type { NewUiComponentInteraction } from '../flatten.js';
import { EventKind } from '../../pipeline/types.js';
import type { IncomingEvent } from '../../pipeline/types.js';

/** Structural button fake covering flatten + reply/followUp state. */
function fakeButton(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		isButton: (): boolean => true,
		isAnySelectMenu: (): boolean => false,
		isModalSubmit: (): boolean => false,
		customId: 'ui2:s1:lotto/main#join',
		user: { id: 'u1' },
		guildId: 'g1',
		channelId: 'c1',
		message: { id: 'm1' },
		replied: false,
		deferred: false,
		reply: vi.fn(async () => undefined),
		followUp: vi.fn(async () => undefined),
		deferUpdate: vi.fn(async () => undefined),
		showModal: vi.fn(async () => undefined),
		...overrides,
	};
}

/** A fake client whose channel fetch is fully controllable. */
function fakeClient(channels: Record<string, unknown> = {}): Client {
	return {
		channels: {
			fetch: vi.fn(async (id: string) => channels[id] ?? null),
		},
	} as unknown as Client;
}

/** The IncomingEvent the flattener produces for the standard fake button. */
const STD_EVENT: IncomingEvent = {
	kind: EventKind.Button,
	customId: 'ui2:s1:lotto/main#join',
	actorId: 'u1',
	guildId: 'g1',
	channelId: 'c1',
	messageId: 'm1',
};

describe('binding - replyToActor', () => {
	it('replies ephemeral to the interaction of the dispatch in flight', async () => {
		const bridge = createUiBridge(fakeClient());
		const button = fakeButton();
		let seen: string | undefined;

		await bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => {
			await bridge.platform.replyToActor('nope');
			seen = 'ran';
		});

		expect(seen).toBe('ran');
		expect(button.reply).toHaveBeenCalledWith({ content: 'nope', flags: MessageFlags.Ephemeral });
		expect(button.followUp).not.toHaveBeenCalled();
	});

	it('falls back to followUp when the interaction was already answered', async () => {
		const bridge = createUiBridge(fakeClient());
		const button = fakeButton({ replied: true });

		await bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => {
			await bridge.platform.replyToActor('nope');
		});

		expect(button.reply).not.toHaveBeenCalled();
		expect(button.followUp).toHaveBeenCalledWith({ content: 'nope', flags: MessageFlags.Ephemeral });
	});

	it('drops the ephemeral flag when the host asks for public copy (dev)', async () => {
		const bridge = createUiBridge(fakeClient(), { ephemeralAsPublic: true });
		const button = fakeButton();

		await bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => {
			await bridge.platform.replyToActor('nope');
		});

		expect(button.reply).toHaveBeenCalledWith({ content: 'nope' });
	});

	it('drops the text (no crash) outside a dispatch window', async () => {
		const bridge = createUiBridge(fakeClient());
		await expect(bridge.platform.replyToActor('orphan')).resolves.toBeUndefined();
	});
});

describe('binding - showModal', () => {
	it('opens the raw payload on the bound interaction', async () => {
		const bridge = createUiBridge(fakeClient());
		const button = fakeButton();
		const payload = { custom_id: 'ui2:s1:lotto/main#form', title: 'Form', components: [] };

		await bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => {
			await bridge.platform.showModal(payload as never);
		});

		expect(button.showModal).toHaveBeenCalledWith(payload);
	});
});

describe('success ack', () => {
	it('deferUpdates an unanswered interaction once the dispatch finishes', async () => {
		const bridge = createUiBridge(fakeClient());
		const button = fakeButton();

		await bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => undefined);

		expect(button.deferUpdate).toHaveBeenCalledTimes(1);
	});

	it('skips the ack when the dispatch already answered (denial/error copy path)', async () => {
		const bridge = createUiBridge(fakeClient());
		const button = fakeButton({ replied: true });

		await bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => undefined);

		expect(button.deferUpdate).not.toHaveBeenCalled();
	});

	it('skips the ack when the dispatch opened a modal (the modal is the answer)', async () => {
		const bridge = createUiBridge(fakeClient());
		const button = fakeButton();

		await bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => {
			await bridge.platform.showModal({ title: 'Form', components: [] } as never);
		});

		expect(button.showModal).toHaveBeenCalledTimes(1);
		expect(button.deferUpdate).not.toHaveBeenCalled();
	});

	it('still acks when the core itself fails', async () => {
		const bridge = createUiBridge(fakeClient());
		const button = fakeButton();

		await expect(bridge.dispatch(button as unknown as NewUiComponentInteraction, async () => {
			throw new Error('core bug');
		})).rejects.toThrow('core bug');

		expect(button.deferUpdate).toHaveBeenCalledTimes(1);
	});
});

describe('dispatch serialization', () => {
	it('never runs two dispatches concurrently (the singleton binding stays race-free)', async () => {
		const bridge = createUiBridge(fakeClient());
		const first = fakeButton({ customId: 'ui2:s1:lotto/main#a' });
		const second = fakeButton({ customId: 'ui2:s1:lotto/main#b' });

		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const order: string[] = [];

		const firstRun = bridge.dispatch(first as unknown as NewUiComponentInteraction, async () => {
			order.push('first-start');
			await firstGate;
			order.push('first-end');
		});
		const secondRun = bridge.dispatch(second as unknown as NewUiComponentInteraction, async () => {
			order.push('second-start');
		});

		// Give the second dispatch its turn on the microtask queue: it must
		// still be waiting behind the first.
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual(['first-start']);

		releaseFirst();
		await Promise.all([firstRun, secondRun]);
		expect(order).toEqual(['first-start', 'first-end', 'second-start']);
	});

	it('flattens before handing to the core, and drops messageless interactions', async () => {
		const bridge = createUiBridge(fakeClient());
		const core = vi.fn(async (): Promise<void> => undefined);

		await bridge.dispatch(fakeButton() as unknown as NewUiComponentInteraction, core);
		expect(core).toHaveBeenCalledWith(STD_EVENT);

		const orphan = fakeButton({ message: null });
		await bridge.dispatch(orphan as unknown as NewUiComponentInteraction, core);
		expect(core).toHaveBeenCalledTimes(1);
	});

	it('keeps the mutex alive after a failing dispatch', async () => {
		const bridge = createUiBridge(fakeClient());
		const failing = vi.fn(async (): Promise<void> => { throw new Error('core bug'); });
		const after = fakeButton({ customId: 'ui2:s1:lotto/main#b' });
		const afterCore = vi.fn(async (): Promise<void> => undefined);

		await expect(bridge.dispatch(fakeButton() as unknown as NewUiComponentInteraction, failing)).rejects.toThrow('core bug');
		await bridge.dispatch(after as unknown as NewUiComponentInteraction, afterCore);

		expect(afterCore).toHaveBeenCalledTimes(1);
	});
});

describe('delivery seams', () => {
	it('editMessage edits the fetched message', async () => {
		const edit = vi.fn(async () => undefined);
		const channel = {
			isSendable: (): boolean => true,
			messages: { fetch: vi.fn(async () => ({ edit })) },
		};
		const bridge = createUiBridge(fakeClient({ c1: channel }));
		const payload = { flags: MessageFlags.IsComponentsV2, components: [] };

		await bridge.platform.editMessage({ channelId: 'c1', messageId: 'm1' }, payload as never);

		expect(channel.messages.fetch).toHaveBeenCalledWith('m1');
		expect(edit).toHaveBeenCalledWith(payload);
	});

	it('editMessage throws on an unfetchable channel (the pipeline owns failures)', async () => {
		const bridge = createUiBridge(fakeClient());
		await expect(bridge.platform.editMessage({ channelId: 'gone', messageId: 'm1' }, {} as never))
			.rejects.toThrow('not a message channel');
	});

	it('sendToChannel sends and reports where it landed', async () => {
		const channel = { isSendable: (): boolean => true, send: vi.fn(async () => ({ id: 'm9' })) };
		const bridge = createUiBridge(fakeClient({ c2: channel }));

		const ref = await bridge.sendToChannel('c2', { flags: MessageFlags.IsComponentsV2, components: [] } as never);

		expect(ref).toEqual({ channelId: 'c2', messageId: 'm9' });
	});

	it('replySender replies publicly with fetchReply and reports the message', async () => {
		const interaction = {
			reply: vi.fn(async () => ({ id: 'm5', channelId: 'c3' })),
		} as unknown as ChatInputCommandInteraction;
		const bridge = createUiBridge(fakeClient());

		const ref = await bridge.replySender(interaction).send({ flags: MessageFlags.IsComponentsV2, components: [] } as never);

		expect(ref).toEqual({ channelId: 'c3', messageId: 'm5' });
		const options = interaction.reply as unknown as ReturnType<typeof vi.fn>;
		expect(options.mock.calls[0][0]).toMatchObject({ fetchReply: true });
	});
});
