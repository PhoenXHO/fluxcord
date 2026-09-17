/**
 * Tree node types.
 * 
 * These types define the structure of the framework's virtual
 * DOM tree, which is used to represent the UI elements.
 *
 * This module defines the types of nodes that make up the tree structure used
 * in the framework. Each node type corresponds to a specific kind of UI element.
 * The types are designed to be platform-agnostic and do not depend on any
 * specific rendering library or framework.
 *
 * @module tree/types
 */

import { NodeKind } from './vocab.js';
import type { ButtonStyle, InputStyle, SelectEntity, SeparatorSpacing } from './vocab.js';
import type { ActionHandler, PermissionPolicy } from '../pipeline/types.js';

// Properties of each node type are read-only because the tree is immutable

/** Top-level message surface; children render flat at the message top level. */
export interface ViewNode {
	readonly kind: NodeKind.view;
	readonly title?: string;
	readonly children: readonly ViewChild[];  // can only contain text, rows, and containers
}

/** Read-only text block. */
export interface TextNode {
	readonly kind: NodeKind.text;
	/** Optional title added to the text block, rendered in bold above the body. */
	readonly title?: string;
	readonly body: string;
}

/**
 * What may sit between a text block's tags: copy, numbers, and text nodes
 * (what the inline `code` / block `codeblock` sugar produce). Folded into
 * the body string at build time; the tree only ever sees finished text.
 */
export type TextChild = string | number | TextNode;

/** Horizontal control group (Discord action row). */
export interface RowNode {
	readonly kind: NodeKind.row;
	readonly children: readonly ControlNode[];
}

/**
 * Panel grouping text blocks and rows; maps to a V2 container. Cannot nest.
 */
export interface ContainerNode {
	readonly kind: NodeKind.container;
	/** Panel accent color; absent = neutral panel. */
	readonly color?: number;
	readonly children: readonly ContainerChild[];
}

/**
 * A horizontal separator: a divider line with vertical padding, or with
 * `divider: false`, padding alone. Maps to the platform's Separator
 * component; legal in views and containers, never in modals.
 */
export interface HrNode {
	readonly kind: NodeKind.hr;
	/** Whether the visible line is drawn. Default true. */
	readonly divider?: boolean;
	/** Padding size around the line. Default small. */
	readonly spacing?: SeparatorSpacing;
}

/**
 * A button that can be clicked to trigger an action. The button can be
 * disabled, and can have a style (primary, secondary, success, danger).
 * 
 * The `onClick` handler is never-erased, meaning it accepts any flow's
 * typed handler.
 */
export interface ButtonNode {
	readonly kind: NodeKind.button;
	readonly onClick: ActionHandler<never>;
	readonly label: string;
	readonly style?: ButtonStyle;
	readonly disabled?: boolean;

	/**
	 * The button's policy, which defines who can interact with it.
	 * If present, the button's policy overrides the flow's own policy.
	 */
	readonly policy?: PermissionPolicy;

	/**
	 * Draw-phase ownership tag, set by the commit phase's slot-tagging
	 * kit: the bag path the handler lenses to at click time. The screen's
	 * own controls carry their slot; the flow wrap's carry `[]` (the root
	 * bag). Authors never set this by hand; untagged controls fall back to
	 * the screen's slot at dispatch.
	 */
	readonly slot?: readonly string[];
}

/**
 * A link button that can be clicked to open a URL. The link can be disabled.
 */
export interface LinkNode {
	readonly kind: NodeKind.link;
	readonly url: string;
	readonly label: string;
	readonly disabled?: boolean;
}

/**
 * A select menu option, which can be selected by the user. The option can
 * have a label, value, description, and default state.
 * 
 * The `default` property indicates whether the option is selected by default.
 */
export interface SelectOption {
	readonly label: string;
	readonly value: string;
	readonly description?: string;
	/** Whether this option is selected by default. */
	readonly default?: boolean;
}

/**
 * A select menu that allows the user to choose from a list of options.
 * The select menu can be disabled, and can have a placeholder text.
 *
 * One node, two contexts: in a message it is a control and carries the
 * `onSelect` handler (validated as required there); in a modal it is a
 * form field and carries `id`/`label`/`required` instead. The `onSelect`
 * handler is never-erased, meaning it accepts any flow's typed handler.
 */
export interface SelectNode {
	readonly kind: NodeKind.select;

	/**
	 * The pick handler for message context. Modal selects are data fields
	 * read from the submission, so the handler is optional on the node;
	 * validation enforces its presence in messages.
	 */
	readonly onSelect?: ActionHandler<never>;

	/**
	 * Draw-phase ownership tag, set by the commit phase's slot-tagging
	 * kit: the bag path the handler lenses to at click time. Same contract
	 * as ButtonNode's `slot`; authors never set this by hand.
	 */
	readonly slot?: readonly string[];

	// (options XOR entity) is enforced by the two select builders

	/**
	 * Options for the select menu. If present, the select menu is a static list.  
	 * Cannot be used with the `entity` property.
	 */
	readonly options?: readonly SelectOption[];
	/**
	 * Entity type for the select menu. If present, the select menu is a dynamic
	 * list of users, roles, channels, or mentionables.  
	 * Cannot be used with the `options` property.
	 */
	readonly entity?: SelectEntity;
	/**
	 * Entity ids preselected when the select first renders. Entity selects
	 * only: a static options list preselects through `SelectOption.default`.
	 * Must fit the selection cap (`maxSelected`, platform default 1).
	 */
	readonly defaultIds?: readonly string[];

