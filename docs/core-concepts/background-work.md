# Background work

Event handlers are run-to-completion operations inside the per-session queue, so a handler's edits land as one automatic redraw per event. Because Discord closes a component interaction's response window after 3s, slow operations risk timing out. Before this verb, there was no busy screen and no way to keep a panel interactive while work ran.

To explore the solution, you build the `monitor` module found in `examples/src/modules/monitor.tsx`. Registered with the `/monitor` command, it demonstrates how to watch a job run while you keep using the panel.

## Launching work

You start background work by calling `event.launch(work, { as? })`. The closure starts outside the session's queue, so `launch` returns immediately: the handler settles and the click acks, leaving the panel interactive. The closure receives a mutate-only `JobHandle`, since moving the panel is the handlers' business.

> [!IMPORTANT]
> The handle is mutate-only: a job cannot navigate, send replies, or exit its flow. Screens are the handlers' business; the job's only output is bag writes.

Don't confuse the two with `event.task`, the synchronous hook for fallible work inside the event itself: it runs before any mutation and throws if you call it after one.

```tsx
import { action, command, flow, mounts, screen } from 'fluxcord';

interface MonitorData {
	progress: number;
	paused: boolean;
	rate: number;
	report?: { steps: number; seconds: number };
}

const STEPS = 20;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const bar = (progress: number): string => {
	const filled = Math.round((progress / 100) * 10);
	return '█'.repeat(filled) + '░'.repeat(10 - filled);
};
```

## Writes that redraw

