// The taco stand: screens in, one mounted command out. The screens map is
// where the screen files meet, and the keys here are what ui.go() checks.
import { command, flow, mounts } from 'fluxcord';
import { buildScreen } from './build.screen.js';
import type { OrderData } from './data.js';
import { menuScreen } from './menu.screen.js';
import { receiptScreen } from './receipt.screen.js';

export const orderFlow = flow<OrderData>('order', {
	screens: { menu: menuScreen, build: buildScreen, receipt: receiptScreen },
	first: 'menu',
	initialData: { toppings: [] },
});

export const orderCommand = command('order', 'Open the taco stand', {
	mount: mounts(orderFlow),
});
