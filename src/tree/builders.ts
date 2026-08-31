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
	InputNode,
	LinkNode,
	ModalChild,
	ModalNode,
	RowNode,
	SelectNode,
	SelectOption,
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
// checks the rule at runtime for trees that arrive through casts.

export type ViewProps = Omit<ViewNode, 'kind' | 'children'>;
export type TextProps = Omit<TextNode, 'kind'>;
export type RowProps = Omit<RowNode, 'kind' | 'children'>;
export type ContainerProps = Omit<ContainerNode, 'kind' | 'children'>;
export type ButtonProps = Omit<ButtonNode, 'kind'>;
export type LinkProps = Omit<LinkNode, 'kind'>;
export type OptionSelectProps = Omit<SelectNode, 'kind' | 'entity'> & { readonly options: readonly SelectOption[] };
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

export function view(props: ViewProps, ...children: readonly ViewChild[]): ViewNode {
	return deepFreeze({ kind: NodeKind.view, ...props, children });
}

export function text(props: TextProps): TextNode {
	return deepFreeze({ kind: NodeKind.text, ...props });
}

export function row(props: RowProps, ...children: readonly ControlNode[]): RowNode {
	return deepFreeze({ kind: NodeKind.row, ...props, children });
}

export function container(props: ContainerProps, ...children: readonly ContainerChild[]): ContainerNode {
	return deepFreeze({ kind: NodeKind.container, ...props, children });
}

export function button(props: ButtonProps): ButtonNode {
	return deepFreeze({ kind: NodeKind.button, ...props });
}

export function link(props: LinkProps): LinkNode {
	return deepFreeze({ kind: NodeKind.link, ...props });
}

export function optionSelect(props: OptionSelectProps): SelectNode {
	return deepFreeze({ kind: NodeKind.select, ...props });
}

export function entitySelect(props: EntitySelectProps): SelectNode {
	return deepFreeze({ kind: NodeKind.select, ...props });
}

export function modal(props: ModalProps, ...children: readonly ModalChild[]): ModalNode {
	return deepFreeze({ kind: NodeKind.modal, ...props, children });
}

export function input(props: InputProps): InputNode {
	return deepFreeze({ kind: NodeKind.input, ...props });
}