Calling `job.mutate(fn)` re-enters the session's FIFO as one short entry. It applies your function to the flow's bag (the launching frame's slot path), then asks the coalescing redraw scheduler for a render only when the launching frame is the top frame, and a called flow's job writes its own slot.

A write always lands in the bag, even while the user is on another screen, but only an on-screen frame redraws. Changes made while the user is elsewhere wait for the next navigation, and the navigation's own redraw renders from the bag, so the screen is current on return. Because renders always read the current bag, collapsing intermediate states loses nothing.

At most one edit per session is in flight. Writes landing while an edit runs only schedule the next round, meaning a chatty job self-paces to what the platform accepts instead of backing the FIFO up behind rate-limited edits. At the edit seam, a payload identical to the last one sent drops.

> [!NOTE]
> Visit the settings screen mid-job and the bar keeps ticking silently underneath: the writes land but the settings screen just doesn't render them. Head back and the running screen is already caught up, since its redraw reads the current bag.

```tsx
import { action, command, flow, mounts, screen } from 'fluxcord';

const start = action<MonitorData>()((event) => {
	const session = event.session;
	const startedAt = Date.now();
	event.ui.go('running');
	// Fire-and-forget: this handler returns, the click acks, the panel
	// stays interactive. The job reads paused and rate from the bag on
	// every step, so button edits and settings changes steer it live.
	event.launch(async (job) => {
		// The pause check runs twice per step: once before the wait (the
		// idle loop) and once after it, so a pause landing mid-step skips
		// the step instead of overshooting one.
		while (session.data.progress < 100) {
			if (session.data.paused) {
				await sleep(100);
				continue;
			}
			await sleep(session.data.rate);
			if (session.data.paused) continue;
			job.mutate((data) => {
				data.progress = Math.min(100, data.progress + 100 / STEPS);
			});
		}
		return { steps: STEPS, seconds: Math.round((Date.now() - startedAt) / 1000) };
	}, { as: 'report' });
});
```

## Steering the job from the panel

The job reads the bag on every step by closing over `event.session` in the handler. To handle interruptions cleanly, you check a pause flag before and after each wait. This ensures a pause landing mid-step skips the step instead of overshooting one.

You add normal actions to modify the rate and pause state. The settings screen exposes rate buttons alongside `<Back />`. Because the rate change steers the job from its next step, the running screen picks the change up the moment you go back.

```tsx
import { action, command, flow, mounts, screen } from 'fluxcord';

const togglePause = action<MonitorData>()((event) => {
	event.mutate((data) => {
		data.paused = !data.paused;
	});
});

const setSlow = action<MonitorData>()((event) => {
	event.mutate((data) => {
		data.rate = 800;
	});
});

const setFast = action<MonitorData>()((event) => {
	event.mutate((data) => {
		data.rate = 250;
	});
});
```

## Delivering a result

The settled value of your work lands in `data.<as>` under the same landing rules. You pass `{ as: 'report' }` in `event.launch` to deliver the final metrics. A rejection routes to the error socket as a framework-source failure with no click bound, so the shipped default logs it and sends the user nothing. Nothing is written on failure.

The screens themselves stay ordinary: intro, running and settings bind the actions above, and the running screen flips to a finished state once `data.report` appears.

```tsx
import { action, command, flow, mounts, screen } from 'fluxcord';

const introScreen = screen<MonitorData>()((data, { Button }) => (
	<container color={0x5865f2}>
		<text title="Monitor">
			A demo of background work: press Start and a job runs while you keep using this panel.
		</text>
		<row>
			<Button onClick={start} label="Start the job" />
		</row>
	</container>
));

const runningScreen = screen<MonitorData>()((data, { Button }) => (
	<container color={data.paused ? 0xf1c40f : 0x2ecc71}>
		<text title={data.paused ? 'Monitor (paused)' : 'Monitor'}>
			{`[${bar(data.progress)}] ${Math.round(data.progress)}%\nRate: one step every ${data.rate}ms, read from the bag each step.`}
		</text>
		<text title={data.report === undefined ? 'Job running' : 'Job finished'}>
			{data.report === undefined
				? 'The bar redraws on its own: every job edit is an ordinary queued redraw.'
				: `Done in ${data.report.seconds}s (${data.report.steps} steps); the settled value arrived through { as: 'report' }.`}
		</text>
		<row>
			<Button onClick={togglePause} label={data.paused ? 'Resume' : 'Pause'} secondary />
			<Button onClick={e => e.ui.go('settings')} label="Settings" secondary />
			<Button onClick={e => e.ui.exit()} label="Stop" />
		</row>
	</container>
));

const settingsScreen = screen<MonitorData>()((data, { Button, Back }) => (
	<container color={0x95a5a6}>
		<text title="Settings">
			The job keeps running while you are here. Changing the rate steers it from its next
			step; the running screen picks the change up the moment you go back.
		</text>
		<row>
			<Button onClick={setSlow} label="Slow (800ms)" secondary={data.rate === 800 || undefined} />
			<Button onClick={setFast} label="Fast (250ms)" secondary={data.rate === 250 || undefined} />
			<Back />
		</row>
	</container>
));
```

## When the job ends

The job is owned by its frame, so pressing Stop (which runs `event.ui.exit()`) kills it quietly, and the same goes for the flow returning, crashing, or the session ending.

Because JavaScript can't cancel a running closure, a dead job's later writes are dropped. This check relies on identity, so a revive-replaced session under the same id counts as dead. Jobs live in memory only: a restart drops them. A revived session starts clean, though it can land on a stale pending flag that your screens must survive.

Job writes never touch the sliding TTL, because a polling job must not keep its own panel alive. You may set `ttlMs: Infinity` in your flow definition to opt out of expiry entirely. The sweeper never reaps it, though close and remount-replace still kill it, and an ephemeral surface's absolute ceiling applies. Zero, negative and NaN values still throw.

> [!TIP]
> A long-lived monitor that should survive idle stretches sets `ttlMs: Infinity` in its flow definition: the session lives until closed and the sweeper never reaps it. Job writes never slide the window for you either way, so a watched-but-untouched panel still expires on the default 30-minute clock.

```tsx
import { action, command, flow, mounts, screen } from 'fluxcord';

export const monitorFlow = flow<MonitorData>('monitor', {
	screens: { intro: introScreen, running: runningScreen, settings: settingsScreen },
	first: 'intro',
	initialData: { progress: 0, paused: false, rate: 400 },
});

export const monitorCommand = command('monitor', 'Watch a job run while you keep using the panel', {
	mount: mounts(monitorFlow),
});
```

## Slow handlers and the 3s window

A dispatch that outlasts 2s of Discord's 3s window acks early (`deferUpdate`), so a slow synchronous handler never renders as "didn't respond in time". Any copy sent after the early ack rides `followUp`. This ack race timer defaults to 2000ms and remains tunable per runtime via the `ackAfterMs` dispatch option. Launching handlers return instantly and never feel it, so launch-and-notify keeps the main path clear and the timer stays a safety net for slow synchronous handlers.

> [!CAUTION]
> Handlers that open modals must open them inside the window: a modal cannot open on an already-acked interaction. When a handler combines slow work with a modal, open the modal first and do the work on the submit.

## Next steps

Background work and live panels cover the two ways a panel moves on its own, but both forget everything the moment the process restarts. In the [persistence](persistence.md) chapter, we'll meet the rehydrate store: the single place where fluxcord interacts with a database, letting a delayed click revive a panel from domain truth.
