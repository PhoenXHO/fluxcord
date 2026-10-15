/**
 * Tree validation: the structural and value checks the type system
 * cannot express.
 *
 * Illegal nesting is already a compile error (closed child unions), and
 * the two select builders make options-XOR-entity unrepresentable.
 * `validateTree` is the echo for what can still arrive through casts or
 * other authoring front-ends, plus the value and bounds rules (lengths,
 * counts, ranges).
 *
 * Renderer-specific limits (embed caps, Components V2 message caps) are
 * not checked here. Renderers loud-reject what they cannot express.
 *
 * @module tree/validate
 */

import { NodeKind, SeparatorSpacing } from './vocab.js';
import type {
	AccessoryNode,
	ButtonNode,
	CheckboxGroupNode,
	CheckboxNode,
	ContainerNode,
	HrNode,
	InputNode,
	LinkNode,
	ModalNode,
	RadioGroupNode,
	RowNode,
	SectionNode,
	SelectNode,
	SelectOption,
	TextNode,
	TreeNode,
	TreeRoot,
	ViewNode,
} from './types.js';

/** One broken rule at one place in the tree. */
export interface Violation {
	/** Tree location, e.g. 'view/row[1]/button[0]'. */
	readonly path: string;
	/** Stable rule identifier. */
	readonly rule: number;
	/** Human-ready explanation; displayed by the caller. */
	readonly message: string;
}

/**
 * The validation rules, named. The numbers are the stable identifiers a
 * violation carries (tests and docs key off them); the names exist so
 * this file reads `Rules.viewNeedsChild` instead of a magic number.
 * Every value is explicit, so nothing renumbers when a rule is added.
 */
export enum Rules {
	/** The tree's root must be a view or a modal. */
	rootKind = 1,
	/** A view needs at least one child. */
	viewNeedsChild = 2,
	/** A view's children are text, row, container or hr only. */
	viewChildKind = 3,
	/** A row's children are button, link or select only. */
	rowChildKind = 4,
	/** A row holds at most five children. */
	rowChildCap = 5,
	/** A modal's children are form fields or text only. */
	modalChildKind = 6,
	/** A modal holds at most five children. */
	modalChildCap = 7,
	/** A select sets exactly one of options or entity. */
	selectOptionsXorEntity = 8,
	/** The node kind is not part of the vocabulary. */
	unknownNodeKind = 9,
	/** A static select holds at most 25 options. */
	selectOptionCap = 10,
	/** Option labels and values are non-empty and unique. */
	optionLabelValue = 11,
	/** minSelected/maxSelected sit in range, in order, within the option count. */
	selectBounds = 12,
	/** input minLength/maxLength sit in 0-4000, in order. */
	inputBounds = 13,
	/** An input's prefill value is at most 4000 chars. */
	inputPrefillCap = 14,
	/** A button's or link's label is 1-80 chars. */
	controlLabelCap = 15,
	/** Option strings are at most 100 chars. */
	optionStringCap = 16,
	/** A select's or input's placeholder is within its cap. */
	placeholderCap = 17,
	/** An input's label is 1-45 chars. */
	inputLabelCap = 18,
	/** A modal's title is 1-45 chars. */
	modalTitleBounds = 19,
	/** A link's url is http(s). */
	linkUrlHttp = 20,
	/** A container's color is an integer in 0x000000-0xFFFFFF. */
	containerColorRange = 21,
	/** A row with a select contains exactly that select. */
	rowSelectExclusive = 22,
	/** A container's children are text, row or hr only. */
	containerChildKind = 23,
	/** A container needs at least one child. */
	containerNeedsChild = 24,
	/** Form field ids are 1-100 chars and unique within the modal. */
	fieldId = 25,
	/** Preselections fit the selection cap. */
	preselectionCap = 26,
	/** An hr's spacing is small or large. */
	hrSpacing = 27,
	/** A button's style is a known vocabulary value. */
	buttonStyleVocab = 28,
	/** An input's style is a known vocabulary value. */
	inputStyleVocab = 29,
	/** A modal select is a proper form field: id, label, no disabled, min for required. */
	modalSelectField = 30,
	/** A message select routes through a handler and carries no modal-only fields. */
	messageSelectHandler = 31,
	/** A form field's description is at most 100 chars. */
	formDescriptionCap = 32,
	/** Checkbox-family labels are 1-45 chars and ids 1-100 chars. */
	checkboxStringBounds = 33,
	/** A checkbox group's options and selection bounds fit 1-10. */
	checkboxGroupBounds = 34,
	/** A radio group takes 2-10 options and at most one preselected. */
	radioGroupBounds = 35,
	/** `values` belongs to a static options list, not an entity select. */
	selectValuesStaticOnly = 36,
	/** A section carries 1-3 text children. */
	sectionTextBounds = 37,
	/** A section takes exactly one accessory block. */
	sectionOneAccessory = 38,
	/** The accessory tag is only legal as a direct section child. */
	accessoryInsideSection = 39,
	/** The accessory block holds exactly one thumbnail, button or link. */
	accessorySingleChild = 40,
	/** A thumbnail carries an http(s) media URL. */
	thumbnailMediaUrl = 41,
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.values(NodeKind));

