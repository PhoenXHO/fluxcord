import { Client, Events, GatewayIntentBits } from 'discord.js';
import { buildFlowCatalog, createUiRuntime, moduleFlowRegistrations } from 'fluxcord';
import { createUiBridge, deriveCommand, setUiHost } from 'fluxcord/discord';
import { counterCommand } from './apps/counter.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const bridge = createUiBridge(client);

// One entry per example app: its flows and commands.
const modules = [{ name: 'counter', commands: [counterCommand] }];
const flows = buildFlowCatalog(modules.flatMap(moduleFlowRegistrations));

const runtime = createUiRuntime({
	platform: bridge.platform,
	sendToChannel: bridge.sendToChannel,
	policy: {
		// The framework asks before every click. This engine honors
		// ownership only; yours can do roles, admins, channels, and so on.
		authorize: (request) =>
			request.actorId === request.ownerId
				? Promise.resolve({ allowed: true })
				: Promise.resolve({ allowed: false, denyMessage: 'Not your panel.' }),
	},
	flows,
});

setUiHost({ mount: runtime.mount, replySender: bridge.replySender });

const commands = [deriveCommand(counterCommand)];

client.once(Events.ClientReady, async (ready) => {
	const bodies = commands.map((c) => c.data.toJSON());
	// Guild-scoped when DISCORD_GUILD_ID is set, global otherwise.
	if (process.env.DISCORD_GUILD_ID) {
		await ready.application.commands.set(bodies, process.env.DISCORD_GUILD_ID);
	} else {
		await ready.application.commands.set(bodies);
	}
	console.log(`example bot ready as ${ready.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (interaction.isChatInputCommand()) {
		const command = commands.find((c) => c.data.name === interaction.commandName);
		if (command) await command.execute(interaction);
		return;
	}
	if (interaction.isMessageComponent()) {
		await bridge.dispatch(interaction, runtime.dispatch);
	}
});

client.login(process.env.DISCORD_TOKEN);
