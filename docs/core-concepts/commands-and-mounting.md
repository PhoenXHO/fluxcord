# Commands and mounting

Up to this point, nearly every module so far has followed the same pattern: a `flow` containing UI screens, and a `command` that opens it. While this pairing seems straightforward, commands do more than open a flow: they define who owns the panel and how it opens. A command establishes an ownership tree where a module owns its commands, and a command owns mount leaves that point to the single flow they launch. The flow itself remains completely independent of commands, which is why the delivery flow from the previous chapter could ignore tacos entirely. Flows manage internal state and UI rendering, whereas commands simply serve as entry doors into those flows.

In this chapter, we will examine how that hierarchy works by introducing a grouped command with subcommands, gating it behind a Discord native permission, and mounting one of its panels as an ephemeral reply.

## The anatomy of a command

The `command` function accepts a name, a description, and a spec object. Because it executes at module load to validate its own tree, configuration mistakes fail immediately at boot with a clear error pointing to the command rather than dying later inside Discord's registration response.

Names must use bare kebab-case, meaning lowercase words joined by hyphens, like `staff-tickets`, because Discord rejects command names containing separators such as `/` or `:`. If a command name contains invalid characters, fluxcord intercepts them early with an error:

```text
command: command name 'staff/tickets' must be a bare kebab name (no '/', ':', '#', '~' or '.')
```

You must also provide a description because Discord displays it inside the command picker. Likewise, the spec must commit to either a bare `mount` or grouped `subcommands`. Declaring both or omitting both triggers a load-time failure:

```text
command 'staff': exactly one of 'mount' or 'subcommands' is required
```

## The bare mount, one more time

You've written this shape in every module so far:

```tsx
export const aboutCommand = command('about', 'Open the about panel', {
    mount: mounts(aboutFlow),
});
```

A bare command owns exactly one mount leaf built via `mounts(flow)`. When a user invokes the command, fluxcord mounts the flow onto the command's reply: the session's owner becomes the user who typed it, the data bag starts as a fresh clone of the flow's `initialData`, and the first screen draws into the message. Everything we've built across earlier chapters rides directly on those three facts.

A mount leaf can also accept custom options via `mounts(flow, { ... })`; on a bare mount, the leaf inherits the command's description.

## Grouped commands and subcommands

The example bot has kept its commands flat so far, which works fine while the command list stays small, though real-world bots rarely stay that way. A moderation module typically groups related operations under `/staff roles` and `/staff tickets` rather than cluttering the picker with unrelated top-level commands, so a grouped command solves this by owning one leaf per subcommand.

The new module lives at `examples/src/modules/staff.tsx`, and since this chapter focuses on doors rather than the rooms behind them, both panels remain intentionally small:

```tsx
import { PermissionFlagsBits } from 'discord.js';
import { command, flow, mounts, screen } from 'fluxcord';

const rolesScreen = screen()(() => (
    <view>
        <text>Pick the staff and admin roles this server trusts.</text>
    </view>
));

const rolesFlow = flow('roles', {
    screens: { picker: rolesScreen },
    first: 'picker',
});

const deskScreen = screen()(() => (
    <view>
        <text>The ticket desk: view the queue and resolve tickets from one panel.</text>
    </view>
));

const ticketsFlow = flow('tickets', {
    screens: { desk: deskScreen },
    first: 'desk',
});

export const staffCommand = command('staff', 'Moderation panels for server staff', {
    memberPermissions: PermissionFlagsBits.ManageMessages,
    subcommands: {
        roles: mounts(rolesFlow, { description: 'Pick the staff and admin roles' }),
        tickets: mounts(ticketsFlow, { description: 'Open the ticket desk', ephemeral: true }),
    },
});
```

The `subcommands` record is keyed by subcommand name, and each leaf must supply its own description. Unlike a bare leaf, a subcommand leaf cannot inherit its description because there's no single parent text to borrow from, so leaving one off fails at load (`command 'staff': subcommand 'tickets' requires a description`), as does an empty group.

At registration, Discord receives the group as a single command with declared subcommands, routing any incoming invocation by subcommand name directly to the owning leaf. From there the mount proceeds as usual; each leaf's flow initializes from its own `initialData`, ensuring the panel behaves predictably no matter which door opened it.