/** Vocabulary echoes for the style fields a cast can corrupt (rules 28/29). */
const KNOWN_BUTTON_STYLES: ReadonlySet<string> = new Set(['primary', 'secondary', 'success', 'danger']);
const KNOWN_INPUT_STYLES: ReadonlySet<string> = new Set(['short', 'paragraph']);

/**
 * Escape-hatch read of a node's kind for violation messages. Well-typed
 * trees never need this. It exists because the impossible branches
 * (narrowed to `never` by exhaustive checks) still run for cast input.
 */
function kindOf(node: object): string {
	return String((node as { kind?: unknown }).kind);
}

/**
 * Validates a whole tree: the root must be a view or a modal, and every
 * node below it passes its own kind's checks.
 *
 * @param root The tree to check.
 * @returns One entry per violation; an empty array means the tree is clean.
 */
export function validateTree(root: TreeRoot): Violation[] {
	const violations: Violation[] = [];
	if (root.kind !== NodeKind.view && root.kind !== NodeKind.modal) {
		violations.push({
			path: kindOf(root),
			rule: Rules.rootKind,
			message: `root must be view or modal, got '${kindOf(root)}'`,
		});
		return violations;
	}
	validateNode(root, kindOf(root), violations);
	return violations;
}

/**
 * Dispatches each node to its kind's checks; unknown kinds are reported.
 */
function validateNode(node: TreeNode, path: string, violations: Violation[], inModal = false, parentKind?: NodeKind): void {
	switch (node.kind) {
		case NodeKind.view: validateView(node, path, violations); break;
		case NodeKind.text: break; // no value rules of its own; text caps are renderer limits
		case NodeKind.row: validateRow(node, path, violations); break;
		case NodeKind.container: validateContainer(node, path, violations); break;
		case NodeKind.section: validateSection(node, path, violations); break;
		case NodeKind.accessory:
			// The accessory block is a section-only grouping: anywhere else
			// it has no meaning and no wire representation.
			if (parentKind !== NodeKind.section) {
				violations.push({
					path,
					rule: Rules.accessoryInsideSection,
					message: 'the accessory tag is only legal as a direct section child',
				});
			}
			break;
		case NodeKind.thumbnail:
			if (parentKind !== NodeKind.accessory) {
				violations.push({
					path,
					rule: Rules.accessorySingleChild,
					message: 'a thumbnail is only legal inside an accessory block',
				});
			}
			if (!/^https?:\/\//.test(node.media)) {
				violations.push({
					path,
					rule: Rules.thumbnailMediaUrl,
					message: `thumbnail media must be an http(s) URL, got '${node.media}'`,
				});
			}
			break;
		case NodeKind.button: validateButton(node, path, violations); break;
		case NodeKind.link: validateLink(node, path, violations); break;
		case NodeKind.select: validateSelect(node, path, violations, inModal); break;
		case NodeKind.modal: validateModal(node, path, violations); break;
		case NodeKind.input: validateInput(node, path, violations); break;
		case NodeKind.checkbox: validateCheckbox(node, path, violations); break;
		case NodeKind.checkboxGroup: validateCheckboxGroup(node, path, violations); break;
		case NodeKind.radioGroup: validateRadioGroup(node, path, violations); break;
		case NodeKind.hr: validateHr(node, path, violations); break;
		default: {
			// Exhaustive check: adding a kind to NodeKind without a case here
			// breaks the build. So `node` stops being `never` in this arm.
			const unreachable: never = node;
			violations.push({
				path,
				rule: Rules.unknownNodeKind,
				message: `unknown node kind '${kindOf(unreachable)}'`,
			});
		}
	}
}

