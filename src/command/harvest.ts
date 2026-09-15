/**
 * Command harvest: the read side of the ownership tree.
 *
 * Turns a module's commands into flow registrations: each leaf's flow,
 * carrying the invocation path (`'sync'`, `'lotto start'`) as its parting-hint
 * default. Pure and structural; the loader feeds it real modules, tests
 * feed it fixtures; neither touches the other's registries.
 *
 * @module command/harvest
 */

import type { FlowRegistration } from '../boot/build.js';
import type { Flow } from '../flow/token.js';
import { commandLeaves } from './declare.js';
import type { Command } from './declare.js';

/** The module fields the harvest reads: structural, so plain fixtures work. */
export interface FlowSourceModule {
	readonly name: string;
	readonly flows?: readonly Flow[];
	readonly commands?: readonly Command[];
}

/**
 * One module's flow registrations: every command leaf's flow (each
 * carrying its invocation path as the parting-hint default) plus the
 * manifest's flows. A flow mounted by a command AND listed in `flows`
 * throws here: one home per flow.
 */
export function moduleFlowRegistrations(mod: FlowSourceModule): FlowRegistration[] {
	const registrations: FlowRegistration[] = [];
	const mounted = new Set<Flow>();
	for (const command of mod.commands ?? []) {
		for (const { leaf, commandHint } of commandLeaves(command)) {
			mounted.add(leaf.flow);
			registrations.push({ module: mod.name, flow: leaf.flow, commandHint });
		}
	}
	for (const flow of mod.flows ?? []) {
		if (mounted.has(flow)) {
			throw new Error(
				`Module '${mod.name}' registers flow '${flow.id}' twice: once in flows and once mounted by a command. Pick one home.`,
			);
		}
		registrations.push({ module: mod.name, flow });
	}
	return registrations;
}
