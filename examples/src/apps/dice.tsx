// The guide's dice panel: navigation (go pops back to the menu, Back
// rides the history stack), state (a click mutates session data, the
// panel redraws), controls (the select takes your call, values arrive
// as strings), layout (a page heading, separators, a painted rules
// panel, and a callout dress the same screens), and modals (one action
// opens the wager dialog and receives its submit).
import { action, command, EventKind, flow, mounts, screen } from 'fluxcord';

interface DiceData {
	call?: number;
	roll?: number;
	wager?: number;
	lucky?: boolean;
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

// Two lifetimes: the click opens the dialog, and the submit re-runs this
// same action with event.inputs filled in.
const setWager = action<DiceData>()(e => {
	if (e.kind !== EventKind.ModalSubmit) {
		void e.ui.showModal(
			<modal title="Set a wager">
				<text>Stake some coins on the round. Lucky mode doubles the swing: a win pays double, a loss costs double.</text>
				<input
					id="wager"
					label="Wager"
					required
					placeholder="Amount in coins"
					maxLength={6}
					value={e.session.data.wager !== undefined ? String(e.session.data.wager) : undefined}
				/>
				<checkbox
					id="lucky"
					label="Lucky mode"
					description="Double the payout, double the risk"
					checked={e.session.data.lucky}
				/>
			</modal>,
		);
		return;
	}
	e.mutate(d => {
		const amount = Number(e.inputs?.wager);
		d.wager = Number.isFinite(amount) && amount > 0 ? amount : undefined;
		d.lucky = e.inputs?.lucky === true;
	});
});

// A new round keeps the wager but clears the table.
const reset = action<DiceData>()(e => {
	e.mutate(d => {
		d.call = undefined;
		d.roll = undefined;
	});
});

const calls = [1, 2, 3, 4, 5, 6].map(n => ({
	label: String(n),
	value: String(n),
}));

function headline({ call, roll, wager, lucky }: DiceData): string {
	const stake = wager === undefined
		? ''
		: ` ${wager} coins on the table${lucky === true ? ', double or nothing' : ''}.`;
	if (roll === undefined) {
		return call === undefined
			? `Call a number, then roll.${stake}`
			: `You called ${call}. Now roll.${stake}`;
	}
	if (wager === undefined) {
		return roll === call
			? `You called ${call} and rolled ${roll}. You win the round!`
			: `You called ${call} and rolled ${roll}. The die wins.`;
	}
	const swing = lucky === true ? wager * 2 : wager;
	return roll === call
		? `You called ${call} and rolled ${roll}. You win ${swing} coins!`
		: `You called ${call} and rolled ${roll}. You lose ${swing} coins.`;
}

const menuScreen = screen<DiceData>()((_data, { Button, Back }) => (
	<view title="Dice">
		<text>One die, one roll, no house edge. Where to?</text>
		<hr />
		<row>
			<Button onClick={e => e.ui.go('roll')} label="Roll" />
			<Button onClick={e => e.ui.go('rules')} label="Rules" />
			<Button onClick={e => e.ui.go('about')} label="About" />
		</row>
		<Back />
	</view>
));

const rollScreen = screen<DiceData>()((data, { Button, Select, Back }) => (
	<view>
		<text>{headline(data)}</text>
		<Select
			placeholder="Call a number"
			options={calls}
			onSelect={call}
			values={[data.call]}
			disabled={data.roll !== undefined}
		/>
		<row>
			<Button
				onClick={roll}
				label="Roll"
				disabled={data.call === undefined || data.roll !== undefined}
				success={data.call !== undefined ? true : undefined}
			/>
			<Button onClick={setWager} label="Set a wager" />
			<Button onClick={reset} label="New round" secondary />
			<Back />
		</row>
	</view>
));

const rulesScreen = screen<DiceData>()((_data, { Back }) => (
	<container color={0xf1c40f}>
		<text title="House rules">Call a number from one to six, then roll. Guess right and you win the round; guess wrong and the die wins.</text>
		<hr />
		<codeblock lang="js">roll === call // the only winning line</codeblock>
		<Back />
	</container>
));

const aboutScreen = screen<DiceData>()((_data, { Back }) => (
	<view>
		<info>Dice is the guide's example panel.</info>
		<text>It grows chapter by chapter; the chrome you see here comes from the layout chapter.</text>
		<Back />
	</view>
));

export const diceFlow = flow<DiceData>('dice', {
	screens: { menu: menuScreen, roll: rollScreen, rules: rulesScreen, about: aboutScreen },
	first: 'menu',
});

export const diceCommand = command('dice', 'Open the dice panel', {
	mount: mounts(diceFlow),
});
