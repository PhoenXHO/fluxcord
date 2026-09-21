/**
 * createBot host tests: the registration seam. A `registerCommands`
 * callback replaces the built-in bulk `set()` wholesale and receives
 * every derived command with its source module; without it the default
 * path still posts the derived bodies.
 *
 * @module discord/__tests__/create-bot
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { command, mounts } from '../../command/declare.js';
import { screen } from '../../flow/screen.js';
import { flow } from '../../flow/token.js';
import { text, view } from '../../tree/builders.js';
import { createBot } from '../create-bot.js';
import type { CommandRegistration } from '../create-bot.js';

/** A ready fake client whose command set and login are recorded, not sent. */
function fakeReadyClient(set: (bodies: unknown, guild?: string) => Promise<unknown>): {
	client: Client;
	login: (token: string) => Promise<void>;
} {
	const login = vi.fn(async (_token: string) => undefined);
	const client = {
		isReady: (): boolean => true,
		on: vi.fn(),
		once: vi.fn(),
		login,
		application: { commands: { set } },
	} as unknown as Client;
	return { client, login };
}

/**
 * Runs the body with a controlled environment and restores whatever it
 * replaced afterwards, so the suite never leaks machine state.
 */
async function withEnv(vars: Record<string, string | undefined>, run: () => void | Promise<void>): Promise<void> {
	const saved: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(vars)) {
		saved[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		await run();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

/** Lets the void-fired registration settle before assertions. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const aboutFlow = flow('about', {
	screens: { main: screen()(() => view({}, text('about'))) },
	first: 'main',
});
const aboutCommand = command('about', 'Open the about panel', { mount: mounts(aboutFlow) });

const counterFlow = flow('counter', {
	screens: { main: screen()(() => view({}, text('counter'))) },
	first: 'main',
});
const counterCommand = command('counter', 'Open the counter', { mount: mounts(counterFlow) });

describe('createBot - the registration seam', () => {
	it('hands the callback the ready client and every command with its module, and skips the default set', async () => {
		const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
		const registerCommands = vi.fn(async (_client: Client<true>, _commands: readonly CommandRegistration[]) => undefined);
		const { client } = fakeReadyClient(set);
		createBot({
			modules: [
				{ name: 'about', commands: [aboutCommand] },
				{ name: 'counter', commands: [counterCommand] },
			],
			token: 't',
			guildId: 'g1',
			registerCommands,
			client,
			sweeper: false,
		});
		await flush();
		expect(registerCommands).toHaveBeenCalledTimes(1);
		const [ready, registrations] = registerCommands.mock.calls[0];
		expect(ready).toBe(client);
		expect(registrations.map((entry) => entry.module)).toEqual(['about', 'counter']);
		expect(registrations.map((entry) => entry.command.data.name)).toEqual(['about', 'counter']);
		expect(set).not.toHaveBeenCalled();
	});

	it('without the callback the default bulk set still posts the derived bodies', async () => {
		const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
		createBot({
			modules: [{ name: 'about', commands: [aboutCommand] }],
			token: 't',
			client: fakeReadyClient(set).client,
			sweeper: false,
		});
		await flush();
		expect(set).toHaveBeenCalledTimes(1);
		expect(set.mock.calls[0][0]).toHaveLength(1);
	});
});

describe('createBot - conventional env fallback', () => {
	it('reads DISCORD_TOKEN and DISCORD_GUILD_ID when the options are omitted', async () => {
		await withEnv({ DISCORD_TOKEN: 'env-token', DISCORD_GUILD_ID: 'g-env' }, async () => {
			const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
			const { client, login } = fakeReadyClient(set);
			const bot = createBot({
				modules: [{ name: 'about', commands: [aboutCommand] }],
				client,
				sweeper: false,
			});
			await bot.start();
			expect(login).toHaveBeenCalledWith('env-token');
			expect(set).toHaveBeenCalledTimes(1);
			expect(set.mock.calls[0][1]).toBe('g-env');
		});
	});

	it('explicit options win over the environment', async () => {
		await withEnv({ DISCORD_TOKEN: 'env-token', DISCORD_GUILD_ID: 'g-env' }, async () => {
			const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
			const { client, login } = fakeReadyClient(set);
			const bot = createBot({
				modules: [{ name: 'about', commands: [aboutCommand] }],
				token: 'explicit',
				guildId: 'g-explicit',
				client,
				sweeper: false,
			});
			await bot.start();
			expect(login).toHaveBeenCalledWith('explicit');
			expect(set.mock.calls[0][1]).toBe('g-explicit');
		});
	});

	it('throws a readable error when neither option nor environment carries a token', async () => {
		await withEnv({ DISCORD_TOKEN: undefined }, () => {
			expect(() =>
				createBot({ modules: [{ name: 'about', commands: [aboutCommand] }], sweeper: false }),
			).toThrow(/DISCORD_TOKEN/);
		});
	});
});
