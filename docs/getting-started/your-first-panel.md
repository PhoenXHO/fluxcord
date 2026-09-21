# Your first panel

Now that the project is structured, let's build your first interactive element: a simple "about" panel containing a line of text and a link button. We're keeping this initial panel stateless on purpose. Since panels don't actually require state to exist, skipping it for now keeps things lean. We'll introduce state in a later chapter when there's a practical reason to use it.

If you caught the example in the README, you might have seen a slightly more involved setup; a counter with buttons and dynamic state. Here, we're taking a step back to build things up from the absolute basics. Everything we write in this chapter lives in `src/apps/about.tsx`, which will match the completed file in [`examples/src/apps/about.tsx`](../../../examples/src/apps/about.tsx) by the end.

## The screen

A panel's layout is defined inside a screen, which is essentially just a function that returns TSX. To get started, open `src/apps/about.tsx` and define the screen layout:

```tsx
const aboutScreen = screen()(() => (
	<view>
		<text>A tiny panel built with fluxcord.</text>
		<row>
			<link label="Source" url="https://github.com/PhoenXHO/fluxcord" />
		</row>
	</view>
));
```

There are two calls fused into that one line, which is easier to see split apart:

```tsx
const makeScreen = screen(); // the factory hands back a function...

const aboutScreen = makeScreen(() => (
	<view>
		{/* the same layout as before */}
	</view>
)); // ...and that function receives the view
```

`screen()` is the framework's screen factory. Since the screen is stateless, the factory call stays empty; a stateful screen would use it to declare its data type, as we'll see later. With no data to read, the view function takes no arguments either — there is simply no session state to pass down.

The parentheses around the JSX are plain JavaScript, not part of the tag vocabulary: they bundle the multi-line element into the single expression the arrow function returns. After a `return` keyword they even become required, because JavaScript ends a bare `return` at the line break.

The lowercase elements make up fluxcord's built-in layout vocabulary:
- `<view>` is the panel root
- `<text>` renders a text block using its children as its content
- `<row>` arranges interactive controls horizontally
- `<link>` renders a clickable button that opens a URL

Because link buttons are handled directly by the Discord client, you don't need to declare a handler for them.

## The flow

While a screen handles presentation, it needs a controller to manage navigation and lifecycle. A flow wraps one or more screens into a cohesive unit that fluxcord can mount as an active panel:

```ts
export const aboutFlow = flow('about', {
	screens: { main: aboutScreen },
	first: 'main',
});
```

The first argument sets the flow's unique ID within your bot. The `screens` object maps out the available views, and `first` specifies which screen renders when the panel opens. Because this flow doesn't track any custom data, there's no state to declare — fluxcord initializes it with an empty state object automatically.

## The command

One piece is missing: nothing yet says how a panel gets opened. To let users actually open this panel in Discord, we need to register a slash command that mounts the flow. Update your imports at the top of the file and export the command definition at the bottom:

```ts
import { command, flow, mounts, screen } from 'fluxcord';
```

```ts
export const aboutCommand = command('about', 'Open the about panel', {
	mount: mounts(aboutFlow),
});
```

The first argument of `command()` is the command name, which is what users type in Discord to execute it (e.g. `/about`). The second is the command description, which is what Discord shows next to the command name. And the third is the command definition.

The `mount: mounts(aboutFlow)` part is the most interesting: it tells fluxcord to spawn a fresh session of `aboutFlow` whenever the command is executed. Note that a command isn't the only way a panel can open: the bot also exposes a `mount` function for starting flows programmatically, which we'll come back to in a later chapter.

Keep in mind that the command definition is a pure declaration: it doesn't touch the bot's state, and it doesn't reach Discord on its own. We still need to register it with our bot instance.

## Next

At this point, you have a complete mini-app composed of a screen, a flow, and a mounting command. Your file should now match the reference example `examples/src/apps/about.tsx`. Head over to [Hosting and commands](hosting-and-commands.md) to wire this up using `createBot` and see it live!
