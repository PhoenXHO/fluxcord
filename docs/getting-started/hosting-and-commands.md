# Hosting and commands

Up to this point, our mini-app only exists on your local machine. To actually run it, we need to register an application with Discord and replace our placeholder entry point with a call to `createBot`.

This chapter covers both sides of that setup: setting up the **Discord Developer** Portal and connecting it to your codebase.

## Creating the application

Bots live inside applications on Discord's side, so head over to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. Pick a name for your bot (can be changed later) and confirm.

Once the application is created, you need to get its token. Select the **Bot** tab  on the left sidebar and click **Reset Token**, then copy the generated string (click the copy icon) and paste it into your `.env` file (replace the placeholder from [Project setup](project-setup.md)):

`/.env`
```
DISCORD_TOKEN=your-real-token
```

Treat this token like a password, because that's exactly what it is: whoever holds it can use it to log in as your bot and do anything with it. If it ever leaks, hit **Reset Token** again to invalidate the old one.

If you've used discord.js before, you may have seen a slightly more involved setup when configuring client options, listeners, intents, and permissions. As you'll see later in this chapter, fluxcord makes this much simpler. For instance, you won't need to enable any privileged gateway intents most of the time, because fluxcord's UI panels work entirely on the default `Guilds` intent.

## Inviting the bot

Next, you'll need to generate an invite link to bring the bot into your Discord server.

1. Navigate to the **OAuth2** tab on the left sidebar, then scroll down to the **URL generator** section.
2. Under **Scopes**, select the `bot` scope (gives the bot access to your server), and the `applications.commands` scope (makes slash commands show up at all).
3. Leave the **Bot permissions** checkboxes unchecked for now, since basic text permissions in your server are enough, and granting that with server roles is more flexible than baking it into the invite anyway.
4. Copy the generated URL at the bottom of the page, open it in a browser, and add the bot to a server of your choice (your test server for example).

Note: without the `applications.commands` scope, the bot would not be able to register slash commands, and the `/about` command would not appear in the picker nor would you be able to invoke it.

## Wiring it together

With the Discord side sorted out, it's time to update `src/index.ts` to log the bot in and mount your command.

The imports come first: along with your command, the Discord host itself comes from a separate fluxcord export:

`/src/index.ts`
```ts
import { createBot } from 'fluxcord/discord';
import { aboutCommand } from './apps/about.js';
```

Notice the `fluxcord/discord` import path; the Discord host adapter lives behind its own export so that the framework core stays independent of any particular platform. Also, the relative import for `./apps/about.js` uses the `.js` extension even though the source file is `.tsx`. This is required by TypeScript's `Node16` module resolution from your tsconfig that requires imports to reflect the compiled output files, and it's a good habit to get into.

With the imports in place, everything else collapses into a single call. This is the entire file:

```ts
const bot = createBot({
	modules: [{ name: 'about', commands: [aboutCommand] }],
});
```

The `modules` array is where your declarations meet the host, and each module is a named bundle of command definitions. The commands are automatically registered with Discord by fluxcord, so you don't need to do anything else.

Also note that there is no token anywhere in sight. That's because `createBot` reads the conventional `DISCORD_TOKEN` environment variable which you've set in your `.env` file so you don't have to wire it up manually. If it is missing, the bot fails at boot and prints a readable error to remind you that you need to set it. In the rare case where the credential comes from somewhere else, you can pass it instead as the `token` option.

### Instant command registration with a guild ID

Global slash commands can take up to an hour to propagate, so it's recommended to register them with a guild ID during development. All you need to do is set the `DISCORD_GUILD_ID` environment variable in your `.env` file:

`/.env`
```
DISCORD_TOKEN=your-real-token
DISCORD_GUILD_ID=your-server-id
```

To find your server's ID, enable **Developer Mode** in Discord's appearance settings, then right-click the server and choose **Copy Server ID**. When you're ready to deploy your bot, simply remove the `DISCORD_GUILD_ID` line from your `.env` file to register commands globally.

### Starting the bot

The last missing piece of the entry point is the `start` call:

`/src/index.ts`
```ts
void bot.start();
```

This function starts the bot and logs it in. The `void` type annotation is intentional because we're not awaiting the promise; if the login fails, Node's unhandled-rejection handling stops the process and prints the reason, which is the right outcome for a boot script. The moment the login succeeds, fluxcord posts your derived commands to Discord and starts listening for interactions — nothing else is needed.

For the curious: `createBot` takes more seams than the one field shown here, including a custom permission engine and a `registerCommands` callback that replaces the built-in registration entirely. Check out the [API reference](../reference/README.md) for more details.

## Seeing it live

Everything is in place now, and you can run your bot with:

```bash
npm run build && npm run start
```

This executes those two scripts we created earlier in [Project setup](project-setup.md) which build the bot and run it.

Once the terminal confirms that the bot is running, go to your test server and type `/about` to see your bot in action. The panel should open with your text and the Source link, and clicking the link takes you to the fluxcord repository.

If the command doesn't show up in the picker, double-check the `applications.commands` scope when inviting the bot and that your `DISCORD_GUILD_ID` matches your server's ID.

## Next

That completes the getting started section! Now that you have a working development workflow, you can move on to the [Core concepts](../core-concepts/README.md) section to learn how state, navigation, custom controls, and modals work.
