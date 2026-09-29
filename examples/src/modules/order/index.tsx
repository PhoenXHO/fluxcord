// The taco stand: screens in, one mounted command out. The screens map is
// where the screen files meet, and the keys here are what ui.go() checks.
// Delivery rides along as a subflow: it owns its screen, the parent only
// seeds its slot and paints the Done bar around it.
import { command, flow, mounts, subflow } from 'fluxcord';
import type { FlowComponent, SubflowPlug } from 'fluxcord';
import { buildScreen } from './build.screen.js';
import type { OrderData } from './data.js';
import { deliveryFlow } from './delivery.flow.js';
import { menuScreen } from './menu.screen.js';
import { receiptScreen } from './receipt.screen.js';

// The plug: bind the delivery flow into the order flow at the slot named
// "delivery". Same name on both sides, so the wiring reads twice.
const deliveryPlug = subflow({ use: deliveryFlow.definition, at: 'delivery' });

// Inside the subflow only the subflow's screens draw, so the Done button
// has to arrive as a components wrap: it checks the screen name and adds
// a bar under whatever the delivery screen painted.
function deliveryBar(plug: SubflowPlug): FlowComponent<OrderData> {
	return (tree, session, { Button }) => {
		if (!session.screen.startsWith('delivery.')) return tree;
		return (
			<view {...tree}>
				{tree.children}
				<hr />
				<row>
					<Button onClick={plug.done} label="Done" success />
				</row>
			</view>
		);
	};
}

export const orderFlow = flow<OrderData>('order', {
	screens: { menu: menuScreen, build: buildScreen, receipt: receiptScreen },
	first: 'menu',
	initialData: { toppings: [], delivery: {} },
	// Ten idle minutes, not the default thirty: taco cravings are urgent.
	ttlMs: 10 * 60 * 1000,
	// Adds a line under the framework's default expiry copy.
	parting: { note: 'Nothing was saved: the next order starts from scratch.' },
	components: [deliveryBar(deliveryPlug)],
	subflows: [deliveryPlug],
});

export const orderCommand = command('order', 'Open the taco stand', {
	mount: mounts(orderFlow),
});
