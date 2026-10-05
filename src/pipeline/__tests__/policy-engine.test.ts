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

	it('nearest policy wins: actionPolicy replaces flowPolicy, flowPolicy applies alone', async () => {
		const engine = createDefaultPolicyEngine({ privileges: async () => [] });
		// The flow is gated, the control opted open.
		await expect(engine.authorize(request({ flowPolicy: policy.privilege('admin'), actionPolicy: policy.allow() }))).resolves.toEqual({ allowed: true });
		// No control gate: the flow's applies.
		await expect(engine.authorize(request({ flowPolicy: policy.privilege('admin') }))).resolves.toEqual({ allowed: false });
	});
});
