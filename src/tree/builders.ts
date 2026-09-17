/**
 * Node builders - functions that construct tree nodes.
 *
 * Builders are dumb. They set the kind, spread the props, freeze the
 * result. Structural and value checks live in the tree validator module.
 *
 * Output is deep-frozen: mutating a tree anywhere throws at the mutation
 * site instead of corrupting a later render.
 *
 * @module tree/builders
 */

import { NodeKind } from './vocab.js';
import type { SelectEntity } from './vocab.js';
import type {
	ButtonNode,
	ContainerChild,
	ContainerNode,
	ControlNode,
	HrNode,
	InputNode,
	LinkNode,
	ModalChild,
	ModalNode,
	RowNode,
	SelectNode,
	SelectOption,
	TextChild,
	TextNode,
	ViewChild,
	ViewNode,
} from './types.js';

// --- Props types -----------------------------------------------------------------
// Derived from the node types so there is one source of truth.
//
// OptionSelectProps and EntitySelectProps are split so a select can never be
// built with both options and entity: each props type is missing the other
// field, which makes passing both a compile error. The tree validator still
// checks the rule at runtime for trees that arrive through casts. defaultIds
// rides the entity side only; a static options list preselects through each
// option's `default` flag.

export type ViewProps = Omit<ViewNode, 'kind' | 'children'>;
/** Text props: an optional title. The body is the children, folded at build time. */
export type TextProps = { readonly title?: string };
export type RowProps = Omit<RowNode, 'kind' | 'children'>;
export type ContainerProps = Omit<ContainerNode, 'kind' | 'children'>;
export type HrProps = Omit<HrNode, 'kind'>;
export type ButtonProps = Omit<ButtonNode, 'kind'>;
export type LinkProps = Omit<LinkNode, 'kind'>;
export type OptionSelectProps = Omit<SelectNode, 'kind' | 'entity' | 'defaultIds'> & { readonly options: readonly SelectOption[] };
export type EntitySelectProps = Omit<SelectNode, 'kind' | 'options'> & { readonly entity: SelectEntity };
export type ModalProps = Omit<ModalNode, 'kind' | 'children'>;
export type InputProps = Omit<InputNode, 'kind'>;

// --- Freeze ----------------------------------------------------------------------

/**
 * Freezes the value and everything reachable under it (arrays, child nodes,
 * option objects). Trees are immutable data; a mutation attempt throws here
 * at the mutation site instead of failing mysteriously three renders later.
 */
