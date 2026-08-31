/**
 * The tree's fixed vocabulary.
 * 
 * This module defines the fixed vocabulary of node kinds and styles
 * used in the tree structure.
 *
 * @module tree/vocab
 */

/**
 * Tree node kinds. Each kind corresponds to a specific type of UI element.
 * String values are used for logging and debugging purposes.
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
}

export const ButtonStyle = {
	Primary: 'primary',
	Secondary: 'secondary',
	Success: 'success',
	Danger: 'danger',
} as const;
export type ButtonStyle = (typeof ButtonStyle)[keyof typeof ButtonStyle];

export const InputStyle = {
	Short: 'short',
	Paragraph: 'paragraph',
} as const;
export type InputStyle = (typeof InputStyle)[keyof typeof InputStyle];

export const SelectEntity = {
	Users: 'users',
	Roles: 'roles',
	Channels: 'channels',
	Mentionable: 'mentionable',
} as const;
export type SelectEntity = (typeof SelectEntity)[keyof typeof SelectEntity];
