/**
 * PolicyRequest helpers: convenience predicates for policy engines.
 *
 * PolicyRequest stays pure data and the PolicyPort stays one question;
 * these are free functions an authorize implementation reaches for
 * instead of hand-writing the same identity checks. Nothing here talks
 * to the framework: each reads identity off the request and answers.
 *
 * @module pipeline/policy
 */

import type { PolicyRequest } from './types.js';

/** Whether the clicker is the session's owner. */
export function isOwner(request: PolicyRequest): boolean {
	return request.actorId === request.ownerId;
}

/** Whether the clicker holds one role. */
export function hasRole(request: PolicyRequest, roleId: string): boolean {
	return request.actorRoleIds?.includes(roleId) ?? false;
}

/** Whether the clicker holds any of the given roles. */
export function hasAnyRole(request: PolicyRequest, roleIds: readonly string[]): boolean {
	return roleIds.some(roleId => hasRole(request, roleId));
}
