/**
 * Tree validation.
 * 
 * This module checks a tree for violations of the rules documented in
 * <TODO: replace with rules file path>. The rules are enforced at runtime because the
 * TypeScript type system cannot express all of them.
 *
 * The type system already forbids illegal nesting (closed child unions) and
 * the two select builders already make options-XOR-entity unrepresentable.
 * `validateTree` is the echo for what can still arrive through casts or other
 * authoring front-ends, plus the value/bounds rules types can't express
 * (lengths, counts, ranges).
 *
 * Renderer-specific limits (embed caps, Components V2 message caps) are NOT
 * checked here. Renderers loud-reject what they cannot express.
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
 * Validates a whole tree.
 * Enforces: rule 1 (root must be view or modal); everything else is reached
 * by recursion from here.
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
 * Dispatches to the per-kind checks.
 * Enforces: rule 9 (unknown kind) via the exhaustive switch.
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
 * Enforces:
 *   - rule 2 (view needs a child),
 *   - rule 3 (children are text/row/container only),
 *   - rule 9 via the child loop.
 */
function validateView(node: ViewNode, path: string, violations: Violation[]): void {
	if (node.children.length === 0) {
		violations.push({ path, rule: 2, message: 'view needs at least one child' });
	}
	node.children.forEach((child, index) => {
		const childPath = `${path}/${kindOf(child)}[${index}]`;
		if (!KNOWN_KINDS.has(child.kind)) {
			// just in case
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
 * Enforces:
 *   - rule 24 (container needs a child),
 *   - rule 23 (children are text/row only; also bans nested
 *     containers, which the platform forbids),
 *   - rule 21 (color range),
 *   - rule 9 via the child loop.
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
 * Enforces:
 *   - rule 4 (children are controls only),
 *   - rule 5 (max 5 children),
 *   - rule 22 (a row with a select has exactly one child; the platform
 *     allows up to 5 buttons OR exactly one select, never a mix),
 *   - rule 9 via the child loop.
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
 * Enforces:
 *   - rule 19 (title length),
 *   - rule 7 (max 5 children),
 *   - rule 6 (children are input/text only),
 *   - rule 25 (input ids unique within the modal),
 *   - rule 9 via the child loop.
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

/**
 * Enforces: rule 15 (label length).
 */
function validateButton(node: ButtonNode, path: string, violations: Violation[]): void {
	if (node.label.length === 0 || node.label.length > 80) {
		violations.push({
			path,
			rule: 15,
			message: `button label must be 1-80 chars, got ${node.label.length}`,
		});
	}
}

/**
 * Enforces:
 *   - rule 15 (label length),
 *   - rule 20 (url must be http(s)).
 */
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
 * Enforces:
 *   - rule 8 (exactly one of options/entity; the builders already
 *     prevent this at compile time; this is the runtime echo),
 *   - rule 10 (max 25 options),
 *   - rule 11 (non-empty unique option labels/values),
 *   - rule 12 (minSelected/maxSelected bounds),
 *   - rule 16 (option text lengths),
 *   - rule 17 (placeholder length).
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
 * Enforces:
 *   - rule 25 (id length; it becomes the platform custom_id),
 *   - rule 18 (label length),
 *   - rule 13 (minLength/maxLength bounds),
 *   - rule 14 (prefill value length),
 *   - rule 17 (placeholder length).
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