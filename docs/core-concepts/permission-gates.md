# Permission gates

When a user clicked a panel they don't own at the end of the last chapter, fluxcord intercepted the interaction and displayed a standard denial message: `"You don't have permission to do that."` Behind this check is an extensible policy engine where fluxcord asks exactly one authorization question per incoming event and lets your app answer it. The framework handles event routing and identity context, leaving custom authorization rules, database queries, and role verification entirely up to your application host.

In this chapter, we will replace fluxcord's default ownership engine with a custom policy implementation for the staff module, then give the ticket desk's resolve button a gate of its own and a `/staff roles` picker to feed it.

## The default engine

By default, fluxcord evaluates permissions using an ownership check: it compares the interacting user's Discord ID against the session owner's ID. If the IDs match, the interaction proceeds; otherwise, fluxcord cancels event execution and displays the default denial message you saw earlier. That default works well for most panels because they naturally belong to whoever opened them, but as soon as a panel must open to a group, like a panel shared by your staff, you'll want to supply your own engine in place of the default. You can override the default engine by supplying a `policy` object to `createBot`:

```ts
const bot = createBot({
    policy: staffPolicy,
    modules: [/* ... */],
});
```

Because the `policy` option accepts any `PolicyPort` (an object exposing a single `authorize` function), passing your own implementation replaces the default ownership check.

> [!IMPORTANT]
> There is no chaining and no fallback: your engine alone answers every question, including the ones the ownership default used to handle.

## The one question

Whenever fluxcord invokes `authorize`, it passes a `PolicyRequest` and expects a `PolicyDecision` in return. Because the seam is intentionally narrow, the incoming request carries only identity and location:

| Field                  | What it says                                                          |
|------------------------|-----------------------------------------------------------------------|
| `actorId`              | Discord ID of the user triggering the interaction.                    |
| `actorRoleIds`         | Array of role IDs held by the user (if supplied by Discord).          |
| `ownerId`              | Discord ID of the session owner who launched the panel.               |
| `guildId`              | Guild the interaction ran in (absent in Direct Messages).             |
| `channelId`            | Channel the interaction fired in.                                     |
| `flowId`               | Full identifier of the active flow (e.g., `staff/tickets`).           |
| `view`                 | Identifier of the active screen view (e.g., `staff/desk`).            |
| `actionPolicy`         | Control-specific policy constraints declared directly on the element. |

Your decision resolves to either `{ allowed: true }` or `{ allowed: false, denyMessage }`. When an interaction is denied, fluxcord halts immediately and replies to the actor, usually as an ephemeral message; the underlying handler never runs, since the framework never begins running a handler before verifying permissions. If your engine omits `denyMessage`, fluxcord falls back to the default `"You don't have permission to do that."`

> [!NOTE]
> To maintain strict separation between framework routing and business logic, `PolicyRequest` does not carry session data. Your engine can't inspect it, so query your own database or application state for access decisions instead.

## Building the staff policy engine

That absence raises an obvious question for our staff example: if the engine can't inspect the panel's data, where do the staff role ids live? In production, policy engines typically inspect user permissions against a persistent database. For our example, a module-level configuration store serves as the source of truth:

```tsx
const roleConfig = {
    staff: [] as readonly string[],
    admin: [] as readonly string[],
};
```

Because the engine closure reads this store directly, re-picking the roles updates the engine's decisions immediately without requiring a restart; the only trade-off is that an in-memory store dies with the process, whereas a database wouldn't.

Our custom policy evaluates permissions using two sequential rules:
1. Controls with an explicit `actionPolicy` evaluate strictly against those specified roles.
2. All other controls permit access to either the session owner or members holding a staff role.

Both checks ship with fluxcord as request helpers (`isOwner`, `hasAnyRole`), so the engine only decides what they mean:

```tsx
const staffPolicy: PolicyPort = {
    authorize(request) {
        const gate = request.actionPolicy;
        if (gate?.roles?.roleIds !== undefined) {
            return hasAnyRole(request, gate.roles.roleIds)
                ? Promise.resolve({ allowed: true })
                : Promise.resolve({ allowed: false, denyMessage: 'Admins only.' });
        }
        if (isOwner(request) || hasAnyRole(request, roleConfig.staff)) {
            return Promise.resolve({ allowed: true });
        }
        return Promise.resolve({ allowed: false, denyMessage: 'Staff only.' });
    },
};
```

Reading this top-down: the `actionPolicy` branch runs first because an explicit gate narrows access; even the session owner must pass through it, which is precisely why you'd declare a gate. Anything without an explicit gate falls back to the broader staff-or-owner rule.

## Configuring roles dynamically

Since our store needs a way to update, we can add a `/staff roles` subcommand that renders two role selects. As we saw in the [Controls](controls.md) chapter, setting the `roles` flag asks Discord for a searchable role list while `defaultIds` preselects values so that a redraw immediately reflects your current choices:

```tsx
const rolesScreen = screen()((_data, { Select }) => (
    <view>
        <text>
            Who counts as staff, and who can resolve tickets? New picks apply to fresh panels right away; a
            panel that is already open adopts them on its next draw.
        </text>
        <Select roles placeholder="Staff roles" onSelect={pickStaff} defaultIds={[...roleConfig.staff]} />
        <Select roles placeholder="Admin roles (may resolve tickets)" onSelect={pickAdmin} defaultIds={[...roleConfig.admin]} />
    </view>
));
```

Because the picker doesn't maintain its own data bag, its actions write straight to `roleConfig`, allowing the screen to read values back through `defaultIds` on the next draw so the store stays the single source of truth. The policy engine is configured through the same screens and controls as the module it protects.

## Element-level policy declarations

UI elements can enforce granular access controls by declaring a `policy` prop. For example, on the staff ticket desk, general staff members may view the queue, but resolving a ticket requires admin privileges:

```tsx
<Button
    onClick={resolveNext}
    label="Resolve the next"
    policy={{ roles: { mode: 'allow', roleIds: [...roleConfig.admin] } }}
/>
```

When clicked, the button passes its declared `policy` object to the host's policy engine inside `request.actionPolicy`. The `policy` prop is evaluated fresh on every render, so changing admin roles in `/staff roles` takes effect on the gated control's next draw; a panel that is already open keeps enforcing the gate it was drawn with until something redraws it.

## What fluxcord ships and what it carries

The `policy` prop supports these declarative constraints:
- `users` and `channels` allow and deny lists
- `owner` rules with admin or moderator overrides (e.g., `ownerOnly`, `allowAdminOverride`, `allowModOverride`)
- `merge`/`replace` resolution modes for combining policy layers
- Custom response overrides (e.g., `reasonLabel`, `hint`)

fluxcord passes these policy objects directly to the host engine without modification, allowing it to interpret or extend the policy rules as needed. The request carries the `flowId` too, so engines that want per-flow rules can match on it.

> [!TIP]
> If owner-only panels plus `memberPermissions` at the command boundary cover your bot, the default engine is a fine permanent choice. Many bots never write a custom policy, and the two layers work independently and can be combined.

## Next steps

While permissions govern which clicks land, [Sessions and expiry](sessions-and-expiry.md) explores how a panel behaves over its full lifecycle. We'll look at how sessions expire and see how you can leave a parting note so users know how to jump back in.
