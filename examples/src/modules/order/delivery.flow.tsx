// The delivery subflow: a small, self-contained flow the taco stand
// plugs in. Authored against its own data type, it never sees the order
// bag, only the slot the parent seeds for it.
import { action, EventKind, flow, screen } from 'fluxcord';

export interface DeliveryData {
	when?: string;
	address?: string;
}

const WHEN = [
	{ label: 'As soon as possible', value: 'asap' },
	{ label: 'In about half an hour', value: 'later' },
];

const pickWhen = action<DeliveryData>()(e => {
	e.mutate(d => {
		d.when = e.values?.[0];
	});
});

// Two lives again: the click opens the dialog, the submit lands back here.
const setAddress = action<DeliveryData>()(e => {
	if (e.kind !== EventKind.ModalSubmit) {
		void e.ui.showModal(
			<modal title="Delivery address">
				<input id="address" label="Where to?" required maxLength={100} placeholder="Street and number" />
			</modal>,
		);
		return;
	}
	e.mutate(d => {
		const address = e.inputs?.address;
		d.address = typeof address === 'string' && address.length > 0 ? address : undefined;
	});
});

export const deliveryFlow = flow<DeliveryData>('delivery', {
	screens: {
		details: screen<DeliveryData>()((data, { Button, Select }) => (
			<view title="Delivery">
				<text>When should the order arrive, and where should it go?</text>
				<Select placeholder="Pick a time" options={WHEN} onSelect={pickWhen} values={[data.when]} />
				<row>
					<Button onClick={setAddress} label={data.address === undefined ? 'Set an address' : 'Change the address'} secondary />
				</row>
			</view>
		)),
	},
	first: 'details',
	initialData: {},
});
