// The guide's dice panel: navigation (go pops back to the menu, Back
// rides the history stack), state (a click mutates session data, the
// panel redraws), and controls (the select takes your call, values
// arrive as strings).
import { action, command, flow, mounts, screen } from 'fluxcord';

interface DiceData {
	call?: number;
	roll?: number;
}

const roll = action<DiceData>()(e => {
	e.mutate(d => {
		d.roll = 1 + Math.floor(Math.random() * 6);
	});
});

const call = action<DiceData>()(e => {
	const pick = e.values?.[0];
	if (pick === undefined) return;
	e.mutate(d => {
		d.call = Number(pick);
	});
});

const calls = [1, 2, 3, 4, 5, 6].map(n => ({
	label: String(n),
	value: String(n),
}));

function headline({ call, roll }: DiceData): string {
	if (roll === undefined) {
		return call === undefined
			? 'Call a number, then roll.'
			: `You called ${call}. Now roll.`;
	}
	return roll === call
		? `You called ${call} and rolled ${roll}. You win the round!`
		: `You called ${call} and rolled ${roll}. The die wins.`;
}

const menuScreen = screen<DiceData>()((_data, { Button, Back }) => (
	<view>
		<text>Dice: one die, one roll, no house edge. Where to?</text>
		<row>
			<Button onClick={e => e.ui.go('roll')} label="Roll" />
			<Button onClick={e => e.ui.go('rules')} label="Rules" />
			<Button onClick={e => e.ui.go('about')} label="About" />
		</row>
		<row>
			<Back />
		</row>
	</view>
));

const rollScreen = screen<DiceData>()((data, { Button, Select, Back }) => (
	<view>
		<text>{headline(data)}</text>
		<Select
			placeholder="Call a number"
			options={calls}
			onSelect={call}
		/>
		<row>
			<Button
				onClick={roll}
				label="Roll"
				disabled={data.call === undefined}
				success={data.call !== undefined ? true : undefined}
			/>
			<Back />
		</row>
	</view>
));

const rulesScreen = screen<DiceData>()((_data, { Back }) => (
	<view>
		<text>Call a number from one to six, then roll. Guess right and you win the round; guess wrong and the die wins.</text>
		<row>
			<Back />
		</row>
	</view>
));

const aboutScreen = screen<DiceData>()((_data, { Back }) => (
	<view>
		<text>Dice is the guide's example panel.</text>
		<row>
			<Back />
		</row>
	</view>
));

export const diceFlow = flow<DiceData>('dice', {
	screens: { menu: menuScreen, roll: rollScreen, rules: rulesScreen, about: aboutScreen },
	first: 'menu',
});

export const diceCommand = command('dice', 'Open the dice panel', {
	mount: mounts(diceFlow),
});
