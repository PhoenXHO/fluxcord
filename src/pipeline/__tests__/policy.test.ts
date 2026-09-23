/**
 * PolicyRequest helper tests: the three predicates over plain request
 * shapes, including the roles-absent case.
 *
 * @module pipeline/__tests__/policy
 */

import { describe, expect, it } from 'vitest';
import { hasAnyRole, hasRole, isOwner } from '../policy.js';
import type { PolicyRequest } from '../types.js';

function request(over: Partial<PolicyRequest> = {}): PolicyRequest {
	return {
		actorId: 'actor-1',
		ownerId: 'owner-1',
		flowId: 'mod/flow',
		view: 'mod/screen',
		...over,
	};
}

describe('isOwner', () => {
	it('matches the actor against the owner', () => {
		expect(isOwner(request())).toBe(false);
		expect(isOwner(request({ actorId: 'owner-1' }))).toBe(true);
	});
});

describe('hasRole', () => {
	it('finds one held role', () => {
		const r = request({ actorRoleIds: ['a', 'b'] });
		expect(hasRole(r, 'b')).toBe(true);
		expect(hasRole(r, 'c')).toBe(false);
	});

	it('answers false when the platform sent no roles', () => {
		expect(hasRole(request(), 'a')).toBe(false);
	});
});

describe('hasAnyRole', () => {
	it('answers true on the first held role', () => {
		const r = request({ actorRoleIds: ['b'] });
		expect(hasAnyRole(r, ['a', 'b'])).toBe(true);
		expect(hasAnyRole(r, ['a', 'c'])).toBe(false);
	});

	it('answers false on an empty list and when roles are absent', () => {
		expect(hasAnyRole(request({ actorRoleIds: ['b'] }), [])).toBe(false);
		expect(hasAnyRole(request(), ['a'])).toBe(false);
	});
});
