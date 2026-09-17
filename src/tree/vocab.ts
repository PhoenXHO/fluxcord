/**
 * The tree's fixed vocabulary: node kinds and the style unions (button
 * styles, input styles, select entity sources).
 *
 * @module tree/vocab
 */

/**
 * Tree node kinds: which UI element a node renders as. String-valued so
 * logs and validation errors stay readable.
 */
export enum NodeKind {
	view = 'view',
	text = 'text',
	row = 'row',
	container = 'container',
	button = 'button',
	link = 'link',
	select = 'select',
	modal = 'modal',
	input = 'input',
	checkbox = 'checkbox',
	checkboxGroup = 'checkbox-group',
	radioGroup = 'radio-group',
	hr = 'hr',
}

/**
 * Button visual styles, mapped straight to Discord's. Authors spell them
 * through the builder's style flags (`<Button danger />`, absent =
 * primary); this union is the vocabulary the nodes, validator and
 * renderer share.
 */
export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';

/**
 * Text input styles: one line or paragraph. Spelled through the input
 * builder's style flags (`short` / `paragraph`, absent = short).
 */
export type InputStyle = 'short' | 'paragraph';

/** Entity sources a select can draw its options from. */
export const SelectEntity = {
	Users: 'users',
	Roles: 'roles',
	Channels: 'channels',
	Mentionable: 'mentionable',
} as const;
export type SelectEntity = (typeof SelectEntity)[keyof typeof SelectEntity];

/** Padding sizes around an hr's line, mapped to the platform's separator spacing. */
export const SeparatorSpacing = {
	Small: 'small',
	Large: 'large',
} as const;
export type SeparatorSpacing = (typeof SeparatorSpacing)[keyof typeof SeparatorSpacing];
