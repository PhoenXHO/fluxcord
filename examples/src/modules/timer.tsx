// A panel that updates itself: no click in sight. onSessionStart starts a
// ticking interval that redraws through the mount handle; the stop function
// lands in a module map keyed by session id, and onSessionEnd consults it
// on every death path. Closing stays a handler verb: a service stops
// watching, it never ends the panel.
import { command, flow, mounts, screen } from 'fluxcord';
import type { MountHandle } from 'fluxcord';

interface TimerData {
	left: number;
}

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

const clockScreen = screen<TimerData>()(data => (
	<container color={0xe67e22}>
		<text title="Kitchen timer">
			{data.left > 0 ? `Your tacos are on the clock: ${data.left} seconds left.` : 'Ding! Tacos are ready.'}
		</text>
	</container>
));

export const timerFlow = flow<TimerData>(
	'timer',
	{
		screens: { clock: clockScreen },
		first: 'clock',
		initialData: { left: 30 },
	},
	{
		// handle is the same object mount returns. The second parameter,
		// context, is the command invocation when the shipped Discord host
		// did the mounting; this flow has no use for it.
		onSessionStart: startCountdown,
		onSessionEnd: end => stoppers.get(end.sessionId)?.(),
	},
);

export const timerCommand = command('timer', 'Start a 30-second kitchen timer panel', {
	mount: mounts(timerFlow),
});
