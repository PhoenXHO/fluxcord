# State and actions

Right now, the dice panel moves between screens, but it does not store or remember anything. Every visit to the rules screen displays the exact same text, and the menu remains completely static. In this chapter, we will give panels a place to hold data.

We will start with a minimal counter panel to make the core mechanics clear, then apply those same patterns to the dice panel so rolling the die finally works.

## The counter panel

The counter is the hello world of stateful UIs, representing a simple number on screen alongside buttons that increment or decrement it. Small as it is, it exercises the full loop we're focusing on in this chapter because a click has to change the underlying data so that the screen can redraw with the updated value.

The panel lives in `src/apps/counter.tsx`, which mirrors [`examples/src/apps/counter.tsx`](../../../examples/src/apps/counter.tsx). As always, we start with the data shape because the structure of the data dictates how everything else is built:

`/src/apps/counter.tsx`
```tsx
import { action, command, flow, mounts, screen } from 'fluxcord';

interface CounterData {
	count: number;
}
```

Every flow holds a single bag of data for its entire lifecycle. The `CounterData` describes what our counter flow's bag looks like, which in this case consists of a single number.

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

Just like `screen`, action handlers use the `action` factory, which uses a two-step function signature to stamp the handler with the data type it works on. The first call, `action<CounterData>()`, binds the handler to our specific data type for strict typechecking. The second call takes the actual handler callback that runs whenever a user interacts with the control that the action is bound to. Inside this callback, `event.mutate` hands you a mutable reference to the session's data so that you can change it like an ordinary object and fluxcord automatically handles the rest by re-rendering the current screen so that users see the updated count without you ever having to touch the message yourself.

Why go through `mutate` instead of writing to the session's data directly?  
Because `mutate` is how fluxcord notices that data changed. The moment you call it, the redraw is scheduled, so the screen cannot drift out of sync with your handler. The call also splits a handler into two phases: anything fallible, such as an API call or a database write, belongs before the mutation. If that work fails after you've already mutated, the user is left looking at a state the failure contradicts. The event's `task` helper puts this rule into practice; it runs a promise for you, and it throws if a mutate has already happened. Wrapping fallible work in `task` is what places it under that guard. The [Errors](errors.md) chapter goes into more detail on this.

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

Flows that nest inside other flows give `mutate` a second job: in [Subflows](subflows.md), a nested screen's `mutate` writes to its own slice of the parent's data, while a bare write to `event.session.data` skips that path and corrupts the outer flow's bag.

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

Two specific details stand out here. First, the screen receives the data bag as its first argument (the one we underscored and ignored in the previous chapter), but inside the view that bag is strictly read-only, which means TypeScript will reject any attempt to write to `data.count` there. We maintain this deliberate split because views should only render while handlers handle mutations; keeping these responsibilities separate allows the framework to know exactly when a redraw is necessary.

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

Once you rebuild and restart your bot, you can run `/counter` and click the buttons to watch the count move; since every click triggers your handler to mutate the bag, the screen redraws automatically to reflect the update.

## Rolling the die

Now that the mechanics are in place, we can make the dice panel remember rolls by setting up a data interface along with a roll action to update it.

After opening `src/apps/dice.tsx` (finished version lives at [`examples/src/apps/dice.tsx`](../../../examples/src/apps/dice.tsx)), we'll define the shared bag first; because every screen in a flow shares a single data type, we declare the interface at the top of the file:

```tsx
interface DiceData {
	roll?: number;
}
```

The `roll` field is optional because a fresh panel doesn't have a roll to show yet. Since we're omitting `initialData` this time, every session starts from an empty bag where `data.roll` is `undefined` until the first click lands. Both forms are perfectly valid, so you should pick whichever matches the flow's needs; a flow with a meaningful starting state declares it while one without can simply skip the ceremony.

Next, we'll place the action above the screens that bind it so that it's available during definition:

```tsx
const roll = action<DiceData>()(e => {
	e.mutate(d => {
		d.roll = 1 + Math.floor(Math.random() * 6);  // roll a number from 1 to 6
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

The ternary expression handles this by picking the text based on whether a roll exists yet; because the action mutates the bag after each click, fluxcord automatically redraws this same screen with the new number so that repeated clicks will simply re-roll.

To link this up, the menu's button row gains an entry pointing directly at the new screen:

```tsx
<Button onClick={e => e.ui.go('roll')} label="Roll" />
```

And finally, register `rollScreen` in the flow. Since the flow now states its bag type explicitly, TypeScript can use that definition to check every screen in the map; as a result, any screen that doesn't accept `DiceData` will fail to compile:

```tsx
export const diceFlow = flow<DiceData>('dice', {
	screens: { menu: menuScreen, roll: rollScreen, rules: rulesScreen, about: aboutScreen },
	first: 'menu',
});
```

Once you rebuild and restart, you can run `/dice` to roll a few times and then try leaving to the menu and coming back; you'll find that your last result is still on the screen because the bag belongs to the session, meaning navigation only changes which screen renders it. State outlives navigation.

## Next

Although the dice panel now has both halves of navigation and state, its controls are still limited to plain buttons. In [Controls](controls.md), we'll widen our vocabulary by introducing button style flags and the select menu.
