/**
 * Command derivation with arguments: how declared arguments become Discord
 * options on the registered builder (bare command or subcommand), and how
 * an invocation's typed values reach the leaf's data resolver.
 *
 * @module discord/__tests__/derive-args
 */

import type { ChatInputCommandInteraction } from 'discord.js';
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
