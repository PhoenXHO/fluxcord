# Permission gates

Permission gates decide who may press what. You attach gates to a control's `policy` prop or a flow's third argument, and they can also guard a command's leaf. The vocabulary is tiny and composes. We'll use the staff module as a worked example because it builds a roles picker that decides who counts as staff, alongside an ephemeral ticket desk whose resolve button is admin-only.

## The vocabulary

```tsx
import { policy } from 'fluxcord';

// Staff means the panel owner, or anyone the host's staff roles name.
const staffGate = policy.any(policy.owner(), policy.privilege('mod'), policy.privilege('admin'));
```

The atoms are `policy.owner()` for the user who opened the panel, `policy.privilege('name')`, and the absolutes `policy.allow()` and `policy.deny()`. The `policy.any` and `policy.all` combinators nest to arbitrary depth; there's no negation. Every gate takes an optional `{ deny: 'message' }` configuration whose copy replaces the generic "You don't have permission to do that." response. Policies never mention role IDs or the word admin because `admin` is a privilege name, and mapping Discord roles to that name is the host's business. This indirection keeps a module portable between servers.

## The host names the roles

The shipped engine asks one fact to evaluate those names.

```ts
export const staffFacts: PrivilegeFacts = {
    async privileges(_actorId, _guildId, roleIds) {
        const ids = roleIds ?? [];
        const names = new Set<string>();
        if (ids.some(id => roleConfig.admin.includes(id))) names.add('admin');
        if (ids.some(id => roleConfig.staff.includes(id))) names.add('mod');
        return [...names];
    },
};
```

```ts
const bot = createBot({
    policy: staffFacts,
    modules: [/* ... */],
});
```

Here `roleConfig` is the module's own store, since the picker feeds it, though a real bot answers from its database. The engine calls `privileges` fresh on every evaluation and never caches, so a privilege change applies on the next click without restarts or redraws. The role IDs ride along when Discord supplied them, meaning list-based bindings stay cheap; a host that prefers member fetches can ignore them entirely. An unbound name appears in nobody's list and fails closed. A failing facts lookup also denies the action. Passing a full `PolicyPort` as the `policy` option on `createBot`, which is an object with an `authorize(request)` method, bypasses the shipped engine entirely. The fluxcord package exports helpers like `isOwner` and `hasRole`, along with `hasAnyRole`, for custom engines.

## Three doors

The attach points evaluate in a nearest-wins hierarchy.

```tsx
<Button
    onClick={resolveNext}
    label="Resolve the next"
    success
    disabled={data.open === 0}
    policy={policy.privilege('admin', { deny: 'Admins only.' })} />
```

```ts
export const ticketsFlow = flow<TicketData>('tickets', {
    screens: { desk: deskScreen },
    first: 'desk',
    initialData: { open: 3, pinged: false },
}, { policy: staffGate });
```

```ts
export const staffCommand = command('staff', 'Moderation panels for server staff', {
    subcommands: {
        roles: mounts(rolesFlow, { description: 'Pick the staff and admin roles', policy: policy.privilege('admin', { deny: 'Admins only.' }) }),
        tickets: mounts(ticketsFlow, { description: 'Open the ticket desk', ephemeral: true, policy: staffGate }),
    },
});
```

Because the nearest policy wins, a control's gate replaces its flow's gate for that action alone; `policy.allow()` is how a control opts back open inside a gated panel. Ungated means allowed, because gates are opt-in fences rather than a default-deny wall. The command door evaluates before the panel mounts, relying on the invocation's identity alone. This means `policy.owner()` is vacuously false at a door, since nobody owns a session that doesn't exist yet. A denied door replies ephemerally with the gate's copy, and no panel is born. A gate guards its own door: gating the command doesn't gate the panels it opens, so you put the gate on the flow to protect the surface and on the leaf to protect the entry. Discord's own `memberPermissions` is a `command` option that hides a command from members entirely; that stays the first tool for static role gates, while the door covers everything dynamic.

## Live, not frozen

Evaluation happens per click against fresh facts, and the staff picker serves as the demo. The roles screen writes the picks to the module's store, and an already-open ticket desk enforces the new roles on its very next click. A Discord message renders once for everyone, so a gate never hides a control; the button looks the same to a non-staff member, and the denial happens on click.

## What gates do not do

The `PolicyRequest` carries identity and location but not the interaction's values, so per-target rules belong inside the handler where the values live. App-state conditions are host facts too: you can compute them into privilege names, or wait for the requirement registry. Both escape hatches exist without new vocabulary.

Panel lifespans, expiry, and parting notes are covered in [Sessions and expiry](sessions-and-expiry.md).
