/**
 * The V2 renderer: tree in, Components V2 payload out.
 *
 * This file only translates. It never calls Discord (sending and editing
 * is the commit phase's job) and never imports `discord.js`; every number in
 * the payload is a named member of `discord-api-types`. The mapping tables
 * below are keyed by the vocabulary constants themselves, so `vocab.ts`
 * stays the one place a control name is written down.
 *
 * Three platform limits are enforced here, each thrown as a `RenderError`
 * the moment a node breaks it: more than 40 components in one message,
 * more than 4000 characters in a text display, or a container color that
 * does not fit in 24 bits.
 *
 * @module render/v2
 */

import {
	ButtonStyle,
	ComponentType,
	MessageFlags,
	SelectMenuDefaultValueType,
	SeparatorSpacingSize,
	TextInputStyle,
} from 'discord-api-types/v10';
import type {
	APIActionRowComponent,
	APIButtonComponent,
	APIComponentInMessageActionRow,
	APIContainerComponent,
	APILabelComponent,
	APIMessageTopLevelComponent,
	APIModalInteractionResponseCallbackComponent,
	APISelectMenuComponent,
	APISeparatorComponent,
	APITextDisplayComponent,
} from 'discord-api-types/v10';
import { NodeKind, SelectEntity, SeparatorSpacing } from '../tree/vocab.js';
import type {
	ButtonStyle as TreeButtonStyle,
	InputStyle as TreeInputStyle,
	SeparatorSpacing as TreeSeparatorSpacing,
} from '../tree/vocab.js';
import type {
	ButtonNode,
	ContainerNode,
	ControlNode,
	HrNode,
	InputNode,
	ModalNode,
	RowNode,
	SelectNode,
	TextNode,
	ViewNode,
} from '../tree/types.js';
import { encodeActionId } from './id-codec.js';

// --- Errors & payload shapes -----------------------------------------------------

/** The error the renderer throws when a node breaks a platform limit. It carries the offending node's path, so a log line points at the exact spot in the tree. */
export class RenderError extends Error {
	readonly path: string;
	readonly reason: string;

	constructor(path: string, reason: string) {
		super(`${path}: ${reason}`);
		this.name = 'RenderError';
		this.path = path;
		this.reason = reason;
	}
}

/** The REST body for a Components V2 message: the flag that turns V2 mode on, and the rendered components. */
export interface V2MessagePayload {
	readonly flags: number;
	readonly components: readonly APIMessageTopLevelComponent[];
}

/**
 * Returns the wire stamp for one control: its handler's source hash, plus
 * an occurrence suffix like `'-1'` or `'-2'` when the same handler source
 * appears more than once in the draw. The renderer never computes stamps
 * itself; `materializeTree` (`commit/frame.ts`) walks the tree first and hands
 * this lookup over. Taking it as a required argument is deliberate: a tree
 * cannot be rendered without its stamps, so two same-source controls can
 * never end up with the same `custom_id`.
 */
export type StampLookup = (control: ButtonNode | SelectNode) => string;

// --- Limits & mapping tables -----------------------------------------------------

/** The platform caps a V2 message at 40 components, nested ones included. */
const MAX_COMPONENTS = 40;
/** The platform caps one text display at 4000 characters. */
const MAX_TEXT_CHARS = 4000;

/** The platform button styles the vocabulary maps to (Link and Premium excluded, see below). */
type WireButtonStyle = ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger;

/** Tree button style -> platform button style number. Link and Premium are missing on purpose: a link is its own node (`LinkNode`, it carries a url instead of a handler), and premium buttons are not part of the vocabulary. */
const BUTTON_STYLES: Record<TreeButtonStyle, WireButtonStyle> = {
	primary: ButtonStyle.Primary,
	secondary: ButtonStyle.Secondary,
	success: ButtonStyle.Success,
	danger: ButtonStyle.Danger,
};

/** Tree input style -> platform text input style number. */
const INPUT_STYLES: Record<TreeInputStyle, TextInputStyle> = {
	short: TextInputStyle.Short,
	paragraph: TextInputStyle.Paragraph,
};

/** Tree hr spacing -> platform separator padding size. */
const HR_SPACING: Record<TreeSeparatorSpacing, SeparatorSpacingSize> = {
	[SeparatorSpacing.Small]: SeparatorSpacingSize.Small,
	[SeparatorSpacing.Large]: SeparatorSpacingSize.Large,
};

