# Installation

## Prerequisites

Before getting started, make sure you have the following ready:

- **Node.js 22 or newer.** Older Node lines are end-of-life, and fluxcord is tested on 22 and 24.
- **A Discord bot token.** If you don't have one yet, the [Hosting and commands](hosting-and-commands.md) page walks you through creating the application and inviting the bot.
- **TypeScript.** Panels are written as TSX views, so the project needs to be TypeScript.

## Create the project

First, create a new folder for your bot and move into it:

```bash
mkdir my-bot && cd my-bot
```

Then initialize a package inside it:

```bash
npm init -y
```

This generates a `package.json` with sensible defaults. Open it and add `"type": "module"`, so the top of the file looks like this:

```json
{
	"name": "my-bot",
	"version": "1.0.0",
	"type": "module"
}
```

Setting `"type": "module"` tells Node to process your `.js` files as modern ES modules instead of CommonJS, and fluxcord is published as an ESM package.

> [!WARNING]
> Without that line, launching your bot fails with `SyntaxError: Cannot use import statement outside a module`.

## Install fluxcord

Now install fluxcord itself:

```bash
npm install fluxcord
```

This installs fluxcord along with discord.js, which is declared as a peer dependency.

> [!NOTE]
> npm 7 and newer install peer dependencies automatically, so you don't need to add `discord.js` manually.

You'll also want TypeScript and the Node type definitions as dev dependencies:

```bash
npm install --save-dev typescript @types/node
```

## Configure TypeScript

Create a `tsconfig.json` file in your project's root folder:

`/tsconfig.json`
```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "Node16",
		"moduleResolution": "Node16",
		"jsx": "react-jsx",
		"jsxImportSource": "fluxcord",
		"outDir": "dist",
		"rootDir": "src",
		"strict": true,
		"skipLibCheck": true
	},
	"include": ["src"]
}
```

Two of these options are what make fluxcord work. `jsx: "react-jsx"` tells TypeScript to compile JSX through a runtime function rather than expecting React to be installed, and `jsxImportSource: "fluxcord"` names fluxcord as that runtime. Together they let you write panels in TSX without pulling in a UI library.

> [!IMPORTANT]
> Keep `moduleResolution` on `Node16` or `NodeNext`. Those are the modes that read package export maps; with the older default, `import 'fluxcord/discord'` won't resolve.

The rest of the file is a standard strict-mode setup. While strict mode isn't strictly enforced by fluxcord, its type inference works best when it is enabled.

## Next

With the project in place, head over to [Project setup](project-setup.md) to set up your directory structure, entry point, and build scripts.
