# Persistence

Every session so far has lived only in memory, so it dies whenever your process restarts. Discord keeps the messages alive on its own platform, but our framework completely forgets them; so when someone clicks an old panel after a restart, they land straight on the parting screen because the new process treats the forgotten session as expired.

In this chapter, we're adding the missing half. Once your flow declares how to rebuild its data bag from your own storage, the framework can restore a session the moment a user clicks an existing panel.

## Rows and references

fluxcord never touches a database. What it keeps instead is a compact pointer record, a store row, that says which domain object a live message belongs to. The row carries the message ID, channel ID, flow ID, session owner ID, and a reference string (`ref`). The reference string acts as an application-defined key, such as `campfire:main`, pointing to your underlying storage record. The data itself never enters the row; the ref points into your storage, and your flow knows how to follow it.

On the storage side, a single small interface serves as the only place where your database meets fluxcord:

```ts
interface RehydrateStore {
    put(row: RehydrateRow): Promise<void>;
    get(messageId: string): Promise<RehydrateRow | undefined>;
    delete(messageId: string): Promise<void>;
    touch?(messageId: string): Promise<void>;
    purge?(flowId: string, olderThan: Date): Promise<number>;
}
```

fluxcord writes rows at mount time and removes them when a panel closes permanently. Rows persist through session expiration because a subsequent interaction can trigger state restoration. They do not persist forever; the retention section below covers how old rows leave. If no store is provided to `createBot`, mounting a flow that declares a `rehydrate` callback throws, and interactions on forgotten panels fall back to parting screens.

## Implementing a file-backed store

`put`, `get` and `delete` are required, so a minimal store takes little code. `touch` and `purge` are the two retention methods, and the example below implements them too. Here is a local JSON file store implementation from the example repository:

```ts
// examples/src/rehydrate-store.ts
import { readFile, writeFile } from 'node:fs/promises';
import type { RehydrateRow, RehydrateStore } from 'fluxcord';

const ROWS_FILE = 'rehydrate-rows.json';

type StoredRow = RehydrateRow & { usedAt: number };

async function readRows(): Promise<Record<string, StoredRow>> {
    try {
        return JSON.parse(await readFile(ROWS_FILE, 'utf8')) as Record<string, StoredRow>;
    } catch {
        return {};
    }
}

async function writeRows(rows: Record<string, StoredRow>): Promise<void> {
    await writeFile(ROWS_FILE, JSON.stringify(rows, null, '\t'));
}

export const rehydrateStore: RehydrateStore = {
    async put(row) {
        const rows = await readRows();
        rows[row.messageId] = { ...row, usedAt: Date.now() };
        await writeRows(rows);
    },
    async get(messageId) {
        return (await readRows())[messageId];
    },
    async delete(messageId) {
        const rows = await readRows();
        delete rows[messageId];
        await writeRows(rows);
    },
    async touch(messageId) {
        const rows = await readRows();
        if (rows[messageId] === undefined) return;
        rows[messageId].usedAt = Date.now();
        await writeRows(rows);
    },
    async purge(flowId, olderThan) {
        const rows = await readRows();
        let purged = 0;
        for (const [messageId, row] of Object.entries(rows)) {
            if (row.flowId === flowId && row.usedAt < olderThan.getTime()) {
                delete rows[messageId];
                purged += 1;
            }
        }
        if (purged > 0) await writeRows(rows);
        return purged;
    },
};
```

While our demo relies on local disk, a production bot points that same interface at a real database, and nothing else changes.

## How long rows are kept

A row whose panel is never clicked again would sit in your database forever, so rows have a retention. A row counts as used when it is written, when its session dies by expiry, and when a late click revives the panel. Once a row has gone unused for its flow's `rehydrateTtlMs`, fluxcord asks the store to purge it. The default is seven days.

```tsx
const campfire = flow<CampfireData>('campfire', {
    // ...screens, first, rehydrate
    rehydrateTtlMs: 30 * 24 * 60 * 60 * 1000, // a month
});
```

Set `rehydrateTtlMs: Infinity` for a panel that stays clickable for as long as the thing it shows exists; its row is then removed only when its session closes. A finite value needs a store with `purge`, and `createBot` throws at boot if a flow sets one and the store has none. A flow that leaves the default alone on a store without `purge` simply keeps its rows.

fluxcord calls `purge(flowId, olderThan)` once when the sweeper starts and then hourly, once for each rehydratable flow with a finite retention. `touch` is optional: without it, rows age from the moment they were written. Separately, when an edit fails because Discord says the message or its channel is gone, fluxcord deletes that message's row at once, since nothing can click it any more.

## Defining a rehydratable flow

Our example repository includes a community campfire module (`examples/src/modules/campfire.tsx`). The panel displays a total log count and a button to feed the fire. The state on disk acts as the primary source of truth, and the UI panel reflects that underlying record.

The excerpt below shows the campfire's storage side first: the file that the ref points at, and the action that writes each log count to disk.

