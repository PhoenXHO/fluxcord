/**
 * createBot: the one-call host.
 *
 * The whole boot a Discord host writes by hand, collapsed into one
 * function: the client, the bridge, the runtime, the
 * UI host wiring, command registration and the interaction listener.
 * What comes back is the small surface an app can still want afterwards:
 * `start` (login), the raw `client` (for listeners fluxcord does not
 * cover) and `mount` (programmatic panels). The standalone pieces remain
 * exported for custom hosts; they are just no longer the front door.
 *
 * The shipped permission default is open: nothing is gated unless a
 * policy says so. A `policy` option either names the privilege facts the
 * shipped engine evaluates against, or replaces the engine with any
 * PolicyPort.
 *
 * The conventional environment variables spare the common host any
 * plumbing: an omitted `token`, `guildId` or `devGuildId` option falls
 * back to `DISCORD_TOKEN` / `DISCORD_GUILD_ID` / `DISCORD_DEV_GUILD_ID`,
 * and the explicit option wins when both exist.
 *
 * @module discord/create-bot
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { Interaction } from 'discord.js';
import type { Command } from '../command/declare.js';
import type { Flow } from '../flow/token.js';
import { defaultOnError } from '../pipeline/dispatch.js';
import { createDefaultPolicyEngine, isPolicyPort } from '../pipeline/policy.js';
import type { PrivilegeFacts } from '../pipeline/policy.js';
import { ErrorSource } from '../pipeline/types.js';
import type { BridgePort, ErrorHandler, PartingOptions, PolicyPort } from '../pipeline/types.js';
import type { RehydrateStore } from '../state/types.js';
import { createUiRuntime } from '../runtime/create.js';
import type { MountHandle, MountOptions } from '../runtime/types.js';
import { deriveCommand } from './derive.js';
import { memberRoleIds } from './flatten.js';
import type { DerivedCommand } from './derive.js';
import { createUiBridge } from './platform.js';
import type { BridgeLogger } from './platform.js';
import { setUiHost } from './ui-host.js';

// used in docs
/* eslint-disable @typescript-eslint/no-unused-vars */
import { UiRuntime } from '../runtime/types.js';
/* eslint-enable */

/** One registration entry: a derived command and the module that declared it. */
export interface CommandRegistration {
	/** The name of the module the command came from. */
	readonly module: string;
	/** The derived command; its `data` builder is registration-ready. */
	readonly command: DerivedCommand;
}

/** The module fields createBot reads: a name to pair commands with, and the commands. Structural, so a plain object works. */
export interface CommandSourceModule {
	readonly name: string;
	readonly commands?: readonly Command[];
}

/** What createBot takes: the modules, the token, and any seam to override. */
export interface CreateBotOptions {
	/** The modules whose commands to register. Flows need no listing: declaring one with `flow()` registers it. */
	readonly modules: readonly CommandSourceModule[];
	/**
	 * The bot token; `start` logs in with it. Omit to read the
	 * conventional `DISCORD_TOKEN` environment variable; one of the two
	 * must exist.
	 */
	readonly token?: string;
	/**
	 * Scopes command registration to one guild when set; global
	 * otherwise. Omit to read the `DISCORD_GUILD_ID` environment
	 * variable; the option wins when both exist.
	 */
	readonly guildId?: string;
	/**
	 * Where dev-only commands register: a private guild. Omit to read the
	 * `DISCORD_DEV_GUILD_ID` environment variable; the option wins when
	 * both exist. Dev-only commands never ride the public registration;
	 * without a dev guild they are dropped entirely.
	 */
	readonly devGuildId?: string;
	/**
	 * Replaces the built-in registration wholesale: the ready client and
	 * every derived command (with its source module) arrive here, and
	 * whatever the callback does is the registration. `guildId` only
	 * feeds the default path. Omit for the default bulk `set()`.
	 */
	readonly registerCommands?: (client: Client<true>, commands: readonly CommandRegistration[]) => Promise<void>;
	/**
	 * Wraps every interaction before fluxcord routes it. `next` runs the
	 * shipped routing (command execute, autocomplete, component and modal
	 * dispatch); a host that never calls it drops the interaction. This is
	 * the seam for anything that must run around a command: authorization,
	 * stale filtering, logging, failure copy, ids fluxcord does not own. A
	 * throw lands in the same error unit as any listener failure. Omit and
	 * every interaction goes straight to `next`.
	 */
	readonly intercept?: (interaction: Interaction, next: () => Promise<void>) => Promise<void>;
	/**
	 * Decorates the bridge the runtime talks through: receives the shipped
	 * port and returns the one the runtime uses (swap `replyToActor` for a
	 * styled reply, say). Omit to use the shipped port as is.
	 */
	readonly wrapBridge?: (port: BridgePort) => BridgePort;
	/**
	 * Runs once the client is ready, awaited before commands register. A
	 * rejection goes to `onError` and boot carries on to registration.
	 */
	readonly onReady?: (client: Client<true>) => Promise<void>;
	/**
	 * The permission layer. Pass the facts object (`{ privileges }`) and
	 * the shipped engine evaluates the authored policy vocabulary against
	 * it; pass your own `PolicyPort` and the engine is out entirely.
	 * Default: nothing is gated.
	 */
	readonly policy?: PolicyPort | PrivilegeFacts;
	/**
	 * The host's global parting bundle: what a flow that declares no
	 * `parting` of its own expires into (and what a dead click on its
	 * panel renders), instead of the built-in screen. Flows with their
	 * own parting keep it.
	 */
	readonly defaultParting?: PartingOptions;
	/** Gateway intents for the built client. Default: `[Guilds]`. */
	readonly intents?: readonly GatewayIntentBits[];
	/**
	 * Bring-your-own client for custom intents or caching. Pass one that
	 * has not logged in yet: `start` owns the login either way.
	 */
	readonly client?: Client;
	/** Logs bridge-side anomalies (dropped replies, ack failures). Default: silence. */
	readonly logger?: BridgeLogger;
	/** Sends actor-facing copy (denials, error copy) publicly instead of ephemeral; a dev-observability switch. */
	readonly ephemeralAsPublic?: boolean;
	/** Backs rehydration; omit and rehydratable flows fail loudly at mount. */
	readonly rehydrate?: RehydrateStore;
	/** Reports handler and death-path failures; omit and the shipped default fails loud. */
	readonly onError?: ErrorHandler;
	/** Injectable clock for tests; defaults to Date.now. */
	readonly now?: () => number;
	/** Runs the expiry sweeper from boot; true by default. */
	readonly sweeper?: boolean;
}

