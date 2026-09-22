# Controls

Although the dice panel has state and navigation now, its controls are still the plain blurple buttons we started with. We'll round out the panel's control surface in this chapter by introducing button style flags along with the select menu that finally makes the rules screen's promise real. Checkboxes and forms exist as well, but those are covered in the [Modals](modals.md) chapter because they're modal-specific material.

## Button styles

Every button renders in one of Discord's four faces, which you pick by passing a style flag: `primary` (blurple), `secondary` (gray), `success` (green), or `danger` (red). We've been using these without explicitly naming them; for instance, the counter's minus button wore `secondary` because a cancel-adjacent action reads much better in gray. A button without a style flag defaults to `primary`, and passing any other flag overrides it.

To render a green button, for example, you can pass its style flag directly:

```tsx
<Button label="Click me" success />
```

> [!IMPORTANT]
> The style flags are literal-`true` markers rather than standard booleans. We designed them this way so that a typo like `suceess` fails at compile time instead of silently failing at runtime. The flip side is that a conditional face must pass `undefined` to switch the flag off:
>
> ```tsx
> // green while the roll is available; undefined is what switches the flag back off
> <Button label="Roll" disabled={!canRoll} success={canRoll ? true : undefined} />
> ```

Since style flags are plain props, a button's face can depend on anything the screen can see; we'll put that flexibility to work later in this chapter once our roll screen has state to react to.

## Calling a number

Ever since the navigation chapter, the rules screen has promised a simple game where you call a number from one to six and roll to see if they match. Now that selects are on the table, the roll screen can finally deliver on that promise. To support this, we'll expand our data bag with a `call` field and use a small array to describe the available choices:

```tsx
interface DiceData {
	call?: number;
	roll?: number;
}

const calls = [1, 2, 3, 4, 5, 6].map(n => ({
	label: String(n),
	value: String(n),
}));
```

Every option requires a `label` to show the user and a `value` for your handler to receive; we separate these because labels act as user-facing copy while values serve as stable identifiers for your code. Since they coincide in this particular case, we can derive both from the same number.

We'll destructure the `Select` component from the screen kit and write a handler that looks like any other action; you can view the complete implementation in the finished app at [`examples/src/apps/dice.tsx`](../../../examples/src/apps/dice.tsx):

```tsx
const call = action<DiceData>()(e => {
	const pick = e.values?.[0];  // event.values can be undefined, so we guard first before indexing
	if (pick === undefined) return;  // no-op if the user didn't pick anything
	e.mutate(d => {
		d.call = Number(pick);
	});
});
```

Because Discord selects can be configured to accept multiple choices at once, as we'll see below, any pick arrives through `event.values` as an array of selected value strings. The TypeScript types are honest about this possibility; since button clicks carry no values, the `values` array is optional on the event, which is why our handler uses optional chaining to grab the first pick and safely returns if that array is empty. Although a default select configuration always guarantees at least one pick, this small guard is a cheap way to keep our data bag clean.

The list itself can arrive in one of two spellings. The `options` prop accepts any array, which is why we derive `calls` with `.map` rather than writing out six tags by hand; `<option>` elements are the other spelling, and they read best for a few fixed entries. Each element takes the same `label` and `value` as an array entry, plus an optional `description` that Discord renders in smaller text beneath the label:

```tsx
<Select placeholder="Call a number" onSelect={call}>
	<option value="1">1</option>
	<option value="2" description="The lowest roll">2</option>
</Select>
```

The two spellings can also share a select, because `<option>` children append to whatever the `options` prop brought. That makes them a convenient way to pin a fixed entry onto a generated list.

Now we can assemble these pieces into our screen layout:

```tsx
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
```

Notice how the select sits directly in the view without a `<row>` while Roll and Back share one; we'll examine both approaches in the next section.

The button's conditional flags do something quite powerful; since its visual presentation now directly depends on the session's data, the face turns green once a number is called while the `disabled` prop keeps it unpressable before then. The screen was already a function of our data bag, and now the controls are part of that same function too. The `placeholder` prop, meanwhile, controls the text displayed inside the select before a user makes a choice.

