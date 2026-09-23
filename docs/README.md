# fluxcord guide

fluxcord is a UI framework for Discord bots built around Discord's Components V2 system.

At its core, fluxcord lets you treat Discord messages as stateful UI panels. You write your screens and event handlers in TypeScript. When a user interacts with a panel, your handler updates the state, and fluxcord takes care of re-rendering the UI and routing events behind the scenes.

Rather than dumping disconnected code snippets, this guide builds a real bot step by step. Everything you see here comes directly from the runnable example in [`examples/`](../examples/).

## Where to start

### Getting started

1. [Installation](getting-started/installation.md) — Set up a fresh TypeScript project ready for building panels.
2. [Project setup](getting-started/project-setup.md) — Add a source folder, an entry point, and a run script.
3. [Your first panel](getting-started/your-first-panel.md) — Build a stateless about panel end to end.
4. [Hosting and commands](getting-started/hosting-and-commands.md) — Run your bot with `createBot` and open the panel with a slash command.

### Core concepts

- [Screens and navigation](core-concepts/screens-and-navigation.md) — Manage multi-screen flows and transition between them.
- [State and actions](core-concepts/state-and-actions.md) — Handle session data and write click handlers.
- [Controls](core-concepts/controls.md) — Buttons, selects, and the values handlers receive.
- [Layout and content](core-concepts/layout-and-content.md) — Structure your panels with headings, separators, containers, and text dressings.
- [Modals](core-concepts/modals.md) — Pop up modal dialogs to collect user input.
- Subflows — Nest UI flows inside parent flows for modular layouts.
- Commands and mounting — Attach flows to slash commands, including subcommands and permission knobs.
- Permission gates — Control who can interact with specific components.
- Sessions and expiry — Manage panel lifecycles and clean up inactive sessions.
- Errors — Decide what users see when a handler fails.
- Live panels — Hook into external events to trigger real-time panel updates.
- Persistence — Save and restore active sessions across bot restarts.

### Reference

- API Reference — Detailed breakdown of every public export, including function signatures and usage examples.
