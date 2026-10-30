/**
 * Command derivation tests: how a `command` declaration becomes the
 * registration-ready builder, and how the door gate evaluates before
 * anything mounts. Deny = an ephemeral reply, no panel; a host without
 * a checkDoor seam (no policy option) never asks.
 *
 * @module discord/__tests__/derive
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { command, mounts } from '../../command/declare.js';
import { screen } from '../../flow/screen.js';
import { flow } from '../../flow/token.js';
import { policy } from '../../pipeline/policy.js';
import type { Policy, PolicyDecision } from '../../pipeline/types.js';
import { text, view } from '../../tree/builders.js';
import { deriveCommand } from '../derive.js';
import { setUiHost } from '../ui-host.js';
import type { UiHost } from '../ui-host.js';

const dummy = flow('dummy', {
	screens: { main: screen()(() => view({}, text('dummy'))) },
	first: 'main',
});

describe('deriveCommand - descriptions', () => {
	it('a bare leaf with its own description overrides the command description', () => {
		const cmd = command('tool', 'Command level', {
			mount: mounts(dummy, { description: 'Leaf level' }),
		});
		expect(deriveCommand(cmd).data.description).toBe('Leaf level');
	});

	it('a bare leaf without a description keeps the command description', () => {
		const cmd = command('tool', 'Command level', { mount: mounts(dummy) });
		expect(deriveCommand(cmd).data.description).toBe('Command level');
	});

	it('grouped subcommands carry their own descriptions', () => {
		const cmd = command('tool', 'Command level', {
			subcommands: {
				one: { ...mounts(dummy), description: 'First' },
				two: { ...mounts(dummy), description: 'Second' },
			},
		});
		const json = deriveCommand(cmd).data.toJSON();
		const options = json.options as { name: string; description: string }[];
		expect(options.map((option) => [option.name, option.description])).toEqual([
			['one', 'First'],
			['two', 'Second'],
		]);
	});
});

describe('the command door', () => {
	/** A bare command whose single leaf carries the gate under test. */
	function gatedCommand(gate: Policy): ReturnType<typeof deriveCommand> {
		return deriveCommand(command('panel', 'The panel', { mount: mounts(dummy, { policy: gate }) }));
	}

	/** A minimal chat-input fake: identity, reply, nothing else. */
	function fakeInteraction(): ChatInputCommandInteraction {
		return {
			user: { id: 'u1' },
			guildId: 'g1',
			channelId: 'c1',
			reply: vi.fn(async () => undefined),
			options: { getSubcommand: (): string => 'main' },
		} as unknown as ChatInputCommandInteraction;
	}

	/** Host stubs: the mount spy plus a checkDoor the test controls. */
	function hostWith(checkDoor: UiHost['checkDoor']): { mount: ReturnType<typeof vi.fn> } {
		const mount = vi.fn(async (): Promise<undefined> => undefined);
		setUiHost({
			mount: mount as unknown as UiHost['mount'],
			replySender: vi.fn(() => ({
				send: async (): Promise<{ channelId: string; messageId: string }> => ({ channelId: 'c1', messageId: 'm1' }),
			})) as UiHost['replySender'],
			...(checkDoor !== undefined ? { checkDoor } : {}),
		});
		return { mount };
	}

	it('a denied gate replies ephemeral with the gate\'s copy and mounts nothing', async () => {
		const { mount } = hostWith(async (): Promise<PolicyDecision> => ({ allowed: false, denyMessage: 'Admins only.' }));
		const interaction = fakeInteraction();

		await gatedCommand(policy.privilege('admin')).execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({ content: 'Admins only.', flags: MessageFlags.Ephemeral });
		expect(mount).not.toHaveBeenCalled();
	});

	it('a denial without copy falls back to the generic message', async () => {
		const { mount } = hostWith(async (): Promise<PolicyDecision> => ({ allowed: false }));
		const interaction = fakeInteraction();

		await gatedCommand(policy.deny()).execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({ content: "You don't have permission to do that.", flags: MessageFlags.Ephemeral });
		expect(mount).not.toHaveBeenCalled();
	});

	it('an allowed gate mounts the leaf\'s flow, and the door saw the gate', async () => {
		const gate = policy.privilege('admin');
		let seenGate: Policy | undefined;
		let seenFlow: unknown;
		const { mount } = hostWith(async (flow, doorGate): Promise<PolicyDecision> => {
			seenGate = doorGate;
			seenFlow = flow;
			return { allowed: true };
		});
		const interaction = fakeInteraction();

		await gatedCommand(gate).execute(interaction);

		expect(interaction.reply).not.toHaveBeenCalled();
		expect(seenGate).toBe(gate);
		expect(seenFlow).toBe(dummy);
		expect(mount).toHaveBeenCalledTimes(1);
	});

	it('an ungated leaf never asks the door', async () => {
		const checkDoor = vi.fn(async (): Promise<PolicyDecision> => ({ allowed: false }));
		const { mount } = hostWith(checkDoor);
		const interaction = fakeInteraction();

		await deriveCommand(command('open', 'Open', { mount: mounts(dummy) })).execute(interaction);

		expect(checkDoor).not.toHaveBeenCalled();
		expect(mount).toHaveBeenCalledTimes(1);
	});

	it('a gated leaf under a host with no policy option mounts unchecked', async () => {
		const { mount } = hostWith(undefined);
		const interaction = fakeInteraction();

		await gatedCommand(policy.privilege('admin')).execute(interaction);

		expect(mount).toHaveBeenCalledTimes(1);
	});
});