We'll define the headline as a plain TypeScript function right above the screen. We don't need any framework magic here because views are just standard TypeScript; this means any complex text formatting can live in a dedicated helper function where you can test and maintain it easily:

```tsx
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
```

Once you rebuild and restart the bot, you can trigger `/dice` to test out a full round. After you pick a number, you'll see the Roll button turn green so that you can roll and see who won.

## Rows

Rows are where controls live: because Discord arranges interactive elements into action rows, fluxcord automatically wraps any bare control in a dedicated row during rendering. That's why the roll screen can place its select straight into the view without an enclosing tag, and the menu, rules, and about screens do the same with their lone `Back` button. Each control gets its own row this way, so controls share horizontal space only when you group them in an explicit `<row>`, exactly as we did for Roll and Back. Both spellings produce identical layouts, so wrapping a control manually is simply a way to make your design intent clear in the markup.

> [!IMPORTANT]
> Although a single row can hold up to five buttons, Discord forbids mixing buttons and selects in the same row; fluxcord will therefore reject any row that pairs a select with another control when building the layout:
>
> ```tsx
> // throws: row with a select must have exactly one child, got 2
> <row>
> 	<Button onClick={roll} label="Roll" />
> 	<Select placeholder="Call a number" options={calls} onSelect={call} />
> </row>
> ```

## Multi-select and entity selects

Although the dice panel doesn't need them, selects support two additional props that open up more advanced use cases. Passing `minSelected` and `maxSelected` transforms a standard select into a multi-select interface; for example, setting `maxSelected={3}` allows users to select up to three items before they send their choice. Discord limits these selections to a maximum of twenty-five options, though they default to exactly one choice if you leave these props unspecified.

A select can also skip the static list and pull its options straight from Discord. The following entity flags are available for this purpose:

- `users` for server members
- `roles` for server roles
- `channels` for server channels
- `mentionable` for members and roles

Example:

```tsx
<Select placeholder="Pick a member to promote" users onSelect={promote} />
```

Since Discord returns these selections as entity IDs inside `event.values`, your handler can consume them directly while `minSelected` and `maxSelected` continue to enforce your quantity limits.

Either type of select can be initialized with an existing selection. With a static list, you mark an option with the `default` flag:

```tsx
<Select placeholder="Pick a number" onSelect={setNumber}>
	<option value="1" default>1</option>
	<option value="2">2</option>
</Select>
```

A `default` flag is baked into the list at authoring time, so it can't follow your session's data. You'll run into this exact limitation in the dice panel: when you pick a number and roll, the redrawn panel forgets your choice and drops back to its placeholder, even though the headline still reports the call. To make the preselection react to data, pass the `values` prop; it takes an array of values to mark on every draw, and because entries may be `undefined`, your data-bag field can ride in directly:

```tsx
<Select placeholder="Call a number" options={calls} onSelect={call} values={[data.call]} />
```

Before your first pick, `data.call` is `undefined`, so nothing is preselected and the placeholder shows as usual. Once you make a choice, though, the matching option stays marked across every redraw because the select is now a function of the data bag, just like the buttons. Any values that don't match an option are simply ignored; when `values` does yield a match, it takes precedence over any `default` flags: the live pick replaces the static fallback.

Entity selects rely on the `defaultIds` prop instead, which accepts an array of Discord IDs. To pre-select the server's default role, for example, pass its ID in that array:

```tsx
<Select placeholder="Pick a role" roles onSelect={setRole} defaultIds={[role.id]} />
```

> [!IMPORTANT]
> `defaultIds` works only on entity selects, whereas static lists preselect through the `default` flag or the `values` prop instead.

<!-- -->

> [!CAUTION]
> ```tsx
> // throws when the select builds: a select takes either options or entity, never both
> <Select
> 	placeholder="Pick a member to promote"
> 	options={calls}
> 	users
> 	onSelect={promote}
> />
> ```
> An option list and an entity flag are mutually exclusive. fluxcord has no way to merge a hand-written list with a live Discord picker, so the combination fails the moment the select is built.

## Next

While our panel can now receive rich user input, its visual presentation remains limited to flat rows of text and basic controls. In [Layout and content](layout-and-content.md), we'll introduce structure to the dice panel by using sections and headers along with the other native layout elements Discord offers.
