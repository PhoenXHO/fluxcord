# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-07

### Added

- The policy engine: gates are inert values built through the `policy` namespace (`policy.owner()`, `policy.privilege('mod', { deny: 'Staff only.' })`, `policy.any/all`, `policy.allow`, `policy.deny`), and the shipped engine evaluates them over one host fact: `policy: { privileges(actorId, guildId, roleIds?) }`. Nearest policy wins (a control's gate replaces its flow's), nothing is gated by default, evaluation is live per click (privilege changes apply on the next click, no rerun), and unbound privilege names plus failing fact lookups are fail-closed. Passing a full `PolicyPort` as the `policy` option bypasses the engine entirely.
- The command door: a leaf can carry a gate (`mounts(flow, { policy })`), evaluated before the panel mounts from the invocation's identity alone (`policy.owner()` is vacuously false at a door). Deny = an ephemeral reply, no panel. Static role-gating stays Discord-native via `memberPermissions`; the door covers everything dynamic.
- A flow's `first` accepts a resolver `(data) => screenKey`, evaluated once at session birth on the seeded bag (mount, revive and `event.call` alike), so a flow can land on a state-dependent entry screen with no flicker. A static or resolved key naming no screen throws at birth.
- Flows call flows like functions: `await event.call(childFlow, { as: 'slot', args })` runs the child on its own frame (own screen history, own bag nested under `slot` in the parent's data), parks the caller until the child exits, and resolves with the child's return value. A throw inside a called flow rejects the caller's `await`, so an author's `try`/`catch` owns the crash. A session dying mid-call drops the in-flight call without settling; a revived session restarts at the root's first screen.
- Detached tracked work: `event.launch(work, { as? })` starts the closure outside the session's queue and returns immediately, so the panel stays interactive while the process runs. The closure receives a mutate-only handle: every `job.mutate` re-enters the session's FIFO as one short write that always lands the bag and redraws only when the job's frame is the one on screen, so changes made while the user is elsewhere wait for the next navigation instead of burning edits. A settled value with `as` lands in `data.<as>` the same way; a throw routes to the error socket and writes nothing. The job is owned by its frame: it dies quietly when the flow exits or the session ends, and its writes never keep the session's TTL alive.
- An ack race timer: a dispatch that outlasts 2s of Discord's 3s response window acks early (deferUpdate), so a slow synchronous handler never renders as "didn't respond in time"; copy sent after the early ack rides followUp. Launching handlers return instantly and never feel it. Tunable per runtime via the `ackAfterMs` dispatch option.
- A flow may set `ttlMs: Infinity` to opt out of expiry entirely: the session lives until closed, the sweeper never reaps it, and an ephemeral surface's absolute ceiling still applies. Zero, negative and NaN values still throw.

### Fixed

- The bridge's interaction binding is per dispatch (through `AsyncLocalStorage`), replacing the global dispatch mutex. A parked `event.call` used to hold that mutex for the child's whole lifetime, deadlocking every later interaction on the bot. The caller's click is now also acked right before the park (`PlatformPort.ack`), so entering a child flow no longer leaves a stuck spinner past Discord's response window.
- A modal submit lenses to its opener's slot: in a called flow, the submit's `mutate` now writes the child's bag instead of silently landing on the root data, where neither the child's screens nor the parent's could see it.

### Changed

- Breaking: the old declarative `PermissionPolicy` object family (`mode`/`owner`/`users`/`channels`/`roles`/`response`, merge modes and bypass flags) is replaced by the `policy` namespace values above. The engine reads `FlowMeta.policy` now, so a flow's third argument is a live gate; and the default posture when no `policy` option is supplied flips from owner-only panels to nothing gated.
- Breaking: frames carry their flow's token, so the screen-registry exports (`asScreenRegistry`, `screenEntries`) are gone and the wire screen key is `flowId/screen`. Parting copy always comes from the root flow's token.
- `event.call` opens a same-module flow with no manifest listing: the caller's frame names the module and the child's identity assembles at call time. The manifest `flows` field is doors only (host mounts and cross-module calls).
- Breaking: the subflow system is removed (`subflow()` plugs, the `subflows` option, `<at>.` screen-name namespacing). Open a child with `await event.call(...)` instead; a called flow's screens are addressed through its own frame, and stale parent-screen clicks bounce as before.
- Breaking: `ui.close` merged into `ui.exit(options?)`: `{ value }` returns to the caller below the root, `{ final }` is the goodbye view at the root (`final` below the root throws), and bare `exit()` just leaves.
- Breaking: `Flow` gained a second type parameter, the exit value: `Flow<TData, TExit>`, `void` by default. Annotate a flow constant as `Flow<MyData, MyExit>` and the caller's `await event.call(...)` is typed.
- A redraw whose rendered payload is identical to the last one sent is dropped instead of editing: a no-op handler mutate, a job write the current screen does not render, and any pixels-neutral pass no longer burn a Discord edit. Final edits (freeze, parting) are unaffected.
- Job redraws are coalesced: at most one edit per session is in flight, and writes that land while an edit runs only schedule the next round, rendered from the current bag. A chatty job self-paces to what the platform accepts instead of backing the session's queue up behind rate-limited edits, so clicks stop waiting past Discord's response window while a job runs.

## [0.1.1] - 2026-10-03

### Added

- Policy request helpers: `isOwner`, `hasRole`, and `hasAnyRole` as free functions over `PolicyRequest`, so a policy engine stops hand-writing identity checks. The request stays plain data and the port stays one question.
- Dev-only commands register in a dev guild instead of the public set: a `devGuildId` option (with a `DISCORD_DEV_GUILD_ID` env fallback) scopes them to a private guild, and without one they are dropped entirely. When both scopes land on the same guild, one registration call carries everything.
- An unseeded subflow slot fails at the draw with the screen and slot path named, instead of letting the guest view die on its own error far from the cause.

### Changed

- `action()` now defaults its data type to `unknown`, so stateless handlers (nav-only buttons, module-state pickers) can drop the explicit `action<unknown>()` and write bare `action()`.
- Removed extra newlines from the default parting screen.

### Fixed

- A bare-mount leaf's own `description` overrides the command description in the command picker, as documented.
- Trees are validated at the draw site: an illegal tree fails loudly with the rule and the path, on the first render, redraws, and the freeze alike, instead of passing locally and reaching Discord as a 400. A select's `maxSelected` below 1 is rejected, and modal selects follow the same description rules as message selects.
- `showModal` stamps a fresh nonce per open, so Discord no longer serves an older unsubmitted draft back as prefill, and a failed open leaves no pending submit destination behind. A required checkbox's `checked` prefill survives the required rewrite, so the modal opens ticked.
- Only accepted events slide the session's expiry window: denied, stale, and nonce-mismatched clicks no longer revive an idle session.
- A custom `onError` unit that throws is contained: it is logged and the shipped default takes over, in dispatch and in the interaction listener alike. Framework failures reply with the copy the flow's error hook chose.
- `findLive` returns the newest live session of a flow and owner, so a remount race yields to the actual successor.
- Rebinding a rehydratable flow with a `rehydrateRef` consults the flow's restore callback first: the rebound panel keeps its state instead of restarting from the seed.

## [0.1.0] - 2026-09-22

Initial release.

### Added

- Flow authoring: `flow` / `defineFlow` with bare flow ids, `screen` factories with a typed kit, inferred screen keys, and the live session as the view's third parameter, `subview` and `subflow` composition, a `components` option that draws onion-wrapped chrome around every screen, `action` handlers, and `command` + `mounts` for mounting commands with subcommands, `devOnly`, and `memberPermissions` knobs. `initialData` is optional, so stateless flows start sessions from an empty bag.
- Session model: per-flow TTL via `ttlMs`, a `remount` policy for what a repeat mount does (`replace` or `coexist`), the `Expiry` component with the `expiryEpoch` helper, `onSessionStart` / `onSessionEnd` hooks, `close-with-view` final views (including from expiry), custom parting screens via `command` hint, `note`, or a full `view`, and rehydration from a `RehydrateStore` after restarts.
- TSX authoring: the JSX runtime (`fluxcord/jsx-runtime`), fragments that splice flat, and the unified screen kit (`kitFor`: `Button`, `Select`, `Back`, `go` / `push` / `back` navigation), with plain builder functions as the non-TSX path.
- Layout and content tags: `view`, `row`, `container`, `text`, `code`, `codeblock`, `hr` with padding flags, the `error` / `warning` / `info` callouts, and children-as-content on the text-like tags.
- Controls: buttons with style flags, links, required selects with min/max values, `checkbox` / `checkbox-group` / `radio-group`, and modal forms built from `input` and `modal-select`. `<option>` children append to the `options` prop of a select and of the modal fields (`modal-select`, `checkbox-group`, `radio-group`), so a generated list can carry pinned fixed entries.
- Modal submissions land in `event.inputs` keyed by field id, each value in its field's natural shape: text inputs and radio answers arrive as strings, a checkbox as a boolean, and multi-pick fields (checkbox groups, modal selects) as arrays of their picks in pick order. An empty pick list and an unanswered radio group are omitted entirely.
- Entity selects render preselected ids (`defaultIds`) through the platform's `default_values`, so redrawn panels show the current selection highlighted.
- Static selects take a `values` prop for live preselection: entries may be strings, numbers, undefined, or null, nullish entries are filtered out and the rest stringified, so a data-bag field can ride in directly (`values={[data.pick]}`), and the matching options render preselected on every draw, which keeps a user's pick highlighted across redraws. A non-empty match takes precedence over the options' `default` flags, and passing `values` on an entity select fails with `select values belongs to a static options list, not an entity select`.
- Bare controls forgive their missing row: a select, button, or link dropped straight into a view or container gets its own synthetic row at render (controls share a row only when the author wraps them in one explicitly), while a row that mixes a select with other controls fails loudly with `row with a select must have exactly one child` instead of reaching the Discord API.
- Permission gates as declarations on flows and controls, decided per click by a policy port the host implements: the shipped default is owner-only, individual controls can carry a `policy` prop, and the policy vocabulary covers user/channel/role allow-or-deny lists with admin and mod bypasses, merge-or-replace composition, and custom denial copy.
- Per-flow `onError` that picks user-facing failure copy per error report, falling through to the shipped default when it returns nothing.
- Ephemeral panels: a per-mount ephemeral flag and the `ephemeralAsPublic` switch for dev visibility.
- Session runtime: state store, per-session click queues, a commit phase with automatic re-renders and message edits, dispatch core, and a TTL sweeper with parting screens.
- Discord binding (`fluxcord/discord`): `createUiBridge`, `flattenInteraction`, `setUiHost`, and `deriveCommand`, over discord.js v14 Components V2.
- Host: `createBot`, the one-call boot (client, bridge, runtime, command registration, interaction listener), with `bot.mount` for programmatic panels targeting a channel, an interaction reply, or an existing message to rebind after restarts, `registerCommands` to replace the built-in registration wholesale, `DISCORD_TOKEN` / `DISCORD_GUILD_ID` env fallbacks, bring-your-own `client` and `intents`, and a `logger` seam for bridge anomalies.
- Boot layer: `buildFlowCatalog`, `moduleFlowRegistrations`, and `coverageScan` boot validation.
- Advanced seams for custom hosts: `createUiRuntime`, `createCommit` / `viewOf`, `createSessionStore`, `asScreenRegistry`, `createDispatch` / `defaultOnError`, the action-id codec (`encodeActionId`, `decodeActionId`, `isActionId`), `validateTree`, and the type vocabulary (`Session`, `MessageRef`, `EndReason`, node types, `PolicyPort`, render payloads).