/**
 * A view needs at least one child, and children are text, row or
 * container only.
 */
function validateView(node: ViewNode, path: string, violations: Violation[]): void {
	if (node.children.length === 0) {
		violations.push({ path, rule: Rules.viewNeedsChild, message: 'view needs at least one child' });
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			// Unknown kind: report it and move on.
			violations.push({ path: childPath, rule: Rules.unknownNodeKind, message: `unknown node kind '${kindOf(child)}'` });
		} else if (child.kind !== NodeKind.text && child.kind !== NodeKind.row && child.kind !== NodeKind.container && child.kind !== NodeKind.section && child.kind !== NodeKind.hr) {
			violations.push({
				path: childPath,
				rule: Rules.viewChildKind,
				message: `view child must be text, row, container, section or hr, got '${kindOf(child)}'`,
			});
		} else {
			validateNode(child, childPath, violations, false, NodeKind.view);
		}
	});
}

/**
 * A section carries one to three text children plus exactly one
 * accessory block, whose single child is a thumbnail, button, or link.
 * The platform's Section component is the whole contract: no other
 * composition exists on the wire.
 */
function validateSection(node: SectionNode, path: string, violations: Violation[]): void {
	const texts = node.children.filter((child): child is TextNode => child.kind === NodeKind.text);
	const accessories = node.children.filter((child): child is AccessoryNode => child.kind === NodeKind.accessory);
	if (texts.length < 1 || texts.length > 3) {
		violations.push({
			path,
			rule: Rules.sectionTextBounds,
			message: `section takes 1-3 text children, got ${texts.length}`,
		});
	}
	if (accessories.length !== 1) {
		violations.push({
			path,
			rule: Rules.sectionOneAccessory,
			message: `section takes exactly one accessory block, got ${accessories.length}`,
		});
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (child.kind === NodeKind.accessory) {
			validateAccessory(child, childPath, violations);
		}
	});
}

/**
 * The accessory block holds exactly one thumbnail, button, or link:
 * the platform's accessory union, selects excluded. The child recurses
 * for its own value checks (a thumbnail's URL rule lives there).
 */
function validateAccessory(node: AccessoryNode, path: string, violations: Violation[]): void {
	const child = node.children[0];
	if (node.children.length !== 1 || child === undefined || (child.kind !== NodeKind.thumbnail && child.kind !== NodeKind.button && child.kind !== NodeKind.link)) {
		violations.push({
			path,
			rule: Rules.accessorySingleChild,
			message: 'the accessory block holds exactly one thumbnail, button or link',
		});
		return;
	}
	validateNode(child, `${path}/${kindOf(child)}[0]`, violations, false, NodeKind.accessory);
}

/**
 * A container needs at least one child, its children are text or row
 * only (nested containers are forbidden by the platform), and its
 * color, when set, is an integer in `0x000000`-`0xFFFFFF`.
 */
