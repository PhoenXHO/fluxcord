// The guide's first panel: stateless, no data slice, no kit.
import { command, flow, mounts, screen } from 'fluxcord';

const aboutScreen = screen()(() => (
	<view>
		<text>A tiny panel built with fluxcord.</text>
		<row>
			<link label="Source" url="https://github.com/PhoenXHO/fluxcord" />
		</row>
	</view>
));

export const aboutFlow = flow('about', {
	screens: { main: aboutScreen },
	first: 'main',
});

export const aboutCommand = command('about', 'Open the about panel', {
	mount: mounts(aboutFlow),
});
