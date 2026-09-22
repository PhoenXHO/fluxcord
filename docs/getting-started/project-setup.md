# Project setup

The last chapter left you with a bare npm project. Before writing any panels, the bot needs a bit of structure: a source folder, an entry point, and a way to manage secrets like your bot token.

## The folder layout

Everything we write lives under the `src/` directory. The entry point sits directly in it, and panels will get their own subfolder as the bot grows.

By the end of this chapter the project looks like this:

```
my-bot/
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

Go ahead and create the source directory:

```bash
mkdir src
```

## Storing the token safely

Your bot authenticates with Discord using a token.

> [!WARNING]
> Tokens are sensitive credentials. Never hardcode them into source files or commit them to source control.

Create a `.env` file in the root of your project:

`/.env`
```
DISCORD_TOKEN=your-token-here
```

We'll replace this placeholder with a real token in the [Hosting and commands](hosting-and-commands.md) chapter when we register the application on Discord. For now, keeping the key here ensures our environment setup is wired up correctly.

If you're using git, create a `.gitignore` file as well so the token and the build output never get committed:

`/.gitignore`
```
node_modules/
dist/
.env
```

## The entry point

Next, create `src/index.ts`. This is where your bot will eventually boot up and register event listeners. For now, let's keep it minimal just to verify that environment variables load as expected:

`/src/index.ts`
```ts
console.log(
	'DISCORD_TOKEN is',
	process.env.DISCORD_TOKEN === undefined ? 'missing' : 'set',
);
```

Reading `process.env.DISCORD_TOKEN` is how the bot will reach the value from `.env`. Nothing loads that file automatically, though; the run script in the next section takes care of it.

## Build and run

TypeScript needs to be compiled before Node can run it, so add three scripts to `package.json`:

`/package.json`
```json
{
	"name": "my-bot",
	"version": "1.0.0",
	"type": "module",
	"scripts": {
		"build": "tsc -p tsconfig.json",
		"start": "node --env-file=.env dist/index.js",
		"dev": "node --watch --env-file=.env dist/index.js"
	}
}
```

Running `npm run build` compiles everything in `src/` to JavaScript inside `dist/`, while `npm run start` executes the built output. During development, rebuilding and restarting by hand after every change wears thin fast, so the `dev` script runs the bot under Node's built-in `--watch` mode, which restarts it whenever the compiled output in `dist/` changes. The compiled output still needs producing, so the watch workflow is two terminals:

```bash
npx tsc --watch
npm run dev
```

TypeScript recompiles on every save in the first, Node restarts the bot in the second, and together they turn the edit loop into save and wait, with nothing to install.

> [!TIP]
> The `--env-file=.env` flag is built right into Node 22+, so there's no need to install third-party packages like `dotenv`.

Now test the build pipeline:

```bash
npm run build && npm run start
```

If everything is configured correctly, you should see `DISCORD_TOKEN is set` printed in your terminal. This confirms that TypeScript compiles cleanly, Node runs the output, and your environment variables are loaded properly.

## Next

With your build toolchain and environment fully configured, you're ready to write real code. In [Your first panel](your-first-panel.md) you'll write a quick, stateless about panel.
