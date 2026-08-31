/**
 * Command harvest: the read side of the ownership tree.
 *
 * Turns a module's uiCommands into flow registrations: each leaf's flow,
 * carrying the invocation path ('sync', 'lotto start') as its parting-hint
 * default. Pure and structural; the loader feeds it real modules, tests
 * feed it fixtures; neither touches the other's registries.
 *
 * @module command/harvest
 */

import type { FlowRegistration } from '../boot/build.js';
import type { FlowToken } from '../flow/token.js';
import { commandLeaves } from './declare.js';
import type { CommandToken } from './declare.js';

/** The module fields the harvest reads: structural, so plain fixtures work. */
export interface FlowSourceModule {
	readonly name: string;
	readonly uiFlows?: readonly FlowToken[];
	readonly uiCommands?: readonly CommandToken[];
}

/**
 * One module's flow registrations: every uiCommand leaf's flow (each
 * carrying its invocation path as the parting-hint default) plus the
 * manifest's uiFlows. A flow mounted by a command AND listed in uiFlows
 * throws here: one home per flow.
 */
export function moduleFlowRegistrations(mod: FlowSourceModule): FlowRegistration[] {
	const registrations: FlowRegistration[] = [];
	const mounted = new Set<FlowToken>();
	for (const command of mod.uiCommands ?? []) {
		for (const { leaf, commandHint } of commandLeaves(command)) {
			mounted.add(leaf.flow);
			registrations.push({ module: mod.name, token: leaf.flow, commandHint });
		}
	}
	for (const token of mod.uiFlows ?? []) {
		if (mounted.has(token)) {
			throw new Error(
				`Module '${mod.name}' registers flow '${token.id}' twice: once in uiFlows and once mounted by a uiCommand. Pick one home.`,
			);
		}
		registrations.push({ module: mod.name, token });
	}
	return registrations;
}
