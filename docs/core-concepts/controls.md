# Controls

Even though our dice panel now handles state and navigation, its controls are still the plain blurple buttons we started with. In this chapter, we'll expand what it can accept by adding button style flags alongside a select menu that brings the rules screen to life. Because checkboxes and text inputs belong in modal dialogs, we'll cover those separately in the [Modals](modals.md) chapter. We'll wrap up by wiring a reset button to the round, since a data bag this easy to change deserves an equally straightforward way to clear it out.

## Button styles

Every button renders in one of Discord's four faces, which you choose by passing a style flag: `primary` (blurple), `secondary` (gray), `success` (green), or `danger` (red). We've already been using these without naming them directly; for example, the counter's minus button used `secondary` because cancel-adjacent actions read much clearer in gray. Buttons default to `primary` when you don't specify a flag, so passing any other flag overrides that baseline.

To render a green button, pass the `success` flag:

```tsx
<Button label="Click me" success />
```

> [!IMPORTANT]
> Because these style flags are literal-`true` markers rather than standard booleans, a typo like `suceess` fails immediately at compile time instead of failing silently at runtime. The flip side is that conditional styling requires passing `undefined` to switch the flag off:
>
> ```tsx
> // green while the roll is available; undefined is what switches the flag back off
> <Button label="Roll" disabled={!canRoll} success={canRoll ? true : undefined} />
> ```

Since style flags are plain props, a button's appearance can react dynamically to session state; we'll put that flexibility to work later in this chapter once our roll screen has state to respond to.

## Rows

Because Discord arranges interactive elements into horizontal action rows, fluxcord mirrors that structure directly in markup by placing controls like buttons and selects inside a `<row>`, which can hold up to five items. You've already encountered this convention, since the counter's minus and plus buttons shared a row to keep related actions paired together.

fluxcord forgives lone controls, though; dropping a button straight into a view automatically allocates it a dedicated row at render time, which is why a lone `Back` button never needed any wrapping boilerplate in our previous screens:

```tsx
<view>
	<text>Are you sure?</text>
	<Back />
</view>
```

Since both spellings produce identical layouts, writing an explicit `<row>` acts as a design statement rather than pure mechanics: controls only share horizontal space when you deliberately group them.

## Calling a number

Our rules screen promised a game where you pick a number between one and six before rolling the die to check for a match, and now that selects are available, the roll screen can deliver on that promise. We'll start by expanding our data bag with a `call` field and mapping an array to describe the available choices:

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

We'll destructure the `Select` component from the screen kit and write a handler that looks like any other action; you can find the complete implementation in the finished app at [`examples/src/apps/dice.tsx`](../../../examples/src/apps/dice.tsx):

```tsx
const call = action<DiceData>()(e => {
	const pick = e.values?.[0];  // event.values can be undefined, so we guard first before indexing
	if (pick === undefined) return;  // no-op if the user didn't pick anything
	e.mutate(d => {
		d.call = Number(pick);
	});
});
```

Because Discord selects can accept multiple choices simultaneously, any selection arrives through `event.values` as an array of strings. Since this event payload is shared across all control types, that `values` array remains optional; using `e.values?.[0]` lets your handler safely read the first selection when no selection arrived.

The guard clause (`if (pick === undefined) return;`) keeps your data bag intact if an empty selection slips through. While Discord typically prevents users from submitting a required select without choosing an item, guarding the branch remains good practice because it keeps unexpected payloads from silently corrupting state.

## The options list

You can provide options in two ways depending on what fits your data best. While passing an array to the `options` prop works well for computed collections like our `.map`-derived `calls`, explicit `<option>` child elements read much better when declaring a few fixed choices. Each element accepts the same `label` and `value` fields as an array item, alongside an optional `description` that Discord renders in smaller text beneath the label:

```tsx
<Select placeholder="Call a number" onSelect={call}>
	<option value="1">1</option>
	<option value="2" description="The lowest roll">2</option>
</Select>
```

You can even combine both formats within the same component, since any `<option>` children will append directly to whatever array the `options` prop supplies, making it easy to pin fixed choices onto a generated list.

With those primitives ready, we can assemble our complete screen layout:

```tsx
const rollScreen = screen<DiceData>()((data, { Button, Select, Back }) => (
	<view>
		<text>{headline(data)}</text>
		<Select
			placeholder="Call a number"
			options={calls}
			onSelect={call}
			disabled={data.roll !== undefined}
		/>
		<row>
			<Button
				onClick={roll}
				label="Roll"
				disabled={data.call === undefined || data.roll !== undefined}
				success={data.call !== undefined ? true : undefined}
			/>
			<Back />
		</row>
	</view>
));
```

Notice that our select sits directly in the `<view>` without an enclosing `<row>`, whereas Roll and Back are grouped together. This takes advantage of the single-control shorthand we saw earlier: fluxcord wraps the select in its own row automatically, while leaving the buttons paired inside an explicit row because they belong together.

