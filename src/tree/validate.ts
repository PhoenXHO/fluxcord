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

import { NodeKind } from './vocab.js';
import type {
	ButtonNode,
	ContainerNode,
	InputNode,
	LinkNode,
	ModalNode,
	RowNode,
	SelectNode,
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

const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.values(NodeKind));

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
			rule: 1,
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
function validateNode(node: TreeNode, path: string, violations: Violation[]): void {
	switch (node.kind) {
		case NodeKind.view: validateView(node, path, violations); break;
		case NodeKind.text: break; // no value rules of its own; text caps are renderer limits
		case NodeKind.row: validateRow(node, path, violations); break;
		case NodeKind.container: validateContainer(node, path, violations); break;
		case NodeKind.button: validateButton(node, path, violations); break;
		case NodeKind.link: validateLink(node, path, violations); break;
		case NodeKind.select: validateSelect(node, path, violations); break;
		case NodeKind.modal: validateModal(node, path, violations); break;
		case NodeKind.input: validateInput(node, path, violations); break;
		default: {
			// Exhaustive check: adding a kind to NodeKind without a case here
			// breaks the build. So `node` stops being `never` in this arm.
			const unreachable: never = node;
			violations.push({
				path,
				rule: 9,
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
		violations.push({ path, rule: 2, message: 'view needs at least one child' });
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			// Unknown kind: report it and move on.
			violations.push({ path: childPath, rule: 9, message: `unknown node kind '${kindOf(child)}'` });
		} else if (child.kind !== NodeKind.text && child.kind !== NodeKind.row && child.kind !== NodeKind.container) {
			violations.push({
				path: childPath,
				rule: 3,
				message: `view child must be text, row or container, got '${kindOf(child)}'`,
			});
		} else {
			validateNode(child, childPath, violations);
		}
	});
}

/**
 * A container needs at least one child, its children are text or row
 * only (nested containers are forbidden by the platform), and its
 * color, when set, is an integer in `0x000000`-`0xFFFFFF`.
 */
function validateContainer(node: ContainerNode, path: string, violations: Violation[]): void {
	if (node.children.length === 0) {
		violations.push({ path, rule: 24, message: 'container needs at least one child' });
	}
	if (node.color !== undefined && (!Number.isInteger(node.color) || node.color < 0x000000 || node.color > 0xffffff)) {
		violations.push({
			path,
			rule: 21,
			message: `container color must be an integer in 0x000000-0xFFFFFF, got ${node.color}`,
		});
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			violations.push({ path: childPath, rule: 9, message: `unknown node kind '${kindOf(child)}'` });
		} else if (child.kind !== NodeKind.text && child.kind !== NodeKind.row) {
			violations.push({
				path: childPath,
				rule: 23,
				message: `container child must be text or row, got '${kindOf(child)}'`,
			});
		} else {
			validateNode(child, childPath, violations);
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
			rule: 5,
			message: `row allows at most 5 children, got ${node.children.length}`,
		});
	}
	if (node.children.some((child) => child.kind === NodeKind.select) && node.children.length !== 1) {
		violations.push({
			path,
			rule: 22,
			message: `row with a select must have exactly one child, got ${node.children.length}`,
		});
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			violations.push({ path: childPath, rule: 9, message: `unknown node kind '${kindOf(child)}'` });
		} else if (child.kind !== NodeKind.button && child.kind !== NodeKind.link && child.kind !== NodeKind.select) {
			violations.push({
				path: childPath,
				rule: 4,
				message: `row child must be button, link or select, got '${kindOf(child)}'`,
			});
		} else {
			validateNode(child, childPath, violations);
		}
	});
}

/**
 * A modal's title is 1-45 chars, it holds at most 5 children, children
 * are inputs or text only, and input ids are unique within the modal.
 */
function validateModal(node: ModalNode, path: string, violations: Violation[]): void {
	if (node.title.length === 0 || node.title.length > 45) {
		violations.push({
			path,
			rule: 19,
			message: `modal title must be 1-45 chars, got ${node.title.length}`,
		});
	}
	if (node.children.length > 5) {
		violations.push({
			path,
			rule: 7,
			message: `modal allows at most 5 children, got ${node.children.length}`,
		});
	}
	const seenInputIds = new Set<string>();
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			violations.push({ path: childPath, rule: 9, message: `unknown node kind '${kindOf(child)}'` });
		} else if (child.kind !== NodeKind.input && child.kind !== NodeKind.text) {
			violations.push({
				path: childPath,
				rule: 6,
				message: `modal child must be input or text, got '${kindOf(child)}'`,
			});
		} else {
			if (child.kind === NodeKind.input) {
				if (seenInputIds.has(child.id)) {
					violations.push({
						path: childPath,
						rule: 25,
						message: `duplicate input id '${child.id}'`,
					});
				}
				seenInputIds.add(child.id);
			}
			validateNode(child, childPath, violations);
		}
	});
}

/** A button's label is 1-80 chars. */
function validateButton(node: ButtonNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 80) {
		violations.push({
			path,
			rule: 15,
			message: `button label must be 1-80 chars, got ${node.label.length}`,
		});
	}
}

