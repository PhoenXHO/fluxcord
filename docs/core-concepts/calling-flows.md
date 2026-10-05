# Calling flows

Single-flow panels stop scaling when your data grows complex, so fluxcord lets a flow call another flow the way a function calls a function. The parent handler runs `await event.call(childFlow, ...)`, and the child runs on its own frame with its own screens and data, since the parent's handler sits parked at the `await` until the child is done. We can see this structure in the taco stand's delivery flow, which sits alongside the dice panel as the second module the guide covers: that's where you configure an order and check out, though delivery is the piece we care about in this chapter. `examples/src/modules/order/delivery.flow.tsx` defines the flow and the build screen calls it.

## A flow that minds its own business

```tsx
// The delivery flow: a small, self-contained flow the taco stand calls.
// Authored against its own data type, it never sees the order bag, only
// the slot the parent names for it.
// The Done button calls ui.exit(), the verb that ends this flow and
// returns to the parent.

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
                    <Button onClick={e => e.ui.exit()} label="Done" success />
                </row>
            </view>
        )),
    },
    first: 'details',
    initialData: {},
});
```

Because this code never mentions tacos, you can reuse it anywhere; a called flow is an ordinary flow that happens to be opened by another flow. The Done button calls `ui.exit()` because that line is the flow's whole exit strategy: while the child runs, the parent's screens are unreachable, so no parent-drawn button could help you leave. The child always owns its exit.

## Calling it like a function

```tsx
// This handler calls another flow, which becomes the child of the
// current flow. The parent stays parked at the await until the child
// exits, and the child's bag nests under the slot named by `as`. While
// the child runs, its screens own the message.
const openDelivery = action<OrderData>()(async e => {
    await e.call(deliveryFlow, { as: 'delivery' });
});
```

The handler is async because the `await` is where the handler stops until the child finishes. The flow token travels directly in the call, so there is no screen-name string to validate. When you click, the child's first screen draws; the parent's handler freezes at the `await`; every later click belongs to the child because its frame is the top of the session's frame stack. When the child calls `ui.exit()`, the frame pops, the parent's screen redraws, and the parked handler resumes past the `await`. Navigation is sealed per frame, so `<Back />` inside the delivery flow moves through the delivery flow's own history and can never walk out of a flow; leaving is always an explicit `ui.exit()` the child's screens authored.

## The child's bag

The `as` key names the slot in the parent's data.

```tsx
export interface OrderData {
    size?: string;
    toppings: readonly string[];
    name?: string;
    napkins?: boolean;
    // The delivery flow's slot: event.call nests the child's bag here,
    // and the parent's screens read it like any other field.
    delivery: DeliveryData;
}
```

The child's handlers use `e.mutate` exactly like an independent flow, though every write lands inside the parent's `delivery` slot. You do not need to seed the slot before calling because the call writes it; returning means the data is already in place, so the build screen reads the slot like any field when it renders the order summary:

```tsx
if (delivery.when !== undefined) {
    const when = delivery.when === 'asap' ? 'ASAP' : 'in about half an hour';
    lines.push(`Delivery: ${when}${delivery.address !== undefined ? `, to ${delivery.address}` : ''}`);
}
```

The call can also seed the child with values through `args`:

```tsx
await e.call(deliveryFlow, { as: 'delivery', args: { ...data.delivery } });
```

The `args` property seeds the child bag, which is how a return visit opens with previous choices in place; omitted `args` means the child starts from its own `initialData`. Either way the child receives a fresh clone, so frames never share mutable state and a push inside the child's arrays never leaks to the parent.

## Returning a value

The `ui.exit` function takes an options object, and `{ value }` is the return path. The delivery flow returns nothing since its results travel through the slot, so it calls `ui.exit()` bare. A flow whose outcome is a decision returns the decision.

```tsx
export const confirmFlow: Flow<ConfirmData, boolean> = flow<ConfirmData>('confirm', {
    screens: {
        ask: screen<ConfirmData>()((data, { Button }) => (
            <view title="Are you sure?">
                <row>
                    <Button onClick={e => e.ui.exit({ value: true })} label="Yes" success />
                    <Button onClick={e => e.ui.exit({ value: false })} label="No" secondary />
                </row>
            </view>
        )),
    },
    first: 'ask',
    initialData: {},
});

// The caller:
const confirmed = await e.call(confirmFlow, { as: 'confirm' });
```

The second type parameter on `Flow<TData, TExit>` is the exit value; annotating the constant types the caller's `await`, though it is type-only and phantom at runtime.

## When the child crashes

A `throw` inside a called flow is a crash of that call: the child's frame pops and the parent's `await` rejects, surfacing inside the parent's handler where `try`/`catch` owns it.

```tsx
const openDelivery = action<OrderData>()(async e => {
    try {
        await e.call(deliveryFlow, { as: 'delivery' });
    } catch {
        // The child crashed: its frame is gone and the panel is back here.
    }
});
```

Uncaught, the rejection cascades one frame per level until the root reports it as an ordinary handler failure. If the session dies while a call is parked, the parked call is dropped without settling, so the parent's handler never resumes; a revived session restarts at the root's first screen. Restart dropping in-flight calls is the deliberate trade.

## Listing called flows

A flow another flow calls is still an ordinary `flow()` token, and the module's manifest still lists it among its flows, because `event.call` resolves the flow through the boot catalog and fails fast when it is missing. The old advice of writing called flows with `defineFlow` is gone with the plug system, since a definition without a token is a definition nobody can call. You can read [Commands and mounting](commands-and-mounting.md) for how `command('order', ...)` delivers the flow with a mount.
