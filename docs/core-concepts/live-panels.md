# Live panels

Most panels render once and then wait for a click. While this model works for forms and menus, certain features require the application to push updates independently without waiting for user input, such as background job monitors, status displays, or countdown timers. In this chapter, we will build a kitchen timer panel that counts down thirty seconds by updating its display every second.

## The push mechanism

In standard interactions, fluxcord handles redrawing automatically when an action callback runs. To support external updates, the framework exposes a session handle with a `redraw` method. Calling `redraw` re-renders the current screen and edits the Discord message using the same queue as user clicks, ensuring push updates and click events never interleave:

```tsx
await handle.redraw(); // re-render the current screen from unchanged data

await handle.redraw(d => { // mutate the data bag first, then re-render,
    d.done = true;         // exactly like e.mutate inside an action handler
});
```

The mutation callback is optional. Without one, the screen re-renders from the data it already has, which is enough when the view has gone stale for another reason, like a value the screen reads from your own storage.

That leaves the question of who actually holds this handle. Action handlers receive UI methods via `e.ui`, and screen functions receive state, UI components, and read-only session metadata; the handle appears nowhere in either. It is handed out exactly once, when the session is created.

## Implementing the kitchen timer

Beyond their name and options, flows accept an optional third argument for registration options (`FlowMeta`). These options configure standalone panel behaviors, such as policy gates and lifecycle hooks. They attach to the flow as an independently mounted panel, so a flow opened by `event.call` runs with its hooks dormant; birth and death belong to the flow that owns the session:

```tsx
export const timerFlow = flow<TimerData>(
    'timer',
    {
        screens: { clock: clockScreen },
        first: 'clock',
        initialData: { left: 30 },
    },
    {
        // The start hook receives (handle, context). handle is the panel's
        // remote control (sessionId plus redraw), the same object bot.mount
        // returns. context is whatever the mounter passed when starting the
        // panel.
        // For example, the Discord host passes the slash-command invocation.
        // This flow uses the handle and ignores the context.
        onSessionStart: startCountdown,
        onSessionEnd: end => stoppers.get(end.sessionId)?.(),
    },
);
```

When the panel mounts, `onSessionStart` receives the mount handle, the very same object returned by the runtime's `mount` function, which gives whichever callback holds it the ability to push updates. With the handle captured, the timer's screen stays straightforward by using a single text node that reads directly from state:

```tsx
const clockScreen = screen<TimerData>()(data => (
    <container color={0xe67e22}>
        <text title="Kitchen timer">
            {data.left > 0 ? `Your tacos are on the clock: ${data.left} seconds left.` : 'Ding! Tacos are ready.'}
        </text>
    </container>
));
```

The countdown logic itself runs on a standard interval that pushes mutations every second:

```tsx
const stoppers = new Map<string, () => void>();

function startCountdown(handle: MountHandle<TimerData>): void {
    let left = 30;
    const tick = setInterval(() => {
        left -= 1;
        void handle.redraw(d => {
            d.left = left;
        });
        if (left <= 0) {
            clearInterval(tick);
            stoppers.delete(handle.sessionId);
        }
    }, 1000);
    stoppers.set(handle.sessionId, () => {
        clearInterval(tick);
        stoppers.delete(handle.sessionId);
    });
}
```

You can read this implementation in two parts. The interval decrements the count and calls `redraw` with a mutation, which updates the flow's data and edits the message. The map stores the cancellation callback under the session ID so the cleanup hook can find it.

## Session cleanup with `onSessionEnd`

Because any process that starts pushing also owns the responsibility to stop, cleanup must fire across every conceivable exit path, not only on normal completion. That's the purpose of `onSessionEnd`: it runs during explicit closes, replace-remounts, or automated sweeper reaps, delivering the dying session's identity alongside the reason:

```tsx
onSessionEnd: end => stoppers.get(end.sessionId)?.(),
```

Several guarantees make this hook reliable. Because it executes across every termination path, any background push you initiate at startup will always be cleaned up. It also runs right before the death event edits the message, giving you time to handle teardown that goes beyond a simple `clearInterval`.

> [!IMPORTANT]
> The two hooks fail in opposite directions. A throw inside `onSessionStart` fails the mount loudly, because a half-initialized session is worse than no session at all. A throw inside `onSessionEnd` is logged and the shutdown continues, so a broken cleanup can never disrupt the death path it rides.

One more detail about the start hook: its second parameter is the mount context. Whoever starts the panel chooses what that value is. A programmatic `bot.mount` call accepts a `context` option, and the shipped Discord host always passes the slash-command invocation there. The engine only carries the value from the mount call to the hook without inspecting it. And because you know who mounts your flow, you can annotate the parameter to give the hook a real type and put the value to work; for example, reading the invoked options off the command interaction. This timer ignores the invocation entirely, so its callback simply omits the parameter.

## Rate limits and session TTL

Before you start pushing updates everywhere, two limits are worth knowing:
- Every push translates into a Discord edit, and Discord budgets edits at roughly five per five seconds in a single channel. A single ticking timer stays safely under the limit, but dozens of live panels in one channel will exhaust the quota and start hitting rate limits. Production services batch their updates, or redraw only when a value actually changed.
- Every push registers as activity: each redraw resets the sliding window from the [Sessions and expiry](sessions-and-expiry.md) chapter, so an actively pushed panel never reaches its idle deadline.

That persistence is ideal while a live view remains relevant, but you'll want to halt updates as soon as they stop being useful so the panel can expire naturally. The map pattern shown earlier enforces this discipline: once the timer runs out, pushes cease, allowing the panel to idle out on its own or die from a user's click.

Finally, remember the architectural boundary: while an external service holding a handle can stop watching, it can't shut the panel down directly. When `redraw` resolves to `false`, it's signaling that the session is gone and you should drop your handle. Closing a panel deliberately remains an internal handler action through `ui.exit`, ensuring that only the user's direct actions can dismiss what's on screen.

## Next steps

Whenever a bot restarts, it forgets all active sessions in memory, which quickly becomes a problem for durable panels like a giveaway or a signup sheet. In the [persistence](persistence.md) chapter, we'll introduce the rehydrate store: the single place where fluxcord interacts with a database, showing how a delayed click can revive a panel from domain truth.
