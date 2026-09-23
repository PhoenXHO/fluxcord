# Roadmap

Fluxcord's version goals, checked off as they land.

## 0.1.0

- [x] Public repository with CI on Node 22 and 24
- [x] Coverage tooling and package metadata
- [x] Logo, lockups, and README
- [ ] Kitchen-sink example bot in examples/ that exercises every supported feature (skeleton, counter, about, dice, and order apps so far)
- [ ] Guide written from the example bot's working code (getting-started done, plus core-concepts through modals; subflows onward remain)
- [ ] Per-export API reference
- [x] Hero demo GIF recorded from the example bot
- [x] Publish v0.1.0 to npm

## 0.2.0

- [ ] `fluxcord init` CLI: patches a project's tsconfig for TSX authoring and scaffolds a starter flow
- [ ] `reset` verb for the data bag: restore `initialData` (or an empty bag for stateless flows); whether it also resets navigation is still open
- [ ] Modal draft retention: a dynamic keep/discard toggle for the per-open modal nonce, so Discord can preserve a half-typed draft across reopenings (trade-off: submits from modals open during a redraw go stale)
- [ ] Docs site (exploring fumadocs, once real users justify it)
