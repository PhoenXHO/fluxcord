/**
 * action(): author a named, module-level action handler.
 *
 * The same deal screen()/subview() give views, for handlers: the slice is
 * the handler's own declaration, the event arrives contextually typed
 * (mutate's bag, the ui toolkit, the kind fork), and the product is the
 * plain function controls bind by identity: one function object, hashed
 * as its own wire id. Runtime is a pass-through (all value is at the type
 * level); authors never name {@link ActionHandler} or {@link ActionEvent}.
 * For arrows local to a view, the kit's handler() does the same job in
 * place.
 *
 * @module pipeline/action
 */

import type { ActionEvent, ActionHandler } from './types.js';

export function action<TData>(): <TKeys extends string = string>(
	run: (event: ActionEvent<TData, TKeys>) => void | Promise<void>,
) => ActionHandler<TData, TKeys> {
	return (run) => {
		if (typeof run !== 'function') {
			throw new Error("action: 'run' must be a function: (event) => void");
		}
		return run;
	};
}
