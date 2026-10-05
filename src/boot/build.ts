/**
 * Boot build: authored flows become the runtime catalog.
 *
 * This is where module identity meets the authored flow name: the full id
 * `'<module>/<name>'` is assembled here, once, so no author ever hand-types a
 * prefix that can lie about its home. The duplicate flowId throw guards the
 * lookups. The module loader calls this once at boot; the runtime consumes
 * the result, immutable from then on.
 *
 * @module boot/build
 */

import type { Flow, MountToken } from '../flow/token.js';

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
	/**
	 * The revive index, keyed by `flowId`: revive resolves rehydrate rows
	 * through it, and dead-session parting resolves the wire key's flowId.
	 */
	readonly byFlowId: ReadonlyMap<string, MountToken>;
	/**
	 * The door map, authored flow -> its runtime twin: `mount` resolves the
	 * flow a command holds (or the host mounts) through this.
	 */
	readonly byToken: ReadonlyMap<object, MountToken>;
}

/**
 * Assembles the catalog from module registrations: builds each flow's
 * runtime twin (full id, module prefix, parting hint) and indexes the
 * result both by flow id and by authored flow.
 *
 * @param registrations One entry per authored flow, harvested from the
 *   modules' `flow`s and `command`s.
 * @returns The catalog the runtime consumes; immutable from then on.
 * @throws When two flows land on the same full id.
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
	const byFlowId = new Map<string, MountToken>();
	const byToken = new Map<object, MountToken>();
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (byFlowId.has(token.flowId)) {
			throw new Error(`buildFlowCatalog: flow id '${token.flowId}' is declared twice`);
		}
		byFlowId.set(token.flowId, token);
		byToken.set(registrations[i].flow, token);
	}
	return { tokens, byFlowId, byToken };
}
