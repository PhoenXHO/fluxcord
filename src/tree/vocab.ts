/**
 * The tree's fixed vocabulary: node kinds and the style unions (button
 * styles, input styles, select entity sources).
 *
 * @module tree/vocab
 */

/**
 * The option value of the one-option group a required checkbox is rendered
 * as. The submit reads a pick list of exactly this value back as `true`, so
 * a checkbox group of the author's own may not use it.
 */
export const REQUIRED_CHECKBOX_VALUE = 'fluxcord:checkbox';

/**
 * Tree node kinds: which UI element a node renders as. String-valued so
 * logs and validation errors stay readable.
 */
export enum NodeKind {
	view = 'view',
	text = 'text',
	row = 'row',
	container = 'container',
	section = 'section',
	accessory = 'accessory',
	thumbnail = 'thumbnail',
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

/**
 * Entity sources a select can draw its options from. Authors spell the
 * choice through flags (`<Select roles />`); this union is the node
 * vocabulary the builders, validator and renderer share.
 */
export type SelectEntity = 'users' | 'roles' | 'channels' | 'mentionable';

/** Padding sizes around an hr's line, mapped to the platform's separator spacing. */
export const SeparatorSpacing = {
	Small: 'small',
	Large: 'large',
} as const;
export type SeparatorSpacing = (typeof SeparatorSpacing)[keyof typeof SeparatorSpacing];
