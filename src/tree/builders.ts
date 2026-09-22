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
import type { ButtonStyle, InputStyle, SelectEntity } from './vocab.js';
import type {
	ButtonNode,
	CheckboxGroupNode,
	CheckboxNode,
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
// option's `default` flag or the live `values` prop, which the builder
// normalizes to clean strings on the node. The entity side is spelled through
// bare flags (`roles: true`), resolved to the node's entity union by the builder.

export type ViewProps = Omit<ViewNode, 'kind' | 'children'>;
/** Text props: an optional title. The body is the children, folded at build time. */
export type TextProps = { readonly title?: string };
export type RowProps = Omit<RowNode, 'kind' | 'children'>;
export type ContainerProps = Omit<ContainerNode, 'kind' | 'children'>;
export type HrProps = Omit<HrNode, 'kind'>;
/**
 * The button's style flags: the authoring spelling of its visual style.
 * At most one may be set and each takes no value; no flag means primary.
 * The node itself carries only the resolved style union.
 */
export type ButtonStyleFlags = {
	readonly primary?: true;
	readonly secondary?: true;
	readonly success?: true;
	readonly danger?: true;
};
/** Button props: the label rides the `label` prop or the children, the style rides the flags. */
export type ButtonProps = Omit<ButtonNode, 'kind' | 'style' | 'label'> & ButtonStyleFlags & { readonly label?: string };
/** Link props: the label rides the `label` prop or the children. */
export type LinkProps = Omit<LinkNode, 'kind' | 'label'> & { readonly label?: string };
/**
 * The forgiving entry type of a select's `values` prop: a data-bag field can
 * ride directly because undefined and null are accepted entries; the builder
 * filters nullish entries out and stringifies the rest.
 */
export type SelectValues = readonly (string | number | undefined | null)[];
export type OptionSelectProps = Omit<SelectNode, 'kind' | 'entity' | 'defaultIds' | 'values'> & { readonly options: readonly SelectOption[] } & { readonly values?: SelectValues };
/**
 * The entity-source flags: each takes no value and is spelled bare
 * (`<Select roles />` / `roles: true`). At most one may be set.
 */
export type SelectEntityFlags = {
	readonly users?: true;
	readonly roles?: true;
	readonly channels?: true;
	readonly mentionable?: true;
};
/** The one-flag-required union behind {@link EntitySelectProps}: an entity select with no source is an author mistake. */
export type EntitySelectSource =
	| { readonly users: true }
	| { readonly roles: true }
	| { readonly channels: true }
	| { readonly mentionable: true };
/** A select whose options come from a Discord entity source, spelled through one {@link SelectEntityFlags} flag. */
export type EntitySelectProps = Omit<SelectNode, 'kind' | 'options' | 'entity' | 'values'> & SelectEntityFlags & EntitySelectSource;
/**
 * The modal-select tag's props: a select as a modal form field, handler
 * off the surface. The source rides the {@link SelectEntityFlags} flags or
 * an options list; setting both is a runtime throw here (the flat type
 * cannot spell the exclusion).
 */
export type ModalSelectProps = Omit<SelectNode, 'kind' | 'onSelect' | 'entity'> & SelectEntityFlags;
/** Option props: the label rides the `label` prop or the children. */
export type OptionProps = Omit<SelectOption, 'label'> & { readonly label?: string };
export type ModalProps = Omit<ModalNode, 'kind' | 'children'>;
/**
 * The input's style flags: `short` (the default) or `paragraph`. At most
 * one may be set; the node carries the resolved union.
 */
export type InputStyleFlags = {
	readonly short?: true;
	readonly paragraph?: true;
};
/** Input props: the label is a plain prop, the style rides the flags. */
export type InputProps = Omit<InputNode, 'kind' | 'style'> & InputStyleFlags;
export type CheckboxProps = Omit<CheckboxNode, 'kind'>;
export type CheckboxGroupProps = Omit<CheckboxGroupNode, 'kind'>;
export type RadioGroupProps = Omit<RadioGroupNode, 'kind'>;

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

// --- Control labels & style flags -------------------------------------------------

/**
 * Resolves a control's label: the `label` prop XOR the folded children.
 * Both or neither is an author mistake, thrown here at the build site.
 */
function controlLabel(kind: 'button' | 'link' | 'option', props: { readonly label?: string }, children: readonly TextChild[]): string {
	if (props.label !== undefined && children.length > 0) {
		throw new Error(`${kind} takes a label prop or children, never both`);
	}
	if (props.label !== undefined) return props.label;
	const folded = flattenTextContent(children);
	if (folded.length === 0) {
		throw new Error(`${kind} needs a label: the label prop or the children carry it`);
	}
	return folded;
}

/** Style-flag vocabularies: flag name -> the node's style value. */
const BUTTON_FLAG_STYLES: Record<string, ButtonStyle> = {
	primary: 'primary',
	secondary: 'secondary',
	success: 'success',
	danger: 'danger',
};
const INPUT_FLAG_STYLES: Record<string, InputStyle> = {
	short: 'short',
	paragraph: 'paragraph',
};
const ENTITY_FLAG_ENTITIES: Record<string, SelectEntity> = {
	users: 'users',
	roles: 'roles',
	channels: 'channels',
	mentionable: 'mentionable',
};

/**
 * Reads the entity flags off raw props: at most one may be set (two is an
 * author mistake) and a set flag must arrive bare (`true`). Shared by the
 * tag seams (kit Select, modal-select), which route on the resolved source.
 */
export function entityFlagOf(props: Record<string, unknown>): SelectEntity | undefined {
	return styleFlag(ENTITY_FLAG_ENTITIES, props, 'entity', 'a select');
}

/**
 * Reads the style flags off raw props: at most one may be set (two is an
 * author mistake) and a set flag must arrive bare (`true`). Returns the
 * node's style value, or undefined when no flag was set, which leaves the
 * style off the node so the renderer's default applies.
 */
function styleFlag<S extends string>(map: Record<string, S>, props: Record<string, unknown>, noun = 'style', owner = 'a control'): S | undefined {
	let style: S | undefined;
	for (const [key, mapped] of Object.entries(map)) {
		const value = props[key];
		if (value === undefined) continue;
		if (value !== true) {
			throw new Error(`${noun} flag '${key}' takes no value`);
		}
		if (style !== undefined) {
			throw new Error(`${owner} takes at most one ${noun} flag`);
		}
		style = mapped;
	}
	return style;
}

/**
 * A clickable button bound to a handler. The label comes from the `label`
 * prop or from the children, never both; the style comes from one flag
 * (`danger: true`), and no flag means primary.
 */
export function button(props: ButtonProps, ...children: readonly TextChild[]): ButtonNode {
	const style = styleFlag(BUTTON_FLAG_STYLES, props);
	return deepFreeze({
		kind: NodeKind.button,
		onClick: props.onClick,
		label: controlLabel('button', props, children),
		...(style !== undefined ? { style } : {}),
		...(props.disabled !== undefined ? { disabled: props.disabled } : {}),
		...(props.policy !== undefined ? { policy: props.policy } : {}),
	});
}

/**
 * A button-shaped link that opens a URL; no handler. The label comes from
 * the `label` prop or the children, like {@link button}.
 */
export function link(props: LinkProps, ...children: readonly TextChild[]): LinkNode {
	return deepFreeze({
		kind: NodeKind.link,
		url: props.url,
		label: controlLabel('link', props, children),
		...(props.disabled !== undefined ? { disabled: props.disabled } : {}),
	});
}

/**
 * Filters nullish entries out of a forgiving `values` array and stringifies
 * the rest; an empty result collapses to undefined so no preselection rides
 * the node.
 */
function normalizeValues(values: SelectValues | undefined): readonly string[] | undefined {
	const live = (values ?? [])
		.filter((entry): entry is string | number => entry !== undefined && entry !== null)
		.map(String);
	return live.length > 0 ? live : undefined;
}

/** A select whose options are a static list. The live `values` preselection arrives in the forgiving {@link SelectValues} spelling and is normalized to clean strings here. */
export function optionSelect(props: OptionSelectProps): SelectNode {
	const { values, ...rest } = props;
	const live = normalizeValues(values);
	return deepFreeze({ kind: NodeKind.select, ...rest, ...(live !== undefined ? { values: live } : {}) });
}

/**
 * A select whose options come from a Discord entity source (users, roles,
 * channels, mentionables), spelled through one {@link SelectEntityFlags}
 * flag. The flags resolve to the node's entity union and never ride along.
 */
export function entitySelect(props: EntitySelectProps): SelectNode {
	const entity = styleFlag(ENTITY_FLAG_ENTITIES, props, 'entity', 'a select');
	const rest = { ...props } as Record<string, unknown>;
	delete rest.users;
	delete rest.roles;
	delete rest.channels;
	delete rest.mentionable;
	return deepFreeze({ kind: NodeKind.select, ...rest, ...(entity !== undefined ? { entity } : {}) }) as SelectNode;
}

/** A modal root: inputs and text, opened from a handler via `ui.showModal`. */
export function modal(props: ModalProps, ...children: readonly ModalChild[]): ModalNode {
	return deepFreeze({ kind: NodeKind.modal, ...props, children });
}

/**
 * A modal text input. The style rides the flags (`paragraph: true`);
 * absent means short. The label is a plain prop.
 */
export function input(props: InputProps): InputNode {
	const style = styleFlag(INPUT_FLAG_STYLES, props);
	return deepFreeze({
		kind: NodeKind.input,
		id: props.id,
		label: props.label,
		...(style !== undefined ? { style } : {}),
		...(props.required !== undefined ? { required: props.required } : {}),
		...(props.description !== undefined ? { description: props.description } : {}),
		...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {}),
		...(props.value !== undefined ? { value: props.value } : {}),
		...(props.minLength !== undefined ? { minLength: props.minLength } : {}),
		...(props.maxLength !== undefined ? { maxLength: props.maxLength } : {}),
	});
}