function deepFreeze<T>(value: T): T {
	// Handlers (typeof 'function') pass through unfrozen because the tree owns
	// them by identity and freezing a function object buys nothing.
	if (value !== null && typeof value === 'object') {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

// --- Builders --------------------------------------------------------------------

/** The message root: holds text, rows and containers. */
export function view(props: ViewProps, ...children: readonly ViewChild[]): ViewNode {
	return deepFreeze({ kind: NodeKind.view, ...props, children });
}

/**
 * Markdown text content. The children fold into one body string at build
 * time: copy, numbers and the code tags are the accepted children.
 * `text('Hi')`, `text({ title: 'T' }, 'Body')` and the tag form
 * `<text>Key <code>k</code> saved.</text>` all land here.
 */
export function text(props: TextProps | TextChild = {}, ...children: readonly TextChild[]): TextNode {
	const title = typeof props === 'string' || typeof props === 'number' ? undefined : props.title;
	const all: readonly TextChild[] = typeof props === 'string' || typeof props === 'number'
		? [props, ...children]
		: children;
	if (all.length === 0) {
		throw new Error('text needs content: the children carry the body');
	}
	return deepFreeze({ kind: NodeKind.text, ...(title !== undefined ? { title } : {}), body: flattenTextContent(all) });
}

/** Inline code: the content as one backtick code span. */
export function code(content: string): TextNode {
	return deepFreeze({ kind: NodeKind.text, body: inlineCodeSpan(content) });
}

/**
 * A fenced code block, with an optional language tag for highlighting.
 * Compose a titled block by nesting: `<text title="T"><codeblock>...` puts
 * the bold title line above the fence.
 */
export function codeblock(content: string, lang?: string): TextNode {
	return deepFreeze({ kind: NodeKind.text, body: fencedCodeBlock(content, lang) });
}

/**
 * The message as red text in an ansi code fence. The children fold like
 * the text tag's, so interpolated values read naturally:
 * `error(\`Key ${key} rejected\`)` or `<error>Key {key} rejected</error>`.
 * A callout is block-level: the fence always renders as its own block.
 */
export function error(...children: readonly TextChild[]): TextNode {
	return callout(ANSI_RED, children);
}

/** The message as yellow text in an ansi code fence, folded like {@link error}. */
export function warning(...children: readonly TextChild[]): TextNode {
	return callout(ANSI_YELLOW, children);
}

/** The message as blue text in an ansi code fence, folded like {@link error}. */
export function info(...children: readonly TextChild[]): TextNode {
	return callout(ANSI_BLUE, children);
}

/**
 * Folds text-level children into one markdown string: strings and numbers
 * pass through, text nodes (the code/codeblock sugar) contribute their
 * body, and the JSX drop rules hold (false/null/undefined vanish, arrays
 * flatten). Exported for the jsx runtime, which hands the text-like tags'
 * raw children here. Anything else throws: rows and controls are not copy.
 */
export function flattenTextContent(children: readonly unknown[]): string {
	let out = '';
	for (const child of children) {
		if (child === false || child === true || child === null || child === undefined) continue;
		if (typeof child === 'string' || typeof child === 'number') {
			out += String(child);
			continue;
		}
		if (Array.isArray(child)) {
			out += flattenTextContent(child);
			continue;
		}
		if (typeof child === 'object' && (child as { kind?: unknown }).kind === NodeKind.text) {
			out += (child as TextNode).body;
			continue;
		}
		const kind = typeof child === 'object' ? String((child as { kind?: unknown }).kind) : typeof child;
		throw new Error(`only copy, numbers and code tags belong inside text; a '${kind}' is not text content`);
	}
	return out;
}

/** Longest run of backticks in the content, which decides the delimiter sizes. */
function longestBacktickRun(content: string): number {
	let longest = 0;
	let current = 0;
	for (const ch of content) {
		current = ch === '`' ? current + 1 : 0;
		if (current > longest) longest = current;
	}
	return longest;
}

/**
 * The content as an inline code span. Backticks inside the content are
 * handled by the CommonMark rule: longer delimiters plus padding spaces,
 * so the span cannot end early. Inline spans cannot span lines.
 */
function inlineCodeSpan(content: string): string {
	if (content.includes('\n')) {
		throw new Error('inline code cannot span lines; use codeblock');
	}
	const run = longestBacktickRun(content);
	if (run === 0) {
		return `\`${content}\``;
	}
	const fence = '`'.repeat(run + 1);
	const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
	return `${fence}${pad}${content}${pad}${fence}`;
}

/** The content as a fenced block; the fence outgrows any run in the content. */
function fencedCodeBlock(content: string, lang?: string): string {
	const body = content.endsWith('\n') ? content.slice(0, -1) : content;
	const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
	return `${fence}${lang ?? ''}\n${body}\n${fence}`;
}

// --- Callouts ---------------------------------------------------------------------

/** Discord's ANSI foreground codes: red, yellow and blue inside an ```ansi fence. */
const ANSI_RED = 31;
const ANSI_YELLOW = 33;
const ANSI_BLUE = 34;

/**
 * Folds the children and wraps the result in a color-wrapped ansi fence.
 * The color state holds for the whole fence, so multi-line messages stay
 * colored; the fence grows past any backtick run in the message, per the
 * CommonMark rule the other fence helpers follow.
 */
function callout(color: number, children: readonly TextChild[]): TextNode {
	const body = `\u001b[0;${color}m${flattenTextContent(children)}\u001b[0m`;
	return deepFreeze({ kind: NodeKind.text, body: fencedCodeBlock(body, 'ansi') });
}

/** A control row: up to 5 buttons or links, or exactly one select. */
export function row(props: RowProps, ...children: readonly ControlNode[]): RowNode {
	return deepFreeze({ kind: NodeKind.row, ...props, children });
}

/** A boxed section: text and rows, optional accent color. */
export function container(props: ContainerProps, ...children: readonly ContainerChild[]): ContainerNode {
	return deepFreeze({ kind: NodeKind.container, ...props, children });
}

/**
 * A horizontal separator: a divider line with vertical padding, between
 * top-level children or inside a container. `divider: false` drops the
 * line and keeps only the spacing. The tag form spells the options as
 * flags: `<hr p-large />` and `<hr no-divider />`.
 */
export function hr(props: HrProps = {}): HrNode {
	return deepFreeze({ kind: NodeKind.hr, ...props });
}

/** A clickable button bound to a handler. */
export function button(props: ButtonProps): ButtonNode {
	return deepFreeze({ kind: NodeKind.button, ...props });
}

/** A button-shaped link that opens a URL; no handler. */
export function link(props: LinkProps): LinkNode {
	return deepFreeze({ kind: NodeKind.link, ...props });
}

/** A select whose options are a static list. */
export function optionSelect(props: OptionSelectProps): SelectNode {
	return deepFreeze({ kind: NodeKind.select, ...props });
}

/** A select whose options come from a Discord entity source (users, roles, channels, mentionables). */
export function entitySelect(props: EntitySelectProps): SelectNode {
	return deepFreeze({ kind: NodeKind.select, ...props });
}

/** A modal root: inputs and text, opened from a handler via `ui.showModal`. */
export function modal(props: ModalProps, ...children: readonly ModalChild[]): ModalNode {
	return deepFreeze({ kind: NodeKind.modal, ...props, children });
}

/** A modal text input. */
export function input(props: InputProps): InputNode {
	return deepFreeze({ kind: NodeKind.input, ...props });
}
