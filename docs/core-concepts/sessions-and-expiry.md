# Sessions and expiry

In the previous chapters, you might have noticed that every panel we've built had a limited lifespan that we never chose ourselves and fluxcord automatically enforced. When that lifespan runs out, fluxcord cleans up the panel and its session and shows a parting note to the user.

This chapter explains how that works and how you can make that limit your own. We'll tighten the lifespan of our order panel by adding an idle window that shuts down abandoned sessions, complete with a live countdown timer and a clean parting note. We'll touch three files along the way: the flow definition at [`examples/src/modules/order/index.tsx`](../../examples/src/modules/order/index.tsx), the build screen at [`examples/src/modules/order/build.screen.tsx`](../../examples/src/modules/order/build.screen.tsx), and the receipt at [`examples/src/modules/order/receipt.screen.tsx`](../../examples/src/modules/order/receipt.screen.tsx).

## The sliding window

Since every session manages its own clock, each accepted event bumps the session's `lastActivityAt` timestamp, deriving the actual deadline directly on the fly as `lastActivityAt + ttlMs`. Because this window slides rather than counting down from mount, active panels stay alive through ongoing interaction while abandoned ones cleanly time out.

While the default TTL value is 30 minutes, you can configure a shorter idle window using the `ttlMs` flow option:

```tsx
export const orderFlow = flow<OrderData>('order', {
    screens: { menu: menuScreen, build: buildScreen, receipt: receiptScreen },
    first: 'menu',
    initialData: { toppings: [], delivery: {} },
    // Ten idle minutes, not the default thirty: taco cravings are urgent.
    ttlMs: 10 * 60 * 1000,
    components: [deliveryBar(deliveryPlug)],
    subflows: [deliveryPlug],
});
```

> [!CAUTION]
> The `ttlMs` option expects a finite, positive number. Passing `Infinity` throws immediately at definition time because an immortal session represents an unmanaged memory leak.

To clean up inactive sessions, fluxcord runs a background sweeper every 15 seconds (`DEFAULT_SWEEP_INTERVAL_MS = 15_000`) using an unreferenced timer that will not prevent the process from closing. You can adjust this sweep interval if needed, though the default works for nearly every case because the deadline math remains exact regardless of when the sweep runs.

## Adding a live countdown

To ensure users know when a session will close, fluxcord provides an `<Expiry>` component that renders an expiration deadline as a dynamic Discord timestamp. Discord's native client updates the countdown locally, so you only need to draw the timestamp once for it to stay current without any subsequent edits:

```tsx
export const buildScreen = screen<OrderData>()((data, { Button, Select, Back }, session) => (
    <container color={0x3498db}>
        <text title="Build your order">{headline(data)}</text>
        {/* picks */}
        <hr />
        <text title="So far">{summary(data)}</text>
        {/* Discord ticks this countdown on its own. */}
        <Expiry until={expiryEpoch(session)} />
        <row>
            {/* buttons */}
        </row>
    </container>
));
```

Notice that screens accept a third parameter (`session`), which exposes read-only metadata such as `ownerId`, `createdAt`, `screen`, `history`, `lastActivityAt`, `ttlMs`, and `expiresAt`. You can pass that session object straight to `expiryEpoch`, which converts the lifetime bookkeeping into the Unix-seconds integer required by Discord's timestamp syntax, favoring an absolute deadline whenever one exists.

Since that deadline is calculated at draw time, your countdown always mirrors real activity; whenever an accepted click pushes the window forward, it triggers a redraw that snaps the timer to its newest deadline while Discord handles every intermediate tick.

## Configuring parting notes

When a session expires, fluxcord automatically edits the abandoned panel message into a parting screen to notify the user:

> This screen has expired.
> Run `/order` to start a new one.

You don't have to write that line: the framework derives it from the command that mounts the flow. If your flow mounts from multiple commands, you can pin specific wording using `parting.command`, though you'll usually just append extra context through `parting.note`:

```tsx
export const orderFlow = flow<OrderData>('order', {
    // screens, first, initialData as before
    ttlMs: 10 * 60 * 1000,
    // Adds a line under the framework's default expiry copy.
    parting: { note: 'Nothing was saved: the next order starts from scratch.' },
    components: [deliveryBar(deliveryPlug)],
    subflows: [deliveryPlug],
});
```

With that note configured, your panel closes with clearer expectations:

> This screen has expired.
> Run `/order` to start a new one.
> Nothing was saved: the next order starts from scratch.

If you prefer to bypass the default layout entirely, you can supply a custom view builder to `parting.view` to render a completely custom expiration screen of your own design.

Panels encounter this parting note through one of two paths. Most often, the background sweeper discovers the expired window a few seconds after it lapses and performs the cleanup. Alternatively, if someone clicks an expired session before the sweeper catches it, dispatch detects the closed window and executes the parting edit immediately, so the late click gets the parting screen instead of an error reply.

## Closing sessions deliberately

Besides expiring abandoned sessions, you can close a panel deliberately by calling `ui.close()` inside your action handlers:

```tsx
const done = action<OrderData>()(e => {
    e.ui.close(
        <container color={0x2ecc71}>
            <text title="Enjoy">Tacos inbound. Run /order whenever hunger strikes again.</text>
        </container>,
    );
});
```

If you call `close()` without arguments, fluxcord freezes the screen by stripping out the interactive controls, which keeps the final receipt readable while preventing further clicks (a plain URL button would survive the freeze, since it's not an interactive control with a handler of its own). Supplying a custom view argument replaces the panel directly with your chosen markup instead, making it ideal for final confirmations like our taco receipt.

We can hook that action up by adding a Done button right alongside the existing controls:

```tsx
<row>
    <Button onClick={freshOrder} label="New order" success />
    <Button onClick={done} label="Done" />
    <Back />
</row>
```

To prevent duplicate updates when close operations race against background sweeper runs or rapid button clicks, fluxcord tracks completed message edits using an internal per-message set. Whichever termination request completes first claims the edit, making sure the panel is never updated twice.

Your flows can also respond directly to termination through `onSessionEnd`, which fires on every death path (both manual closures and automatic expirations) and receives the dying session's identity (its `sessionId`, `messageId`, and `flowId`) alongside the reason for its closure. Since that hook runs before any message updates take place, it gives you a reliable place to perform teardown before visual cleanup begins.

## Fixed expiration on ephemeral messages

While sliding windows adjust based on user activity, ephemeral messages (`ephemeral: true`) are bound by platform-level interaction limits represented by an unextendable `expiresAt` timestamp. Activity clicks do not extend an ephemeral message's absolute cutoff, and fluxcord ensures all final parting edits complete before this platform limit arrives. This doesn't create any problems when trying to use the `<Expiry>` component, because `expiryEpoch` prioritizes `expiresAt` over the sliding window.

## Running it again

Our final lifetime setting controls what happens when someone invokes the command a second time. By default, fluxcord uses a `replace` policy that automatically closes an invoker's existing sessions whenever they remount the flow, operating on the assumption that someone asking for a fresh menu doesn't want their previous one lingering in the channel. That superseded panel simply freezes as if it were closed normally.

If your flow is designed to support concurrent instances, such as a project board where several panels might remain active at once, you can set `remount: 'coexist'` so that sessions accumulate side by side with independent windows.

## Next steps

While session expiration manages inactive panels cleanly, action handlers can also encounter unexpected runtime errors. In the [Errors](errors.md) chapter, we'll explore the error socket so you can customize per-flow failure copy and inspect report objects instead of relying on default fallbacks.
