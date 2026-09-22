# Screens and navigation

A single screen worked fine for our about panel, but most interactive panels outgrow a single view pretty quickly. Users need menus to explore different options and straightforward ways to get back where they started. In this chapter, we will start building the dice panel (our main ongoing example throughout the guide) by laying out a simple menu and a couple of destination screens.

We will place this code in `src/apps/dice.tsx`, which will match [`examples/src/apps/dice.tsx`](../../../examples/src/apps/dice.tsx) once finished. Much like the about panel, we are not adding session data just yet. Navigation itself is stateless, so we will save state management for the next chapter when we wire up the actual rolling logic.

## The menu screen

Open up `src/apps/dice.tsx` and define the landing screen:

```tsx
const menuScreen = screen()((_data, { Button, Back }) => (
	<view>
		<text>Dice: one die, one roll, no house edge. Where to?</text>
		<row>
			<Button onClick={e => e.ui.go('rules')} label="Rules" />
			<Button onClick={e => e.ui.go('about')} label="About" />
		</row>
		<row>
			<Back />
		</row>
	</view>
));
```

Every screen receives two arguments: session state and the screen kit. We skipped both in the about panel because it did not need them. The first parameter holds session data, which we are prefixing with an underscore (`_data`) for now because we will put it to work in the next chapter. The second argument supplies the screen kit, giving you access to fluxcord's context-aware UI components.

Unlike the standard layout elements we used earlier, the `Button` component comes from the kit rather than the standard tag vocabulary because of its `onClick` prop. This is because kit component handlers are strongly typed against their parent flow, meaning the received event knows all valid screens in that flow to keep navigation calls safe. Inside the handler, `e.ui` is the panel's steering wheel, and `e.ui.go('rules')` transitions the session to the screen registered under the `rules` key in the flow definition below.

_The `e` parameter is the click event, which is an [ActionEvent](../reference/README.md)._

## The back button

A menu is only half of navigation because destinations require a way back home. Here is the rules screen:

```tsx
const rulesScreen = screen()((_data, { Back }) => (
	<view>
		<text>Call a number from one to six, then roll. Guess right and you win the round; guess wrong and the die wins.</text>
		<row>
			<Back />
		</row>
	</view>
));
```

Similar to the `Button` component, the `Back` component comes from the screen kit, but it requires no handler of your own. fluxcord automatically tracks screen transitions in the history stack of each session. When a user clicks `Back`, fluxcord pops one entry off that stack and redraws wherever the user came from. The about screen follows the same shape. Try building it yourself.

> [!NOTE]
> When a user runs `/dice` for the first time, their history stack starts empty, with nowhere to go back to. The menu's `Back` button therefore renders in a disabled state. Once there is at least one screen in the stack, the button becomes active on the destination screen. You never manage the disabled state yourself.

## Navigation verbs: `go`, `push`, and `back`

The screen kit provides three navigation verbs, though `go` is usually the one you'll reach for most. Here's how they work:

- `back` pops exactly one entry without naming a target, which is what the `Back` button invokes internally. If the stack is empty, the `back` method performs no action.
- `push` always appends to the history, which suits linear workflows where revisiting means a fresh step, such as a wizard's next page.
- `go` is the combination of the two: it checks if the target screen already sits in the session's history. If so, it pops back to it and discards everything above it; otherwise, it pushes the screen on top. This keeps menu loops clean so users can bounce between multiple screens without growing a long tail of duplicated screens.

## The flow

Now we bundle all three screens together into a single flow:

```ts
export const diceFlow = flow('dice', {
	screens: { menu: menuScreen, rules: rulesScreen, about: aboutScreen },
	first: 'menu',
});
```

This structure is similar to the about flow we made earlier, but notice how the keys in the `screens` map match the exact screen name strings we passed into `go`. TypeScript enforces this strictness, so a typo like `go('ruls')` fails to compile instead of failing at click time.

## The command

Finally, we export a slash command that mounts our dice flow:

```ts
export const diceCommand = command('dice', 'Open the dice panel', {
	mount: mounts(diceFlow),
});
```

To make this command available in Discord, add the module to your bot's list in `src/index.ts` (don't forget to import the command):

```ts
const bot = createBot({
	modules: [
		{ name: 'about', commands: [aboutCommand] },
		{ name: 'dice', commands: [diceCommand] },
	],
});
```

Rebuild and restart your bot, then run `/dice`. Try navigating between the menu and the other screens to see how the history stack updates in real time.

## Next

Now that navigation is working, the dice panel is ready for interactive logic. In [State and actions](state-and-actions.md), we will add session data and click handlers to make rolling the die work.
