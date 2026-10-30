/**
 * Command derivation with arguments: how declared arguments become Discord
 * options on the registered builder (bare command or subcommand), and how
 * an invocation's typed values reach the leaf's data resolver.
 *
 * @module discord/__tests__/derive-args
 */

import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { arg } from '../../command/args.js';
import { command, mounts } from '../../command/declare.js';
import { screen } from '../../flow/screen.js';
import { flow } from '../../flow/token.js';
import { text, view } from '../../tree/builders.js';
import { deriveCommand } from '../derive.js';
import { setUiHost } from '../ui-host.js';
import type { UiHost } from '../ui-host.js';

const dummy = flow('dummy', {
	screens: { main: screen()(() => view({}, text('dummy'))) },
	first: 'main',
});

interface JsonOption {
	name: string;
	type: number;
	required?: boolean;
	description: string;
	choices?: { name: string; value: string | number }[];
	min_value?: number;
	max_value?: number;
	min_length?: number;
	max_length?: number;
}

// Discord's ApplicationCommandOptionType numbers.
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;

describe('deriveCommand - arguments on the builder', () => {
	it('a bare leaf registers its arguments in declaration order', () => {
		const cmd = command('whois', 'Look someone up', {
			mount: mounts(dummy, {
				args: [
					arg.user('member', 'Who to look up', { required: true }),
					arg.integer('torn_id', 'Or a Torn id', { min: 1, max: 99 }),
					arg.string('status', 'Filter', { choices: ['verified', { name: 'Not linked', value: 'pending' }] }),
					arg.boolean('loud', 'Be loud'),
				],
			}),
		});
		const options = deriveCommand(cmd).data.toJSON().options as JsonOption[];
		expect(options.map((o) => [o.name, o.type, o.required ?? false])).toEqual([
			['member', USER, true],
			['torn_id', INTEGER, false],
			['status', STRING, false],
			['loud', BOOLEAN, false],
		]);
		expect(options[1]).toMatchObject({ min_value: 1, max_value: 99 });
		expect(options[2].choices).toEqual([
			{ name: 'verified', value: 'verified' },
			{ name: 'Not linked', value: 'pending' },
		]);
	});

	it('string length limits reach the builder', () => {
		const cmd = command('note', 'Take a note', {
			mount: mounts(dummy, { args: [arg.string('text', 'The note', { minLength: 2, maxLength: 40 })] }),
		});
		const [option] = deriveCommand(cmd).data.toJSON().options as JsonOption[];
		expect(option).toMatchObject({ min_length: 2, max_length: 40 });
	});

	it('a subcommand leaf carries its own arguments', () => {
		const cmd = command('tool', 'A tool', {
			subcommands: {
				find: { ...mounts(dummy, { args: [arg.user('member', 'Who')] }), description: 'Find' },
				list: { ...mounts(dummy), description: 'List' },
			},
		});
		const subs = deriveCommand(cmd).data.toJSON().options as { name: string; options?: JsonOption[] }[];
		expect(subs.find((s) => s.name === 'find')?.options?.map((o) => o.name)).toEqual(['member']);
		expect(subs.find((s) => s.name === 'list')?.options ?? []).toEqual([]);
	});

	it('a leaf with no arguments registers none', () => {
		const cmd = command('plain', 'Plain', { mount: mounts(dummy) });
		expect(deriveCommand(cmd).data.toJSON().options ?? []).toEqual([]);
	});
});

