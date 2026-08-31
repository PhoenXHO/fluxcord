/**
 * The subflow lens: a live facade over one slot of the parent bag.
 *
 * Subflow screens and actions are authored on the subflow's own data
 * type; at runtime they receive the parent session with `data`
 * redirected to the bag path their screen owns (the registry slot).
 * Every other property (screen, history, nonce, identity) forwards to
 * the real session record, so navigation and diagnostics keep working
 * through the lens. This is what makes a subflow reusable across
 * different parent bags: it never sees the bag, only its room.
 *
 * @module flow/lens
 */

import type { Session } from '../state/types.js';

/**
 * Reads the value at a bag path. Returns undefined when any hop along
 * the way is missing or not an object. The author contract is to seed
 * the slot before navigating into it.
 */
export function getPath(root: unknown, path: readonly string[]): unknown {
	let current: unknown = root;
	for (const key of path) {
		if (typeof current !== 'object' || current === null) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

/**
 * Writes the value at a bag path, creating missing intermediate objects
 * as needed.
 * 
 * @throws When an intermediate hop holds a non-object value: that is an
 * authoring bug, and silently replacing it would eat data.
 */
export function setPath(root: unknown, path: readonly string[], value: unknown): void {
	if (path.length === 0) throw new Error('setPath: empty path');
	let current = root as Record<string, unknown>;
	for (const key of path.slice(0, -1)) {
		const next = current[key];
		if (typeof next !== 'object' || next === null) {
			if (next !== undefined) {
				throw new Error(`setPath: '${key}' holds a non-object; cannot descend`);
			}
			current[key] = {};
		}
		current = current[key] as Record<string, unknown>;
	}
	current[path[path.length - 1]] = value;
}

/**
 * Builds the lensed session: the same session, with `data` pointed at
 * the slot path. The cast is the one type-erase point; at runtime the
 * facade is fully live, and reads and writes land in the real bag.
 */
export function lensSession<TSub>(session: Session<unknown>, path: readonly string[]): Session<TSub> {
	return new Proxy(session, {
		get(target, property, receiver): unknown {
			if (property === 'data') return getPath(target.data, path);
			return Reflect.get(target, property, receiver);
		},
		set(target, property, value): boolean {
			if (property === 'data') {
				setPath(target.data, path, value);
				return true;
			}
			return Reflect.set(target, property, value);
		},
	}) as Session<TSub>;
}
