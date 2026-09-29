// A community campfire that outlives the process. The bag is a mirror;
// the file is the truth. When a click lands on a panel whose session is
// gone (a restart, or the TTL running out), the flow's rehydrate
// callback reads the file back into a fresh bag and the panel continues
// instead of parting.
import { readFile, writeFile } from 'node:fs/promises';
import { action, flow, screen } from 'fluxcord';

interface CampfireData {
	logs: number;
}

// The flow's own database: one fire, one number. The mount site names
// it ('campfire:main'); a real bot would hold many fires and switch on
// the ref.
const CAMPFIRE_FILE = 'campfire.json';

async function readLogs(): Promise<number> {
	try {
		const campfire = JSON.parse(await readFile(CAMPFIRE_FILE, 'utf8')) as { logs: number };
		return campfire.logs;
	} catch {
		return 0;
	}
}

async function writeLogs(logs: number): Promise<void> {
	await writeFile(CAMPFIRE_FILE, JSON.stringify({ logs }, null, '\t'));
}

// Truth lands on disk inside the handler: the file, not the bag, is what
// a revive reads back. The write comes before the mutate, so a failing
// write throws before any state changes and the panel and the file
// never disagree.
const addLog = action<CampfireData>()(async e => {
	const next = e.session.data.logs + 1;
	await writeLogs(next);

	// Note that mutate runs *after* the write (fallible work; see the Errors chapter)
	e.mutate(d => {
		d.logs = next;
	});
});

const campfireScreen = screen<CampfireData>()((data, { Button }) => (
	<view>
		<text title="Campfire">
			{data.logs === 0
				? 'The fire is cold. Someone has to strike the first spark.'
				: `The fire has burned ${data.logs} logs tonight. Someone keeps it fed.`}
		</text>
		<row>
			<Button onClick={addLog} label="Add a log" />
		</row>
	</view>
));

export const campfireFlow = flow<CampfireData>('campfire', {
	screens: { fire: campfireScreen },
	first: 'fire',
	initialData: { logs: 0 },
	// The ref would pick a fire in a real bot; this demo runs one, so the
	// callback ignores it and reads the file. Returning undefined means
	// the fire is gone, and the late click gets the parting screen.
	rehydrate: async () => ({ logs: await readLogs() }),
});
