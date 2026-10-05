# Screens and navigation

A single screen worked fine for our about panel, but most interactive panels outgrow a single view quickly. Users need menus to explore different options and straightforward ways to get back where they started. In this chapter, we will start building the dice panel (our main ongoing example throughout the guide) by laying out a simple menu and a couple of destination screens.

We will place this code in `src/modules/dice.tsx`, which will match [`examples/src/modules/dice.tsx`](../../examples/src/modules/dice.tsx) once finished. Like the about panel, the dice panel gets no session data yet. Navigation needs no session data of its own, so we will save state management for the next chapter when we wire up the actual rolling logic.

## The menu screen

Open up `src/modules/dice.tsx` and define the landing screen:

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

Every screen receives three arguments: session state, the screen kit, and a read-only session snapshot. The about panel skipped all three because it did not need them. The first parameter holds session data, which we are prefixing with an underscore (`_data`) for now because we will use it in the next chapter. The second argument supplies the screen kit, giving you access to fluxcord's context-aware UI components. The third argument is a read-only view of the session itself, and it waits for the [Sessions and expiry](sessions-and-expiry.md) chapter to explain how it works.

Unlike the standard layout elements we used earlier, the `Button` component comes from the kit rather than the standard tag vocabulary, and its handlers are strongly typed against the parent flow, meaning the received event knows all valid screens in that flow to keep navigation calls safe. Inside the handler, `e.ui` is the panel's navigation toolkit, and `e.ui.go('rules')` transitions the session to the screen registered under the `rules` key in the flow definition below.

_The `e` parameter is the click event, which is an `ActionEvent`._

## The back button

Destinations need a way back, so the rules screen gets a `Back` button. Here is the rules screen:

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

The event's `ui` toolkit provides three navigation verbs, though `go` is the one you'll reach for most. Here's how they work:

- `back` pops exactly one entry without naming a target, which is what the `Back` button invokes internally. If the stack is empty, the `back` method performs no action.
- `push` always appends to the history, which suits linear workflows where revisiting means a fresh step, such as a wizard's next page. Pushing the screen you are already on does nothing.
- `go` is the combination of the two: it checks if the target screen already sits in the session's history. If so, it pops back to it and discards everything above it; otherwise, it pushes the screen on top. Like `push`, it does nothing when the target is the screen you are already on. This keeps menu loops clean so users can move between screens without the stack filling with duplicates.

## The flow

Now we bundle all three screens together into a single flow:

```ts
export const diceFlow = flow('dice', {
    screens: { menu: menuScreen, rules: rulesScreen, about: aboutScreen },
    first: 'menu',
});
```

This structure is similar to the about flow we made earlier, but notice how the keys in the `screens` map match the exact screen name strings we passed into `go`. TypeScript enforces this strictness, so a typo like `go('ruls')` fails to compile instead of failing at click time.

When `first` is a function, it receives the session's seed and returns the screen to open at. fluxcord runs it once when the session is born, before anything renders, so a panel can open on the screen its data calls for. A wizard whose seed says the user already finished it opens at its overview instead of replaying the welcome step. A revived session runs the same resolver on the restored data, so it lands on the screen its state calls for. Whatever the resolver returns has to name a screen; a resolver (or a static `first`) naming a missing screen throws when the session is born, not at draw time.

```ts
export const onboardingFlow = flow<OnboardingData>('onboarding', {
    screens: { welcome: welcomeScreen, overview: overviewScreen },
    first: (data) => (data.finished ? 'overview' : 'welcome'),
});
```

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

## Your own components

Because every screen we've built so far repeats the closing shape of a text body followed by a row of controls, you can lift that layout into a custom component whenever the pattern spreads across screens, since any function returning a tree works directly as a TSX tag:

```tsx
import type { ComponentResult } from 'fluxcord';

function PanelBody(props: { readonly intro: string; readonly children?: unknown }): ComponentResult {
    return (
        <view>
            <text>{props.intro}</text>
            <row>{props.children}</row>
        </view>
    );
}

const rulesScreen = screen()((_data, { Back }) => (
    <PanelBody intro="Call a number from one to six, then roll. Guess right and you win the round; guess wrong and the die wins.">
        <Back />
    </PanelBody>
));
```

The compiler transforms `<PanelBody>` into a call to the function itself while passing props as a plain object. Whatever the function returns splices directly into the tree where the tag stood, so the draw pipeline processes it as standard nodes without needing any special framework magic.

Three rules to keep in mind:
1. **Explicit dependencies:** Custom components receive only their props and children. No session, data bag, or screen kit is injected automatically. That is why `Back` rides in as a child from the screen where the kit is in scope, rather than being reached for inside `PanelBody`.
2. **Pure layout functions:** Components act as pure functional helpers. They return TSX element trees without holding internal component state or lifecycle hooks, preserving the flow's state bag as the single source of truth.
3. **View placement:** A component that stands in for the whole screen returns a `<view>`; one used inside a screen returns a fragment, since a view can never nest.

> [!NOTE]
> Unlike React, fluxcord does not use hooks because it stores state in the session's data bag so it can survive restarts and expiry, meaning whatever a hook would have tracked belongs there instead. React components are stateful, and hooks are a way to manage that state.

## Next steps

Now that navigation is working, the dice panel is ready for interactive logic. In [State and actions](state-and-actions.md), we will add session data and click handlers to make rolling the die work.