describe('persistent command mounts', () => {
	interface PollBag { pollId: string }
	const poll = flow<PollBag>('poll', {
		screens: { main: screen<PollBag>()(() => view({}, text('poll'))) },
		first: 'main',
		initialData: { pollId: '' },
	});
	const interaction = {
		user: { id: 'u1' },
		guildId: 'g1',
		channelId: 'c1',
		reply: vi.fn(async () => undefined),
		options: { getSubcommand: (): string => 'main' },
	} as unknown as ChatInputCommandInteraction;

	/** Host stubs: a mount that posts (or fails with the given error). */
	function hostMounting(failure?: Error): ReturnType<typeof vi.fn> {
		const handle = { sessionId: 's1', messageId: 'm1' };
		const mount = vi.fn(async () => {
			if (failure !== undefined) throw failure;
			return handle;
		});
		setUiHost({
			mount: mount as unknown as UiHost['mount'],
			replySender: vi.fn(() => ({ send: vi.fn() })) as unknown as UiHost['replySender'],
		});
		return mount;
	}

	it('takes the rehydrate ref from the bag, then hands the bag and the handle to onMounted', async () => {
		const mount = hostMounting();
		const onMounted = vi.fn();
		const onMountFailed = vi.fn();
		const cmd = command('poll', 'Start a poll', {
			mount: mounts(poll, {
				data: () => ({ pollId: 'p1' }),
				rehydrateRef: (bag) => `poll:${bag.pollId}`,
				onMounted,
				onMountFailed,
			}),
		});

		await deriveCommand(cmd).execute(interaction);

		expect(mount).toHaveBeenCalledWith(poll, expect.objectContaining({ rehydrateRef: 'poll:p1', data: { pollId: 'p1' } }));
		expect(onMounted).toHaveBeenCalledWith({ pollId: 'p1' }, { sessionId: 's1', messageId: 'm1' });
		expect(onMountFailed).not.toHaveBeenCalled();
	});

	it('runs onMountFailed when the post fails, then throws the error on', async () => {
		const failure = new Error('Missing Access');
		hostMounting(failure);
		const onMounted = vi.fn();
		const onMountFailed = vi.fn();
		const cmd = command('poll', 'Start a poll', {
			mount: mounts(poll, { data: () => ({ pollId: 'p1' }), onMounted, onMountFailed }),
		});

		await expect(deriveCommand(cmd).execute(interaction)).rejects.toBe(failure);

		expect(onMountFailed).toHaveBeenCalledWith({ pollId: 'p1' }, failure);
		expect(onMounted).not.toHaveBeenCalled();
	});

	it('rejects the hooks on a leaf with no data resolver', () => {
		expect(() => command('poll', 'Start a poll', {
			mount: mounts(poll, { onMounted: vi.fn() }),
		})).toThrow("command 'poll': onMounted read the bag the data resolver builds; declare data");
	});

	it('rejects a rehydrate ref on an ephemeral leaf', () => {
		expect(() => command('poll', 'Start a poll', {
			subcommands: {
				start: mounts(poll, { description: 'Start', ephemeral: true, data: () => ({ pollId: 'p1' }), rehydrateRef: (bag) => bag.pollId }),
			},
		})).toThrow("command 'poll start': an ephemeral panel cannot rehydrate");
	});
});