/** What createBot hands back: the login and logout buttons and the two live seams. */
export interface Bot {
	/** Logs in; command registration, dispatch and the sweeper are already wired. */
	readonly start: () => Promise<void>;
	/** Stops the sweeper, then closes the client (parting edits need the connection, so that order). */
	readonly stop: () => Promise<void>;
	/** The raw client, for listeners fluxcord does not cover. */
	readonly client: Client;
	/** Opens a flow session programmatically (push panels, service surfaces). @see {@link UiRuntime.mount}. */
	readonly mount: <TData>(flow: Flow<TData>, options: MountOptions) => Promise<MountHandle<TData>>;
}

/** The shipped posture when the host declares no policy anywhere: nothing is gated. */
const openPolicy: PolicyPort = { authorize: () => Promise.resolve({ allowed: true }) };

/** Facts object in, engine out; a custom port passes through unchanged; nothing declared means nothing is gated. */
function normalizePolicy(value: PolicyPort | PrivilegeFacts | undefined): PolicyPort {
	if (value === undefined) return openPolicy;
	return isPolicyPort(value) ? value : createDefaultPolicyEngine(value);
}

/**
 * Builds the whole host around one options object. Nothing logs in here;
 * {@link Bot.start} does.
 *
 * @param options The modules, the token, and any seams to override.
 * @returns The bot: start, the raw client, and mount.
 */