describe('deriveCommand - autocomplete', () => {
	const suggest = vi.fn((typed: string) => [{ name: `Match ${typed}`, value: typed }]);

	/** A fake autocomplete interaction: the focused option, the others already typed, and a recorded respond. */
	function typing(
		focused: { name: string; value: string },
		others: Record<string, string | number> = {},
		subcommand?: string,
	): { interaction: AutocompleteInteraction; respond: ReturnType<typeof vi.fn> } {
		const respond = vi.fn(async (): Promise<void> => undefined);
		const flat = [
			{ name: focused.name, value: focused.value, focused: true },
			...Object.entries(others).map(([name, value]) => ({ name, value })),
		];
		const interaction = {
			user: { id: 'u1' },
			guildId: 'g1',
			channelId: 'c1',
			respond,
			options: {
				getFocused: (): { name: string; value: string } => focused,
				getSubcommand: (): string | null => subcommand ?? null,
				data: subcommand === undefined ? flat : [{ name: subcommand, options: flat }],
			},
		} as unknown as AutocompleteInteraction;
		return { interaction, respond };
	}

	it('registers an autocomplete argument as such', () => {
		const cmd = command('lotto', 'Lotto', {
			mount: mounts(dummy, { args: [arg.string('item', 'An item', { autocomplete: suggest }), arg.string('note', 'A note')] }),
		});
		const options = deriveCommand(cmd).data.toJSON().options as (JsonOption & { autocomplete?: boolean })[];
		expect(options.find((o) => o.name === 'item')?.autocomplete).toBe(true);
		expect(options.find((o) => o.name === 'note')?.autocomplete).toBeUndefined();
	});

	it('a command with no autocomplete argument has no autocomplete handler', () => {
		const cmd = command('plain', 'Plain', { mount: mounts(dummy, { args: [arg.string('note', 'A note')] }) });
		expect(deriveCommand(cmd).autocomplete).toBeUndefined();
	});

	it('answers with the handler\'s choices for what was typed', async () => {
		suggest.mockClear();
		const cmd = command('lotto', 'Lotto', { mount: mounts(dummy, { args: [arg.string('item', 'An item', { autocomplete: suggest })] }) });
		const { interaction, respond } = typing({ name: 'item', value: 'xan' });

		await deriveCommand(cmd).autocomplete!(interaction);

		expect(suggest).toHaveBeenCalledWith('xan', expect.objectContaining({ guildId: 'g1', userId: 'u1', channelId: 'c1' }));
		expect(respond).toHaveBeenCalledWith([{ name: 'Match xan', value: 'xan' }]);
	});

	it('hands the handler the other options already typed, not the focused one', async () => {
		const seen: unknown[] = [];
		const cmd = command('lotto', 'Lotto', {
			mount: mounts(dummy, {
				args: [
					arg.string('item', 'An item', { autocomplete: (_typed, context) => { seen.push(context.values); return []; } }),
					arg.integer('amount', 'How many'),
				],
			}),
		});
		const { interaction } = typing({ name: 'item', value: 'x' }, { amount: 3 });

		await deriveCommand(cmd).autocomplete!(interaction);

		expect(seen).toEqual([{ amount: 3 }]);
	});

	it('routes a subcommand to its own leaf and focused argument', async () => {
		const other = vi.fn(() => [{ name: 'Wrong', value: 'wrong' }]);
		const cmd = command('lotto', 'Lotto', {
			subcommands: {
				start: { ...mounts(dummy, { args: [arg.string('item', 'An item', { autocomplete: suggest })] }), description: 'Start' },
				join: { ...mounts(dummy, { args: [arg.string('item', 'An item', { autocomplete: other })] }), description: 'Join' },
			},
		});
		const { interaction, respond } = typing({ name: 'item', value: 'b' }, {}, 'start');

		await deriveCommand(cmd).autocomplete!(interaction);

		expect(respond).toHaveBeenCalledWith([{ name: 'Match b', value: 'b' }]);
		expect(other).not.toHaveBeenCalled();
	});

	it('answers with nothing for an argument that has no handler', async () => {
		const cmd = command('lotto', 'Lotto', {
			mount: mounts(dummy, { args: [arg.string('item', 'An item', { autocomplete: suggest }), arg.string('note', 'A note')] }),
		});
		const { interaction, respond } = typing({ name: 'note', value: 'hi' });

		await deriveCommand(cmd).autocomplete!(interaction);

		expect(respond).toHaveBeenCalledWith([]);
	});

	it('keeps 25 choices, trims long labels, and awaits an async handler', async () => {
		const many = Array.from({ length: 30 }, (_, i) => ({ name: 'n'.repeat(150) + i, value: `v${i}` }));
		const cmd = command('lotto', 'Lotto', {
			mount: mounts(dummy, { args: [arg.string('item', 'An item', { autocomplete: async () => many })] }),
		});
		const { interaction, respond } = typing({ name: 'item', value: '' });

		await deriveCommand(cmd).autocomplete!(interaction);

		const [answered] = respond.mock.calls[0] as [{ name: string; value: string }[]];
		expect(answered).toHaveLength(25);
		expect(answered[0].name).toHaveLength(100);
		expect(answered[0].value).toBe('v0');
	});

	it('answers with nothing and rethrows when the handler fails, so the host can log it', async () => {
		const boom = new Error('lookup failed');
		const cmd = command('lotto', 'Lotto', {
			mount: mounts(dummy, { args: [arg.string('item', 'An item', { autocomplete: () => { throw boom; } })] }),
		});
		const { interaction, respond } = typing({ name: 'item', value: 'x' });

		await expect(deriveCommand(cmd).autocomplete!(interaction)).rejects.toBe(boom);
		expect(respond).toHaveBeenCalledWith([]);
	});
});