function validateContainer(node: ContainerNode, path: string, violations: Violation[]): void {
	if (node.children.length === 0) {
		violations.push({ path, rule: Rules.containerNeedsChild, message: 'container needs at least one child' });
	}
	if (node.color !== undefined && (!Number.isInteger(node.color) || node.color < 0x000000 || node.color > 0xffffff)) {
		violations.push({
			path,
			rule: Rules.containerColorRange,
			message: `container color must be an integer in 0x000000-0xFFFFFF, got ${node.color}`,
		});
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			violations.push({ path: childPath, rule: Rules.unknownNodeKind, message: `unknown node kind '${kindOf(child)}'` });
		} else if (child.kind !== NodeKind.text && child.kind !== NodeKind.row && child.kind !== NodeKind.section && child.kind !== NodeKind.hr) {
			violations.push({
				path: childPath,
				rule: Rules.containerChildKind,
				message: `container child must be text, row, section or hr, got '${kindOf(child)}'`,
			});
		} else {
			validateNode(child, childPath, violations, false, NodeKind.container);
		}
	});
}

/**
 * A row holds at most 5 children, every child is a control (button,
 * link or select), and a row containing a select must contain nothing
 * else: the platform allows up to 5 buttons or exactly one select,
 * never a mix.
 */
function validateRow(node: RowNode, path: string, violations: Violation[]): void {
	if (node.children.length > 5) {
		violations.push({
			path,
			rule: Rules.rowChildCap,
			message: `row allows at most 5 children, got ${node.children.length}`,
		});
	}
	if (node.children.some((child) => child.kind === NodeKind.select) && node.children.length !== 1) {
		violations.push({
			path,
			rule: Rules.rowSelectExclusive,
			message: `row with a select must have exactly one child, got ${node.children.length}`,
		});
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			violations.push({ path: childPath, rule: Rules.unknownNodeKind, message: `unknown node kind '${kindOf(child)}'` });
		} else if (child.kind !== NodeKind.button && child.kind !== NodeKind.link && child.kind !== NodeKind.select) {
			violations.push({
				path: childPath,
				rule: Rules.rowChildKind,
				message: `row child must be button, link or select, got '${kindOf(child)}'`,
			});
		} else {
			validateNode(child, childPath, violations);
		}
	});
}

/**
 * A modal's title is 1-45 chars, it holds at most 5 children, children
 * are form fields (input, select, checkbox, checkbox-group, radio-group)
 * or text only, and field ids are unique within the modal.
 */
function validateModal(node: ModalNode, path: string, violations: Violation[]): void {
	if (node.title.length === 0 || node.title.length > 45) {
		violations.push({
			path,
			rule: Rules.modalTitleBounds,
			message: `modal title must be 1-45 chars, got ${node.title.length}`,
		});
	}
	if (node.children.length > 5) {
		violations.push({
			path,
			rule: Rules.modalChildCap,
			message: `modal allows at most 5 children, got ${node.children.length}`,
		});
	}
	const seenFieldIds = new Set<string>();
	const FIELD_KINDS: ReadonlySet<NodeKind> = new Set([NodeKind.input, NodeKind.select, NodeKind.checkbox, NodeKind.checkboxGroup, NodeKind.radioGroup]);
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			violations.push({ path: childPath, rule: Rules.unknownNodeKind, message: `unknown node kind '${kindOf(child)}'` });
		} else if (!FIELD_KINDS.has(child.kind) && child.kind !== NodeKind.text) {
			violations.push({
				path: childPath,
				rule: Rules.modalChildKind,
				message: `modal child must be a field (input, select, checkbox, checkbox-group, radio-group) or text, got '${kindOf(child)}'`,
			});
		} else {
			if (FIELD_KINDS.has(child.kind)) {
				const id = (child as unknown as { id?: string }).id;
				if (id !== undefined) {
					if (seenFieldIds.has(id)) {
						violations.push({
							path: childPath,
							rule: Rules.fieldId,
							message: `duplicate field id '${id}'`,
						});
					}
					seenFieldIds.add(id);
				}
			}
			validateNode(child, childPath, violations, true);
		}
	});
}

/** A button's label is 1-80 chars and its style, when set, is a known vocabulary value. */
function validateButton(node: ButtonNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 80) {
		violations.push({
			path,
			rule: Rules.controlLabelCap,
			message: `button label must be 1-80 chars, got ${node.label.length}`,
		});
	}
	if (node.style !== undefined && !KNOWN_BUTTON_STYLES.has(node.style)) {
		violations.push({
			path,
			rule: Rules.buttonStyleVocab,
			message: `button style must be 'primary', 'secondary', 'success' or 'danger', got '${node.style}'`,
		});
	}
}

