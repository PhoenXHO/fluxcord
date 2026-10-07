// A job runs while the panel stays fully usable. Start launches a
// polling-style job; its progress edits redraw the screen live with no
// click in sight. Pause/Resume are ordinary buttons whose edits the job
// reads from the bag each step. Settings is a screen you can visit
// mid-job: the job keeps working underneath, its edits wait (nothing the
// settings screen renders changed), and a rate change steers it from the
// next step. Stop ends the flow, which kills the job quietly with its
// frame.
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

export const monitorFlow = flow<MonitorData>('monitor', {
	screens: { intro: introScreen, running: runningScreen, settings: settingsScreen },
	first: 'intro',
	initialData: { progress: 0, paused: false, rate: 400 },
});

export const monitorCommand = command('monitor', 'Watch a job run while you keep using the panel', {
	mount: mounts(monitorFlow),
});
