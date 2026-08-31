/**
 * JSX runtime. TSX authoring sugar over the node builders.
 *
 * tsconfig's automatic JSX settings (`jsx: "react-jsx"`, `jsxImportSource:
 * "fluxcord"`) make the compiler rewrite every tag into an import of this
 * module and a call to `jsx()`/`jsxs()`: `<view title="x"><text/></view>`
 * becomes `jsx('view', { title: 'x', children: jsx('text', { body: 'x' }) })`.
 * The factory maps tag names onto the builders and returns the same
 * deep-frozen trees the builders produce. `validateTree`, renderers and the
 * rest of the engine never know TSX exists.
 *
 * The import specifier resolves through the `package.json` `"exports"` map,
 * so every consumer lands on the right copy: the `"types"` and `"development"`
 * conditions point at src (`tsc`, `vitest`), `"default"` at dist.
 *
 * Children follow React's coercion rules, so the idioms TSX authors expect
 * just work: false/null/undefined drop (`{cond && <row/>}`), arrays flatten
 * arbitrarily deep (`.map()`, fragments, array-returning components), and
 * bare strings/numbers throw loudly.
 *
 * Tag vocabulary splits one way, with no overlap: layout and leaf kinds
 * are the intrinsics (view, text, row, container, link, modal, input);
 * none of them carries a handler. The handler-carrying controls (Button,
 * Select) exist only as screen-kit members (tree/kit):
 * a view destructures them from its kit parameter and uses them as
 * components (e.g., `<Button/>`) so their handler slots stay typed against the
 * flow's data and screen keys. The draw-time kit IS this module's builders
 * (runtimeKit), so kit elements produce the same trees intrinsics do.
 * Uppercase tags in general are components.
 *
 * @module tree/jsx-runtime
 */

import {
	container,
	input,
	link,
	modal,
	row,
	text,
	view,
} from './builders.js';
import type {
	ContainerProps,
	InputProps,
	LinkProps,
	ModalProps,
	RowProps,
	TextProps,
	ViewProps,
} from './builders.js';
import type {
	ComponentResult,
	ContainerChild,
	ContainerNode,
	ControlNode,
	InputNode,
	LinkNode,
	ModalChild,
	ModalNode,
	RowNode,
	TextNode,
	TreeNode,
	ViewChild,
	ViewNode,
} from './types.js';
import { coerceChildren } from './normalize.js';

/** The element union lives with the tree types; re-exported for TSX authors. */
export type { ComponentResult };

/**
 * The fragment tag (`<>...</>`). Declared as a function because the compiler
 * requires a callable fragment factory, but it never runs. `jsx()` intercepts
 * it by identity and returns its coerced children as an array, which the
 * parent's coercion splices flat.
 */
export function Fragment(props: { readonly children?: unknown }): readonly TreeNode[] {
	void props;
	throw new Error('Fragment is a splicing marker. jsx() intercepts it by identity; it never runs');
}

export function jsx(tag: 'view', props: ViewProps & { readonly children?: unknown } | null): ViewNode;
export function jsx(tag: 'text', props: TextProps | null): TextNode;
export function jsx(tag: 'row', props: RowProps & { readonly children?: unknown } | null): RowNode;
export function jsx(tag: 'container', props: ContainerProps & { readonly children?: unknown } | null): ContainerNode;
export function jsx(tag: 'link', props: LinkProps | null): LinkNode;
export function jsx(tag: 'modal', props: ModalProps & { readonly children?: unknown } | null): ModalNode;
export function jsx(tag: 'input', props: InputProps | null): InputNode;
export function jsx(type: typeof Fragment, props: { readonly children?: unknown } | null): readonly TreeNode[];
export function jsx<P extends object, T extends ComponentResult>(type: (props: P) => T, props: P | null): T;
export function jsx(type: unknown, props: unknown): TreeNode | readonly TreeNode[] {
	if (typeof type === 'function' && type !== Fragment) {
		return callComponent(type as (props: unknown) => unknown, bareProps(props));
	}
	const { node, children } = splitProps(props);
	if (type === Fragment) {
		return children;
	}
	switch (type) {
		case 'view':
			return view(node as ViewProps, ...children as readonly ViewChild[]);
		case 'text':
			return text(node as TextProps);
		case 'row':
			return row(node as RowProps, ...children as readonly ControlNode[]);
		case 'container':
			return container(node as ContainerProps, ...children as readonly ContainerChild[]);
		case 'link':
			return link(node as LinkProps);
		case 'modal':
			return modal(node as ModalProps, ...children as readonly ModalChild[]);
		case 'input':
			return input(node as InputProps);
		default:
			throw new Error(`jsx: unknown tag '${String(type)}'`);
	}
}

/** The compiler emits jsxs for elements with statically multiple children; the shape is the same. */
export const jsxs: typeof jsx = jsx;

/**
 * The dev transform vite applies in vitest calls this variant with React's
 * dev-tool arguments (key, isStaticChildren, source, self): the factory
 * ignores them; children live in props either way.
 */
export function jsxDEV(
	type: unknown,
	props: unknown,
	_key?: unknown,
	_isStaticChildren?: boolean,
	_source?: unknown,
	_self?: unknown,
): TreeNode | readonly TreeNode[] {
	return (jsx as (type: unknown, props: unknown) => TreeNode | readonly TreeNode[])(type, props);
}

/** Calls a component and normalizes its result to the spliceable shape. */
function callComponent(fn: (props: unknown) => unknown, props: unknown): TreeNode | readonly TreeNode[] {
	const result = fn(props);
	if (result === false || result === null || result === undefined) {
		return [];
	}
	return result as TreeNode | readonly TreeNode[];
}

/**
 * Returns a shallow copy of the props with the React dev-tool keys
 * (`__self`, `__source`) stripped. The compiler emits them for every
 * element, but they are not part of the node shape and must be dropped
 * before passing props to a builder or component.
 */
function bareProps(props: unknown): Record<string, unknown> {
	if (props === null || props === undefined) {
		return {};
	}
	const node = { ...(props as Record<string, unknown>) };
	delete node.__self;
	delete node.__source;
	return node;
}

/** Splits intrinsic props into node props and coerced children (children ride props under the automatic runtime). */
function splitProps(props: unknown): { node: Record<string, unknown>; children: readonly TreeNode[] } {
	const bare = bareProps(props);
	const children = coerceChildren(bare.children);
	delete bare.children;
	return { node: bare, children };
}

// eslint-disable-next-line @typescript-eslint/no-namespace --- the compiler reads the JSX vocabulary from the runtime module's JSX namespace (the react-jsx convention)
export namespace JSX {
	/**
	 * Any element expression.  
	 * One flat type for all elements is TSX's ceiling (React's ReactNode is
	 * flat the same way): props are compile-checked per tag, but child POSITIONS
	 * are not. Nesting legality is `validateTree`'s job, running at every commit
	 * and at boot (`coverageScan`).
	 */
	export type Element = ComponentResult;
	export interface IntrinsicElements {
		view: ViewProps & { readonly children?: unknown };
		text: TextProps;
		row: RowProps & { readonly children?: unknown };
		container: ContainerProps & { readonly children?: unknown };
		link: LinkProps;
		modal: ModalProps & { readonly children?: unknown };
		input: InputProps;
	}
}