/** Select entity source -> wire shape. Each entity kind is its own component type on the platform, so the table pairs every source with a builder taking the `custom_id` and optional preselected ids (`default_values`; mentionable ignores them — its defaults mix users and roles, and an id alone cannot say which is which). */
const ENTITY_SELECTS: Record<SelectEntity, (customId: string, defaultIds?: readonly string[]) => APISelectMenuComponent> = {
	[SelectEntity.Users]: (customId, defaultIds) => ({
		type: ComponentType.UserSelect,
		custom_id: customId,
		...(defaultIds?.length ? { default_values: defaultIds.map((id) => ({ id, type: SelectMenuDefaultValueType.User })) } : {}),
	}),
	[SelectEntity.Roles]: (customId, defaultIds) => ({
		type: ComponentType.RoleSelect,
		custom_id: customId,
		...(defaultIds?.length ? { default_values: defaultIds.map((id) => ({ id, type: SelectMenuDefaultValueType.Role })) } : {}),
	}),
	[SelectEntity.Channels]: (customId, defaultIds) => ({
		type: ComponentType.ChannelSelect,
		custom_id: customId,
		...(defaultIds?.length ? { default_values: defaultIds.map((id) => ({ id, type: SelectMenuDefaultValueType.Channel })) } : {}),
	}),
	[SelectEntity.Mentionable]: (customId) => ({ type: ComponentType.MentionableSelect, custom_id: customId }),
};

/** Reads a node's kind as a plain string. Trees can arrive through casts or hand-built objects whose types lie, and the error paths below still want to print the kind the object really carries. */
const kindOf = (node: object): string => String((node as { kind?: unknown }).kind);

// --- Node renderers ---------------------------------------------------------------

/**
 * Builds a `TextDisplay`, the platform's plain text block.
 *
 * @throws `RenderError` when the content is over 4000 characters.
 */
function textDisplay(content: string, path: string): APITextDisplayComponent {
	if (content.length > MAX_TEXT_CHARS) {
		throw new RenderError(path, `text display is ${content.length} chars, max is ${MAX_TEXT_CHARS}`);
	}
	return { type: ComponentType.TextDisplay, content };
}

/** Renders a text node. A title, when present, becomes a bold line above the body; the platform has no titled text block of its own. */
function renderText(node: TextNode, path: string): APITextDisplayComponent {
	return textDisplay(node.title === undefined ? node.body : `**${node.title}**\n${node.body}`, path);
}

/** Renders an hr into the platform's Separator. Defaults ride the platform (visible line, small padding), so they are omitted from the payload. */
function renderSeparator(node: HrNode): APISeparatorComponent {
	return {
		type: ComponentType.Separator,
		...(node.divider === false ? { divider: false } : {}),
		...(node.spacing !== undefined ? { spacing: HR_SPACING[node.spacing] } : {}),
	};
}

/** Encodes a control's `custom_id` from its stamp. Nothing an author named rides the wire, only session, screen and handler. */
function stampedCustomId(control: ButtonNode | SelectNode, sessionId: string, screenKey: string, stampOf: StampLookup): string {
	return encodeActionId({ sessionId, screenKey, actionHash: stampOf(control) });
}

/**
 * Resolves a button node's wire style. A style outside the vocabulary
 * means a cast slipped past validation, so this throws instead of
 * shipping `style: undefined`.
 */
function buttonStyle(node: ButtonNode, path: string): WireButtonStyle {
	const style = BUTTON_STYLES[node.style ?? 'primary'];
	if (style === undefined) {
		throw new RenderError(path, `unknown button style '${String(node.style)}'`);
	}
	return style;
}

/** The same gate for an input's style. */
function inputStyle(node: InputNode, path: string): TextInputStyle {
	const style = INPUT_STYLES[node.style ?? 'short'];
	if (style === undefined) {
		throw new RenderError(path, `unknown input style '${String(node.style)}'`);
	}
	return style;
}

