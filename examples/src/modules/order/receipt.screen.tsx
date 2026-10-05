import { action, screen } from 'fluxcord';
import { TOPPINGS } from './data.js';
import type { OrderData } from './data.js';

const freshOrder = action<OrderData>()(e => {
	e.mutate(d => {
		d.size = undefined;
		d.toppings = [];
		d.name = undefined;
		d.napkins = undefined;
		d.delivery = {};
	});
	e.ui.go('menu');
});

// Exiting with a final view leaves these parting words on the message
// instead of the frozen receipt. Without `final`, the last screen
// freezes as usual.
const done = action<OrderData>()(e => {
	e.ui.exit({
		final: (
			<container color={0x2ecc71}>
				<text title="Enjoy">Tacos inbound. Run /order whenever hunger strikes again.</text>
			</container>
		),
	});
});

function receipt({ size, toppings, name, napkins, delivery }: OrderData): string {
	const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
	const labels = toppings.map(v => TOPPINGS.find(t => t.value === v)?.label ?? v);
	const lines = [`1x ${cap(size ?? 'taco')} taco`];
	for (const label of labels) lines.push(`   + ${label.toLowerCase()}`);
	if (napkins === true) lines.push('   + extra napkins');
	if (delivery.when !== undefined || delivery.address !== undefined) {
		lines.push('');
		const bits: string[] = [];
		if (delivery.when === 'asap') bits.push('asap');
		if (delivery.when === 'later') bits.push('within half an hour');
		if (delivery.address !== undefined) bits.push(`to ${delivery.address}`);
		lines.push(`delivery: ${bits.join(', ')}`);
	}
	if (name !== undefined) lines.push('', `name: ${name}`);
	return lines.join('\n');
}

export const receiptScreen = screen<OrderData>()((data, { Button }) => (
	<>
		<container color={0x2ecc71}>
			<text title="Order placed">{data.name === undefined ? 'Your tacos are on the griddle.' : `${data.name}, your tacos are on the griddle.`}</text>
		</container>
		<container color={0x95a5a6}>
			<text title="Receipt">{receipt(data)}</text>
			<hr />
			<row>
				<Button onClick={freshOrder} label="New order" success />
				<Button onClick={done} label="Done" />
			</row>
		</container>
	</>
));