/** A link's label is 1-80 chars and its url must be http(s). */
function validateLink(node: LinkNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 80) {
		violations.push({
			path,
			rule: 15,
			message: `link label must be 1-80 chars, got ${node.label.length}`,
		});
	}
	if (!isHttpUrl(node.url)) {
		violations.push({
			path,
			rule: 20,
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
 * A select sets exactly one of options or entity (the compile-time
 * split's runtime echo), its placeholder is at most 150 chars, its
 * `minSelected`/`maxSelected` sit in 0-25 with min not above max, and
 * a static options list holds at most 25 entries with unique non-empty
 * labels and values of at most 100 chars each. Preselected options
 * (`default: true`) must fit the selection cap.
 */
function validateSelect(node: SelectNode, path: string, violations: Violation[]): void {
	const hasOptions = node.options !== undefined;
	const hasEntity = node.entity !== undefined;
	if (hasOptions === hasEntity) {
		violations.push({
			path,
			rule: 8,
			message: hasOptions
				? 'select must not set both options and entity'
				: 'select must set exactly one of options or entity',
		});
	}
	if (node.placeholder !== undefined && node.placeholder.length > 150) {
		violations.push({
			path,
			rule: 17,
			message: `select placeholder max 150 chars, got ${node.placeholder.length}`,
		});
	}
	for (const bound of ['minSelected', 'maxSelected'] as const) {
		const value = node[bound];
		if (value !== undefined && (value < 0 || value > 25)) {
			violations.push({
				path,
				rule: 12,
				message: `select ${bound} must be in 0-25, got ${value}`,
			});
		}
	}
	if (node.minSelected !== undefined && node.maxSelected !== undefined && node.minSelected > node.maxSelected) {
		violations.push({
			path,
			rule: 12,
			message: `select minSelected (${node.minSelected}) must not exceed maxSelected (${node.maxSelected})`,
		});
	}
	if (node.options) {
		const options = node.options;
		if (options.length > 25) {
			violations.push({
				path,
				rule: 10,
				message: `select allows at most 25 options, got ${options.length}`,
			});
		}
		if (node.minSelected !== undefined && node.minSelected > options.length) {
			violations.push({
				path,
				rule: 12,
				message: `select minSelected (${node.minSelected}) exceeds option count (${options.length})`,
			});
		}
		if (node.maxSelected !== undefined && node.maxSelected > options.length) {
			violations.push({
				path,
				rule: 12,
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
				rule: 26,
				message: `select preselects ${defaults} options, more than the selection cap (${cap})`,
			});
		}
		const seen = new Set<string>();
		options.forEach((option, index) => {
			const optionPath = `${path}/option[${index}]`;
			if (option.label.length === 0) {
				violations.push({ path: optionPath, rule: 11, message: 'option label must not be empty' });
			}
			if (option.value.length === 0) {
				violations.push({ path: optionPath, rule: 11, message: 'option value must not be empty' });
			}
			if (seen.has(option.value)) {
				violations.push({
					path: optionPath,
					rule: 11,
					message: `duplicate option value '${option.value}'`,
				});
			}
			seen.add(option.value);
			if (option.label.length > 100) {
				violations.push({
					path: optionPath,
					rule: 16,
					message: `option label max 100 chars, got ${option.label.length}`,
				});
			}
			if (option.value.length > 100) {
				violations.push({
					path: optionPath,
					rule: 16,
					message: `option value max 100 chars, got ${option.value.length}`,
				});
			}
			if (option.description !== undefined && option.description.length > 100) {
				violations.push({
					path: optionPath,
					rule: 16,
					message: `option description max 100 chars, got ${option.description.length}`,
				});
			}
		});
	}
}

/**
 * An input's id is 1-100 chars (it becomes the platform `custom_id`),
 * its label 1-45 chars, its placeholder at most 100 chars, its
 * `minLength`/`maxLength` sit in 0-4000 with min not above max, and
 * a prefill value is at most 4000 chars.
 */
function validateInput(node: InputNode, path: string, violations: Violation[]): void {
	if (node.id.length === 0 || node.id.length > 100) {
		violations.push({
			path,
			rule: 25,
			message: `input id must be 1-100 chars, got ${node.id.length}`,
		});
	}
	if (node.label.length === 0 || node.label.length > 45) {
		violations.push({
			path,
			rule: 18,
			message: `input label must be 1-45 chars, got ${node.label.length}`,
		});
	}
	if (node.placeholder !== undefined && node.placeholder.length > 100) {
		violations.push({
			path,
			rule: 17,
			message: `input placeholder max 100 chars, got ${node.placeholder.length}`,
		});
	}
	for (const bound of ['minLength', 'maxLength'] as const) {
		const value = node[bound];
		if (value !== undefined && (value < 0 || value > 4000)) {
			violations.push({
				path,
				rule: 13,
				message: `input ${bound} must be in 0-4000, got ${value}`,
			});
		}
	}
	if (node.minLength !== undefined && node.maxLength !== undefined && node.minLength > node.maxLength) {
		violations.push({
			path,
			rule: 13,
			message: `input minLength (${node.minLength}) must not exceed maxLength (${node.maxLength})`,
		});
	}
	if (node.value !== undefined && node.value.length > 4000) {
		violations.push({
			path,
			rule: 14,
			message: `input value (prefill) max 4000 chars, got ${node.value.length}`,
		});
	}
}