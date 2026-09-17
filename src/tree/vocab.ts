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
	hr = 'hr',
}

/** Button visual styles, mapped straight to Discord's. */
export const ButtonStyle = {
	Primary: 'primary',
	Secondary: 'secondary',
	Success: 'success',
	Danger: 'danger',
} as const;
export type ButtonStyle = (typeof ButtonStyle)[keyof typeof ButtonStyle];

/** Text input styles: one line or paragraph. */
export const InputStyle = {
	Short: 'short',
	Paragraph: 'paragraph',
} as const;
export type InputStyle = (typeof InputStyle)[keyof typeof InputStyle];

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
