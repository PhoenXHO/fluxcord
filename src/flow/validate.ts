/**
 * Cross-flow validation: every screen belongs to exactly one flow.
 * 
 * Pure: takes the flows about to be registered and throws on the first
 * duplicate screen key. The manifest loader calls this at boot, before
 * any session can be born into an ambiguous registry.
 *
 * @module flow/validate
 */

import type { FlowDefinition } from './types.js';

/** One flow on its way into the screen registry. */
export interface RegisteredFlow {
	/** The module the flow's screens register under (registry key prefix). */
	readonly moduleId: string;
	/** Human label for error messages: the flow's manifest name when known. */
	readonly flowId?: string;
	readonly definition: FlowDefinition;
}

/**
 * Validates the flows' screen keys: every screen must be declared by
 * exactly one flow.
 *
 * @throws When a screen key is declared by more than one flow.
 */
export function validateFlows(flows: readonly RegisteredFlow[]): void {
	const owners = new Map<string, string>();
	for (const { moduleId, flowId, definition } of flows) {
		const label = flowId ?? moduleId;
		for (const id of definition.screenIds) {
			const key = `${moduleId}/${id}`;
			const owner = owners.get(key);
			if (owner !== undefined) {
				throw new Error(`validateFlows: screen '${key}' is declared by both '${owner}' and '${label}' (every screen belongs to exactly one flow)`);
			}
			owners.set(key, label);
		}
	}
}