/** A link's label is 1-80 chars and its url must be http(s). */
function validateLink(node: LinkNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 80) {
		violations.push({
			path,
			rule: Rules.controlLabelCap,
			message: `link label must be 1-80 chars, got ${node.label.length}`,
		});
	}
	if (!isHttpUrl(node.url)) {
		violations.push({
			path,
			rule: Rules.linkUrlHttp,
			message: `link url must be a valid http(s) url, got '${node.url}'`,
		});
	}
}

/** Utility to check if a string is a valid http or https URL. */
function isHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * An hr's spacing is small or large; `divider` is boolean by type, so
 * only a corrupted spacing can arrive through a cast.
 */
function validateHr(node: HrNode, path: string, violations: Violation[]): void {
	if (node.spacing !== undefined && node.spacing !== SeparatorSpacing.Small && node.spacing !== SeparatorSpacing.Large) {
		violations.push({
			path,
			rule: Rules.hrSpacing,
			message: `hr spacing must be 'small' or 'large', got '${String(node.spacing)}'`,
		});
	}
}

/**
 * A select sets exactly one of options or entity (the compile-time
 * split's runtime echo), its placeholder is at most 150 chars, its
 * `minSelected`/`maxSelected` sit in 0-25 with min not above max, and
 * a static options list holds at most 25 entries with unique non-empty
 * labels and values of at most 100 chars each. Preselected options
 * (`default: true`) and entity preselections (`defaultIds`) must fit
 * the selection cap; `defaultIds` belongs to entity selects only, and the
 * live `values` preselection belongs to static lists only (rule 36).
 *
 * The context rules split the two lives of the node: in a modal it is a
 * form field and needs its `id` and `label` (rule 30); in a message it
 * is a control and needs its handler, with the modal-only fields absent
 * (rule 31).
 */
