/**
 * Root normalization.
 * 
 * This module folds the TSX element union into the concrete tree the commit
 * phase draws because TSX folds element expressions into a flat union.
 * 
 * A view root is a view node; a modal root is a modal node; a fragment root
 * is an empty view with the fragment's children. A dropped root
 * (false/null/undefined) throws at the author-facing call site so the screen
 * has something to draw, instead of failing silently in the commit phase.
 * 
 * Illegal view children are caught in the tree validator, not here. The TSX
 * union is too broad to narrow here. One shape is forgiven here: a bare
 * control (a select, button, or link) gets its own synthetic row, because
 * the platform only hosts controls inside action rows and the fix is
 * unambiguous. Each control gets its own row; an author who wants controls
 * to share a row wraps them in one explicitly.
 *
 * @module tree/normalize
 */

import { container, row, view } from './builders.js';
import type { ComponentResult, ContainerChild, ModalNode, TreeNode, ViewChild, ViewNode } from './types.js';
import { NodeKind } from './vocab.js';

/**
 * Coerces one children value into a flat node list: drop true/false/null/undefined,
 * flatten arrays arbitrarily deep, keep nodes. Bare strings/numbers throw
 * loudly because a child has to be a node; bare text belongs inside a text node.
 */
export function coerceChildren(children: unknown): readonly TreeNode[] {
	const out: TreeNode[] = [];
	collect(children, out);
	return out;
}

function collect(value: unknown, out: TreeNode[]): void {
	if (value === false || value === true || value === null || value === undefined) {
		// drop true/false/null/undefined
		return;
	}
	if (isNodeList(value)) {
		for (const inner of value) collect(inner, out);
		return;
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
		throw new Error(`a bare ${typeof value} is not a child node; copy belongs in a text body`);
	}
	out.push(value as TreeNode);
}

/**
 * Returns true if the value is a node list (array or readonly array) and false
 * otherwise. This is a type guard that narrows the value to a node list.
 */
function isNodeList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

/**
 * Normalizes a TSX root into a view node, throwing if the root is dropped (true/false/null/undefined).
 * A fragment root is wrapped in a view node with the fragment's children.
 * 
 * @param rendered The TSX root to normalize.
 * @returns The normalized view node.
 * @throws If the root is dropped (true/false/null/undefined).
 */
export function normalizeViewRoot(rendered: ComponentResult): ViewNode {
	if (rendered === false || rendered === null || rendered === undefined || rendered === true) {
		throw new Error('view returned nothing; a root `{cond && <view/>}` drops when cond is false; keep the root unconditional');
	}
	if (isNodeList(rendered)) {
		return wrapBareControls(view({}, ...(coerceChildren(rendered) as readonly ViewChild[])));
	}
	if (typeof rendered === 'object' && rendered.kind === 'view') {
		return wrapBareControls(rendered);
	}
	return wrapBareControls(view({}, rendered as ViewChild));
}

/**
 * Wraps bare control nodes in synthetic rows: the platform only accepts a
 * select, button, or link inside an action row, so one dropped straight into
 * a view or container gets its own row. Manual wrapping keeps working, and a
 * row that mixes a select with other controls is left for the renderer to
 * reject rather than rewritten here.
 *
 * Returns the original node when nothing needed wrapping so unchanged screens
 * keep their identity.
 */
function wrapBareControls(root: ViewNode): ViewNode {
	const children = wrapControlChildren(root.children);
	if (children === root.children) return root;
	return view({ ...(root.title !== undefined ? { title: root.title } : {}) }, ...(children as readonly ViewChild[]));
}

function wrapControlChildren(children: readonly TreeNode[]): readonly TreeNode[] {
	let changed = false;
	const next = children.map((child) => {
		if (child.kind === NodeKind.select || child.kind === NodeKind.button || child.kind === NodeKind.link) {
			changed = true;
			return row({}, child);
		}
		if (child.kind === NodeKind.container) {
			const inner = wrapControlChildren(child.children);
			if (inner === child.children) return child;
			changed = true;
			return container(
				{ ...(child.color !== undefined ? { color: child.color } : {}) },
				...(inner as readonly ContainerChild[]),
			);
		}
		return child;
	});
	return changed ? next : children;
}

/**
 * Normalizes a TSX root into a modal node, throwing if the root is dropped (false/null/undefined) or not a modal node.
 * 
 * @param rendered The TSX root to normalize.
 * @returns The normalized modal node.
 * @throws If the root is dropped or not a modal node.
 */
export function normalizeModalRoot(rendered: ComponentResult): ModalNode {
	if (typeof rendered === 'object' && rendered !== null && !isNodeList(rendered) && rendered.kind === 'modal') {
		return rendered;
	}
	throw new Error('showModal needs a <modal> root; a fragment or a dropped root is not a modal');
}
