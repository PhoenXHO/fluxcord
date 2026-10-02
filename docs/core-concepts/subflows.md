# Subflows

Keeping every screen in a single flow made sense for the dice panel while it stayed small, but real bots rarely remain that simple once a shop adds delivery or an admin interface needs configuration screens. Before long, a single screens map ends up holding the entire bot.

To solve this, fluxcord provides subflows so that a parent flow can plug in a self-contained guest with its own screens and data contract. All the parent has to do is seed a slot in its data bag for the guest flow to fill.

The example bot demonstrates this pattern with a taco stand order panel that embeds a separate delivery subflow. It sits alongside the dice panel as the second module the guide covers: that's where you configure an order and check out, though delivery is the piece we care about in this chapter. Because delivery operates as an independent flow with its own screens, mounting it as a subflow keeps the ordering logic and the delivery flow easy to follow separately.

## A flow that minds its own business

Here is the complete delivery flow definition from `examples/src/modules/order/delivery.flow.tsx`:

```tsx
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
```

Notice that nothing in this file mentions tacos or toppings; since it's written strictly against its own `DeliveryData` type, you could reuse this exact flow inside an e-commerce store or booking app. That isolation is the entire goal here, because a subflow is just an ordinary flow that happens to be mounted by a parent. We set `initialData` to an empty object here because the host flow will seed the actual values shortly.

## Plugging in

Over in `examples/src/modules/order/index.tsx`, we set up the parent by calling `subflow`, passing in both the guest definition and the target slot on the parent's data bag:

```tsx
const deliveryPlug = subflow({ use: deliveryFlow.definition, at: 'delivery' });
```

Here, the `use` prop receives the flow definition that travels on `deliveryFlow.definition` from the `flow()` token, while `at` identifies which field to populate on the parent.

> [!NOTE]
> Using the same name `delivery` for both sides is optional, but it keeps the wiring simple and readable.

To mount the plug, pass the plug into the host's `subflows` array:

```tsx
export const orderFlow = flow<OrderData>('order', {
    screens: { menu: menuScreen, build: buildScreen, receipt: receiptScreen },
    first: 'menu',
    initialData: { toppings: [], delivery: {} },
    components: [deliveryBar(deliveryPlug)],
    subflows: [deliveryPlug],
});
```

Registering the plug in `subflows` brings the delivery screens into the parent under a namespaced convention, which joins the slot name and the screen name with a dot so that `details` becomes `delivery.details`. Because entering the subflow automatically opens the guest's designated `first` screen, you won't need to track `delivery.details` manually.

We've also added the `components` option here specifically to accommodate the subflow, though we'll return to how that works after walking through navigation.

## Seeding the slot

Because the subflow writes straight into the field specified by `at`, that slot must already exist on the parent's data bag before anyone navigates to it. In the order module, `OrderData` defines the shape and `initialData` supplies the initial values:

```tsx
export interface OrderData {
    size?: string;
    toppings: readonly string[];
    name?: string;
    napkins?: boolean;
    // The delivery subflow's slot: seeded empty, filled by the subflow's
    // own screens through the lens.
    delivery: DeliveryData;
}
```

> [!IMPORTANT]
> An unseeded slot fails quietly at the worst moment: the mount itself succeeds and the parent panel still shows, but when the guest's opening screen renders, it meets `undefined` where its data bag should be and the view throws mid-render. fluxcord logs the failure, yet all the user sees is the Delivery click doing nothing. If entering a subflow silently does nothing, check `initialData` first.

That seed doesn't necessarily have to start empty, though; prefilling the slot lets the subflow open with values already in place, which makes a return visit to update an address much smoother.

## Entering the subflow

You open a subflow just like any other destination by calling `e.ui.go('delivery')`, which we trigger from a button on the build screen:

```tsx
const openDelivery = action<OrderData>()(e => {
    e.ui.go('delivery');
});
```

There's an important TypeScript detail here: because inline screen actions validate target names strictly against the local screens map, passing `'delivery'` inline would fail type-checking since that identifier lives in the flow options instead. Defining a standalone action bypasses this restriction by leaving the navigation target open to any registered root, so remember to use inline handlers for moving between local screens and standalone actions when entering subflows.

We place that button directly on the build screen alongside our other navigation controls:

