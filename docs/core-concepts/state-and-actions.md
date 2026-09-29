# State and actions

Right now, the dice panel moves between screens, but it does not store or remember anything. Every visit to the rules screen displays the exact same text, and the menu remains completely static. In this chapter, we will give panels a place to hold data.

We will start with a minimal counter panel to make the core mechanics clear, then apply those same patterns to the dice panel so rolling the die finally works.

## The counter panel

The counter is the hello world of stateful UIs, representing a simple number on screen alongside buttons that increment or decrement it. It is small, but it exercises the full loop we're focusing on in this chapter because a click has to change the underlying data so that the screen can redraw with the updated value.

The panel lives in `src/modules/counter.tsx`, which mirrors [`examples/src/modules/counter.tsx`](../../examples/src/modules/counter.tsx). As always, we start with the data shape because the structure of the data dictates how everything else is built:

`/src/modules/counter.tsx`
```tsx
import { action, command, flow, mounts, screen } from 'fluxcord';

interface CounterData {
	count: number;
}
```

Every session holds a single bag of data for its entire lifecycle. The `CounterData` interface gives the bag its shape: a single number.

Next, we'll write the two handlers, which are worth reading closely since the pattern here establishes the standard shape for every handler you'll write in fluxcord:

```tsx
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
```

Like `screen()`, the `action` factory takes two calls. The first, `action<CounterData>()`, binds the data type for strict typechecking; the second takes the handler callback that runs whenever a user interacts with the control that the action is bound to. Inside this callback, `event.mutate` hands you a mutable reference to the session's data so that you can change it like an ordinary object, and fluxcord automatically handles the rest by redrawing the current screen so that users see the updated count without you ever having to touch the message yourself.

Why go through `mutate` instead of writing to the session's data directly?

Every successful handler is followed by one automatic redraw that renders the bag as it stands, so even a bare write reaches the screen. What `mutate` adds is discipline: it applies your change immediately and marks the event as mutated, which is what the `task` guard checks. That guard matters because a handler that throws never redraws; the message keeps its last good render while the bag already contains the change, leaving the two out of sync. Anything fallible, such as an API call or a database write, therefore belongs before the mutation. If that work fails after you've already mutated, the bag is ahead of what the user sees. The event's `task` helper puts this rule into practice; it runs a promise for you, and it throws if a mutate has already happened. Wrapping fallible work in `task` is what places it under that guard. The [Errors](errors.md) chapter goes into more detail on this.

Both phases in one handler:

```tsx
const save = action<SettingsData>()(async e => {
	// fallible work first: the write can fail
	await e.task(() => db.saveSettings(e.session.data));
	// mutate last: only reached when the save succeeded
	e.mutate(d => {
		d.saved = true;
	});
});
```

> [!CAUTION]
> ```tsx
> e.mutate(d => {
> 	d.saved = true;
> });
> await e.task(() => db.saveSettings(e.session.data)); // throws, the save never runs
> ```
> Every `task` call after a mutate dies with an error. Always do the fallible work first inside `task`.

In [Subflows](subflows.md), flows nest inside other flows, and the lens slices automatically: on a nested screen, `event.session.data` already is the parent's slot, so even a bare write lands in the right place. A bare write just never sets the mutated mark, and only that mark makes `task` throw.

Now, with our handlers defined, the screen can read from `data` and bind those handlers directly to buttons:

```tsx
const counterScreen = screen<CounterData>()((data, { Button }) => (
	<view>
		<text>Count: {data.count}</text>
		<row>
			<Button onClick={minus} label="-1" secondary />
			<Button onClick={plus} label="+1" />
		</row>
	</view>
));
```

Two specific details stand out here. First, the screen receives the data bag as its first argument (the one we underscored and ignored in the previous chapter), but inside the view that bag is strictly read-only, which means TypeScript will reject any attempt to write to `data.count` there. We maintain this deliberate split because views should only render while handlers handle mutations; the split means the redraw shows whatever the bag holds once your handler finishes.

_The `secondary` prop on the minus button renders Discord's gray style, though we'll explore the rest of the available styles in the next chapter._

Second, `onClick` receives the actual handler function instead of a string; since buttons bind by identity, you don't have to invent or parse custom-id strings.

