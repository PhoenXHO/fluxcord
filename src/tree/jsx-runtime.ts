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
 * bare strings/numbers throw loudly everywhere except the text-like tags
 * (text, code, codeblock, and the callouts error, warning, info), where they ARE the content.
 *
 * Tag vocabulary splits one way, with no overlap: layout and leaf kinds
 * are the intrinsics (view, text, row, container, link, modal, input, hr);
 * none of them carries a handler. The handler-carrying controls (Button,
 * Select) exist only as screen-kit members (tree/kit):
 * a view destructures them from its kit parameter and uses them as
 * components (e.g., `<Button/>`) so their handler slots stay typed against the
 * flow's data and screen keys. The draw-time kit is this module's builders
 * (runtimeKit), so kit elements produce the same trees intrinsics do.
 * The exception proving the rule is the modal-context select: a select in
 * a modal is a data field (id + label, read from the submission), not a
 * control, so it is the intrinsic `modal-select` while the message-context
 * select stays the kit's `Select`. The modal-only checkbox tags
 * (checkbox, checkbox-group, radio-group) are intrinsics the same way.
 * Uppercase tags in general are components.
 *
 * @module tree/jsx-runtime
 */

import {
	checkbox,
	checkboxGroup,
	code,
	codeblock,
	container,
	entitySelect,
	error,
	flattenTextContent,
	hr,
	info,
	input,
	link,
	modal,
	option,
	optionSelect,
	radioGroup,
	row,
	text,
	view,
	warning,
} from './builders.js';
import type {
	CheckboxGroupProps,
	CheckboxProps,
	ContainerProps,
	EntitySelectProps,
	HrProps,
	InputProps,
	LinkProps,
	ModalProps,
	ModalSelectProps,
	OptionProps,
	OptionSelectProps,
	RadioGroupProps,
	RowProps,
	TextProps,
	ViewProps,
} from './builders.js';
import { SeparatorSpacing } from './vocab.js';
import type {
	CheckboxGroupNode,
	CheckboxNode,
	ComponentResult,
	ContainerChild,
	ContainerNode,
	ControlNode,
	HrNode,
	InputNode,
	LinkNode,
	ModalChild,
	ModalNode,
	RadioGroupNode,
	RowNode,
	SelectNode,
	SelectOption,
	TextChild,
	TextNode,
	TreeNode,
	ViewChild,
	ViewNode,
} from './types.js';
import { coerceChildren } from './normalize.js';

/** The element union lives with the tree types; re-exported for TSX authors. */
export type { ComponentResult };

/** The callout tags keyed as their JSX spellings; each folds its children and fences them in its color. */
const CALLOUT_TAGS: Record<'error' | 'warning' | 'info', (...children: readonly TextChild[]) => TextNode> = {
	error,
	info,
	warning,
};

/**
 * The hr tag's flag vocabulary: `p-small` / `p-large` pick the padding,
 * `no-divider` drops the visible line. A flag takes no value. Note the
 * compiler skips hyphenated JSX attributes when checking a tag, so this
 * type documents the surface rather than enforcing it; the runtime
 * rejects typoed flags and valued flags alike.
 */
export type HrTagProps = {
	readonly 'p-small'?: true;
	readonly 'p-large'?: true;
	readonly 'no-divider'?: true;
};

/** hr tag flags -> the node's spacing value. */
const HR_SPACING_FLAGS: Record<string, SeparatorSpacing> = {
	'p-small': SeparatorSpacing.Small,
	'p-large': SeparatorSpacing.Large,
};

/**
 * Turns the hr tag's raw props into node props. Every key must be a
 * known flag and every flag must arrive bare (`true`, as the compiler
 * emits for `<hr p-large />`): anything else throws, because a typoed
 * flag would otherwise ride into the tree unnoticed.
 */