/**
 * A modal checkbox: one yes/no box. `required` renders as a one-option
 * checkbox group on the wire, because the platform cannot require a bare
 * checkbox; the author surface stays one tag either way.
 */
export function checkbox(props: CheckboxProps): CheckboxNode {
	return deepFreeze({ kind: NodeKind.checkbox, ...props });
}

/** A modal multi-pick checkbox group; one to ten options. */
export function checkboxGroup(props: CheckboxGroupProps): CheckboxGroupNode {
	return deepFreeze({ kind: NodeKind.checkboxGroup, ...props });
}

/** A modal single-choice radio group; two to ten options. */
export function radioGroup(props: RadioGroupProps): RadioGroupNode {
	return deepFreeze({ kind: NodeKind.radioGroup, ...props });
}

/**
 * One option of a select or a modal checkbox/radio group. The label comes
 * from the `label` prop or the children, never both; `value` identifies
 * the pick, and `description` and `default` ride props. The tag form is
 * `<option value="1h">1 hour</option>`.
 */
export function option(props: OptionProps, ...children: readonly TextChild[]): SelectOption {
	return deepFreeze({
		value: props.value,
		label: controlLabel('option', props, children),
		...(props.description !== undefined ? { description: props.description } : {}),
		...(props.default !== undefined ? { default: props.default } : {}),
	});
}
