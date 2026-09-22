# Layout and content

Our dice panel handles input and state, but every screen still renders as a basic vertical stack. While plain panels are completely readable, styled layouts communicate structure much better: a distinct page heading establishes context, while dividers or colored accent boxes group related controls together.

Because Discord's Components V2 provides these visual surfaces natively, fluxcord maps them one to one; so in this chapter, we'll dress up the dice panel with a page heading and separators, alongside an accent-colored rules panel and richer text formatting.

## The page heading

The `<view>` component is the root surface for every screen, and its direct children stack vertically from top to bottom. A view accepts four kinds of children:

- `<text>` blocks for copy
- `<row>` groups for controls
- `<hr>` separators
- `<container>` card panels

Because `<view>` represents the whole message, it's the natural place for a page heading. When you pass the `title` prop, fluxcord automatically renders it as a markdown heading above everything else in the panel. We've carried "Dice:" in our body copy since the navigation chapter as a workaround for not having a dedicated heading, but now we can move it where it belongs:

```tsx
<view title="Dice">
	<text>One die, one roll, no house edge. Where to?</text>
	<row>
		<Button onClick={e => e.ui.go('roll')} label="Roll" />
		<Button onClick={e => e.ui.go('rules')} label="Rules" />
		<Button onClick={e => e.ui.go('about')} label="About" />
	</row>
	<Back />
</view>
```

Discord itself has no native heading component, so fluxcord folds the title under the hood into a text block whose body starts with `# Dice`. You won't ever need to write that markdown manually, though, since the prop provides the whole interface.

## Separators

To signal that adjacent sections play different roles, you can separate them with an `<hr />`, which draws a horizontal dividing line with a little vertical padding on both sides. Here, we'll place one between the menu's copy and its button row so the actions feel distinct from the prompt:

```tsx
<view title="Dice">
	<text>One die, one roll, no house edge. Where to?</text>
	<hr />
	<row>
		...
	</row>
</view>
```

While the tag's defaults usually give you what you want, you can customize the spacing through two optional flags:

- `p-large` swaps the small padding for large
- `no-divider` keeps the padding but skips the visible line, so the hr becomes pure spacing

## The container panel

Whenever you need a distinct card, wrapping your content in a `<container>` lets Discord draw it with a subtle background; you can also set the `color` prop with an RGB value to paint that panel's accent stripe, where a hex literal reads best:

```tsx
const rulesScreen = screen<DiceData>()((_data, { Back }) => (
	<container color={0xf1c40f}>
		<text title="House rules">Call a number from one to six, then roll. Guess right and you win the round; guess wrong and the die wins.</text>
		<hr />
		<codeblock lang="js">roll === call // the only winning line</codeblock>
		<Back />
	</container>
));
```

Containers can hold text blocks, action rows, and separators, but you can't nest one container inside another — the type checker rejects that before the panel ever builds, and it's a Discord limitation. Omitting the `color` prop simply renders a neutral panel.

Notice the bare `<Back />` at the bottom of the panel. Containers share the view's layout behavior here: any control dropped straight into a container automatically receives its own row, exactly as the [Controls](controls.md) chapter describes for bare controls in a view.

## Text dressings and callouts

The `<text>` tag folds everything you place inside it into a single markdown body, and you can style it further using specific props and formatting tags.

Setting the `title` prop on a text block adds a bold line directly above the body. While the view's main title names the overall screen, a text title is ideal for labeling an individual block within it, such as the "House rules" header in our rules card.

For code formatting, you can use the `<code>` and `<codeblock>` tags. The former wraps its content in inline backticks, while the latter produces a fenced block with an optional `lang` prop for syntax highlighting:

```tsx
<codeblock lang="js">roll === call // the only winning line</codeblock>
```

You can also call out notices with dedicated alert blocks. The `<error>`, `<warning>`, and `<info>` tags fold their children just like `<text>` does, but fluxcord renders the result inside an ansi code fence, which Discord colors red, yellow, or blue respectively. Because a callout is strictly block-level, the fence always occupies its own block so that it reads as an intentional notice rather than inline emphasis. The about screen picks `<info>` for its one-liner:

```tsx
const aboutScreen = screen<DiceData>()((_data, { Back }) => (
	<view>
		<info>Dice is the guide's example panel.</info>
		<text>It grows chapter by chapter; the chrome you see here comes from the layout chapter.</text>
		<Back />
	</view>
));
```

## Fragments

Our remaining layout tool isn't a custom tag at all, but rather JSX fragment syntax (`<></>`). Fragments group children in your source and splice them flat into whatever container holds them; arrays splice the exact same way, so a helper that constructs several blocks can simply return a plain array. Because a fragment is purely an authoring convenience, nothing about it survives into the built tree.

This grouping behavior makes fragments especially handy for conditional blocks, since the JSX drop rules apply to the whole group:

```tsx
<view title="Dice">
	<text>One die, one roll, no house edge. Where to?</text>
	{hintNeeded && (
		<>
			<hr />
			<text>Pick a number first and the Roll button unlocks.</text>
		</>
	)}
	...
</view>
```

One trick to keep in mind is that when you return a fragment as a screen's root instead of `<view>...</view>`, fluxcord automatically wraps it in a synthetic `<view>` so the fragment's children nest inside the view's body. This only applies to views, though; modals get no such leeway, since their root must be an actual `<modal>` element.

> [!CAUTION]
> ```tsx
> // throws: showModal needs a <modal> root; a fragment or a dropped root is not a modal
> <>
> 	<input label="Name" />
> </>
> ```

## Next

While the dice panel finally looks the part, everything it does still lives inside one message. In [Modals](modals.md), we'll pop a dialog up over the panel to collect input that deserves its own surface, which is also where checkboxes and forms have been waiting.