```tsx
<row>
    <Button onClick={customize} label="Customize" secondary />
    <Button onClick={openDelivery} label="Delivery" />
    <Button onClick={e => e.ui.go('receipt')} label="Checkout" success disabled={data.size === undefined} />
    <Back />
</row>
```

Clicking it swaps out the build interface for the delivery view; while the guest subflow runs, the parent's screens stay hidden so the guest completely owns the message until it exits.

## Inside the lens

The main benefit of subflows is how state is managed: while a delivery screen is active, `e.session.data` is typed as `DeliveryData` instead of `OrderData`. Even though the subflow's handlers read and update state using `e.mutate` just like an independent flow, nothing is cloned or synchronized manually, as all modifications land directly inside the parent's `delivery` slot.

fluxcord does this with a lens backed by a JavaScript Proxy that forwards every read and write to the parent object, so the guest flow sees its own keys and nothing else. `delivery.flow.tsx` stays completely agnostic about its host and only ever sees `when` and `address`.

Since mutations happen directly on the parent's state, returning from the subflow means the data is already in place. The build screen can read the populated slot immediately without any extra wiring:

```tsx
if (delivery.when !== undefined) {
    const when = delivery.when === 'asap' ? 'ASAP' : 'in about half an hour';
    lines.push(`Delivery: ${when}${delivery.address !== undefined ? `, to ${delivery.address}` : ''}`);
}
```

## The Done bar

This independence creates a design challenge around who should render the Done button: the parent cannot insert one because its screens don't render while the subflow is active, yet the delivery flow shouldn't draw one either since it doesn't know how the host defines completion.

To bridge this gap, fluxcord lets you define wrapper layers via the `components` array, which accepts functions that transform rendered trees across screens. In the order module, we use this wrapper strictly when subflow screens are active:

```tsx
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
```

Looking at the implementation, the function returns a `(tree, session, kit)` component that receives the standard screen kit alongside the current session. Because `session.screen` retains the prefixed route on subflow views, checking `startsWith('delivery.')` lets us target only the guest screens. Furthermore, since UI trees are immutable, the wrapper creates a fresh `<view>` using `{...tree}` to clone the original props before re-rendering existing children alongside the new Done button; any screen outside the subflow simply bypasses this logic and returns the original tree untouched.

We don't need custom dismissal logic here either, since `plug.done` provides a built-in handler that pops back out of the subflow, returning the user to the screen whose button opened it.

## Coming back

Leaving a subflow happens through one of two exits. The kit's `<Back />` button pops back to the previous screen without reporting anything, though it is not an undo: the lens writes mutations into the parent's slot as they happen, so anything the user picked before pressing Back stays picked. The delivery flow doesn't draw a Back at all, since with a single guest screen the Done bar is the only way out. Clicking Done calls `plug.done` to exit while triggering the plug's optional `onDone` callback:

```tsx
const deliveryPlug = subflow({
    use: deliveryFlow.definition,
    at: 'delivery',
    onDone: (state, ui) => {
        // state is the guest's final DeliveryData
    },
});
```

We deliberately omit `onDone` in the taco stand because the lens has already written the delivery choices straight into the parent's data bag, leaving nothing extra to transfer over. Keep the signature in mind, though: while `onDone` gives you the child's final state and a screen kit, its arguments don't provide a `mutate` function, so any further state updates must be handled by the parent's own screens once control returns.

> [!IMPORTANT]
> `onDone` cannot mutate the parent's data bag; there is no `mutate` on its second argument. Data returns through the slot the subflow wrote into.

## A shelf of reusable flows

Every subflow we've plugged in so far has been an ordinary `flow()`, and nothing about plugging one in demands more; the plug takes the flow's `definition`, and a named flow attaches just as easily as an unnamed one. `defineFlow` exists for flows written to be guests and nothing else: it accepts the identical configuration as `flow()` and runs the same checks, but it returns just the definition without a name or a token for the bot to collect. Since there's no token, a command can never deliver it on its own and a module has nothing to list, which makes it purpose-built for library subflows meant only to be plugged in by a host. Use `defineFlow` for flows that exist only to be plugged in; use `flow()` if the panel might also run on its own, plugging it through `.definition` the way we did with delivery in this chapter.

## Next steps

Up to this point, we've glossed over how `command('order', ...)` actually delivers the flow to users with a `mount`. In [Commands and mounting](commands-and-mounting.md), we'll look closely at what commands assemble under the hood: mount configurations and subcommands, as well as the permissions configured on the command itself.