Next, we define the flow and command, which follow the familiar pattern we used for the dice panel:

```tsx
export const counterFlow = flow<CounterData>('counter', {
	screens: { main: counterScreen },
	first: 'main',
	initialData: { count: 0 },
});

export const counterCommand = command('counter', 'Open the counter panel', {
	mount: mounts(counterFlow),
});
```

The only new addition here is the `initialData` field, which defines what a fresh session's bag looks like.

> [!NOTE]
> Every session receives its own clone of that object at mount time, so if two people run `/counter`, each panel counts independently.

To hook this up, wire the command into your module list in `src/index.ts` (make sure to add the import first):

```ts
const bot = createBot({
	modules: [
		{ name: 'about', commands: [aboutCommand] },
		{ name: 'dice', commands: [diceCommand] },
		{ name: 'counter', commands: [counterCommand] },
	],
});
```

Once you rebuild and restart your bot, you can run `/counter` and click the buttons to watch the count move, and fluxcord redraws the screen each time, as before.

## Rolling the die

Now that the mechanics are in place, we can make the dice panel remember rolls by setting up a data interface along with a roll action to update it.

After opening `src/modules/dice.tsx` (finished version lives at [`examples/src/modules/dice.tsx`](../../examples/src/modules/dice.tsx)), we'll define the shared bag first; because every screen here works on the same bag, we declare the interface at the top of the file:

```tsx
interface DiceData {
	roll?: number;
}
```

The `roll` field is optional because a fresh panel doesn't have a roll to show yet. Since we're omitting `initialData` this time, every session starts from an empty bag where `data.roll` is `undefined` until the first click lands. Both forms are perfectly valid, so you should pick whichever matches the flow's needs; a flow with a meaningful starting state declares it while one without can omit it.

Next, we'll place the action above the screens that bind it so that it's available during definition:

```tsx
const roll = action<DiceData>()(e => {
	e.mutate(d => {
		d.roll = 1 + Math.floor(Math.random() * 6);
	});
});
```

This uses the same two-call shape as the counter, with a shorter event name to suit a handler this small; the mutation itself picks a number from one to six and stores it in the bag.

The new screen then reads that value to show either the invitation or the result depending on the state:

```tsx
const rollScreen = screen<DiceData>()((data, { Button, Back }) => (
	<view>
		<text>{data.roll === undefined
			? 'Feeling lucky? Roll.'
			: `You rolled a ${data.roll}.`}</text>
		<row>
			<Button onClick={roll} label="Roll" />
			<Back />
		</row>
	</view>
));
```

The ternary expression picks the text based on whether a roll exists yet, and fluxcord redraws the screen after each click, so repeated clicks simply re-roll.

To link this up, the menu's button row gains an entry pointing directly at the new screen:

```tsx
<Button onClick={e => e.ui.go('roll')} label="Roll" />
```

And finally, register `rollScreen` in the flow. Since the flow now states its bag type explicitly, TypeScript can use that definition to check every screen in the map; as a result, any screen that doesn't accept `DiceData` will fail to compile. That check includes the three screens we wrote in the previous chapter, so each gets a small retype first: they were plain `screen()` calls when they had no data to work with, and now they become `screen<DiceData>()`, with `_data` staying underscored exactly as it was:

```tsx
const menuScreen = screen<DiceData>()((_data, { Button, Back }) => (
	// ...unchanged from the previous chapter
));

const rulesScreen = screen<DiceData>()((_data, { Back }) => (
	// ...unchanged from the previous chapter
));

const aboutScreen = screen<DiceData>()((_data, { Back }) => (
	// ...unchanged from the previous chapter
));
```

```tsx
export const diceFlow = flow<DiceData>('dice', {
	screens: { menu: menuScreen, roll: rollScreen, rules: rulesScreen, about: aboutScreen },
	first: 'menu',
});
```

Once you rebuild and restart, you can run `/dice` to roll a few times and then try leaving to the menu and coming back; you'll find that your last result is still on the screen because the bag belongs to the session, which navigation doesn't touch.

## Next steps

Although the dice panel now has both halves of navigation and state, its controls are still limited to plain buttons. In [Controls](controls.md), we'll widen our vocabulary by introducing button style flags and the select menu.