function hrProps(raw: Record<string, unknown>): HrProps {
	let out: HrProps = {};
	for (const [key, value] of Object.entries(raw)) {
		const spacing = HR_SPACING_FLAGS[key];
		if (spacing === undefined && key !== 'no-divider') {
			throw new Error(`unknown hr flag '${key}'`);
		}
		if (value !== true) {
			throw new Error(`hr flag '${key}' takes no value`);
		}
		out = spacing !== undefined ? { ...out, spacing } : { ...out, divider: false };
	}
	return out;
}

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
export function jsx(tag: 'text', props: TextProps & { readonly children?: unknown } | null): TextNode;
export function jsx(tag: 'code', props: { readonly children?: unknown } | null): TextNode;
export function jsx(tag: 'codeblock', props: { readonly lang?: string; readonly children?: unknown } | null): TextNode;
export function jsx(tag: 'row', props: RowProps & { readonly children?: unknown } | null): RowNode;
export function jsx(tag: 'container', props: ContainerProps & { readonly children?: unknown } | null): ContainerNode;
export function jsx(tag: 'link', props: LinkProps & { readonly children?: unknown } | null): LinkNode;
export function jsx(tag: 'modal', props: ModalProps & { readonly children?: unknown } | null): ModalNode;
export function jsx(tag: 'input', props: InputProps | null): InputNode;
export function jsx(tag: 'modal-select', props: ModalSelectProps & { readonly children?: unknown } | null): SelectNode;
export function jsx(tag: 'checkbox', props: CheckboxProps | null): CheckboxNode;
export function jsx(tag: 'checkbox-group', props: Omit<CheckboxGroupProps, 'options'> & { readonly options?: readonly SelectOption[]; readonly children?: unknown } | null): CheckboxGroupNode;
export function jsx(tag: 'radio-group', props: Omit<RadioGroupProps, 'options'> & { readonly options?: readonly SelectOption[]; readonly children?: unknown } | null): RadioGroupNode;
export function jsx(tag: 'option', props: OptionProps & { readonly children?: unknown } | null): SelectOption;
export function jsx(tag: 'hr', props: HrTagProps | null): HrNode;
export function jsx(tag: 'error', props: { readonly children?: unknown } | null): TextNode;
export function jsx(tag: 'warning', props: { readonly children?: unknown } | null): TextNode;
export function jsx(tag: 'info', props: { readonly children?: unknown } | null): TextNode;
export function jsx(type: typeof Fragment, props: { readonly children?: unknown } | null): readonly TreeNode[];
export function jsx<P extends object, T extends ComponentResult>(type: (props: P) => T, props: P | null): T;
export function jsx(type: unknown, props: unknown): TreeNode | readonly TreeNode[] | SelectOption {
	if (typeof type === 'function' && type !== Fragment) {
		return callComponent(type as (props: unknown) => unknown, bareProps(props));
	}
	if (type === 'text' || type === 'code' || type === 'codeblock' || type === 'error' || type === 'warning' || type === 'info') {
		// The text-like tags fold their children themselves: copy arrives as
		// bare strings, which coerceChildren would reject.
		const { node, children } = splitRawChildren(props);
		if (type === 'text') {
			return text(node as TextProps, ...(children as readonly TextChild[]));
		}
		if (type === 'error' || type === 'warning' || type === 'info') {
			return CALLOUT_TAGS[type](...(children as readonly TextChild[]));
		}
		const body = flattenTextContent(children);
		return type === 'code' ? code(body) : codeblock(body, (node as { readonly lang?: string }).lang);
	}
	if (type === 'link') {
		// A link's label folds like the text-like tags': strings and numbers
		// in children position are content, not nodes.
		const { node, children } = splitRawChildren(props);
		return link(node as LinkProps, ...(children as readonly TextChild[]));
	}
	if (type === 'option') {
		// An option's label folds like the control labels'.
		const { node, children } = splitRawChildren(props);
		return option(node as OptionProps, ...(children as readonly TextChild[]));
	}
	const { node, children } = splitProps(props);
	if (type === Fragment) {
		return children;
	}
	switch (type) {
		case 'view':
			return view(node as ViewProps, ...children as readonly ViewChild[]);
		case 'row':
			return row(node as RowProps, ...children as readonly ControlNode[]);
		case 'container':
			return container(node as ContainerProps, ...children as readonly ContainerChild[]);
		case 'modal':
			return modal(node as ModalProps, ...children as readonly ModalChild[]);
		case 'input':
			if (children.length > 0) {
				throw new Error('input takes no children; the label is a prop');
			}
			return input(node as InputProps);
		case 'modal-select': {
			const selectProps = node as ModalSelectProps;
			const lifted = optionsFromChildren('modal-select', children);
			if (lifted !== undefined && selectProps.options !== undefined) {
				throw new Error('modal-select takes an options prop or option children, never both');
			}
			if (selectProps.options !== undefined && selectProps.entity !== undefined) {
				throw new Error('a select takes either options or entity, never both');
			}
			const withOptions = lifted !== undefined ? { ...selectProps, options: lifted } : selectProps;
			return withOptions.entity !== undefined
				? entitySelect(withOptions as EntitySelectProps)
				: optionSelect(withOptions as OptionSelectProps);
		}
		case 'checkbox':
			if (children.length > 0) {
				throw new Error('checkbox takes no children; the label is a prop');
			}
			return checkbox(node as CheckboxProps);
		case 'checkbox-group': {
			const groupProps = node as CheckboxGroupProps;
			const lifted = optionsFromChildren('checkbox-group', children);
			if (lifted !== undefined && groupProps.options !== undefined) {
				throw new Error('checkbox-group takes an options prop or option children, never both');
			}
			return checkboxGroup(lifted !== undefined ? { ...groupProps, options: lifted } : groupProps);
		}
		case 'radio-group': {
			const groupProps = node as RadioGroupProps;
			const lifted = optionsFromChildren('radio-group', children);
			if (lifted !== undefined && groupProps.options !== undefined) {
				throw new Error('radio-group takes an options prop or option children, never both');
			}
			return radioGroup(lifted !== undefined ? { ...groupProps, options: lifted } : groupProps);
		}
		case 'hr':
			return hr(hrProps(node));
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
	const { node, children: raw } = splitRawChildren(props);
	return { node, children: coerceChildren(raw) };
}

/**
 * Like splitProps but keeps the children raw: the text-like tags receive
 * strings and numbers as content, so coercion would reject exactly what
 * they exist to accept.
 */
function splitRawChildren(props: unknown): { node: Record<string, unknown>; children: readonly unknown[] } {
	const bare = bareProps(props);
	const children = bare.children;
	delete bare.children;
	return {
		node: bare,
		children: children === undefined || children === null ? [] : Array.isArray(children) ? children : [children],
	};
}

/**
 * Lifts `<option>` children into the parent's options array: every coerced
 * child must be an option-built SelectOption (a label/value pair). Returns
 * undefined when there were no children, so the options prop stands.
 */
function optionsFromChildren(tag: string, children: readonly TreeNode[]): readonly SelectOption[] | undefined {
	if (children.length === 0) return undefined;
	return children.map((child) => {
		const candidate = child as unknown as Partial<SelectOption>;
		if (typeof candidate.label !== 'string' || typeof candidate.value !== 'string') {
			throw new Error(`${tag} takes only <option> tags as children`);
		}
		return child as SelectOption;
	});
}


// eslint-disable-next-line @typescript-eslint/no-namespace --- the compiler reads the JSX vocabulary from the runtime module's JSX namespace (the react-jsx convention)
export namespace JSX {
	/**
	 * Any element expression.
	 * One flat type for all elements is TSX's ceiling (React's `ReactNode` is
	 * flat the same way): props are compile-checked per tag, but child
	 * positions are not. Nesting legality is `validateTree`'s job, running at
	 * every commit and at boot (`coverageScan`).
	 */
	export type Element = ComponentResult;
	export interface IntrinsicElements {
		view: ViewProps & { readonly children?: unknown };
		text: TextProps & { readonly children?: unknown };
		code: { readonly children?: unknown };
		codeblock: { readonly lang?: string; readonly children?: unknown };
		error: { readonly children?: unknown };
		warning: { readonly children?: unknown };
		info: { readonly children?: unknown };
		row: RowProps & { readonly children?: unknown };
		container: ContainerProps & { readonly children?: unknown };
		link: LinkProps & { readonly children?: unknown };
		modal: ModalProps & { readonly children?: unknown };
		input: InputProps;
		'modal-select': ModalSelectProps & { readonly children?: unknown };
		checkbox: CheckboxProps;
		'checkbox-group': Omit<CheckboxGroupProps, 'options'> & { readonly options?: readonly SelectOption[]; readonly children?: unknown };
		'radio-group': Omit<RadioGroupProps, 'options'> & { readonly options?: readonly SelectOption[]; readonly children?: unknown };
		option: OptionProps & { readonly children?: unknown };
		hr: HrTagProps;
	}
}
