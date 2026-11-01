/**
 * The flow registry: every flow that exists, by the name it was declared
 * with.
 *
 * `flow()` registers into it the moment a flow is created, so there is no
 * list to keep honest: a flow that exists is a flow the runtime can mount,
 * call, revive from a rehydrate row, and find again from the id on a
 * button after a restart. Names are global, so a duplicate fails at
 * creation, loudly, at the second declaration.
 *
 * Only `flow()` and `command()` write here. The runtime reads.
 *
 * @module flow/registry
 */

import type { Flow, MountToken } from './token.js';

const byId = new Map<string, MountToken>();
const byFlow = new Map<object, MountToken>();

/**
 * Registers a freshly declared flow under its name.
 *
 * @throws When another flow already holds the name.
 */
export function registerFlow(flow: Flow, token: MountToken): void {
	if (byId.has(token.flowId)) {
		throw new Error(`flow: the name '${token.flowId}' is already declared by another flow; flow names are global, so give one of them a distinct name`);
	}
	byId.set(token.flowId, token);
	byFlow.set(flow, token);
}

/** The runtime twin of a declared flow; undefined for anything `flow()` did not make. */
export function tokenOf(flow: object): MountToken | undefined {
	return byFlow.get(flow);
}

/** The flow declared under this name, as the id on a button or a rehydrate row carries it. */
export function tokenById(flowId: string): MountToken | undefined {
	return byId.get(flowId);
}

/** The live index by flow id: revive and dead-session parting resolve through it. */
export const flowIndex: ReadonlyMap<string, MountToken> = byId;

/** Every flow declared so far, in declaration order. */
export function flowTokens(): readonly MountToken[] {
	return [...byId.values()];
}

/**
 * Records the command line that mounts a flow (`'sync'`, `'lotto start'`):
 * its default parting hint. A flow mounted by several commands keeps the
 * first one declared.
 */
export function setCommandHint(flow: object, commandHint: string): void {
	const token = byFlow.get(flow);
	if (token === undefined) {
		throw new Error(`command '${commandHint}': mounts something that is not a flow made by flow()`);
	}
	token.commandHint ??= commandHint;
}

/** Forgets every flow. For tests that declare flows of the same name in several cases; an app never calls it. */
export function resetFlowRegistry(): void {
	byId.clear();
	byFlow.clear();
}