## The permission knob

The `staff` command carries `memberPermissions` using constants imported from discord.js, since this gate delegates enforcement straight to Discord. That value maps directly onto the command's default member permissions. Discord doesn't list the command in the picker for anyone lacking `ManageMessages` and rejects any invocations that manage to slip through.

This option is not a fluxcord policy engine; it only decides who can open the panel, and it knows nothing about the buttons on your panel. Governing who may click specific controls once a panel is active is the focus of [Permission gates](permission-gates.md), and because they operate at different heights, the two layers work independently and can be combined.

## Ephemeral doors

In the staff example, the `tickets` subcommand specifies `ephemeral: true`. Standard command panels mount as public messages visible to all members in a channel. Setting `ephemeral: true` ensures the response is visible only to the invoking user.

Visibility settings are defined at the mount leaf rather than inside the flow definition. Because the flow itself remains agnostic about privacy settings, the same flow can be mounted publicly in one context and ephemerally in another. Note that ephemeral messages operate under platform-level interaction response limits, as detailed in [Sessions and expiry](sessions-and-expiry.md).

## Dev-only tools

Command specifications also support a `devOnly` flag to designate development utilities. The default host keeps these commands out of the public registration. When `createBot` is given a `devGuildId` (or the `DISCORD_DEV_GUILD_ID` environment variable is set), dev-only commands register only in that guild. Without a dev guild, they are dropped. A custom host reads the `devOnly` fact inside its `registerCommands` callback (see [Hosting and commands](../getting-started/hosting-and-commands.md) for details).

## Flow catalog registration

When you have flows that aren't mounted by any command, your module can register them directly using its optional `flows` field. Those flows connect to programmatic doors such as `bot.mount`, which opens a panel wherever your custom logic decides one should appear, as described in [Live panels](live-panels.md). The field is for doors only: a flow called from another flow of the same module needs no entry at all, because the call carries the module identity with it. The example bot's campfire is the door shape: the module lists the flow, and `main` opens the panel once on boot:

```tsx
// examples/src/index.ts
const bot = createBot({
    modules: [
        // ...the command-driven modules...
        { name: 'campfire', flows: [campfireFlow] },
    ],
});

async function main(): Promise<void> {
    await bot.start();
    // The campfire panel mounts once and outlives restarts: the rehydrate
    // row lets any later click on the message rebuild the session. Set
    // CAMPFIRE_CHANNEL_ID and CAMPFIRE_OWNER_ID in .env to get the panel
    const channel = process.env.CAMPFIRE_CHANNEL_ID;
    const owner = process.env.CAMPFIRE_OWNER_ID;
    if (channel !== undefined && owner !== undefined) {
        await bot.mount(campfireFlow, {
            to: { channel },
            ownerId: owner,
            rehydrateRef: 'campfire:main',
        });
    }
}
```

Regardless of whether a flow is mounted or listed, it must have exactly one home; declaring multiple doors to the same flow triggers a startup error:

```text
Module 'staff' registers flow 'tickets' twice: once in flows and once mounted by a command. Pick one home.
```

Naming collisions get their own guard: fluxcord derives each flow's full identifier by joining the module name and authored id into paths like `staff/tickets`, and if two registrations attempt to share that identifier, boot terminates with `buildFlowCatalog: flow id 'staff/tickets' is declared twice`.

## Session ownership

When a user executes a command that mounts a flow, fluxcord designates that user as the session owner. By default, fluxcord applies an ownership policy that restricts panel interactions to the owner. If a different user attempts to click a control on the panel, fluxcord blocks the interaction and displays:

```text
You don't have permission to do that.
```

This default behavior can be customized or replaced entirely by supplying a custom `policy` function to `createBot`. The shipped ownership default is itself one such policy function, so a custom engine takes over exactly that role; [Permission gates](permission-gates.md) builds a role-based one from scratch.

## Next steps

Commands gate who can reach a panel, though once it's open, every button poses a fresh authorization question. In [Permission gates](permission-gates.md), we'll replace the ownership default with policies that decide, control by control, who is allowed to click.
