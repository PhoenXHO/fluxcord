# Roadmap

Fluxcord's version goals, checked off as they land.

## 0.1.0

- [x] Public repository with CI on Node 22 and 24
- [x] Coverage tooling and package metadata
- [x] Logo, lockups, and README
- [ ] Kitchen-sink example bot in examples/ that exercises every supported feature (skeleton, counter, about, dice, and order apps so far)
- [ ] Guide written from the example bot's working code (getting-started done, plus core-concepts through modals; subflows onward remain)
- [x] Hero demo GIF recorded from the example bot
- [x] Publish v0.1.0 to npm

## 0.2.0

- [ ] `fluxcord init` CLI: patches a project's tsconfig for TSX authoring and scaffolds a starter flow
- [ ] `reset` verb for the data bag: restore `initialData` (or an empty bag for stateless flows); whether it also resets navigation is still open
- [ ] Frozen data bag: bare writes to session data throw instead of silently skipping the redraw; mutate becomes copy-on-write (freeze at mount, after each mutate, and after rehydrate)
- [ ] Modal draft retention: a dynamic keep/discard toggle for the per-open modal nonce, so Discord can preserve a half-typed draft across reopenings (trade-off: submits from modals open during a redraw go stale)
- [ ] Rehydratable command mounts: an optional `rehydrateRef` on the mount spec, so a command can reopen a revivable panel instead of always starting fresh (today only `bot.mount` carries a ref; the case is a flow that is both command-summoned and persistent, like `/lotto start` resuming a running lotto)
- [ ] Subflow-defined `initialData`: a plugged subflow's own `initialData` auto-seeds its slot on the parent's bag (and slotted keys become optional on the parent's `TData`), so hosts stop hand-writing `delivery: {}` seeds
- [ ] Subflow roots in inline nav typing: carry the plug key as a literal type through `subflow()`, infer a roots param in `defineFlow`, and widen the kit's `go`/`push` targets to screens plus roots, so `e.ui.go('delivery')` type-checks inline instead of needing a standalone action
- [ ] Built-in Done bar on `subflow()`: an optional done-bar prop the plug applies to exactly its own namespaced screens, replacing the hand-written `components` wrapper with its `startsWith('delivery.')` guard
- [ ] Mount without manifest ceremony: `bot.mount` refuses a flow that isn't also listed in its module's `flows` field (identity is assembled in the boot catalog, and the manifest is the only place a flow's module prefix exists); explore declaring the home at the mount site or auto-registering, so a purely programmatic panel needs no manifest entry
- [ ] Automatic policy resolution: a shipped default engine that evaluates the declarative `PermissionPolicy` vocabulary (today those objects are inert data the host must interpret by hand) across the full layer stack (guild/module → flow entry → control `actionPolicy`, honoring merge/replace and the admin/mod bypass flags); authors opt out by supplying their own `PolicyPort` or build on top of the built-in resolver to add layers; open questions: how admin/mod ID lists reach the engine, and whether the request carries a resolved layer stack
- [ ] Rebind by ref on boot: a mount option that looks up a surviving rehydrate row by ref and patches the existing message instead of sending a fresh panel, so a service panel like the campfire stops duplicating on every restart (today the host must track the message ID itself and pass `to: { existing }`); needs a `findByRef` query on the store interface
- [ ] Mount seeds from rehydrate: when a mount carries `rehydrateRef`, seed the bag via `rehydrate(ref)` instead of the raw `initialData`, so a fresh panel opens showing the record's real state (live-smoke catch 2026-09-26: the campfire's fresh boot panel said "the fire is cold" while the file held 30 logs; only the revived old panel showed the truth)
- [ ] A cancel affordance for flows: an author-facing way to offer "abandon this flow" that exits and discards the bag, complementing the reset verb and the close-from-handle work; open question: kit button, ui verb, or docs guidance (raised reviewing the taco delivery screen, 2026-09-27)
- [ ] Push access for subflows: the lifecycle hooks live on the registration wrapper and a plugged subflow keeps none, so a subflow can never hold a handle and a ticking panel must be a top-level flow today; open question: whether the parent forwards a scoped handle into the plug or nested sessions get their own hook delivery
- [ ] Close from the handle: `handle.close(view?)` mirroring `ui.close`, so the programmatic side (a finished job, a retired service panel) can end a session instead of only pushing final state and waiting out the TTL; 0.1.0 kept close inside-only on purpose (only user actions dismiss); the seam exists (done-set, `commitParting`, `onSessionEnd` with `'close'`, row deletion)
- [ ] Restorable position on revive: a revived session always lands on the flow's first screen because only the data bag returns from `rehydrate`; let the callback optionally name the screen to restore (author-controlled, no row changes), and explore persisting the current screen plus navigation history in the row behind an opt-in; open questions: row writes per navigation vs. a death-time snapshot, and whether full history is worth restoring or the current screen is enough
- [ ] Redraw verb on the event toolkit: handlers in stateless screens (a config picker with no data bag) cannot trigger a redraw after a pick — there is no `mutate` to piggyback on and no `e.ui.redraw()`, so the panel keeps showing stale preselects until the next interaction; live-smoke catch 2026-09-26 (/staff roles). Related open question: gates stamped at draw time vs. re-evaluated live at dispatch (cross-panel freshness)
- [ ] Docs site (exploring fumadocs, once real users justify it)
