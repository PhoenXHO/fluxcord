# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-11

Initial release.

### Added

- Flow authoring: `flow`, `screen`, `subview`, `action`, `command`,
  `mounts`, and subflows via `defineFlow` + `subflow`.
- TSX authoring: the JSX runtime (`fluxcord/jsx-runtime`) and the typed
  screen kit (`Button`, `Select`, navigation, modals), with plain builder
  functions as the non-TSX path.
- Session runtime: state store, per-session click queues, a commit phase
  with automatic re-renders and message edits, dispatch core, TTL sweeper
  with parting screens, and optional rehydration after restarts.
- Discord binding (`fluxcord/discord`): `createUiBridge`, `deriveCommand`,
  and `setUiHost`, over discord.js v14 Components V2.
- Boot layer: `buildFlowCatalog`, `moduleFlowRegistrations`, `coverageScan`.
- Permission gates as declarations on flows and controls, decided per click
  by a policy port the host implements.
- Entity selects render preselected ids (`defaultIds`) through the platform's
  `default_values`, so redrawn panels show the current selection highlighted.
