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
 * accepted props are narrowed. The engine builds one erased kit per draw
 * with {@link kitFor}, so session-aware members (Back) bind the drawing
 * session's live history: a view never passes the session to a control.
 *
 * @module tree/kit
 */

import type { ViewSession } from '../flow/types.js';
import type { ActionHandler } from '../pipeline/types.js';
import { button, entityFlagOf, entitySelect, optionSelect } from './builders.js';
import type { ButtonNode, SelectNode, SelectOption, TextChild } from './types.js';
import type { ButtonProps, ButtonStyleFlags, EntitySelectProps, EntitySelectSource, OptionSelectProps, SelectEntityFlags } from './builders.js';
import { optionsFromChildren } from './jsx-runtime.js';

/**
 * Button props with the handler slot narrowed to the flow's types. The
 * label rides the `label` prop or the JSX children (`<Button>Go</Button>`),
 * exactly like the underlying builder.
 */
export type KitButtonProps<TData, TKeys extends string> = Omit<ButtonProps, 'onClick'>
	& { readonly onClick: ActionHandler<TData, TKeys>; readonly children?: unknown };

/** The static-list arm: `options` or `<option>` children, never both (runtime throw). */
type KitOptionSelectProps<TData, TKeys extends string> = Omit<OptionSelectProps, 'onSelect' | 'options'>
	& { readonly options?: readonly SelectOption[]; readonly onSelect: ActionHandler<TData, TKeys>; readonly children?: unknown };
/**
 * The entity-source arm: one bare flag picks the source. Children are
 * `never` here, so `<Select roles><option/></Select>` is a compile error:
 * an entity select has no static options to lift.
 */
type KitEntitySelectProps<TData, TKeys extends string> = Omit<SelectNode, 'kind' | 'options' | 'entity' | 'onSelect' | 'values'>
	& SelectEntityFlags & EntitySelectSource
	& { readonly onSelect: ActionHandler<TData, TKeys>; readonly children?: never };

/**
 * Union of select props with the handler slot narrowed to the flow's types:
 * `options` (or `<option>` children) for a static list, one entity flag for
 * a Discord entity source. The runtime kit routes on the resolved source;
 * passing both is an author mistake it throws on at construction.
 */
export type KitSelectProps<TData, TKeys extends string> = KitOptionSelectProps<TData, TKeys> | KitEntitySelectProps<TData, TKeys>;

/**
 * Props for the kit's {@link ScreenKit.Back Back}: the pre-nav seam, an
 * optional label, and the style flags. No session, no history, no
 * `disabled` prop: the engine supplies all three.
 */
export type KitBackProps<TData, TKeys extends string> = ButtonStyleFlags & {
	/**
	 * Runs BEFORE the built-in back nav, with the same event shape as any
	 * handler (in a plugged screen it sees the slot's lens, like the
	 * screen's buttons). Async-friendly; throwing from it cancels the
	 * nav, reported like any handler error. Read-only seam: leave the
	 * actual navigation to Back.
	 */
	readonly onLeave?: ActionHandler<TData, TKeys>;
	/** The face label. Defaults to 'Back'. */
	readonly label?: string;
};

/**
 * The flow-typed controls a view receives as its second parameter:
 * `Button`, `Select`, `Back` and `handler`. Mainly a type-level bridge:
 * the nodes it builds are the plain builders' output, only the handler
 * slots are narrowed to the flow's data and screen keys.
 */
export interface ScreenKit<TData = unknown, TKeys extends string = string> {
	/** The flow-typed button builder. */
	Button(props: KitButtonProps<TData, TKeys>): ButtonNode;
	/** One select, two shapes: `options` (or `<option>` children) for a static list, one entity flag (`roles`) for a Discord source. */
	Select(props: KitSelectProps<TData, TKeys>): SelectNode;
	/**
	 * The smart back button: one tag, no wiring. Disabled whenever the
	 * drawing session's history is empty, pops one entry on click. The
	 * disabled state is the engine's: props cannot override it.
	 */
	Back(props: KitBackProps<TData, TKeys>): ButtonNode;
	/**
	 * Typing identity: puts a handler arrow in an argument slot, so
	 * view-local factories get full contextual typing with no annotations.
	 */
	handler(slot: { readonly run: ActionHandler<TData, TKeys> }): ActionHandler;
}

// The controls are written as methods on purpose. Method syntax makes
// TypeScript compare them more loosely, so a kit built for the flow's whole
// data bag can also be passed to a screen that only works with a smaller
// piece of it. Writing them as arrow properties would turn that into a
// compile error.

/**
 * The erased kit for one draw. Session-blind members (`Button`, `Select`,
 * `handler`) are the thin adapters they always were; `Back` closes over
 * the drawing session's history, so it renders disabled on an entry
 * screen and generates its own pop handler. Views receive the product as
 * their second parameter; the slot-tagged variants come from the commit
 * phase's `screenKitAt`.
 */
export function kitFor(session: Pick<ViewSession, 'history'>): ScreenKit {
	return {
		Button: (props): ButtonNode => {
			const { children, ...rest } = props as { readonly children?: unknown };
			// JSX hands a single child through bare and multiple children as an
			// array; either way the builder's rest args want a flat list.
			const kids: readonly unknown[] = children === undefined || children === null
				? []
				: Array.isArray(children) ? children : [children];
			return button(rest as ButtonProps, ...(kids as readonly TextChild[]));
		},
		Select: (props): SelectNode => {
			// The props union lets an author pass both an options list and an
			// entity flag: when an object literal is checked against a union, a
			// property known to any member is accepted. The mistake is caught
			// here, at construction, instead of waiting for validation at draw.
			const raw = props as Record<string, unknown>;
			const kids = raw.children === undefined || raw.children === null
				? []
				: Array.isArray(raw.children) ? raw.children : [raw.children];
			const lifted = optionsFromChildren('Select', kids);
			const entity = entityFlagOf(raw);
			if (entity !== undefined && (raw.options !== undefined || lifted !== undefined)) {
				throw new Error('a select takes either options or entity, never both');
			}
			const rest: Record<string, unknown> = { ...raw };
			delete rest.children;
			if (entity !== undefined) {
				// The flag stays in: entitySelect resolves and strips it.
				return entitySelect(rest as EntitySelectProps);
			}
			delete rest.users;
			delete rest.roles;
			delete rest.channels;
			delete rest.mentionable;
			if (lifted !== undefined) {
				// Children append to the prop list rather than replacing it, so a
				// generated list can carry pinned `<option>` extras.
				rest.options = rest.options === undefined
					? lifted
					: [...(rest.options as readonly SelectOption[]), ...lifted];
			}
			return optionSelect(rest as OptionSelectProps);
		},
		Back: (props): ButtonNode => {
			const { onLeave, label, ...rest } = props as KitBackProps<unknown, string> & { readonly [key: string]: unknown };
			// One bare style flag defaults the face to secondary; the spread
			// order makes the author's flag win and the computed disabled
			// state final (props cannot re-enable an empty history).
			const hasFlag = rest.primary !== undefined || rest.secondary !== undefined
				|| rest.success !== undefined || rest.danger !== undefined;
			const run: ActionHandler = async (event) => {
				await onLeave?.(event);
				event.ui.back();
			};
			return button({
				...(hasFlag ? {} : { secondary: true }),
				...rest,
				label: label ?? 'Back',
				disabled: session.history.length === 0,
				onClick: run,
			} as ButtonProps);
		},
		handler: ({ run }) => run,
	};
}
