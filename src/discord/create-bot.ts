/**
 * createBot: the one-call host.
 *
 * The whole boot a Discord host writes by hand, collapsed into one
 * function: the client, the bridge, the flow catalog, the runtime, the
 * UI host wiring, command registration and the interaction listener.
 * What comes back is the small surface an app can still want afterwards:
 * `start` (login), the raw `client` (for listeners fluxcord does not
 * cover) and `mount` (programmatic panels). The standalone pieces remain
 * exported for custom hosts; they are just no longer the front door.
 *
 * The shipped permission default is ownership: a panel belongs to
 * whoever opened it and everyone else gets a denial. A `policy` option
 * replaces it with any PolicyPort engine.
 *
 * @module discord/create-bot
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { Interaction } from 'discord.js';
import { buildFlowCatalog } from '../boot/build.js';
import { moduleFlowRegistrations } from '../command/harvest.js';
import type { FlowSourceModule } from '../command/harvest.js';
import type { Flow } from '../flow/token.js';
import { defaultOnError } from '../pipeline/dispatch.js';
import { ErrorSource } from '../pipeline/types.js';
import type { ErrorHandler, PolicyPort } from '../pipeline/types.js';
import type { RehydrateStore } from '../state/types.js';
import { createUiRuntime } from '../runtime/create.js';
import type { MountHandle, MountOptions } from '../runtime/types.js';
import { deriveCommand } from './derive.js';
import { createUiBridge } from './platform.js';
import type { BridgeLogger } from './platform.js';
import { setUiHost } from './ui-host.js';

// used in docs
/* eslint-disable @typescript-eslint/no-unused-vars */
import { UiRuntime } from '../runtime/types.js';
/* eslint-enable */

/** What createBot takes: the modules, the token, and any seam to override. */
export interface CreateBotOptions {
	/** The modules to harvest; each carries its commands (and any flows no command mounts). */
	readonly modules: readonly FlowSourceModule[];
	/** The bot token; `start` logs in with it. */
	readonly token: string;
	/** Scopes command registration to one guild when set; global otherwise. */
	readonly guildId?: string;
	/** The permission engine behind every click. Default: the panel's owner only. */
	readonly policy?: PolicyPort;
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

/** What createBot hands back: the login button and the two live seams. */
export interface Bot {
	/** Logs in; command registration, dispatch and the sweeper are already wired. */
	readonly start: () => Promise<void>;
	/** The raw client, for listeners fluxcord does not cover. */
	readonly client: Client;
	/** Opens a flow session programmatically (push panels, service surfaces). @see {@link UiRuntime.mount}. */
	readonly mount: <TData>(flow: Flow<TData>, options: MountOptions) => Promise<MountHandle<TData>>;
}

/** The shipped permission engine: a panel belongs to whoever opened it. */
const ownerOnlyPolicy: PolicyPort = {
	authorize: (request) =>
		request.actorId === request.ownerId
			? Promise.resolve({ allowed: true })
			: Promise.resolve({ allowed: false, denyMessage: 'You don\'t have the permission to do that.' }),
};

/**
 * Builds the whole host around one options object. Nothing logs in here;
 * {@link Bot.start} does.
 *
 * @param options The modules, the token, and any seams to override.
 * @returns The bot: start, the raw client, and mount.
 */
export function createBot(options: CreateBotOptions): Bot {
	const client = options.client ?? new Client({ intents: [...(options.intents ?? [GatewayIntentBits.Guilds])] });
	const bridge = createUiBridge(client, {
		...(options.logger !== undefined ? { logger: options.logger } : {}),
		...(options.ephemeralAsPublic !== undefined ? { ephemeralAsPublic: options.ephemeralAsPublic } : {}),
	});
	const flows = buildFlowCatalog(options.modules.flatMap(moduleFlowRegistrations));
	const runtime = createUiRuntime({
		platform: bridge.platform,
		sendToChannel: bridge.sendToChannel,
		policy: options.policy ?? ownerOnlyPolicy,
		flows,
		...(options.rehydrate !== undefined ? { rehydrate: options.rehydrate } : {}),
		...(options.onError !== undefined ? { onError: options.onError } : {}),
		...(options.now !== undefined ? { now: options.now } : {}),
		...(options.sweeper !== undefined ? { sweeper: options.sweeper } : {}),
	});
	setUiHost({ mount: runtime.mount, replySender: bridge.replySender });

	const commands = options.modules
		.flatMap((mod) => mod.commands ?? [])
		.map(deriveCommand);

	const register = async (ready: Client<true>): Promise<void> => {
		const bodies = commands.map((c) => c.data.toJSON());
		// Guild-scoped when a guild id is set, global otherwise. Two call
		// sites, not one: the API overload refuses string | undefined.
		if (options.guildId !== undefined) {
			await ready.application.commands.set(bodies, options.guildId);
		} else {
			await ready.application.commands.set(bodies);
		}
	};

	const onInteraction = async (interaction: Interaction): Promise<void> => {
		if (interaction.isChatInputCommand()) {
			const command = commands.find((c) => c.data.name === interaction.commandName);
			if (command !== undefined) await command.execute(interaction);
			return;
		}
		if (interaction.isMessageComponent()) {
			await bridge.dispatch(interaction, runtime.dispatch);
		}
	};

	// A listener rejection has no dispatch core around it (a failed mount
	// send, say), so it lands in the same error unit the runtime uses.
	const runInteraction = (interaction: Interaction): Promise<void> =>
		onInteraction(interaction).catch((error) => {
			(options.onError ?? defaultOnError)({
				error,
				source: ErrorSource.Framework,
				reply: (): Promise<void> => Promise.resolve(),
			});
		});

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
		start: (): Promise<void> => client.login(options.token).then(() => undefined),
		client,
		mount: runtime.mount,
	};
}
