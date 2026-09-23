// The parting gift: two painted panels - a green all-clear up top, the
// receipt slab under it - then the way on to a fresh bag or back through
// the counter.
import { action, screen } from 'fluxcord';
import { TOPPINGS } from './data.js';
import type { OrderData } from './data.js';

const freshOrder = action<OrderData>()(e => {
	e.mutate(d => {
		d.size = undefined;
		d.toppings = [];
		d.name = undefined;
		d.napkins = undefined;
	});
	e.ui.go('menu');
});

function receipt({ size, toppings, name, napkins }: OrderData): string {
	const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
	const labels = toppings.map(v => TOPPINGS.find(t => t.value === v)?.label ?? v);
	const lines = [`1x ${cap(size ?? 'taco')} taco`];
	for (const label of labels) lines.push(`   + ${label.toLowerCase()}`);
	if (napkins === true) lines.push('   + extra napkins');
	if (name !== undefined) lines.push('', `name: ${name}`);
	return lines.join('\n');
}

export const receiptScreen = screen<OrderData>()((data, { Button, Back }) => (
	<>
		<container color={0x2ecc71}>
			<text title="Order placed">{data.name === undefined ? 'Your tacos are on the griddle.' : `${data.name}, your tacos are on the griddle.`}</text>
		</container>
		<container color={0x95a5a6}>
			<text title="Receipt">{receipt(data)}</text>
			<hr />
			<row>
				<Button onClick={freshOrder} label="New order" success />
				<Back />
			</row>
		</container>
	</>
));