```tsx
// examples/src/modules/campfire.tsx (excerpt)
import { readFile, writeFile } from 'node:fs/promises';

interface CampfireData {
    logs: number;
}

// The flow's own database: one fire -> one number
const CAMPFIRE_FILE = 'campfire.json';

async function readLogs(): Promise<number> {
    try {
        const campfire = JSON.parse(await readFile(CAMPFIRE_FILE, 'utf8')) as { logs: number };
        return campfire.logs;
    } catch {
        return 0;
    }
}

async function writeLogs(logs: number): Promise<void> {
    await writeFile(CAMPFIRE_FILE, JSON.stringify({ logs }, null, '\t'));
}

// Truth lands on disk inside the handler: the file, not the bag, is what
// a revive reads back. The write comes before the mutate, so a failing
// write throws before any state changes and the panel and the file
// never disagree.
const addLog = action<CampfireData>()(async e => {
    const next = e.session.data.logs + 1;
    await writeLogs(next);

    // Note that mutate runs *after* the write (fallible work; see the Errors chapter)
    e.mutate(d => {
        d.logs = next;
    });
});
```

To opt into revival, your flow defines a `rehydrate` callback that accepts the row's ref and returns a fresh bag, returning `undefined` if the underlying record has vanished:

```tsx
export const campfireFlow = flow<CampfireData>('campfire', {
    screens: { fire: campfireScreen },
    first: 'fire',
    initialData: { logs: 0 },
    // The ref would pick a fire in a real bot; this demo runs one, so the
    // callback ignores it and reads the file. Returning undefined means
    // the fire is gone, and the late click gets the parting screen.
    rehydrate: async () => ({ logs: await readLogs() }),
});
```

That single callback is all your flow needs to provide, since the framework handles the row tracking while automatically repainting the revived interface on any dead click.

## Mounting persistent panels

To activate persistence, pass your store instance to `createBot`:

```ts
const bot = createBot({
    policy: staffPolicy,
    rehydrate: rehydrateStore,
    modules: [
        // ...every module from earlier chapters...
    ],
});
```

The campfire is not something a user summons, so no command mounts it, and declaring the flow with `flow()` is all the registration it needs. Instead, we mount it once on boot via `bot.mount`, supplying the target channel and the ref it should track:

```ts
async function main(): Promise<void> {
    await bot.start();
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

void main();
```

This demo sends a fresh panel on every boot; a production bot usually rebinds to the message it already owns instead, so restarts don't pile up duplicate panels. The [Rebinding existing messages](#rebinding-existing-messages) section at the end of the chapter shows the mount option for that.

fluxcord validates rehydration configurations during mount and throws an error if:
- a flow defines `rehydrate` but no store is provided to `createBot`
- a rehydratable flow is mounted without `rehydrateRef`
- a `rehydrateRef` is supplied for a flow that lacks a `rehydrate` callback
- rehydration options are passed to an ephemeral mount (`ephemeral: true`)

## How restoration executes

When an interaction arrives for a session that is no longer in memory, fluxcord handles restoration as follows:

1. The runtime checks for an active in-memory session. If absent or expired, it queries the `RehydrateStore` for the message ID.
2. If a matching `RehydrateRow` is found, fluxcord checks whether the session owner has already opened a newer live panel for the same flow. If a newer session exists, the old panel yields and renders a parting screen.
3. The framework calls the flow's `rehydrate(ref)` callback. If it returns `undefined`, the interaction falls back to a parting screen.
4. A new session is instantiated using the restored data bag, the flow's initial screen (`first`), and a fresh idle expiration window. The `onSessionStart` hook does not re-run during restoration.
5. fluxcord performs an initial redraw to construct the UI frame, then processes the user's interaction.

Revival isn't a one-time event either; the newly constructed session carries the ref again, so it can time out and come back as many times as the message survives.

> [!NOTE]
> Navigation history isn't saved alongside the state: revived sessions always reset to the flow's first screen, so a multi-step flow comes back to its front door.

<!-- -->

> [!NOTE]
> Expiry behaves differently when a panel can rehydrate: instead of painting an expiry notice over the components, fluxcord leaves the message intact so the next user click can trigger revival. Explicit `ui.exit()` calls remove the stored row, preventing closed panels from being restored.

## Rebinding existing messages

Revival waits for an interaction by default, which keeps background work minimal until someone actually needs the panel. If you prefer to have a permanent service dashboard active the moment your process boots, `bot.mount` can accept an existing message location and patch it in place:

```ts
await bot.mount(campfireFlow, {
    to: { existing: { channelId, messageId } },
    ownerId: owner,
    rehydrateRef: 'campfire:main',
});
```

Although your store retains a copy of the row, your host application usually tracks these persistent message IDs directly. When you rebind an existing message, the framework boots a brand-new session and invokes the flow's callback with your ref to repopulate state from storage. Old buttons rendered prior to the restart are immediately invalidated, so clicks on them encounter the parting screen while the new controls handle later clicks.

## Next steps

That concludes our tour of the core concepts, spanning twelve chapters from your first interactive screen all the way to panels that persist across process restarts. You can inspect all the demo modules we've built inside the [example bot](https://github.com/PhoenXHO/fluxcord/tree/main/examples), or browse the [repo README](../../README.md) for a condensed summary of the entire architecture. Now you can take what we've covered and build bots that outlive their processes.
