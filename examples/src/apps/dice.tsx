// The guide's navigation panel: a hub-and-spoke flow where go pops back
// to the menu and Back rides the session's history. Rolling waits for the
// state chapter.
import { command, flow, mounts, screen } from 'fluxcord';

const menuScreen = screen()((_data, { Button, Back }) => (
	<view>
		<text>Dice: one die, one roll, no house edge. Where to?</text>
		<row>
			<Button onClick={(event) => event.ui.go('rules')} label="Rules" />
			<Button onClick={(event) => event.ui.go('about')} label="About" />
		</row>
		<row>
			<Back />
		</row>
	</view>
));

const rulesScreen = screen()((_data, { Back }) => (
	<view>
		<text>Call a number from one to six, then roll. Guess right and you win the round; guess wrong and the die wins.</text>
		<row>
			<Back />
		</row>
	</view>
));

const aboutScreen = screen()((_data, { Back }) => (
	<view>
		<text>Dice is the guide's example panel. Today it demonstrates screens and navigation; rolling arrives with the state chapter.</text>
		<row>
			<Back />
		</row>
	</view>
));

export const diceFlow = flow('dice', {
	screens: { menu: menuScreen, rules: rulesScreen, about: aboutScreen },
	first: 'menu',
});

export const diceCommand = command('dice', 'Open the dice panel', {
	mount: mounts(diceFlow),
});
