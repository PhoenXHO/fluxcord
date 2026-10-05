# Roadmap

Fluxcord's version goals, checked off as they land.

## 0.1.0

- [x] Public repository with CI on Node 22 and 24
- [x] Coverage tooling and package metadata
- [x] Logo, lockups, and README
- [ ] Kitchen-sink example bot in examples/ that exercises every supported feature (skeleton, counter, about, dice, and order apps so far)
- [x] Guide written from the example bot's working code (getting-started plus all twelve core-concepts chapters)
- [x] Hero demo GIF recorded from the example bot
- [x] Publish v0.1.0 to npm

## 0.2.0

- [ ] `fluxcord init` CLI: patches a project's tsconfig for TSX authoring and scaffolds a starter flow
- [ ] `reset` verb for the data bag: restore `initialData` (or an empty bag for stateless flows); whether it also resets navigation is still open
- [ ] Frozen data bag: bare writes to session data throw instead of silently skipping the redraw; mutate becomes copy-on-write (freeze at mount, after each mutate, and after rehydrate)
- [ ] Modal draft retention: a dynamic keep/discard toggle for the per-open modal nonce, so Discord can preserve a half-typed draft across reopenings (trade-off: submits from modals open during a redraw go stale)
- [ ] Rehydratable command mounts: an optional `rehydrateRef` on the mount spec, so a command can reopen a revivable panel instead of always starting fresh (today only `bot.mount` carries a ref; the case is a flow that is both command-summoned and persistent, like `/lotto start` resuming a running lotto)
- [x] Mount without manifest ceremony: same-module `event.call` needs no manifest entry at all (the child's identity assembles from the calling frame's module), and the `flows` field is doors only — host mounts and cross-module calls. A host mount keeps its listing, because the mount needs the module identity it provides.
- [ ] Automatic policy resolution: a shipped default engine that evaluates the declarative `PermissionPolicy` vocabulary (today those objects are inert data the host must interpret by hand) across the full layer stack (guild/module → flow entry → control `actionPolicy`, honoring merge/replace and the admin/mod bypass flags); authors opt out by supplying their own `PolicyPort` or build on top of the built-in resolver to add layers; open questions: how admin/mod ID lists reach the engine, and whether the request carries a resolved layer stack
- [ ] Rebind by ref on boot: a mount option that looks up a surviving rehydrate row by ref and patches the existing message instead of sending a fresh panel, so a service panel like the campfire stops duplicating on every restart (today the host must track the message ID itself and pass `to: { existing }`); needs a `findByRef` query on the store interface
- [ ] Mount seeds from rehydrate: when a mount carries `rehydrateRef`, seed the bag via `rehydrate(ref)` instead of the raw `initialData`, so a fresh panel opens showing the record's real state (live-smoke catch 2026-09-26: the campfire's fresh boot panel said "the fire is cold" while the file held 30 logs; only the revived old panel showed the truth)
- [ ] A cancel affordance for flows: an author-facing way to offer "abandon this flow" that exits and discards the bag, complementing the reset verb and the close-from-handle work; open question: kit button, ui verb, or docs guidance (raised reviewing the taco delivery screen, 2026-09-27)
- [ ] Close from the handle: `handle.close(view?)` mirroring `ui.exit`, so the programmatic side (a finished job, a retired service panel) can end a session instead of only pushing final state and waiting out the TTL; 0.1.0 kept close inside-only on purpose (only user actions dismiss); the seam exists (done-set, `commitParting`, `onSessionEnd` with `'close'`, row deletion)
- [x] Restorable position on revive: `first` accepts a resolver over the rehydrated seed, so the callback effectively names the screen a revived session lands on (author-controlled, no row changes). Persisting the current screen plus navigation history in the row remains unexplored.
- [ ] Redraw verb on the event toolkit: handlers in stateless screens (a config picker with no data bag) cannot trigger a redraw after a pick — there is no `mutate` to piggyback on and no `e.ui.redraw()`, so the panel keeps showing stale preselects until the next interaction; live-smoke catch 2026-09-26 (/staff roles). Related open question: gates stamped at draw time vs. re-evaluated live at dispatch (cross-panel freshness)
- [ ] Docs site (exploring fumadocs, once real users justify it)