function validateSelect(node: SelectNode, path: string, violations: Violation[], inModal: boolean): void {
	const hasOptions = node.options !== undefined;
	const hasEntity = node.entity !== undefined;
	if (hasOptions === hasEntity) {
		violations.push({
			path,
			rule: Rules.selectOptionsXorEntity,
			message: hasOptions
				? 'select must not set both options and entity'
				: 'select must set exactly one of options or entity',
		});
	}
	if (inModal) {
		// Rule 30: a modal select is a form field. The Label needs its
		// heading, the submission reads its value under the id, and the
		// wire has no disabled state there.
		if (node.id === undefined) {
			violations.push({ path, rule: Rules.modalSelectField, message: 'modal select needs an id' });
		} else if (node.id.length === 0 || node.id.length > 100) {
			violations.push({ path, rule: Rules.modalSelectField, message: `modal select id must be 1-100 chars, got ${node.id.length}` });
		}
		if (node.label === undefined) {
			violations.push({ path, rule: Rules.modalSelectField, message: 'modal select needs a label' });
		} else if (node.label.length === 0 || node.label.length > 45) {
			violations.push({ path, rule: Rules.modalSelectField, message: `modal select label must be 1-45 chars, got ${node.label.length}` });
		}
		if (node.description !== undefined && node.description.length > 100) {
			// The types promise "Max 100 characters" for the modal helper line
			// (rule 32, shared with the other form fields' descriptions).
			violations.push({ path, rule: Rules.formDescriptionCap, message: `modal select description max 100 chars, got ${node.description.length}` });
		}
		if (node.disabled !== undefined) {
			violations.push({ path, rule: Rules.modalSelectField, message: 'a modal select cannot be disabled' });
		}
		if (node.required !== false && node.minSelected === 0) {
			violations.push({ path, rule: Rules.modalSelectField, message: 'a required modal select needs minSelected >= 1' });
		}
	} else {
		// Rule 31: a message select routes through its handler, and the
		// Label-bound fields only exist in modals.
		if (node.onSelect === undefined) {
			violations.push({ path, rule: Rules.messageSelectHandler, message: 'a message select needs a handler' });
		}
		const modalOnly: string[] = [];
		if (node.label !== undefined) modalOnly.push('label');
		if (node.id !== undefined) modalOnly.push('id');
		if (modalOnly.length > 0) {
			violations.push({
				path,
				rule: Rules.messageSelectHandler,
				message: `modal-only field '${modalOnly.join("', '")}' on a message select`,
			});
		}
	}
	if (node.placeholder !== undefined && node.placeholder.length > 150) {
		violations.push({
			path,
			rule: Rules.placeholderCap,
			message: `select placeholder max 150 chars, got ${node.placeholder.length}`,
		});
	}
	for (const bound of ['minSelected', 'maxSelected'] as const) {
		const value = node[bound];
		// maxSelected floors at 1: the platform's max_values lower bound is 1
		// (only min_values reaches 0), so 0 would pass here and 400 on the wire.
		const floor = bound === 'maxSelected' ? 1 : 0;
		if (value !== undefined && (value < floor || value > 25)) {
			violations.push({
				path,
				rule: Rules.selectBounds,
				message: `select ${bound} must be in ${floor}-25, got ${value}`,
			});
		}
	}
	if (node.minSelected !== undefined && node.maxSelected !== undefined && node.minSelected > node.maxSelected) {
		violations.push({
			path,
			rule: Rules.selectBounds,
			message: `select minSelected (${node.minSelected}) must not exceed maxSelected (${node.maxSelected})`,
		});
	}
	if (node.defaultIds !== undefined) {
		if (node.options !== undefined && node.entity === undefined) {
			violations.push({
				path,
				rule: Rules.selectOptionsXorEntity,
				message: 'select defaultIds belongs to an entity select, not a static options list',
			});
		}
		// Same cap as option preselections: maxSelected when set, the platform
		// default of 1 when not (the renderer omits max_values then).
		const cap = node.maxSelected ?? 1;
		if (node.defaultIds.length > cap) {
			violations.push({
				path,
				rule: Rules.preselectionCap,
				message: `select preselects ${node.defaultIds.length} entities, more than the selection cap (${cap})`,
			});
		}
	}
	if (node.values !== undefined && node.entity !== undefined) {
		violations.push({
			path,
			rule: Rules.selectValuesStaticOnly,
			message: 'select values belongs to a static options list, not an entity select',
		});
	}
	if (node.options) {
		const options = node.options;
		if (options.length > 25) {
			violations.push({
				path,
				rule: Rules.selectOptionCap,
				message: `select allows at most 25 options, got ${options.length}`,
			});
		}
		if (node.minSelected !== undefined && node.minSelected > options.length) {
			violations.push({
				path,
				rule: Rules.selectBounds,
				message: `select minSelected (${node.minSelected}) exceeds option count (${options.length})`,
			});
		}
		if (node.maxSelected !== undefined && node.maxSelected > options.length) {
			violations.push({
				path,
				rule: Rules.selectBounds,
				message: `select maxSelected (${node.maxSelected}) exceeds option count (${options.length})`,
			});
		}
		// Preselections must fit the selection cap: maxSelected when set, the
		// platform default of 1 when not (the renderer omits max_values then).
		const defaults = options.filter((option) => option.default === true).length;
		const cap = node.maxSelected ?? 1;
		if (defaults > cap) {
			violations.push({
				path,
				rule: Rules.preselectionCap,
				message: `select preselects ${defaults} options, more than the selection cap (${cap})`,
			});
		}
		checkOptionEntries(options, path, violations);
	}
}

/**
 * The per-option checks shared by selects and the modal groups: labels
 * and values are non-empty (rule 11), values unique (rule 11), and every
 * string within the platform's 100-char caps (rule 16).
 */
