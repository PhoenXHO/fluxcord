// The entry screen: a painted container that sells the place.
import { screen } from 'fluxcord';
import type { OrderData } from './data.js';

export const menuScreen = screen<OrderData>()((_data, { Button }) => (
	<>
		<container color={0x9ddb4b}>
			<text title="Taco Bob's">Build your order, check out, done. No line, no regrets.</text>
			<hr />
			<row>
				<Button onClick={e => e.ui.go('build')} label="Build order" />
			</row>
		</container>
		<info>Everything here is buttons. Even the checkout.</info>
	</>
));