/** Builds a select's core wire shape: options become a `StringSelect`, an entity becomes its platform select type. A select with neither, or with both, means validation rule 8 was dodged somewhere, so this throws rather than guess. */
function selectBase(node: SelectNode, path: string, customId: string): APISelectMenuComponent {
	if (node.options !== undefined && node.entity !== undefined) {
		// rule 8 has slipped through
		throw new RenderError(path, 'select has both options and entity');
	}
	if (node.options !== undefined) {
		return {
			type: ComponentType.StringSelect,
			custom_id: customId,
			options: node.options.map((option) => ({
				label: option.label,
				value: option.value,
				...(option.description !== undefined ? { description: option.description } : {}),
				...(option.default === true ? { default: true } : {}),
			})),
		};
	}
	if (node.entity !== undefined) {
		const defaultIds = node.defaultIds;
		if (defaultIds !== undefined && defaultIds.length > 0) {
			if (node.entity === SelectEntity.Mentionable) {
				throw new RenderError(path, 'select defaultIds is not supported on mentionable selects');
			}
			return ENTITY_SELECTS[node.entity](customId, defaultIds);
		}
		return ENTITY_SELECTS[node.entity](customId);
	}
	// rule 8 has slipped through
	throw new RenderError(path, 'select has neither options nor entity');
}

/** Renders one row control: button, link or select. Buttons and selects get their stamped `custom_id` here; a link carries a url and never gets one. */
function renderControl(node: ControlNode, path: string, sessionId: string, screenKey: string, stampOf: StampLookup): APIComponentInMessageActionRow {
	switch (node.kind) {
		case NodeKind.button:
			return {
				type: ComponentType.Button,
				style: buttonStyle(node, path),
				label: node.label,
				custom_id: stampedCustomId(node, sessionId, screenKey, stampOf),
				...(node.disabled === true ? { disabled: true } : {}),
			} satisfies APIButtonComponent;
		case NodeKind.link:
			return {
				type: ComponentType.Button,
				style: ButtonStyle.Link,
				label: node.label,
				url: node.url,
				...(node.disabled === true ? { disabled: true } : {}),
			} satisfies APIButtonComponent;
		case NodeKind.select: {
			const select = selectBase(node, path, stampedCustomId(node, sessionId, screenKey, stampOf));
			return {
				...select,
				...(node.placeholder !== undefined ? { placeholder: node.placeholder } : {}),
				...(node.minSelected !== undefined ? { min_values: node.minSelected } : {}),
				...(node.maxSelected !== undefined ? { max_values: node.maxSelected } : {}),
				...(node.disabled === true ? { disabled: true } : {}),
			};
		}
		default:
			throw new RenderError(path, `unknown control kind '${kindOf(node)}'`);
	}
}

/** Renders a row into an `ActionRow`, the platform's only legal parent for buttons and selects. */
function renderRow(node: RowNode, path: string, sessionId: string, screenKey: string, stampOf: StampLookup): APIActionRowComponent<APIComponentInMessageActionRow> {
	return {
		type: ComponentType.ActionRow,
		components: node.children.map((child, index) => renderControl(child, `${path}/${kindOf(child)}[${index}]`, sessionId, screenKey, stampOf)),
	};
}

/** Renders a container and its children. The accent color must be an integer from `0x000000` to `0xFFFFFF`, which is all the platform stores. */
function renderContainer(node: ContainerNode, path: string, sessionId: string, screenKey: string, stampOf: StampLookup): APIContainerComponent {
	if (node.color !== undefined && (!Number.isInteger(node.color) || node.color < 0x000000 || node.color > 0xffffff)) {
		throw new RenderError(path, `accent_color must be an integer in 0x000000-0xFFFFFF, got ${node.color}`);
	}
	return {
		type: ComponentType.Container,
		...(node.color !== undefined ? { accent_color: node.color } : {}),
		components: node.children.map((child, index) => {
			const childPath = `${path}/${kindOf(child)}[${index}]`;
			switch (child.kind) {
				case NodeKind.text: return renderText(child, childPath);
				case NodeKind.row: return renderRow(child, childPath, sessionId, screenKey, stampOf);
				case NodeKind.hr: return renderSeparator(child);
				default: throw new RenderError(childPath, `container child must be text, row or hr, got '${kindOf(child)}'`);
			}
		}),
	};
}

/** Renders one top-level view child: text, row or container. */
function renderTopLevel(node: ViewNode['children'][number], path: string, sessionId: string, screenKey: string, stampOf: StampLookup): APIMessageTopLevelComponent {
	switch (node.kind) {
		case NodeKind.text: return renderText(node, path);
		case NodeKind.row: return renderRow(node, path, sessionId, screenKey, stampOf);
		case NodeKind.container: return renderContainer(node, path, sessionId, screenKey, stampOf);
		case NodeKind.hr: return renderSeparator(node);
		default: throw new RenderError(path, `unknown view child kind '${kindOf(node)}'`);
	}
}

