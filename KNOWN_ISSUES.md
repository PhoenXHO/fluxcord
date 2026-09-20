# Known issues

Known limitations in fluxcord, with their impact and what to do about
them. None of them break correctness for a single-community bot, which
is the scale fluxcord is built and tested at today.

| Issue                                                                     | Impact                                                | Workaround                                     |
|---------------------------------------------------------------------------|-------------------------------------------------------|------------------------------------------------|
| [All clicks share one queue](#all-clicks-share-one-queue)                 | A slow handler delays clicks on every panel           | None needed at single-community scale          |
| [Old clicks break after a restart](#old-clicks-break-after-a-restart)     | Harmless errors from panels opened before the restart | None needed; the errors are cosmetic           |
| [Every draw fetches over REST](#every-draw-fetches-over-rest)             | Rate-limit pressure on very busy bots                 | None needed at single-community scale          |
| [Unlisted flows fail at first click](#unlisted-flows-fail-at-first-click) | A command registers fine, then fails on first use     | List the flow in the module manifest's `flows` |

## All clicks share one queue

The discord.js bridge runs interactions one at a time in arrival order.
A slow handler, such as one waiting on an external API, delays clicks on
every other open panel until it finishes. Within a single panel that
same ordering is what keeps handlers from racing each other. A bot
serving one community will not notice; a bot with thousands of
concurrently open panels would.

## Old clicks break after a restart

The bookkeeping that tracks open panels and already-handled clicks
lives in memory. After a restart, a click on a panel that predates it
can produce a harmless error, because the framework no longer remembers
that panel's message. The rehydrate store restores panel state across
restarts when configured; it does not preserve this bookkeeping.

## Every draw fetches over REST

Rendering a panel fetches its channel and message fresh on each draw,
with no caching between draws. This keeps the rendering path simple,
but a very busy bot pays for it in rate-limit headroom.

## Unlisted flows fail at first click

A command that mounts a flow must also list that flow in its module
manifest's `flows` array. Skipping the listing registers the command
normally, and the failure only surfaces when someone uses it, throwing
`mount: flow X is not in the boot catalog`. We plan to catch this at
boot in a future release.
