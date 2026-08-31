/**
 * Screens: the flow's view tree, the control builders, and the
 * registration machinery.
 *
 * The factory form is what lets screen keys stay inferred: the returned
 * function is generic over `TKeys`, and TypeScript solves `TKeys` from the
 * screens map's contextual type inside `defineFlow`. So a screen file
 * never names the flow, imports nothing from it, and still gets
 * compile-checked `ui.go()` targets and fully typed inline handlers via
 * the kit.
 *
 * `NoInfer` keeps the `go()` literals inside the view from feeding the
 * inference; only the map's property names decide `TKeys`.
 *
 * Each screen declares its own data slice, and the flow's bag must cover
 * every slice (contravariance makes the screens map the compile check).
 *
 * @module flow/screen
 */

import type { ScreenKit } from '../tree/kit.js';
import type { ComponentResult } from '../tree/types.js';
import type { AuthorScreen, DeepReadonly } from './types.js';

/**
 * Curried screen factory. The first call declares the screen's data
 * slice; the second receives the view. `TKeys` is solved from context when
 * the flow assembles its screens map, so a screen file never names the
 * flow it joins.
 */
export function screen<TData>(): <TKeys extends string>(
	view: (data: DeepReadonly<TData>, controls: ScreenKit<TData, NoInfer<TKeys>>) => ComponentResult,
) => AuthorScreen<TData, TKeys> {
	return (view) => {
		if (typeof view !== 'function') {
			throw new Error("screen: 'view' must be a function: (data, controls) => tree");
		}
		return Object.freeze({ view });
	};
}

/**
 * A typed view helper inside one screen. It gets the same contextual
 * typing `screen()` gives a view, as a standalone arrow. The slice is
 * the helper's own declaration, the kit arrives contextually, and the
 * product is the plain function a screen's view calls as
 * `helper(data, controls)`. At runtime it is a pass-through: all the
 * value is at the type level, so authors never name ScreenKit,
 * ComponentResult, or any other internal type.
 *
 * The kit is stringly keyed here (helpers live outside the flow's
 * assembly, where screen keys are solved), so navigate from the screen,
 * not the helper.
 */
export function subview<TData>(): (
	view: (data: DeepReadonly<TData>, controls: ScreenKit<TData>) => ComponentResult,
) => (data: DeepReadonly<TData>, controls: ScreenKit<TData>) => ComponentResult {
	return (view) => {
		if (typeof view !== 'function') {
			throw new Error("subview: 'view' must be a function: (data, controls) => tree");
		}
		return view;
	};
}
