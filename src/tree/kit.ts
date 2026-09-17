/**
 * The screen kit, the flow-typed controls bundle a view receives as its
 * second parameter.
 *
 * Tree nodes are flow-agnostic (their handler slots are never-erased), so a
 * builder call site cannot know the flow's data or screen keys. The kit is
 * the bridge: `screen()` factories hand views a kit parameterized by the
 * flow's assembled types, and its builders type the handler slots contextually.
 *
 * The controls are named as components (uppercase) because in TSX they
 * ARE components, destructured from the kit parameter, `<Button/>` and
 * `<Select/>` carry their flow typing into the tags. Lowercase
 * handler-carrying intrinsics do not exist: layout tags are intrinsics,
 * controls are kit members, one way each.
 *
 * The kit produces the SAME nodes the global builders produce; only the
 * accepted props are narrowed. At draw time the commit phase passes the
 * erased {@link runtimeKit}: the global builders themselves.
 *
 * @module tree/kit
 */

import type { ActionHandler } from '../pipeline/types.js';
import { button, entitySelect, optionSelect } from './builders.js';
import type { ButtonNode, SelectNode, TextChild } from './types.js';
import type { ButtonProps, EntitySelectProps, OptionSelectProps } from './builders.js';

/**
 * Button props with the handler slot narrowed to the flow's types. The
 * label rides the `label` prop or the JSX children (`<Button>Go</Button>`),
 * exactly like the underlying builder.
 */
export type KitButtonProps<TData, TKeys extends string> = Omit<ButtonProps, 'onClick'>
	& { readonly onClick: ActionHandler<TData, TKeys>; readonly children?: unknown };

/**
 * Union of select props with the handler slot narrowed to the flow's types:
 * `options` for a static list, `entity` for a Discord entity source. The
 * runtime kit routes on entity presence; passing both is an author mistake
 * it throws on at construction.
 */
export type KitSelectProps<TData, TKeys extends string> = (Omit<OptionSelectProps, 'onSelect'> | Omit<EntitySelectProps, 'onSelect'>)
	& { readonly onSelect: ActionHandler<TData, TKeys> };

/**
 * The flow-typed controls a view receives as its second parameter:
 * `Button`, `Select` and `handler`. Mainly a type-level bridge: the
 * nodes it builds are the plain builders' output, only the handler
 * slots are narrowed to the flow's data and screen keys.
 */
export interface ScreenKit<TData = unknown, TKeys extends string = string> {
	/** The flow-typed button builder. */
	Button(props: KitButtonProps<TData, TKeys>): ButtonNode;
	/** One select, two shapes: `options` (static list) or `entity` (Discord entity source). */
	Select(props: KitSelectProps<TData, TKeys>): SelectNode;
	/**
	 * Typing identity: puts a handler arrow in an argument slot, so
	 * view-local factories get full contextual typing with no annotations.
	 */
	handler(slot: { readonly run: ActionHandler<TData, TKeys> }): ActionHandler;
}

// Button, Select and handler are written as methods on purpose. Method
// syntax makes TypeScript compare them more loosely, so a kit built for the
// flow's whole data bag can also be passed to a screen that only works with
// a smaller piece of it. Writing them as arrow properties would turn that
// into a compile error.

/**
 * The erased kit the pipeline passes at draw time. `Button` and `Select`
 * are thin adapters over the global builders: components receive their
 * JSX children inside the props object, so `Button` lifts them out into
 * the builder's rest args before delegating.
 */
export const runtimeKit: ScreenKit = {
	Button: (props) => {
		const { children, ...rest } = props as { readonly children?: unknown };
		// JSX hands a single child through bare and multiple children as an
		// array; either way the builder's rest args want a flat list.
		const kids: readonly unknown[] = children === undefined || children === null
			? []
			: Array.isArray(children) ? children : [children];
		return button(rest as ButtonProps, ...(kids as readonly TextChild[]));
	},
	Select: (props) => {
		// The props union lets an author pass both `options` and `entity`:
		// when an object literal is checked against a union, a property
		// known to any member is accepted. The mistake is caught here, at
		// construction, instead of waiting for validation at draw time.
		const { options, entity, children } = props as { readonly options?: unknown; readonly entity?: unknown; readonly children?: unknown };
		if (options !== undefined && entity !== undefined) {
			throw new Error('a select takes either options or entity, never both');
		}
		if (children !== undefined && children !== null) {
			throw new Error('a select takes no children; options ride the options prop');
		}
		return entity !== undefined
			? entitySelect(props as EntitySelectProps)
			: optionSelect(props as OptionSelectProps);
	},
	handler: ({ run }) => run,
};
