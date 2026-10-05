// The order command definition: mounts the order flow, which composes
// all the screens. The flow's first screen is the menu.

import { command, flow, mounts } from 'fluxcord';
import { buildScreen } from './build.screen.js';
import type { OrderData } from './data.js';
import { menuScreen } from './menu.screen.js';
import { receiptScreen } from './receipt.screen.js';

export const orderFlow = flow<OrderData>('order', {
	screens: { menu: menuScreen, build: buildScreen, receipt: receiptScreen },
	first: 'menu',
	initialData: { toppings: [], delivery: {} },
	// Ten idle minutes, not the default thirty: taco cravings are urgent.
	ttlMs: 10 * 60 * 1000,
	// Adds a line under the framework's default expiry copy.
	parting: { note: 'Nothing was saved: the next order starts from scratch.' },
});

export const orderCommand = command('order', 'Open the taco stand', {
	mount: mounts(orderFlow),
});
