// The whole host: modules in, running bot out.
// The token and the dev guild id come from .env (DISCORD_TOKEN / DISCORD_GUILD_ID).
import { createBot } from 'fluxcord/discord';
import { aboutCommand } from './modules/about.js';
import { counterCommand } from './modules/counter.js';
import { diceCommand } from './modules/dice.js';
import { orderCommand } from './modules/order/index.js';
import { campfireFlow } from './modules/campfire.js';
import { staffCommand, staffPolicy } from './modules/staff.js';
import { timerCommand } from './modules/timer.js';
import { rehydrateStore } from './rehydrate-store.js';

const bot = createBot({
	policy: staffPolicy,
	rehydrate: rehydrateStore,
	modules: [
		{ name: 'about', commands: [aboutCommand] },
		{ name: 'counter', commands: [counterCommand] },
		{ name: 'dice', commands: [diceCommand] },
		{ name: 'order', commands: [orderCommand] },
		// The campfire has no command: it mounts below, once, on boot.
		{ name: 'campfire', flows: [campfireFlow] },
		{ name: 'staff', commands: [staffCommand] },
		{ name: 'timer', commands: [timerCommand] },
	],
});

async function main(): Promise<void> {
	await bot.start();
	// The campfire panel mounts once and outlives restarts: the rehydrate
	// row lets any later click on the message rebuild the session. Set
	// CAMPFIRE_CHANNEL_ID and CAMPFIRE_OWNER_ID in .env to get the panel
	const channel = process.env.CAMPFIRE_CHANNEL_ID;
	const owner = process.env.CAMPFIRE_OWNER_ID;
	if (channel !== undefined && owner !== undefined) {
		await bot.mount(campfireFlow, {
			to: { channel },
			ownerId: owner,
			rehydrateRef: 'campfire:main',
		});
	}
}

void main();
