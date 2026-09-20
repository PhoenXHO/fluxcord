# fluxcord examples

One bot that runs every example app. Each app lives in a single file under
`src/apps/`, and `src/index.ts` is the shared host every app mounts into.

## Running it

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Fill in `DISCORD_TOKEN` from a Discord application you own. Set
`DISCORD_GUILD_ID` to register commands instantly in one guild while
developing; without it, registration is global and can take up to an hour.

The package resolves `fluxcord` from the repository root through a
`file:` dependency, so run `npm run build` in the repository root once
before the first install.

## Apps

| Command    | File                   | What it shows                                    |
|------------|------------------------|--------------------------------------------------|
| `/counter` | `src/apps/counter.tsx` | A flow on one screen: actions, state, re-renders |
