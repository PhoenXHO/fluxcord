// The whole host: modules in, running bot out.
// The token and the dev guild id come from .env (DISCORD_TOKEN / DISCORD_GUILD_ID).
import { createBot } from 'fluxcord/discord';
import { aboutCommand } from './apps/about.js';
import { counterCommand } from './apps/counter.js';

const bot = createBot({
	modules: [
		{ name: 'about', commands: [aboutCommand] },
		{ name: 'counter', commands: [counterCommand] },
	],
});

void bot.start();