describe('deriveCommand - argument values', () => {
	/** A fake invocation whose options hold exactly the given values. */
	function invoked(given: Record<string, string | number | boolean>, subcommand = 'run'): ChatInputCommandInteraction {
		return {
			user: { id: 'u1' },
			guildId: 'g1',
			channelId: 'c1',
			reply: vi.fn(async () => undefined),
			options: {
				getSubcommand: (): string => subcommand,
				get: (name: string): { value: string | number | boolean } | null =>
					name in given ? { value: given[name] } : null,
			},
		} as unknown as ChatInputCommandInteraction;
	}

	function host(): { mount: ReturnType<typeof vi.fn> } {
		const mount = vi.fn(async (): Promise<undefined> => undefined);
		setUiHost({
			mount: mount as unknown as UiHost['mount'],
			replySender: vi.fn(() => ({
				send: async (): Promise<{ channelId: string; messageId: string }> => ({ channelId: 'c1', messageId: 'm1' }),
			})) as UiHost['replySender'],
		});
		return { mount };
	}

	it('the resolver gets what the invoker typed, and only that', async () => {
		const seen: Record<string, unknown>[] = [];
		const { mount } = host();
		const cmd = command('whois', 'Look someone up', {
			mount: mounts(dummy, {
				args: [arg.user('member', 'Who'), arg.integer('torn_id', 'Id')],
				data: (_context, args) => {
					seen.push({ ...args });
					return { seeded: true };
				},
			}),
		});

		await deriveCommand(cmd).execute(invoked({ member: '123' }));

		expect(seen).toEqual([{ member: '123' }]);
		expect(mount).toHaveBeenCalledWith(dummy, expect.objectContaining({ data: { seeded: true } }));
	});

	it('the resolver still gets the invocation as its first parameter', async () => {
		host();
		let first: unknown;
		const interaction = invoked({});
		const cmd = command('plain', 'Plain', {
			mount: mounts(dummy, { data: (context) => { first = context; return undefined; } }),
		});

		await deriveCommand(cmd).execute(interaction);

		expect(first).toBe(interaction);
	});

	it('a subcommand reads its own arguments', async () => {
		const seen: unknown[] = [];
		host();
		const cmd = command('tool', 'A tool', {
			subcommands: {
				run: {
					...mounts(dummy, { args: [arg.string('target', 'Target', { required: true })], data: (_c, args) => { seen.push(args.target); return undefined; } }),
					description: 'Run',
				},
			},
		});

		await deriveCommand(cmd).execute(invoked({ target: 'alpha' }, 'run'));

		expect(seen).toEqual(['alpha']);
	});
});
