// The whole host: modules in, running bot out.
import { createBot } from 'fluxcord/discord';
import { counterCommand } from './apps/counter.js';

const token = process.env.DISCORD_TOKEN;
if (token === undefined) {
	throw new Error('DISCORD_TOKEN is not set');
}

const bot = createBot({
	modules: [{ name: 'counter', commands: [counterCommand] }],
	token,
	// Guild-scoped commands while testing; remove the line for global registration.
	...(process.env.DISCORD_GUILD_ID ? { guildId: process.env.DISCORD_GUILD_ID } : {}),
});

void bot.start();
