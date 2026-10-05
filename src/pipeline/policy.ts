/**
 * The policy vocabulary and the shipped engine.
 *
 * `policy` builds the inert gate values (see {@link Policy}); the
 * default engine evaluates them over ONE host fact: what privileges
 * does this actor hold here. The engine is pure in the sense the
 * project ruled: no named admin or mod lives here, privileges are the
 * host's naming layer over roles, and an unbound name simply appears in
 * nobody's list (fail-closed with no special case). A host that wants
 * total control supplies its own `PolicyPort` instead and none of this
 * evaluates.
 *
 * The PolicyRequest helpers at the bottom stay free functions for
 * custom authorize implementations.
 *
 * @module pipeline/policy
 */

import type { Policy, PolicyDecision, PolicyPort, PolicyRequest } from './types.js';

/** What a privilege gate needs from the host: the actor's privilege names here. */
export interface PrivilegeFacts {
	/**
	 * Resolves the actor's privilege names for this guild. Called per
	 * evaluation and never cached, so a privilege change applies on the
	 * next click. The platform's role IDs ride along when the interaction
	 * carried them, so list-based bindings stay cheap; absent guild (DMs)
	 * still resolves: the host decides what privileges mean there.
	 */
	privileges(actorId: string, guildId: string | undefined, roleIds?: readonly string[]): Promise<readonly string[]>;
}

/** Options for a gate that denies: the copy shown instead of the generic one. */
export interface PolicyOptions {
	readonly deny?: string;
}

/**
 * The policy vocabulary. Every value is inert data; nothing here asks a
 * question. See {@link Policy} for the shape.
 */
export const policy = {
	/** Passes only for the session's owner. Vacuously false on door requests (no session exists yet). */
	owner(options?: PolicyOptions): Policy {
		return { kind: 'owner', ...(options?.deny !== undefined ? { denyMessage: options.deny } : {}) };
	},
	/** Passes for actors holding this privilege, as the host's facts resolve it. */
	privilege(name: string, options?: PolicyOptions): Policy {
		return { kind: 'privilege', name, ...(options?.deny !== undefined ? { denyMessage: options.deny } : {}) };
	},
	/** Passes when at least one sub-policy passes. */
	any(...of: Policy[]): Policy {
		return { kind: 'any', of };
	},
	/** Passes only when every sub-policy passes. */
	all(...of: Policy[]): Policy {
		return { kind: 'all', of };
	},
	/** Never passes. */
	deny(options?: PolicyOptions): Policy {
		return { kind: 'deny', ...(options?.deny !== undefined ? { denyMessage: options.deny } : {}) };
	},
	/** Always passes: a control's escape hatch out of its flow's gate. */
	allow(): Policy {
		return { kind: 'allow' };
	},
};

/**
 * Builds the shipped engine: nearest policy wins (a control's gate
 * replaces the flow's gate), ungated means allowed, and a failing facts
 * lookup denies with the generic copy (fail-closed).
 *
 * @param facts The one host fact: the actor's privilege names here.
 * @returns A `PolicyPort` wiring the vocabulary to the facts.
 */
export function createDefaultPolicyEngine(facts: PrivilegeFacts): PolicyPort {
	return {
		async authorize(request: PolicyRequest): Promise<PolicyDecision> {
			const gate = request.actionPolicy ?? request.flowPolicy;
			if (gate === undefined) return { allowed: true };
			return evaluate(gate, request, facts);
		},
	};
}

/** Whether this options object is a custom port (authorize) rather than facts (privileges). */
export function isPolicyPort(value: unknown): value is PolicyPort {
	return typeof value === 'object' && value !== null && 'authorize' in value;
}

async function evaluate(gate: Policy, request: PolicyRequest, facts: PrivilegeFacts): Promise<PolicyDecision> {
	switch (gate.kind) {
		case 'allow':
			return { allowed: true };
		case 'deny':
			return denied(gate);
		case 'owner':
			return settle(request.ownerId !== undefined && request.actorId === request.ownerId, gate);
		case 'privilege': {
			let held: readonly string[];
			try {
				held = await facts.privileges(request.actorId, request.guildId, request.actorRoleIds);
			} catch (error) {
				// Fail-closed: an unavailable fact source denies with the
				// generic copy, and the host sees the reason in its log.
				console.error('[fluxcord] policy facts lookup failed:', error);
				return { allowed: false };
			}
			return settle(held.includes(gate.name), gate);
		}
		case 'any': {
			for (const sub of gate.of) {
				if ((await evaluate(sub, request, facts)).allowed) return settle(true, gate);
			}
			return settle(false, gate);
		}
		case 'all': {
			for (const sub of gate.of) {
				if (!(await evaluate(sub, request, facts)).allowed) return settle(false, gate);
			}
			return settle(true, gate);
		}
	}
}

function settle(ok: boolean, gate: { readonly denyMessage?: string }): PolicyDecision {
	if (ok) return { allowed: true };
	return denied(gate);
}

function denied(gate: { readonly denyMessage?: string }): PolicyDecision {
	return gate.denyMessage !== undefined ? { allowed: false, denyMessage: gate.denyMessage } : { allowed: false };
}

/** Whether the clicker is the session's owner. */
export function isOwner(request: PolicyRequest): boolean {
	return request.ownerId !== undefined && request.actorId === request.ownerId;
}

/** Whether the clicker holds one role. */
export function hasRole(request: PolicyRequest, roleId: string): boolean {
	return request.actorRoleIds?.includes(roleId) ?? false;
}

/** Whether the clicker holds any of the given roles. */
export function hasAnyRole(request: PolicyRequest, roleIds: readonly string[]): boolean {
	return roleIds.some(roleId => hasRole(request, roleId));
}