function checkOptionEntries(options: readonly SelectOption[], path: string, violations: Violation[]): void {
	const seen = new Set<string>();
	options.forEach((option, index) => {
		const optionPath = `${path}/option[${index}]`;
		if (option.label.length === 0) {
			violations.push({ path: optionPath, rule: Rules.optionLabelValue, message: 'option label must not be empty' });
		}
		if (option.value.length === 0) {
			violations.push({ path: optionPath, rule: Rules.optionLabelValue, message: 'option value must not be empty' });
		}
		if (seen.has(option.value)) {
			violations.push({
				path: optionPath,
				rule: Rules.optionLabelValue,
				message: `duplicate option value '${option.value}'`,
			});
		}
		seen.add(option.value);
		if (option.label.length > 100) {
			violations.push({
				path: optionPath,
				rule: Rules.optionStringCap,
				message: `option label max 100 chars, got ${option.label.length}`,
			});
		}
		if (option.value.length > 100) {
			violations.push({
				path: optionPath,
				rule: Rules.optionStringCap,
				message: `option value max 100 chars, got ${option.value.length}`,
			});
		}
		if (option.description !== undefined && option.description.length > 100) {
			violations.push({
				path: optionPath,
				rule: Rules.optionStringCap,
				message: `option description max 100 chars, got ${option.description.length}`,
			});
		}
	});
}

/**
 * An input's id is 1-100 chars (it becomes the platform `custom_id`),
 * its label 1-45 chars, its placeholder and description at most 100
 * chars, its `minLength`/`maxLength` sit in 0-4000 with min not above
 * max, and a prefill value is at most 4000 chars.
 */
function validateInput(node: InputNode, path: string, violations: Violation[]): void {
	if (node.id.length === 0 || node.id.length > 100) {
		violations.push({
			path,
			rule: Rules.fieldId,
			message: `input id must be 1-100 chars, got ${node.id.length}`,
		});
	}
	if (node.label.length === 0 || node.label.length > 45) {
		violations.push({
			path,
			rule: Rules.inputLabelCap,
			message: `input label must be 1-45 chars, got ${node.label.length}`,
		});
	}
	if (node.description !== undefined && node.description.length > 100) {
		violations.push({
			path,
			rule: Rules.formDescriptionCap,
			message: `input description max 100 chars, got ${node.description.length}`,
		});
	}
	if (node.placeholder !== undefined && node.placeholder.length > 100) {
		violations.push({
			path,
			rule: Rules.placeholderCap,
			message: `input placeholder max 100 chars, got ${node.placeholder.length}`,
		});
	}
	if (node.style !== undefined && !KNOWN_INPUT_STYLES.has(node.style)) {
		violations.push({
			path,
			rule: Rules.inputStyleVocab,
			message: `input style must be 'short' or 'paragraph', got '${node.style}'`,
		});
	}
	for (const bound of ['minLength', 'maxLength'] as const) {
		const value = node[bound];
		if (value !== undefined && (value < 0 || value > 4000)) {
			violations.push({
				path,
				rule: Rules.inputBounds,
				message: `input ${bound} must be in 0-4000, got ${value}`,
			});
		}
	}
	if (node.minLength !== undefined && node.maxLength !== undefined && node.minLength > node.maxLength) {
		violations.push({
			path,
			rule: Rules.inputBounds,
			message: `input minLength (${node.minLength}) must not exceed maxLength (${node.maxLength})`,
		});
	}
	if (node.value !== undefined && node.value.length > 4000) {
		violations.push({
			path,
			rule: Rules.inputPrefillCap,
			message: `input value (prefill) max 4000 chars, got ${node.value.length}`,
		});
	}
}

/**
 * A checkbox's label is 1-45 chars (the wrapping Label's heading), its
 * id 1-100 chars (the wire `custom_id`), and its description at most
 * 100 chars.
 */
function validateCheckbox(node: CheckboxNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 45) {
		violations.push({ path, rule: Rules.checkboxStringBounds, message: `checkbox label must be 1-45 chars, got ${node.label.length}` });
	}
	if (node.id.length === 0 || node.id.length > 100) {
		violations.push({ path, rule: Rules.checkboxStringBounds, message: `checkbox id must be 1-100 chars, got ${node.id.length}` });
	}
	if (node.description !== undefined && node.description.length > 100) {
		violations.push({ path, rule: Rules.formDescriptionCap, message: `checkbox description max 100 chars, got ${node.description.length}` });
	}
}

