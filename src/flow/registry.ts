/**
 * Registry population: turns `FlowDefinitions` into `RegisteredScreen`
 * entries.
 *
 * `defineFlow` erases author types at the definition boundary using
 * never-parameterized shapes (any author TData fits), while the
 * pipeline's `RegisteredScreen` and `FlowContext` speak
 * unknown-parameterized shapes. The two forms are the same runtime
 * objects but are not statically comparable in both directions, so
 * this module is the one place the never -> unknown cast happens.
 * Every cast below is that single boundary.
 *
 * Entries carry only what the pipeline consults per screen: the view,
 * the subflow slot, and the flow's `wrap`/`roots`/`parting`/`onError`.
 * Handlers are not declared here: drawing the view registers them.
 *
 * The manifest loader consumes this; tests use it to build honest
 * registries without hand-casting.
 *
 * @module flow/registry
 */

import type { FlowContext, RegisteredScreen, ScreenRegistry } from '../pipeline/types.js';
import type { FlowDefinition } from './types.js';

/** The flow-level facts every screen of this flow carries. */
function flowContextOf(definition: FlowDefinition, commandHint?: string): FlowContext {
	return {
		...(definition.wrap !== undefined ? { wrap: definition.wrap as FlowContext['wrap'] } : {}),
		roots: definition.roots,
		...(definition.parting !== undefined ? { parting: definition.parting } : {}),
		...(definition.onError !== undefined ? { onError: definition.onError } : {}),
		...(commandHint !== undefined ? { commandHint } : {}),
	};
}

/**
 * Builds the registry entries for one flow: keys `'<moduleId>/<screenId>'`,
 * each screen carrying its slot path and the flow facts. The command hint
 * (the mounting command's invocation path) rides the same slice; it is
 * the flow's default parting hint.
 */
export function screenEntries(moduleId: string, definition: FlowDefinition, commandHint?: string): Readonly<Record<string, RegisteredScreen>> {
	const flow = flowContextOf(definition, commandHint);
	const entries: Record<string, RegisteredScreen> = {};
	for (const id of definition.screenIds) {
		const slot = definition.slots[id];
		entries[`${moduleId}/${id}`] = {
			view: definition.screens[id].view as RegisteredScreen['view'],
			...(slot.length > 0 ? { slot } : {}),
			flow,
		};
	}
	return entries;
}

/** Wraps entry maps into the ScreenRegistry the pipeline expects. */
export function asScreenRegistry(entries: Readonly<Record<string, RegisteredScreen>>): ScreenRegistry {
	return {
		resolve(viewKey: string): RegisteredScreen | undefined {
			return entries[viewKey];
		},
	};
}