> [!IMPORTANT]
> Even though a single row accommodates up to five buttons, Discord forbids mixing buttons and selects in the same row; fluxcord will reject any layout containing that combination as soon as it builds:
>
> ```tsx
> // throws: row with a select must have exactly one child, got 2
> <row>
> 	<Button onClick={roll} label="Roll" />
> 	<Select placeholder="Call a number" options={calls} onSelect={call} />
> </row>
> ```
>
> You can only have one select per row without any other controls, or up to five buttons.

Conditional styling makes this layout expressive: every prop reads straight from the data bag, so the controls join the same reactive cycle the screen already rides. The Roll button stays unclickable until you pick a number, then turns green while it waits for the click. The `placeholder` prop sets the preview text shown before you choose an option.

Selects accept the same `disabled` prop as buttons, and our roll screen puts it to work: once the die has landed, the menu greys out and the Roll button locks right along with it, so the finished round can't be tampered with. Everything stays locked until the reset button at the end of this chapter reopens the table.

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

Once you rebuild and restart your bot, run `/dice` to test a complete round. After picking a number, you should see the Roll button turn green so you can roll and resolve the match.

## Multi-select

While our dice game only needs a single choice, selects accept two optional props that enable multi-selection when required. By configuring `minSelected` and `maxSelected`, you can let users choose multiple items before submitting; for example, setting `maxSelected={3}` caps their selection at three entries. Discord allows these bounds anywhere from 0 to 25. The component defaults to expecting exactly one item if you omit both properties.

## Preselecting options

A select can also open with choices already highlighted, which you set up in static markup by marking each target entry with the `default` flag; you can add this flag to any number of options as long as the total count stays within the selection cap:

```tsx
<Select placeholder="Pick a number" onSelect={setNumber}>
	<option value="1" default>1</option>
	<option value="2">2</option>
</Select>
```

Because that flag is authoring-time markup, the same entries light up on every render, whatever the session is doing. Our dice panel would feel that immediately: after you pick a number and roll, the redrawn menu snaps straight back to its placeholder even though the headline still remembers your call. If you want the selection to travel with session state, you'll need the `values` prop instead; it expects the plain `value` strings of the options to highlight (not indices or IDs). Since our builders clean up after you by dropping nullish entries and stringifying the rest, a data-bag field can ride along directly:

```tsx
<Select placeholder="Call a number" options={calls} onSelect={call} values={[data.call]} />
```

Before your first pick, `data.call` is `undefined`, so nothing matches and the placeholder shows as usual; once you pick a number, though, the matching entry stays highlighted across every redraw because the menu now reads straight from the data bag. Whenever at least one entry matches, `values` takes over the selection entirely while the `default` flags sit that render out, since current state always beats static fallbacks. Any entries that don't match an option are dropped, and if nothing matches at all, those `default` flags step back in to take charge. If you overshoot the selection cap through `values`, fluxcord will throw as soon as the panel draws.

## Entity selects

Entity selects leave fixed lists behind by querying Discord directly rather than using authored options. One of four flags chooses what the picker lists:

- `users` for server members
- `roles` for server roles
- `channels` for server channels
- `mentionable` for members and roles

```tsx
<Select users placeholder="Pick a member to promote" onSelect={promote} />
```

The picks arrive the same way as before: `event.values` carries the chosen entries' Discord IDs as strings, so your handler can store or act on them directly.

Preselection doesn't use a `default` flag here because there isn't any markup to flag, as the entries come straight from Discord at render time. Instead, the `defaultIds` prop takes an array of Discord IDs; since it's an ordinary prop that gets re-evaluated on every draw, entity preselection tracks session state natively without needing a `values`-style companion:

```tsx
<Select placeholder="Pick a role" roles onSelect={setRole} defaultIds={[role.id]} />
```

One variant rejects preselection entirely: mentionable selects do not accept `defaultIds`, because their entries mix users and roles together and a bare ID doesn't indicate which entity type it represents.

> [!IMPORTANT]
> Remember that `defaultIds` applies only to entity selects; static menus must preselect through the `default` flag or the `values` prop instead.

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
> An option list and an entity flag are mutually exclusive. Because fluxcord cannot combine a static options array with Discord's dynamic directory search, attempting to supply both will fail when building the component.

## Resetting the round

Every game needs a clean restart mechanism, which is where treating state as plain data really pays off. Because our data bag is an ordinary object, clearing it only requires writing a simple action to reset the round's fields and binding that handler to a button:

```tsx
const reset = action<DiceData>()(e => {
	e.mutate(d => {
		d.call = undefined;
		d.roll = undefined;
	});
});
```

```tsx
<Button onClick={reset} label="New round" secondary />
```

We don't need a specialized reset API because `mutate` already exposes the underlying state bag; once you reset those properties, fluxcord triggers a fresh redraw automatically. You can drop this button directly into the roll screen's action row and rebuild your project so players can start over whenever a round finishes.

## Next

Even though our panel now handles user input smoothly, its visual presentation is still confined to flat rows of text and basic controls. In [Layout and content](layout-and-content.md), we'll give the panel a real structure: a page heading, separators, and a painted container panel, along with the text-level dressings that come with them.
