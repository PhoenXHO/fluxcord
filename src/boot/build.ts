/**
 * Boot build: authored flows become the runtime catalog.
 *
 * This is where module identity meets the authored flow name: the full id
 * `'<module>/<name>'` is assembled here, once, so no author ever hand-types a
 * prefix that can lie about its home. Then validateFlows (every screen key
 * in exactly one flow), the duplicate flowId throw, the screen-registry
 * entries and the lookups. The module loader calls this once at boot; the
 * runtime consumes the result, immutable from then on.
 *
 * @module boot/build
 */

import { screenEntries } from '../flow/registry.js';
import { validateFlows } from '../flow/validate.js';
import type { Flow, MountToken } from '../flow/token.js';
import type { RegisteredScreen } from '../pipeline/types.js';

/** One module's contribution to the catalog: its name plus an authored flow. */
export interface FlowRegistration {
	/** The owning module: becomes the flow id's prefix and screen namespace. */
	readonly module: string;
	readonly flow: Flow;
	/**
	 * The mounting command's invocation path (`'sync'`, `'lotto start'`): set
	 * when this registration was harvested from a `command` leaf. Becomes
	 * the flow's default parting hint.
	 */
	readonly commandHint?: string;
}

/** The registration result the runtime (and boot validations) consume. */
export interface FlowCatalog {
	readonly tokens: readonly MountToken[];
	/** Screen entries keyed `'<moduleId>/<screenId>'`: the dispatch/commit registry. */
	readonly entries: Readonly<Record<string, RegisteredScreen>>;
	/** Keyed by `flowId`; mount's revive path resolves rows through this. */
	readonly byFlowId: ReadonlyMap<string, MountToken>;
	/** Authored flow -> its runtime twin; mount resolves the flow a command holds through this. */
	readonly byToken: ReadonlyMap<object, MountToken>;
}

/**
 * Assembles the catalog from module registrations: builds each flow's
 * runtime twin (full id, module prefix, parting hint), validates every
 * flow, and indexes the result both by flow id and by authored flow.
 *
 * @param registrations One entry per authored flow, harvested from the
 *   modules' `flow`s and `command`s.
 * @returns The catalog the runtime consumes; immutable from then on.
 * @throws When two flows land on the same full id, or a flow fails
 *   validation (screen keys, structure).
 */
export function buildFlowCatalog(registrations: readonly FlowRegistration[]): FlowCatalog {
	const tokens: MountToken[] = registrations.map(({ module, flow, commandHint }) =>
		Object.freeze({
			flowId: `${module}/${flow.id}`,
			moduleId: module,
			definition: flow.definition,
			...(flow.meta !== undefined ? { meta: flow.meta } : {}),
			...(commandHint !== undefined ? { commandHint } : {}),
		}),
	);
	validateFlows(tokens.map((token) => ({
		moduleId: token.moduleId,
		flowId: token.flowId,
		definition: token.definition,
	})));
	const byFlowId = new Map<string, MountToken>();
	const byToken = new Map<object, MountToken>();
	const entries: Record<string, RegisteredScreen> = {};
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (byFlowId.has(token.flowId)) {
			throw new Error(`buildFlowCatalog: flow id '${token.flowId}' is declared twice`);
		}
		byFlowId.set(token.flowId, token);
		byToken.set(registrations[i].flow, token);
		Object.assign(entries, screenEntries(token.moduleId, token.definition, token.commandHint));
	}
	return { tokens, entries, byFlowId, byToken };
}
