/**
 * The shipped policy engine: the vocabulary evaluated over the host's
 * privilege facts. Nearest policy wins (a control's gate replaces the
 * flow's), ungated means allowed, unbound privilege names and failing
 * facts lookups are fail-closed, and nothing is cached: a facts flip
 * between clicks flips the decision.
 *
 * @module pipeline/__tests__/policy-engine
 */

import { describe, expect, it, vi } from 'vitest';
import type { PolicyRequest } from '../types.js';
import { createDefaultPolicyEngine, policy } from '../policy.js';

/** A click from u1, owned by u1, in guild g1: the request shape dispatch sends. */
function request(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
	return {
		actorId: 'u1',
		ownerId: 'u1',
		guildId: 'g1',
		flowId: 'mod/panel',
		view: 'mod/panel/main',
		...overrides,
	};
}

describe('the default policy engine', () => {
	it('allows an ungated request without touching the facts', async () => {
		let asked = 0;
		const engine = createDefaultPolicyEngine({ privileges: async () => { asked += 1; return []; } });
		await expect(engine.authorize(request())).resolves.toEqual({ allowed: true });
		expect(asked).toBe(0);
	});

	it('owner passes for the session owner, fails for others, and is vacuously false without an owner', async () => {
		const engine = createDefaultPolicyEngine({ privileges: async () => [] });
		await expect(engine.authorize(request({ actionPolicy: policy.owner() }))).resolves.toEqual({ allowed: true });
		await expect(engine.authorize(request({ actorId: 'u2', actionPolicy: policy.owner() }))).resolves.toEqual({ allowed: false });
		await expect(engine.authorize(request({ ownerId: undefined, actionPolicy: policy.owner() }))).resolves.toEqual({ allowed: false });
	});

	it('privilege resolves through the live facts, unbound names fail closed', async () => {
		const held = ['mod'];
		const engine = createDefaultPolicyEngine({ privileges: async () => held });
		await expect(engine.authorize(request({ actionPolicy: policy.privilege('mod') }))).resolves.toEqual({ allowed: true });
		// A typo'd privilege is in nobody's list: denied, no special case.
		await expect(engine.authorize(request({ actionPolicy: policy.privilege('admmin') }))).resolves.toEqual({ allowed: false });
		// Nothing is cached: flipping the fact flips the next decision.
		held.length = 0;
		await expect(engine.authorize(request({ actionPolicy: policy.privilege('mod') }))).resolves.toEqual({ allowed: false });
	});

	it('a failing facts lookup denies with the generic copy', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const engine = createDefaultPolicyEngine({ privileges: async () => { throw new Error('db down'); } });
		try {
			await expect(engine.authorize(request({ actionPolicy: policy.privilege('mod') }))).resolves.toEqual({ allowed: false });
		} finally {
			spy.mockRestore();
		}
	});

	it('deny and allow are absolutes, and deny copy rides the decision', async () => {
		// Actor-aware facts: u1 holds mod, u2 holds nothing.
		const engine = createDefaultPolicyEngine({ privileges: async (actorId) => (actorId === 'u1' ? ['mod'] : []) });
		await expect(engine.authorize(request({ actionPolicy: policy.deny() }))).resolves.toEqual({ allowed: false });
		await expect(engine.authorize(request({ actionPolicy: policy.allow() }))).resolves.toEqual({ allowed: true });
		await expect(engine.authorize(request({ actionPolicy: policy.privilege('mod', { deny: 'Staff only.' }) }))).resolves.toEqual({ allowed: true });
		await expect(engine.authorize(request({ actorId: 'u2', actionPolicy: policy.privilege('mod', { deny: 'Staff only.' }) }))).resolves.toEqual({ allowed: false, denyMessage: 'Staff only.' });
	});

	it('any and all compose, nested', async () => {
		const engine = createDefaultPolicyEngine({ privileges: async () => ['mod'] });
		const gate = policy.any(policy.privilege('admin'), policy.all(policy.privilege('mod'), policy.owner()));
		await expect(engine.authorize(request({ actionPolicy: gate }))).resolves.toEqual({ allowed: true });
		await expect(engine.authorize(request({ actorId: 'u2', actionPolicy: gate }))).resolves.toEqual({ allowed: false });
	});

	it('any and all take their own deny copy through the array form, and the plain form is unchanged', async () => {
		const engine = createDefaultPolicyEngine({ privileges: async () => [] });
		const staff = policy.any([policy.privilege('admin'), policy.privilege('mod')], { deny: 'Staff only.' });
		await expect(engine.authorize(request({ actionPolicy: staff }))).resolves.toEqual({ allowed: false, denyMessage: 'Staff only.' });
		const both = policy.all([policy.privilege('admin'), policy.owner()], { deny: 'Admin owners only.' });
		await expect(engine.authorize(request({ actionPolicy: both }))).resolves.toEqual({ allowed: false, denyMessage: 'Admin owners only.' });
		// The argument-list form still builds the same data, with no copy.
		expect(policy.any(policy.allow(), policy.deny())).toEqual({ kind: 'any', of: [{ kind: 'allow' }, { kind: 'deny' }] });
		expect(policy.any([policy.allow()])).toEqual({ kind: 'any', of: [{ kind: 'allow' }] });
		// A combinator that passes carries no copy into the decision.
		const open = createDefaultPolicyEngine({ privileges: async () => ['mod'] });
		await expect(open.authorize(request({ actionPolicy: staff }))).resolves.toEqual({ allowed: true });
	});

	it('an all without copy of its own reports the first member that said no, in order', async () => {
		const engine = createDefaultPolicyEngine({ privileges: async () => ['mod'] });
		const gate = policy.all(
			policy.privilege('mod', { deny: 'Not staff.' }),
			policy.privilege('running', { deny: 'Nothing is running.' }),
			policy.privilege('owner-ish', { deny: 'Owners only.' }),
		);
		await expect(engine.authorize(request({ actionPolicy: gate }))).resolves.toEqual({ allowed: false, denyMessage: 'Nothing is running.' });
		// Nested: the message travels up through an inner all.
		const nested = policy.all(policy.all(policy.privilege('running', { deny: 'Nothing is running.' })));
		await expect(engine.authorize(request({ actionPolicy: nested }))).resolves.toEqual({ allowed: false, denyMessage: 'Nothing is running.' });
	});

	it('an all with copy of its own keeps it over a member\'s, and a member without copy leaves the generic denial', async () => {
		const engine = createDefaultPolicyEngine({ privileges: async () => [] });
		const own = policy.all([policy.privilege('x', { deny: 'Member copy.' })], { deny: 'Gate copy.' });
		await expect(engine.authorize(request({ actionPolicy: own }))).resolves.toEqual({ allowed: false, denyMessage: 'Gate copy.' });
		const bare = policy.all(policy.privilege('x'));
		await expect(engine.authorize(request({ actionPolicy: bare }))).resolves.toEqual({ allowed: false });
	});

	it('nearest policy wins: actionPolicy replaces flowPolicy, flowPolicy applies alone', async () => {
		const engine = createDefaultPolicyEngine({ privileges: async () => [] });
		// The flow is gated, the control opted open.
		await expect(engine.authorize(request({ flowPolicy: policy.privilege('admin'), actionPolicy: policy.allow() }))).resolves.toEqual({ allowed: true });
		// No control gate: the flow's applies.
		await expect(engine.authorize(request({ flowPolicy: policy.privilege('admin') }))).resolves.toEqual({ allowed: false });
	});
});
