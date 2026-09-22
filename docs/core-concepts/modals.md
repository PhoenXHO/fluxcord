# Modals

So far, every piece of input our dice panel accepts lives directly inside the message. While that works well enough for quick button clicks, certain interactions need a dedicated surface, such as typing a custom stake or filling out a multi-field form. Discord calls these dialogs modals, and fluxcord treats them as first-class markup; you can compose one from tags and display it from any handler using `ui.showModal`, after which the submitted data routes right back into the action that triggered it. In this chapter, we'll add a wager dialog featuring a coin amount and a lucky-mode toggle to our dice panel, fulfilling the promise of text inputs and checkboxes from the [Controls](controls.md) chapter.

## Opening a dialog

Because every modal requires a launcher, we'll place a "Set a wager" button inside the roll screen's action row and attach it to an action called `setWager`. This action actually leads two lives: the initial click triggers the dialog, whereas the subsequent submission re-invokes the same action with all the populated fields in tow. We differentiate between the two phases by inspecting the event's kind:

```tsx
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
		// the checkbox arrives as a boolean
		const amount = Number(e.inputs?.wager);
		d.wager = Number.isFinite(amount) && amount > 0 ? amount : undefined;
		d.lucky = e.inputs?.lucky === true;
	});
});
```

Everything prior to the `return` statement handles the opening phase, where `e.ui.showModal` passes your modal element to Discord and resolves once the dialog appears on screen. We deliberately place `void` in front because popping the modal is the action's sole purpose, meaning nothing downstream relies on the returned promise. Only one dialog can be open per interaction, and a modal submit has no second modal to answer with, so opening another one from the submit event is dropped.

If a user closes the dialog without submitting, Discord sends no network payload back to your bot. Because no event fires in that situation, you do not need to write cancellation logic, and any existing wager in your data bag stays unchanged.

To prefill the form controls, the action pulls existing values straight from `e.session.data` while constructing the dialog; we'll see how both fields ride session state in a moment.

## The modal markup

Every dialog begins with a root `<modal>` tag and a `title` prop, which Discord displays in the title bar and which must stay between 1 and 45 characters. Within that root, child elements provide copy and inputs: you'll use `<text>` for plain descriptions alongside individual form controls stacked one per row.

The `<input>` tag defines a text entry whose `id` determines the key used when returning submitted values, while its `label` appears as bold header text directly over the field. To ensure players enter a stake, `required` forces Discord to hold submission until something's typed; you can also specify `placeholder` for sample text and `maxLength` to constrain input length. Passing a `value` prop will prefill the box. If `value` evaluates to `undefined`, the field opens empty.

For binary options, the `<checkbox>` tag provides a yes/no switch that accepts both an `id` and a `label`, along with an optional `description` that renders as subdued helper text beneath. Its `checked` prop decides whether the box starts ticked, and because the prop is evaluated when the dialog opens, the checkbox remembers lucky mode across reopenings the same way the input remembers its amount with the `value` prop.

> [!IMPORTANT]
> While a screen root can be a fragment because fluxcord wraps it in a synthetic view, modals don't share that flexibility: `showModal` strictly expects a concrete `<modal>` element and throws immediately if you pass a fragment instead.

## Receiving the submit

Once someone hits submit, fluxcord invokes your action a second time with `e.kind` set to `EventKind.ModalSubmit` and populates `e.inputs`. This payload maps your authored field identifiers to their submitted values, and each value keeps its field's natural shape: text inputs and radio answers arrive as strings, the checkbox arrives as a boolean, and the pick-list fields arrive as arrays of their picks.

Since the wager rides a text field, the submit branch parses it before trusting it:

```tsx
e.mutate(d => {
	const amount = Number(e.inputs?.wager);
	d.wager = Number.isFinite(amount) && amount > 0 ? amount : undefined;
	d.lucky = e.inputs?.lucky === true;
});
```

We use `e.inputs?.wager` to safely access the submitted entry because `e.inputs` can be undefined on the event; any invalid number or non-positive value defaults to `undefined`, thereby clearing the stake. Similarly, the lucky flag compares against `true`, which is exactly what the checkbox delivers. Once `mutate` applies, the panel redraws and the headline announces the stake alongside the call, so the round now plays out for coins.

## The rest of the form kit

Although inputs and checkboxes handle everyday needs, Discord modals support three additional field types that fluxcord exposes directly.

Unlike the `<Select>` component from the previous chapter, a modal select is written `<modal-select>` and behaves as a form field rather than an interactive control. It reuses everything the [Controls](controls.md) chapter taught about options, bounds, and entity flags, but it takes an `id` and a `label` instead of an `onSelect` handler, and its picks arrive in `e.inputs` like any other field. Modal selects cannot be disabled. Setting `required` forces the user to choose an entry, which in turn means `minSelected` must be 1 or higher (defaults to 1 if omitted).

For multiple selections, `<checkbox-group>` presents a list of one to ten checkboxes, taking its entries as an `options` prop or as `<option>` children, same as a select; `minSelected` defaults to 1 while `maxSelected` defaults to the total option count. Its companion `<radio-group>` handles mutually exclusive choices across two to ten options, permitting at most one preselected item.

Pick lists arrive as arrays of option values in pick order, so a handler reads its field's entry as a plain array. Because empty pick lists and untouched radio groups are omitted from the inputs map altogether, your submit handler can treat an absent key as an unanswered field.

## The fine print

To prevent Discord from rejecting malformed requests at runtime, fluxcord validates modal constraints right as the component tree builds. A dialog holds at most five children, and field ids must be unique within it. Furthermore, field labels cannot exceed 45 characters, whereas descriptions top out at 100.

Two platform behaviors are especially worth noting. First, Discord implements a `required` checkbox as a single-item checkbox group so that submission stays locked until checked; that makes `<checkbox required>` ideal whenever you need an explicit consent gate before a user continues. Second, fluxcord stamps a fresh internal ID every time a modal opens, so an abandoned half-typed draft can never bleed into your pre-filled values on the next open.

Submissions also inherit authorization context automatically: fluxcord routes the submit through whichever policy gate protected the launcher button, ensuring an owner-only trigger produces an owner-only submit handler. The [Permission gates](permission-gates.md) chapter gives the full picture.

## Next

Although our wager dialog overlays the main interface smoothly, the entire dice experience still lives within a single flow file. In [Subflows](subflows.md), we'll nest flows inside parent flows, so a complex panel can be assembled from smaller, self-contained pieces.
