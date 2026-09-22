<p align="center">
	<picture>
		<source
			media="(prefers-color-scheme: dark)"
			srcset=".github/assets/horizontal-lockup-dark.png"
		/>
		<img
			src=".github/assets/horizontal-lockup-light.png"
			alt="fluxcord"
			width="560"
		/>
	</picture>
</p>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/PhoenXHO/fluxcord/ci.yml?style=for-the-badge&label=CI)](https://github.com/PhoenXHO/fluxcord/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/fluxcord?style=for-the-badge)](https://www.npmjs.com/package/fluxcord)
[![npm downloads](https://img.shields.io/npm/d18m/fluxcord?style=for-the-badge)](https://www.npmjs.com/package/fluxcord)
[![License](https://img.shields.io/github/license/PhoenXHO/fluxcord?style=for-the-badge)](./LICENSE)
[![Node](https://img.shields.io/node/v/fluxcord?style=for-the-badge)](https://nodejs.org)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![discord.js](https://img.shields.io/badge/discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discordjs.dev)
[![GitHub issues](https://img.shields.io/github/issues/PhoenXHO/fluxcord?style=for-the-badge)](https://github.com/PhoenXHO/fluxcord/issues)
[![last commit](https://img.shields.io/github/last-commit/PhoenXHO/fluxcord?style=for-the-badge)](https://github.com/PhoenXHO/fluxcord/commits/main)

[![Sponsor](https://img.shields.io/badge/Sponsor-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/PhoenXHO)

</div>

Stateful, multi-screen Discord UIs in TSX. Built on discord.js v14
(Components V2).

A screen is a plain function of state: when a click changes that state
through a handler you wrote, the framework re-renders the screen and edits
the message, so you never touch edits or component ids yourself. fluxcord
was extracted from a production Discord bot, where it runs every admin
panel today.

<!--![Two screens of a dice panel, rolling and paging through history](.github/assets/demo.gif)-->

## Features

- Every mounted panel becomes a session that owns its state. Clicks on one
  panel run one at a time through a FIFO queue, so handlers never race
  each other, and idle sessions are swept on an interval.
- Flows carry as many screens as you want, and navigation targets such as
  `ui.go('history')` are checked against the screens map at compile time.
- Screens are authored in TSX through a custom JSX runtime, or with plain
  builder functions, and both compile to the same trees.
- Buttons bind to handler functions by identity, so there are no
  custom-id strings to parse, and every committed change re-renders the
  screen and edits the message.
- Permission gates are declared on a flow or on a single control, and the
  policy port you wire at boot decides every click.
- An optional rehydrate store lets open panels survive a restart.
- The core entry is platform-free; the discord.js binding lives behind a
  peer-dependent `fluxcord/discord` entry.

## Requirements

- Node 22 or newer
- discord.js 14.25 or newer, installed as a peer
- TypeScript 5 or newer, for TSX authoring

## Install

```bash
npm install fluxcord discord.js
```

For TSX authoring, point `jsxImportSource` at the package:

```jsonc
{
	"compilerOptions": {
		"jsx": "react-jsx",
		"jsxImportSource": "fluxcord",
		"module": "Node16",
		"moduleResolution": "Node16"
	}
}
```

## Example

A counter written as a flow:

```tsx
import { action, screen, flow } from 'fluxcord';

interface CounterData {
	count: number;
}

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

const counterScreen = screen<CounterData>()((data, { Button }) => (
	<view>
		<text>Count: {data.count}</text>
		<row>
			<Button onClick={minus} label="-1" secondary />
			<Button onClick={plus} label="+1" />
		</row>
	</view>
));

export const counterFlow = flow<CounterData>('counter', {
	screens: { main: counterScreen },
	first: 'main',
	initialData: { count: 0 },
});
```

Here the two action functions are the entire click surface: a click runs
one of them, `event.mutate` applies the change, and the framework handles
the re-render and the message edit. Buttons bind to handlers by identity
instead of through id strings, so there is nothing to parse and nothing
that can drift out of sync, and the state lives in a session the framework
tracks rather than in a `Map` you babysit.

<p align="center">
	<img src=".github/assets/fluxcord-example-counter.gif" alt="The counter panel from the example, with the count climbing as +1 is clicked" width="480" />
</p>

## Documentation

You'll find full documentation in [docs/](./docs/README.md). The guide walks you
from an empty folder to a running bot; since it is written directly from the
example bot in [examples/](./examples/), every snippet comes from code that
actually builds and runs.

## Contributing

fluxcord is young and maintained by one person. Bug reports with a minimal
reproduction are the most useful thing right now. Before filing one,
check [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) in case it is already on the
list. For anything larger, open an issue first so the scope can settle
before code arrives.

## Roadmap

Version goals and their checkboxes live in [ROADMAP.md](./ROADMAP.md), and
notable changes are tracked in [CHANGELOG.md](./CHANGELOG.md).

---

<div align="center">

<img src=".github/assets/mark-dark.png" alt="The fluxcord mark" width="72" />

Released under the [MIT](./LICENSE) license.

Support the project on [GitHub Sponsors](https://github.com/sponsors/PhoenXHO).

</div>