export function createBot(options: CreateBotOptions): Bot {
	// A missing token fails here, readable, instead of surfacing as a
	// cryptic login rejection later.
	const token = options.token ?? process.env.DISCORD_TOKEN;
	if (token === undefined) {
		throw new Error('DISCORD_TOKEN is not set: pass a token option or set DISCORD_TOKEN');
	}
	// Guild scoping follows the same option-wins pattern.
	const guildId = options.guildId ?? process.env.DISCORD_GUILD_ID;
	const devGuildId = options.devGuildId ?? process.env.DISCORD_DEV_GUILD_ID;
	const client = options.client ?? new Client({ intents: [...(options.intents ?? [GatewayIntentBits.Guilds])] });
	const bridge = createUiBridge(client, {
		...(options.logger !== undefined ? { logger: options.logger } : {}),
		...(options.ephemeralAsPublic !== undefined ? { ephemeralAsPublic: options.ephemeralAsPublic } : {}),
	});
	const policyPort = normalizePolicy(options.policy);
	const runtime = createUiRuntime({
		platform: options.wrapBridge !== undefined ? options.wrapBridge(bridge.platform) : bridge.platform,
		sendToChannel: bridge.sendToChannel,
		policy: policyPort,
		...(options.rehydrate !== undefined ? { rehydrate: options.rehydrate } : {}),
		...(options.defaultParting !== undefined ? { defaultParting: options.defaultParting } : {}),
		...(options.onError !== undefined ? { onError: options.onError } : {}),
		...(options.now !== undefined ? { now: options.now } : {}),
		...(options.sweeper !== undefined ? { sweeper: options.sweeper } : {}),
	});
	setUiHost({
		mount: runtime.mount,
		replySender: bridge.replySender,
		// The command door: leaf gates evaluate here, where the policy port
		// lives. Absent when no policy option exists:
		// nothing gated, nothing asked.
		...(options.policy !== undefined ? {
			// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
			checkDoor: async (flow, gate, interaction) => {
				// Role-based gates (an app's admin privilege) read the actor's roles.
				const roles = memberRoleIds(interaction);
				return policyPort.authorize({
					actorId: interaction.user.id,
					...(roles !== undefined ? { actorRoleIds: roles } : {}),
					...(interaction.guildId !== null ? { guildId: interaction.guildId } : {}),
					...(interaction.channelId !== null ? { channelId: interaction.channelId } : {}),
					flowId: flow.id,
					...(gate !== undefined ? { actionPolicy: gate } : {}),
				});
			},
		} : {}),
	});

	// Module pairing survives derivation: a custom registration may want
	// to route by source module.
	const registrations = options.modules.flatMap((mod) =>
		(mod.commands ?? []).map((command) => ({ module: mod.name, command: deriveCommand(command) })),
	);
	const commands = registrations.map((entry) => entry.command);

	// A failure with no dispatch core around it (a listener rejection, a
	// failed ready hook) lands in the same error unit the runtime uses, with
	// the same containment: a custom unit that throws falls back to the
	// shipped one instead of escaping into the client's listener.
	const reportFailure = (error: unknown): void => {
		const report = {
			error,
			source: ErrorSource.Framework,
			reply: (): Promise<void> => Promise.resolve(),
		};
		try {
			(options.onError ?? defaultOnError)(report);
		} catch (unitError) {
			console.error('[fluxcord] onError unit threw:', unitError);
			defaultOnError(report);
		}
	};

	const register = async (ready: Client<true>): Promise<void> => {
		if (options.onReady !== undefined) {
			try {
				await options.onReady(ready);
			} catch (error) {
				reportFailure(error);
			}
		}
		if (options.registerCommands !== undefined) {
			await options.registerCommands(ready, registrations);
			return;
		}
		// Dev-only commands never ride the public set: they are scoped to
		// the dev guild when one is set, dropped entirely otherwise (dev
		// tools are not global tools).
		const publicBodies = commands.filter((c) => !c.devOnly).map((c) => c.data.toJSON());
		const devCommands = commands.filter((c) => c.devOnly);
		// Both scopes landing on one guild: a single set carries
		// everything (two calls to one guild would clobber).
		if (devGuildId !== undefined && devGuildId === guildId) {
			await ready.application.commands.set(commands.map((c) => c.data.toJSON()), guildId);
			return;
		}
		// Guild-scoped when a guild id is set, global otherwise. Two call
		// sites, not one: the API overload refuses string | undefined.
		if (guildId !== undefined) {
			await ready.application.commands.set(publicBodies, guildId);
		} else {
			await ready.application.commands.set(publicBodies);
		}
		if (devGuildId !== undefined && devCommands.length > 0) {
			await ready.application.commands.set(devCommands.map((c) => c.data.toJSON()), devGuildId);
		}
	};

	const onInteraction = async (interaction: Interaction): Promise<void> => {
		if (interaction.isChatInputCommand()) {
			const command = commands.find((c) => c.data.name === interaction.commandName);
			if (command !== undefined) await command.execute(interaction);
			return;
		}
		if (interaction.isAutocomplete()) {
			const command = commands.find((c) => c.data.name === interaction.commandName);
			await command?.autocomplete?.(interaction);
			return;
		}
		if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
			await bridge.dispatch(interaction, runtime.dispatch);
		}
	};

	// The host's intercept, when present, wraps the shipped routing; a
	// rejection from either (a failed mount send, say) is reported.
	const runInteraction = (interaction: Interaction): Promise<void> => {
		const next = (): Promise<void> => onInteraction(interaction);
		return (options.intercept !== undefined ? options.intercept(interaction, next) : next()).catch(reportFailure);
	};

	client.on(Events.InteractionCreate, (interaction) => {
		void runInteraction(interaction);
	});
	// A client handed in already running never fires ready again, so
	// registration branches on live state instead of assuming.
	if (client.isReady()) {
		void register(client);
	} else {
		client.once(Events.ClientReady, (ready) => {
			void register(ready);
		});
	}

	return {
		start: (): Promise<void> => client.login(token).then(() => undefined),
		stop: async (): Promise<void> => {
			runtime.stopSweeper();
			await client.destroy();
		},
		client,
		mount: runtime.mount,
	};
}