/** Counts every component in the payload, including everything nested in rows and containers, because the platform's cap counts them all. */
function countComponents(components: readonly { type: number; components?: readonly unknown[] }[]): number {
	let total = 0;
	for (const component of components) {
		total += 1;
		if (Array.isArray(component.components)) {
			total += countComponents(component.components);
		}
	}
	return total;
}

// --- Entry points -----------------------------------------------------------------

/**
 * Renders a view into the REST body for a Components V2 message. The
 * view's children land flat at the top level of the message, and a view
 * title becomes a leading `# title` heading.
 *
 * @param view The validated view to render.
 * @param sessionId The live session this draw belongs to.
 * @param screenKey The registry key of the screen being drawn, `'<moduleId>/<screenId>'`.
 * @param stampOf The stamp lookup `materializeTree` built for this draw.
 * @returns The message body: the V2 flag plus the component tree.
 * @throws `RenderError` when the root is not a view or any platform limit breaks.
 */
export function renderV2Message(view: ViewNode, sessionId: string, screenKey: string, stampOf: StampLookup): V2MessagePayload {
	if (view.kind !== NodeKind.view) {
		throw new RenderError(kindOf(view), 'renderer input must be a view');
	}
	const components: APIMessageTopLevelComponent[] = [];
	if (view.title !== undefined) {
		components.push(textDisplay(`# ${view.title}`, 'view'));
	}
	for (const [index, child] of view.children.entries()) {
		components.push(renderTopLevel(child, `view/${kindOf(child)}[${index}]`, sessionId, screenKey, stampOf));
	}
	const total = countComponents(components);
	if (total > MAX_COMPONENTS) {
		throw new RenderError('view', `message has ${total} components, max is ${MAX_COMPONENTS}`);
	}
	return { flags: MessageFlags.IsComponentsV2, components };
}

/** The REST body for a modal interaction response: the modal's own id, its title, and its components. */
export interface V2ModalPayload {
	readonly custom_id: string;
	readonly title: string;
	readonly components: readonly APIModalInteractionResponseCallbackComponent[];
}

/**
 * Renders an input node as a `TextInput` wrapped in a Label, the platform's
 * replacement for the old `ActionRow` wrapper. The `TextInput` itself must
 * carry no label of its own (platform error 50035: the Label supplies it).
 * Unlike every other optional field, `required` is always sent, even as
 * `false`: the platform's default is `true`, so staying silent would quietly
 * flip our optional default.
 */
function renderInput(node: InputNode, path: string): APILabelComponent {
	return {
		type: ComponentType.Label,
		label: node.label,
		component: {
			type: ComponentType.TextInput,
			style: inputStyle(node, path),
			custom_id: node.id,
			required: node.required === true,
			...(node.placeholder !== undefined ? { placeholder: node.placeholder } : {}),
			...(node.value !== undefined ? { value: node.value } : {}),
			...(node.minLength !== undefined ? { min_length: node.minLength } : {}),
			...(node.maxLength !== undefined ? { max_length: node.maxLength } : {}),
		},
	};
}

/**
 * Renders a modal root into the REST body for a modal response. The
 * `customId` comes from the caller (the pipeline's `showModal`) and must be
 * fresh on every open: the Discord client keeps draft text per `custom_id`,
 * so a reused id would let an older unsubmitted draft bleed into our
 * prefill.
 */
export function renderV2Modal(root: ModalNode, customId: string): V2ModalPayload {
	if (root.kind !== NodeKind.modal) {
		throw new RenderError(kindOf(root), 'renderer input must be a modal');
	}
	return {
		custom_id: customId,
		title: root.title,
		components: root.children.map((child, index): APIModalInteractionResponseCallbackComponent => {
			const childPath = `modal/${kindOf(child)}[${index}]`;
			switch (child.kind) {
				case NodeKind.text: return renderText(child, childPath);
				case NodeKind.input: return renderInput(child, childPath);
				default: throw new RenderError(childPath, `modal child must be text or input, got '${kindOf(child)}'`);
			}
		}),
	};
}