	readonly placeholder?: string;
	/**
	 * Minimum number of options that must be selected. If not specified, defaults to 1.
	 * If specified, must be a non-negative integer less than or equal to `maxSelected`.
	 */
	readonly minSelected?: number;
	/**
	 * Maximum number of options that can be selected. If not specified, defaults to 1.
	 * If specified, must be a non-negative integer greater than or equal to `minSelected`
	 * and must be less than or equal to 25.
	 */
	readonly maxSelected?: number;

	/**
	 * Whether a submission requires a selection. Modal-only: the platform
	 * defaults it to true there, so the renderer always sends it explicitly.
	 * Ignored (and omitted) in message payloads.
	 */
	readonly required?: boolean;

	/**
	 * Modal-only heading for the Label the select sits in. Message selects
	 * have no heading; validation enforces presence in modals and absence
	 * in messages.
	 */
	readonly label?: string;

	/**
	 * Modal-only helper line under the label, on the Label component.
	 * Max 100 characters.
	 */
	readonly description?: string;

	/**
	 * Modal-only field identifier, read from the modal submission like an
	 * input's. Message selects route through their handler instead, so
	 * validation enforces presence in modals and absence in messages.
	 */
	readonly id?: string;

	/** Whether the select is greyed out and unclickable. */
	readonly disabled?: boolean;

	/** This control's own identity gate: same contract as ButtonNode.policy. */
	readonly policy?: PermissionPolicy;
}

/** Popup root (shown from an interaction, never rendered as a message). */
export interface ModalNode {
	readonly kind: NodeKind.modal;
	readonly title: string;
	readonly children: readonly ModalChild[];
}

/**
 * An input field that allows the user to enter text in a modal. The input field can
 * have a label, placeholder text, style (short or paragraph), and can be required.
 */
export interface InputNode {
	readonly kind: NodeKind.input;

	/** The input field's unique identifier, used to retrieve the value from the modal submission. */
	readonly id: string;

	readonly label: string;

	/** Optional helper line under the label, on the surrounding Label. Max 100 characters. */
	readonly description?: string;
	readonly placeholder?: string;
	readonly style?: InputStyle;
	readonly required?: boolean;
	readonly minLength?: number;
	readonly maxLength?: number;

	/**
	 * The input field's default value, which will be pre-filled in the input box.
	 * Max length is 4000 characters.
	 */
	readonly value?: string;
}

/**
 * A single yes/no checkbox in a modal. The label sits on the surrounding
 * Label component; a `required` checkbox renders as a one-option checkbox
 * group so the platform blocks submission until it is checked (a bare
 * checkbox cannot be required).
 */
export interface CheckboxNode {
	readonly kind: NodeKind.checkbox;

	/** The checkbox's identifier, used to retrieve its boolean from the modal submission. */
	readonly id: string;
	readonly label: string;

	/** Optional helper line under the label, on the surrounding Label. Max 100 characters. */
	readonly description?: string;

	/** Whether the box starts checked. */
	readonly checked?: boolean;
	readonly required?: boolean;
}

/**
 * A multi-pick group of checkboxes in a modal. Options reuse the select
 * option shape; the platform defaults `required` to true.
 */
export interface CheckboxGroupNode {
	readonly kind: NodeKind.checkboxGroup;

	/** The group's identifier, used to retrieve the picked values from the modal submission. */
	readonly id: string;
	readonly label: string;

	/** Optional helper line under the label, on the surrounding Label. Max 100 characters. */
	readonly description?: string;

	/** One to ten options. */
	readonly options: readonly SelectOption[];

	/** Minimum picks; platform default 1. */
	readonly minSelected?: number;
	/** Maximum picks; platform default is the option count. */
	readonly maxSelected?: number;
	readonly required?: boolean;
}

/**
 * A single-choice radio group in a modal. The platform takes two to ten
 * options and defaults `required` to true.
 */
export interface RadioGroupNode {
	readonly kind: NodeKind.radioGroup;

	/** The group's identifier, used to retrieve the picked value from the modal submission. */
	readonly id: string;
	readonly label: string;

	/** Optional helper line under the label, on the surrounding Label. Max 100 characters. */
	readonly description?: string;

	/** Two to ten options; at most one may be preselected. */
	readonly options: readonly SelectOption[];
	readonly required?: boolean;
}

// --- Node type unions ------------------------------------------------------------
// Unions for parent-child relationships, used in builders and renderers. The
// compiler enforces these relationships, so illegal nesting is a compile error.

export type ControlNode = ButtonNode | LinkNode | SelectNode;
export type ViewChild = TextNode | RowNode | ContainerNode | HrNode;
export type ContainerChild = TextNode | RowNode | HrNode;
export type ModalChild = InputNode | TextNode | SelectNode | CheckboxNode | CheckboxGroupNode | RadioGroupNode;
export type TreeRoot = ViewNode | ModalNode;

/**
 * The tree's node type union. This union is used in the tree builder and
 * renderer to represent any node in the tree structure.
 */
export type TreeNode =
	| ViewNode
	| TextNode
	| RowNode
	| ContainerNode
	| HrNode
	| ButtonNode
	| LinkNode
	| SelectNode
	| ModalNode
	| InputNode
	| CheckboxNode
	| CheckboxGroupNode
	| RadioGroupNode;

/**
 * Utility type used for TSX.  
 * An element expression may be a single node, an array of nodes,
 * a boolean (to conditionally render), null/undefined (to render nothing),
 * or a nested array of nodes.
 */
export type ComponentResult = TreeNode | readonly ComponentResult[] | boolean | null | undefined;
