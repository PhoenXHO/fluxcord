// The counter: two selects drive the bag, and the "So far" panel repaints
// under them on every pick. Checkout walks straight to the receipt; the
// modal is the side door - Customize opens it, and its submit lands back
// on this screen, where the redraw does the walking.
import { action, EventKind, screen } from 'fluxcord';
import { SIZES, TOPPINGS } from './data.js';
import type { OrderData } from './data.js';

const pickSize = action<OrderData>()(e => {
	e.mutate(d => {
		d.size = e.values?.[0];
	});
});

const pickToppings = action<OrderData>()(e => {
	e.mutate(d => {
		d.toppings = [...(e.values ?? [])];
	});
});

const customize = action<OrderData>()(e => {
	if (e.kind !== EventKind.ModalSubmit) {
		void e.ui.showModal(
			<modal title="Customize the order">
				<input
					id="name"
					label="Name for the order"
					placeholder="Who is this for?"
					maxLength={32}
				/>
				<checkbox
					id="napkins"
					label="Extra napkins"
					description="We both know why"
				/>
			</modal>,
		);
		return;
	}
	e.mutate(d => {
		const name = e.inputs?.name;
		d.name = typeof name === 'string' && name.length > 0 ? name : undefined;
		d.napkins = e.inputs?.napkins === true;
	});
});

function headline({ size }: OrderData): string {
	return size === undefined ? 'Pick a size, then load it up.' : `One ${size} taco, good choice.`;
}

function summary({ size, toppings, name, napkins }: OrderData): string {
	const labels = toppings.map(v => TOPPINGS.find(t => t.value === v)?.label ?? v);
	const lines = [
		`Size: ${size ?? 'not picked yet'}`,
		`Extras: ${labels.length > 0 ? labels.join(', ').toLowerCase() : 'none'}`,
	];
	if (name !== undefined) lines.push(`Name: ${name}`);
	if (napkins === true) lines.push('Napkins: extra');
	return lines.join('\n');
}

export const buildScreen = screen<OrderData>()((data, { Button, Select, Back }) => (
	<container color={0x3498db}>
		<text title="Build your order">{headline(data)}</text>
		<Select
			placeholder="Pick a size"
			options={SIZES}
			onSelect={pickSize}
			values={[data.size]}
		/>
		<Select
			placeholder="Load it up (up to 3)"
			options={TOPPINGS}
			onSelect={pickToppings}
			minSelected={0}
			maxSelected={3}
			values={data.toppings}
		/>
		<hr />
		<text title="So far">{summary(data)}</text>
		<row>
			<Button onClick={customize} label="Customize" secondary />
			<Button
				onClick={e => e.ui.go('receipt')}
				label="Checkout"
				success
				disabled={data.size === undefined}
			/>
			<Back />
		</row>
	</container>
));
