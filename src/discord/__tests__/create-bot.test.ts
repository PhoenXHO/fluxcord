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
import { arg } from '../../command/args.js';
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
	destroy: () => Promise<void>;
} {
	const login = vi.fn(async (_token: string) => undefined);
	const destroy = vi.fn(async () => undefined);
	const client = {
		isReady: (): boolean => true,
		on: vi.fn(),
		once: vi.fn(),
		login,
		destroy,
		application: { commands: { set } },
	} as unknown as Client;
	return { client, login, destroy };
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

const devFlow = flow('dev-tool', {
	screens: { dev: screen()(() => view({}, text('dev'))) },
	first: 'dev',
});
const devCommand = command('dev-tool', 'Dev only tool', { devOnly: true, mount: mounts(devFlow) });

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

describe('createBot - autocomplete', () => {
	it('routes an autocomplete interaction to the command whose argument asked for it', async () => {
		const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
		const { client } = fakeReadyClient(set);
		const picker = command('pick', 'Pick something', {
			mount: mounts(aboutFlow, { args: [arg.string('thing', 'A thing', { autocomplete: (typed) => [{ name: typed, value: typed }] })] }),
		});
		createBot({ modules: [{ name: 'pick', commands: [picker] }], token: 't', client, sweeper: false });
		await flush();

		const listener = vi.mocked(client.on).mock.calls.find(([event]) => event === 'interactionCreate')?.[1] as (i: unknown) => Promise<void>;
		const respond = vi.fn(async (): Promise<void> => undefined);
		await listener({
			isAutocomplete: (): boolean => true,
			isChatInputCommand: (): boolean => false,
			isMessageComponent: (): boolean => false,
			isModalSubmit: (): boolean => false,
			commandName: 'pick',
			user: { id: 'u1' },
			guildId: 'g1',
			channelId: 'c1',
			respond,
			options: {
				getFocused: () => ({ name: 'thing', value: 'abc' }),
				getSubcommand: () => null,
				data: [{ name: 'thing', value: 'abc', focused: true }],
			},
		});

		expect(respond).toHaveBeenCalledWith([{ name: 'abc', value: 'abc' }]);
	});
});

describe('createBot - the host seams', () => {
	/** An autocomplete interaction for `/pick`, with the reply recorded. */
	const pickInteraction = (respond: () => Promise<void>): unknown => ({
		isAutocomplete: (): boolean => true,
		isChatInputCommand: (): boolean => false,
		isMessageComponent: (): boolean => false,
		isModalSubmit: (): boolean => false,
		commandName: 'pick',
		user: { id: 'u1' },
		guildId: 'g1',
		channelId: 'c1',
		respond,
		options: {
			getFocused: () => ({ name: 'thing', value: 'abc' }),
			getSubcommand: () => null,
			data: [{ name: 'thing', value: 'abc', focused: true }],
		},
	});
	const picker = command('pick', 'Pick something', {
		mount: mounts(aboutFlow, { args: [arg.string('thing', 'A thing', { autocomplete: (typed) => [{ name: typed, value: typed }] })] }),
	});
	const listenerOf = (client: Client): ((i: unknown) => Promise<void>) =>
		vi.mocked(client.on).mock.calls.find(([event]) => event === 'interactionCreate')?.[1] as (i: unknown) => Promise<void>;

	it('intercept wraps the routing: next runs it, and not calling next drops the interaction', async () => {
		const { client } = fakeReadyClient(async () => []);
		let letThrough = true;
		const seen = vi.fn();
		createBot({
			modules: [{ name: 'pick', commands: [picker] }],
			token: 't',
			client,
			sweeper: false,
			intercept: async (interaction, next) => {
				seen(interaction);
				if (letThrough) await next();
			},
		});
		await flush();
		const respond = vi.fn(async (): Promise<void> => undefined);

		await listenerOf(client)(pickInteraction(respond));
		expect(seen).toHaveBeenCalledTimes(1);
		expect(respond).toHaveBeenCalledTimes(1);

		letThrough = false;
		await listenerOf(client)(pickInteraction(respond));
		expect(seen).toHaveBeenCalledTimes(2);
		expect(respond).toHaveBeenCalledTimes(1);
	});

	it('a throw inside intercept reaches onError as a framework failure', async () => {
		const { client } = fakeReadyClient(async () => []);
		const onError = vi.fn();
		createBot({
			modules: [{ name: 'pick', commands: [picker] }],
			token: 't',
			client,
			sweeper: false,
			onError,
			intercept: async () => {
				throw new Error('gate broke');
			},
		});
		await flush();
		await listenerOf(client)(pickInteraction(async () => undefined));
		await flush();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][0].error).toEqual(new Error('gate broke'));
	});

	it('wrapBridge receives the shipped port and its result is what the runtime talks through', async () => {
		const wrapBridge = vi.fn((port) => port);
		createBot({
			modules: [{ name: 'about', commands: [aboutCommand] }],
			token: 't',
			client: fakeReadyClient(async () => []).client,
			sweeper: false,
			wrapBridge,
		});
		expect(wrapBridge).toHaveBeenCalledTimes(1);
		expect(typeof wrapBridge.mock.calls[0][0].replyToActor).toBe('function');
	});


	it('onReady runs and settles before commands register', async () => {
		const order: string[] = [];
		const registerCommands = vi.fn(async () => {
			order.push('register');
		});
		createBot({
			modules: [{ name: 'about', commands: [aboutCommand] }],
			token: 't',
			client: fakeReadyClient(async () => []).client,
			sweeper: false,
			onReady: async () => {
				await flush();
				order.push('ready');
			},
			registerCommands,
		});
		await flush();
		await flush();
		expect(order).toEqual(['ready', 'register']);
	});

	it('an onReady rejection goes to onError and registration still runs', async () => {
		const onError = vi.fn();
		const registerCommands = vi.fn(async () => undefined);
		createBot({
			modules: [{ name: 'about', commands: [aboutCommand] }],
			token: 't',
			client: fakeReadyClient(async () => []).client,
			sweeper: false,
			onError,
			onReady: async () => {
				throw new Error('init failed');
			},
			registerCommands,
		});
		await flush();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(registerCommands).toHaveBeenCalledTimes(1);
	});

	it('stop closes the client', async () => {
		const { client, destroy } = fakeReadyClient(async () => []);
		const bot = createBot({
			modules: [{ name: 'about', commands: [aboutCommand] }],
			token: 't',
			client,
		});
		await bot.stop();
		expect(destroy).toHaveBeenCalledTimes(1);
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

describe('createBot - dev-only registration', () => {
	it('dev-only commands are dropped when no dev guild is set', async () => {
		await withEnv({ DISCORD_DEV_GUILD_ID: undefined }, async () => {
			const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
			createBot({
				modules: [{ name: 'lab', commands: [aboutCommand, devCommand] }],
				token: 't',
				guildId: 'g1',
				client: fakeReadyClient(set).client,
				sweeper: false,
			});
			await flush();
			expect(set).toHaveBeenCalledTimes(1);
			const bodies = set.mock.calls[0][0] as { name: string }[];
			expect(bodies.map((body) => body.name)).toEqual(['about']);
		});
	});

	it('dev-only commands register in the dev guild alone', async () => {
		const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
		createBot({
			modules: [{ name: 'lab', commands: [aboutCommand, devCommand] }],
			token: 't',
			guildId: 'g1',
			devGuildId: 'dev1',
			client: fakeReadyClient(set).client,
			sweeper: false,
		});
		await flush();
		expect(set).toHaveBeenCalledTimes(2);
		const publicCall = set.mock.calls.find((call) => call[1] === 'g1');
		const devCall = set.mock.calls.find((call) => call[1] === 'dev1');
		expect((publicCall![0] as { name: string }[]).map((body) => body.name)).toEqual(['about']);
		expect((devCall![0] as { name: string }[]).map((body) => body.name)).toEqual(['dev-tool']);
	});

	it('one guild for both scopes merges into a single registration call', async () => {
		const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
		createBot({
			modules: [{ name: 'lab', commands: [aboutCommand, devCommand] }],
			token: 't',
			guildId: 'g1',
			devGuildId: 'g1',
			client: fakeReadyClient(set).client,
			sweeper: false,
		});
		await flush();
		expect(set).toHaveBeenCalledTimes(1);
		expect(set.mock.calls[0][1]).toBe('g1');
		const bodies = set.mock.calls[0][0] as { name: string }[];
		expect(bodies.map((body) => body.name)).toEqual(['about', 'dev-tool']);
	});

	it('reads DISCORD_DEV_GUILD_ID when the option is omitted', async () => {
		await withEnv({ DISCORD_DEV_GUILD_ID: 'dev-env' }, async () => {
			const set = vi.fn(async (_bodies: unknown, _guild?: string) => []);
			createBot({
				modules: [{ name: 'lab', commands: [aboutCommand, devCommand] }],
				token: 't',
				guildId: 'g1',
				client: fakeReadyClient(set).client,
				sweeper: false,
			});
			await flush();
			const devCall = set.mock.calls.find((call) => call[1] === 'dev-env');
			expect(devCall).toBeDefined();
			expect((devCall![0] as { name: string }[]).map((body) => body.name)).toEqual(['dev-tool']);
		});
	});
});
