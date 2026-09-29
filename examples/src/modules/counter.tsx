// The README example, word for word, plus the command that opens it.
import { action, command, flow, mounts, screen } from 'fluxcord';

interface CounterData {
	count: number;
}

const plus = action<CounterData>()((event) => {
	event.mutate((data) => {
		data.count += 1;
	});
});

const minus = action<CounterData>()((event) => {
	event.mutate((data) => {
		data.count -= 1;
	});
});

const counterScreen = screen<CounterData>()((data, { Button }) => (
	<view>
		<text>Count: {data.count}</text>
		<row>
			<Button onClick={minus} label="-1" secondary />
			<Button onClick={plus} label="+1" />
		</row>
	</view>
));

export const counterFlow = flow<CounterData>('counter', {
	screens: { main: counterScreen },
	first: 'main',
	initialData: { count: 0 },
});

export const counterCommand = command('counter', 'Open the counter panel', {
	mount: mounts(counterFlow),
});
