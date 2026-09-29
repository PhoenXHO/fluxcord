# Errors

When an action handler throws an error, the framework must safely handle the failure and notify the user. fluxcord provides a default error path along with flow-level and global hooks to handle exceptions gracefully. In this chapter, we will walk through these features by adding a fallible ping button to the staff module's ticket desk.

## The shipped default

Whenever a handler throws an exception, fluxcord catches the failure, logs it to the console, and immediately replies to the clicker:

> Something went wrong. Try again; if it keeps failing, ping a host.

When logging, fluxcord formats errors as `[fluxcord] <failure-mode>: <error-message>`. Seeing `[fluxcord] handler failure: Error: ...` in your console means an exception was thrown in your code, whereas `[fluxcord] framework failure: ...` indicates an issue in the underlying framework adapter. This distinction represents the main fork in the whole error pipeline: handler failures trigger a user-facing reply, while framework failures are logged and otherwise left alone because a user can't retry their way out of a bug in your adapter.

Meanwhile, the panel itself stays put, since a thrown handler cancels the redraw that normally follows a click so the message keeps showing the last good screen. This behavior introduces one notable wrinkle: if a handler writes session data before throwing, those writes linger in the data even though the message continues showing the old screen, meaning the two can disagree until the next redraw runs. Fortunately, the report carries a diagnostic specifically for this situation, which we'll explore below.

> [!NOTE]
> When a handler succeeds but the redraw publishing its changes fails, nobody gets an error reply. That silence is deliberate: advising a retry would rerun an action that already worked.

## A button that can fail

So far the ticket desk's resolve button can't fail: it just decrements a number. The desk also needs a way to notify the assignee, and that ping is a network call in a production bot, one Discord could easily refuse. That makes the ping a good place to see fluxcord's error handling. In our example bot, a coin flip stands in for the network:

```tsx
interface TicketData {
	open: number;
	pinged: boolean;
}

// Resolving is the gated control: the admin gate rides the button (the
// policy prop), gets stamped into the frame at draw time, and is
// checked at dispatch. Even the session owner needs an admin badge for
// this one.
const resolveNext = action<TicketData>()(e => {
	e.mutate(d => {
		d.open = Math.max(0, d.open - 1);
	});
});

// A real bot would call the assignee through Discord here; the stub flips
// a coin so the failure path actually fires during a demo.
const pingAssignee = action<TicketData>()(async e => {
	if (Math.random() < 0.5) throw new Error('the notification stack refused the ping');
	e.mutate(d => {
		d.pinged = true;
	});
});

const deskScreen = screen<TicketData>()((data, { Button }) => (
	<view>
		<text>The ticket desk: resolve what is handled, ping the assignee when a ticket sits. Wire the real queue to your own tracker.</text>
		<text>{data.open === 0 ? 'The queue is clear.' : `${data.open} ticket${data.open === 1 ? '' : 's'} in the queue.`}</text>
		<row>
			<Button
				onClick={resolveNext}
				label="Resolve the next"
				success
				disabled={data.open === 0}
				policy={{ roles: { mode: 'allow', roleIds: [...roleConfig.admin] } }}
			/>
			<Button onClick={pingAssignee} label="Ping the assignee" secondary disabled={data.open === 0 || data.pinged} />
		</row>
		{data.pinged && <text>The assignee was pinged.</text>}
	</view>
));
```

Because action handlers can be asynchronous (`ActionHandler` returns `void | Promise`), fluxcord treats a rejected promise the same as a thrown exception. When the coin flip succeeds, `e.mutate` marks the assignee as *pinged* so that the redraw disables the button while displaying the confirmation text. When it fails, the error is thrown before any write.

> [!CAUTION]
> Always perform fallible calls (API calls, database writes, etc.) before calling `mutate` to avoid corrupting the data bag. If you use `task`, it already throws if called after a `mutate`.

## Deciding the reply per flow

Although generic copy works fine as a fallback, providing specific feedback is much better when you know why an operation failed. Flows can declare an `onError` hook that receives every failure originating from their screens, returning tailored reply text or returning `undefined` to fall back to the default:

```tsx
const ticketsFlow = flow<TicketData>('tickets', {
	screens: { desk: deskScreen },
	first: 'desk',
	initialData: { open: 3, pinged: false },
	onError: report => {
		if (report.source === ErrorSource.Handler) {
			return 'The notification stack refused the ping. Give it a moment, then try again.';
		}
		return undefined;
	},
});
```

The `onError` hook accepts an `ErrorReport` object and returns a `string` containing the response text or `undefined` to fall back to the default message. The hook determines the response text, while the error socket still handles logging and delivery (we'll see how in a moment). If an `onError` hook throws an exception, fluxcord logs the exception, and falls back to the default response.

The `ErrorReport` payload passed to the hook provides full diagnostic context about the failure:

| Field              | What it says                                                                                            |
|--------------------|---------------------------------------------------------------------------------------------------------|
| `error`            | The thrown value, whatever it was.                                                                      |
| `source`           | The error source: `'handler'` for application code or `'framework'` for framework operations.           |
| `incoming`         | The incoming interaction event, omitted on background failures like sweeper runs or rehydration writes. |
| `session`          | The active session object associated with the interaction, if available.                                |
| `dirtyKeys`        | Array of top-level state keys modified before the handler threw.                                        |
| `suggestedReply`   | Custom message text returned by a flow's onError hook.                                                  |
| `screen`, `action` | The screen key and the control's label, once the event got that far. Diagnostics only.                  |
| `reply`            | Function `(text: string) => Promise` to send a response directly to the user.                           |

Whatever string your flow's `onError` hook returns travels on the report as `suggestedReply`, which the default handler uses instead of the generic error copy for handler failures.

## Replacing the error socket

For global error handling or custom logging setups, you can supply a top-level `onError` handler to `createBot`. Providing a custom error handler completely replaces fluxcord's default error handling logic:

```tsx
const bot = createBot({
	onError: report => {
		logger.error(report.error, { source: report.source, dirtyKeys: report.dirtyKeys });
		if (report.source === ErrorSource.Handler) {
			report.reply('Something broke on our side. It has been logged.').catch(() => undefined);
		}
	},
	modules: [/* ... */],
});
```

Replacing the socket allows you to route errors to external logging services or customize error messaging across your entire application.

> [!TIP]
> To augment the default handling rather than replace it, call `defaultOnError(report)` inside your custom handler: the shipped behavior runs as-is while you attach extras like telemetry.

## Next steps

Up to this point, panels have only updated when a user clicks a control. The [Live panels](live-panels.md) chapter breaks that pattern by showing how external events like ticking countdowns push updates into quiet sessions, along with the lifecycle hooks that keep the process safe.