/**
 * A checkbox group shares the checkbox's string bounds (rules 33/32),
 * takes one to ten options with `minSelected` in 0-10 and `maxSelected`
 * in 1-10, neither above the other nor above the option count (rule 34),
 * and reuses the select's per-option checks.
 */
function validateCheckboxGroup(node: CheckboxGroupNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 45) {
		violations.push({ path, rule: Rules.checkboxStringBounds, message: `checkbox group label must be 1-45 chars, got ${node.label.length}` });
	}
	if (node.id.length === 0 || node.id.length > 100) {
		violations.push({ path, rule: Rules.checkboxStringBounds, message: `checkbox group id must be 1-100 chars, got ${node.id.length}` });
	}
	if (node.description !== undefined && node.description.length > 100) {
		violations.push({ path, rule: Rules.formDescriptionCap, message: `checkbox group description max 100 chars, got ${node.description.length}` });
	}
	const count = node.options?.length ?? 0;
	if (count < 1 || count > 10) {
		violations.push({ path, rule: Rules.checkboxGroupBounds, message: `checkbox group allows 1-10 options, got ${count}` });
	}
	if (node.minSelected !== undefined && (node.minSelected < 0 || node.minSelected > 10)) {
		violations.push({ path, rule: Rules.checkboxGroupBounds, message: `checkbox group minSelected must be in 0-10, got ${node.minSelected}` });
	}
	if (node.maxSelected !== undefined && (node.maxSelected < 1 || node.maxSelected > 10)) {
		violations.push({ path, rule: Rules.checkboxGroupBounds, message: `checkbox group maxSelected must be in 1-10, got ${node.maxSelected}` });
	}
	if (node.minSelected !== undefined && node.maxSelected !== undefined && node.minSelected > node.maxSelected) {
		violations.push({
			path,
			rule: Rules.checkboxGroupBounds,
			message: `checkbox group minSelected (${node.minSelected}) must not exceed maxSelected (${node.maxSelected})`,
		});
	}
	if (node.options) {
		if (node.minSelected !== undefined && node.minSelected > node.options.length) {
			violations.push({
				path,
				rule: Rules.checkboxGroupBounds,
				message: `checkbox group minSelected (${node.minSelected}) exceeds option count (${node.options.length})`,
			});
		}
		if (node.maxSelected !== undefined && node.maxSelected > node.options.length) {
			violations.push({
				path,
				rule: Rules.checkboxGroupBounds,
				message: `checkbox group maxSelected (${node.maxSelected}) exceeds option count (${node.options.length})`,
			});
		}
		checkOptionEntries(node.options, path, violations);
	}
}

/**
 * A radio group shares the checkbox's string bounds (rules 33/32), takes
 * two to ten options (rule 35), at most one of them preselected (rule 35),
 * and reuses the select's per-option checks.
 */
function validateRadioGroup(node: RadioGroupNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 45) {
		violations.push({ path, rule: Rules.checkboxStringBounds, message: `radio group label must be 1-45 chars, got ${node.label.length}` });
	}
	if (node.id.length === 0 || node.id.length > 100) {
		violations.push({ path, rule: Rules.checkboxStringBounds, message: `radio group id must be 1-100 chars, got ${node.id.length}` });
	}
	if (node.description !== undefined && node.description.length > 100) {
		violations.push({ path, rule: Rules.formDescriptionCap, message: `radio group description max 100 chars, got ${node.description.length}` });
	}
	const count = node.options?.length ?? 0;
	if (count < 2 || count > 10) {
		violations.push({ path, rule: Rules.radioGroupBounds, message: `radio group allows 2-10 options, got ${count}` });
	}
	if (node.options) {
		const defaults = node.options.filter((option) => option.default === true).length;
		if (defaults > 1) {
			violations.push({
				path,
				rule: Rules.radioGroupBounds,
				message: `radio group allows at most one preselected option, got ${defaults}`,
			});
		}
		checkOptionEntries(node.options, path, violations);
	}
}
