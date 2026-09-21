# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-11

Initial release.

### Added

- Flow authoring: `flow` / `defineFlow` with bare flow ids, `screen` factories with a typed kit, inferred screen keys, and the live session as the view's third parameter, `subview` and `subflow` composition, `action` handlers, and `command` + `mounts` for mounting commands. `initialData` is optional, so stateless flows start sessions from an empty bag.
- Session model: per-flow TTL via `ttlMs`, the `Expiry` component with the `expiryEpoch` helper, `onSessionStart` / `onSessionEnd` hooks, `close-with-view` final views (including from expiry), and rehydration from a `RehydrateStore` after restarts.
- TSX authoring: the JSX runtime (`fluxcord/jsx-runtime`), fragments that splice flat, and the unified screen kit (`kitFor`: `Button`, `Select`, `Back`, `go` / `push` / `back` navigation), with plain builder functions as the non-TSX path.
- Layout and content tags: `view`, `row`, `container`, `text`, `code`, `codeblock`, `hr` with padding flags, the `error` / `warning` / `info` callouts, and children-as-content on the text-like tags.
- Controls: buttons with style flags, links, required selects with min/max values, `checkbox` / `checkbox-group` / `radio-group`, and modal forms built from `input` and `modal-select`.
- Entity selects render preselected ids (`defaultIds`) through the platform's `default_values`, so redrawn panels show the current selection highlighted.
- Permission gates as declarations on flows and controls, decided per click by a policy port the host implements; the shipped default is owner-only, and individual controls can carry a `policy` prop.
- Ephemeral panels: a per-mount ephemeral flag and the `ephemeralAsPublic` switch for dev visibility.
- Session runtime: state store, per-session click queues, a commit phase with automatic re-renders and message edits, dispatch core, and a TTL sweeper with parting screens.
- Discord binding (`fluxcord/discord`): `createUiBridge`, `flattenInteraction`, `setUiHost`, and `deriveCommand`, over discord.js v14 Components V2.
- Host: `createBot`, the one-call boot (client, bridge, runtime, command registration, interaction listener), with `bot.mount` for programmatic panels, `registerCommands` to replace the built-in registration wholesale, and `DISCORD_TOKEN` / `DISCORD_GUILD_ID` env fallbacks for the `token` and `guildId` options.
- Boot layer: `buildFlowCatalog`, `moduleFlowRegistrations`, and `coverageScan` boot validation.
- Advanced seams for custom hosts: `createUiRuntime`, `createCommit` / `viewOf`, `createSessionStore`, `asScreenRegistry`, `createDispatch` / `defaultOnError`, the action-id codec (`encodeActionId`, `decodeActionId`, `isActionId`), `validateTree`, and the type vocabulary (`Session`, `MessageRef`, `EndReason`, node types, `PolicyPort`, render payloads).
