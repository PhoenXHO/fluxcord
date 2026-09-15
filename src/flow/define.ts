/**
 * The flow definition.
 *
 * Pure: runs once at module load, returns a frozen `FlowDefinition`,
 * touches no registry (registration is the manifest loader's job). The
 * shape it builds:
 *
 * ```plaintext
 *   own screens     -> kept as-is, ids validated
 *   components      -> composed, later entries wrapping earlier output
 *   subflow plugs   -> screens namespaced '<at>.<screen>', slot paths
 *                      rebased onto the plug key, roots reachable via
 *                      ui.go('<at>'); the plug's done handler is bound
 *                      by the parent's views like any other control, and
 *                      drawing the view registers it
 * ```
 *
 * There is no action declaration anywhere: controls bind their handlers
 * by identity, and what the engine last drew is the whole registry.
 *
 * A plugged subflow brings screens, a slot, and done. Never a lifecycle:
 * one session, one TTL, one wrap, and that wrap is the PARENT's (the
 * subflow's own components apply only when it is mounted directly).
 *
 * @module flow/define
 */

import { navigateBack } from '../commit/ui.js';
import type { ActionHandler, UiToolkit } from '../pipeline/types.js';
import { DEFAULT_TTL_MS } from '../state/types.js';
import { normalizeViewRoot } from '../tree/normalize.js';
import type { ComponentResult } from '../tree/types.js';
import type { Screen, FlowDefinition, FlowOptions, SubflowPlug } from './types.js';

// used in docs
/* eslint-disable @typescript-eslint/no-unused-vars */
import { flow } from './token.js';
/* eslint-enable */

/** The typed authoring shape {@link subflow} receives; `TSub` rides on `use`. */
export interface SubflowSpec<TSub> {
	/** The subflow's definition (`flow.definition` for an authored flow). */
	readonly use: FlowDefinition<TSub>;
	/** The plug key: its screens land as `'<at>.<screen>'`, and `ui.go('<at>')` opens it. */
	readonly at: string;
	/** Runs when the subflow closes via its done button; receives the subflow's final state. */
	readonly onDone?: (state: TSub, ui: UiToolkit) => void;
}

/** Screen ids and subflow keys must survive the customId codec; '.' is the namespace separator. */
const BANNED_ID_CHARS = /[:/#~]/;

function assertId(kind: string, id: string): void {
	if (id.length === 0) throw new Error(`defineFlow: ${kind} must not be empty`);
	if (BANNED_ID_CHARS.test(id)) {
		throw new Error(`defineFlow: ${kind} '${id}' must not contain ':', '/' or '~'`);
	}
	if (id.includes('.')) {
		throw new Error(`defineFlow: ${kind} '${id}' must not contain '.' (the subflow namespace separator)`);
	}
}

/**
 * Builds a flow definition: validates screen ids, composes the wrap
 * chain, namespaces subflow plugs. Pure; runs once at module load and
 * returns a frozen definition.
 *
 * Most flows are declared with {@link flow} (same options, plus the bare
 * name and registration facts). `defineFlow` is the tool for definitions
 * built without the `flow` wrapper: subflow libraries and the like.
 *
 * @param options Screens, `first`, `initialData`, and the optional pieces.
 * @returns The frozen definition a flow or subflow plug carries.
 * @throws On an invalid screen id, a non-finite `ttlMs`, or a subflow key
 *   collision.
 */
export function defineFlow<TData, const TScreens extends string = string>(
	options: FlowOptions<TData, TScreens>,
): FlowDefinition<TData> {
	// Own screens: ids validated. Handlers live in the views, so there is
	// no second declaration to keep in sync.
	const screens: Record<string, Screen<TData>> = {};
	for (const [id, screen] of Object.entries(options.screens as Record<string, Screen<TData>>)) {
		assertId('screen id', id);
		screens[id] = screen;
	}

	// Components compose left to right: later entries wrap earlier
	// entries' output. Each link returns the element union (TSX views
	// type flat), so the fold back to a view node runs between links and
	// every component receives a real view tree. No components, no wrap
	// field.
	let wrap: FlowDefinition<TData>['wrap'];
	for (const component of options.components ?? []) {
		const previous = wrap;
		wrap = previous === undefined
			? component
			: (tree, session): ComponentResult => component(normalizeViewRoot(previous(tree, session)), session);
	}

	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
		throw new Error(`defineFlow: ttlMs must be a finite positive number of milliseconds (got ${ttlMs})`);
	}

	// Subflow plugs: namespace the screens, rebase slot paths.
	const slots: Record<string, readonly string[]> = {};
	for (const id of Object.keys(screens)) slots[id] = [];
	const roots: Record<string, string> = {};

	for (const plug of options.subflows ?? []) {
		const { use: def, at } = plug;
		assertId('subflow key', at);
		if (at in roots) throw new Error(`defineFlow: two subflows are plugged at '${at}' (one plug per key)`);
		if (at in screens) throw new Error(`defineFlow: subflow key '${at}' collides with own screen '${at}'`);
		roots[at] = `${at}.${def.first}`;
		for (const [innerRoot, entry] of Object.entries(def.roots)) {
			roots[innerRoot] = `${at}.${entry}`;
		}
		for (const id of def.screenIds) {
			const key = `${at}.${id}`;
			if (key in screens) throw new Error(`defineFlow: namespaced screen '${key}' already exists`);
			screens[key] = def.screens[id] as Screen<TData>;
			slots[key] = [at, ...def.slots[id]];
		}
	}

	const definition: FlowDefinition<TData> = {
		screenIds: Object.keys(screens),
		first: options.first,
		// Carried as-is: the freeze below locks the definition's fields,
		// never the bag itself. Sessions mutate their per-mount clones.
		initialData: options.initialData,
		screens: Object.freeze(screens),
		...(wrap !== undefined ? { wrap } : {}),
		slots: Object.freeze(slots),
		roots: Object.freeze(roots),
		ttlMs,
		remount: options.remount ?? 'replace',
		...(options.parting !== undefined ? { parting: options.parting } : {}),
		...(options.onError !== undefined ? { onError: options.onError } : {}),
		...(options.rehydrate !== undefined ? { rehydrate: options.rehydrate } : {}),
	};
	return Object.freeze(definition);
}

/**
 * Builds a `SubflowPlug`. The subflow's data type is inferred from its
 * definition, so `onDone`'s `state` comes out fully typed with no
 * annotations at the call site. The returned `done` is one function
 * object: bind it in parent views with `button({ onClick: plug.done })`,
 * and drawing the view registers it.
 */
export function subflow<TSub>(spec: SubflowSpec<TSub>): SubflowPlug {
	const done: ActionHandler = (event) => {
		// On subflow screens the session arrives lensed to the slot, so
		// event.session.data is the subflow's state, captured before the
		// pop. (The never-typed param is the erase; the runtime value is
		// the slot's.)
		const state = event.session.data;
		navigateBack(event.session);
		spec.onDone?.(state as never, event.ui);
	};
	return { use: spec.use, at: spec.at, done };
}
