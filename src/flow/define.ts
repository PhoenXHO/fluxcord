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
 * ```
 *
 * There is no action declaration anywhere: controls bind their handlers
 * by identity, and what the engine last drew is the whole registry.
 *
 * @module flow/define
 */

import { DEFAULT_TTL_MS } from '../state/types.js';
import { normalizeViewRoot } from '../tree/normalize.js';
import type { ComponentResult } from '../tree/types.js';
import type { Screen, FlowDefinition, FlowOptions } from './types.js';

// used in docs
/* eslint-disable @typescript-eslint/no-unused-vars */
import { flow } from './token.js';
/* eslint-enable */

/** Screen ids must survive the customId codec, which reserves ':', '#' and '~'. */
const BANNED_ID_CHARS = /[:/#~]/;

function assertId(kind: string, id: string): void {
	if (id.length === 0) throw new Error(`defineFlow: ${kind} must not be empty`);
	if (BANNED_ID_CHARS.test(id)) {
		throw new Error(`defineFlow: ${kind} '${id}' must not contain ':', '/' or '~'`);
	}
}

/**
 * Builds a flow definition: validates screen ids and composes the wrap
 * chain. Pure; runs once at module load and returns a frozen definition.
 *
 * Most flows are declared with {@link flow} (same options, plus the bare
 * name and registration facts). `defineFlow` is the tool for definitions
 * built without the `flow` wrapper.
 *
 * @param options Screens, `first`, `initialData`, and the optional pieces.
 * @returns The frozen definition a flow carries.
 * @throws On an invalid screen id or an invalid `ttlMs`.
 */
export function defineFlow<TData = void, const TScreens extends string = string>(
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
			: (tree, session, kit): ComponentResult =>
				component(normalizeViewRoot(previous(tree, session, kit)), session, kit);
	}

	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	if (Number.isNaN(ttlMs) || ttlMs <= 0) {
		throw new Error(`defineFlow: ttlMs must be a positive number of milliseconds, or Infinity to never expire (got ${String(ttlMs)})`);
	}

	const definition: FlowDefinition<TData> = {
		screenIds: Object.keys(screens),
		first: options.first,
		// Carried as-is: the freeze below locks the definition's fields,
		// never the bag itself. Sessions mutate their per-mount clones.
		initialData: options.initialData,
		screens: Object.freeze(screens),
		...(wrap !== undefined ? { wrap } : {}),
		ttlMs,
		remount: options.remount ?? 'replace',
		...(options.parting !== undefined ? { parting: options.parting } : {}),
		...(options.onError !== undefined ? { onError: options.onError } : {}),
		...(options.rehydrate !== undefined ? { rehydrate: options.rehydrate } : {}),
	};
	return Object.freeze(definition);
}

/**
 * Resolves the flow's entry screen: a resolver `first` runs on the
 * session's seed, so a state-dependent landing screen is decided before
 * any draw exists. Validates the result against the screens map either
 * way; a key naming no screen throws at birth.
 *
 * @param definition The flow's definition.
 * @param data The session's seeded bag (initialData, a rehydrated bag, or
 *   the call's cloned args).
 * @returns The screen id the session opens at.
 */
export function entryScreen(definition: FlowDefinition, data: unknown): string {
	// The erased definition types the resolver's parameter as never; the
	// seed crossing this boundary is the definition-boundary erase.
	const key = typeof definition.first === 'function'
		? (definition.first as (d: unknown) => string)(data)
		: definition.first;
	if (definition.screens[key] === undefined) {
		throw new Error(`entryScreen: the flow's first resolved to '${key}', which is no screen of this flow (screens: ${definition.screenIds.join(', ')})`);
	}
	return key;
}
