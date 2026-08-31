/**
 * The freeze transform: what ui.close leaves on the message.
 *
 * A pure tree pass: interactive controls (buttons, selects) are stripped;
 * everything truthful stays: text, and links, because a link is inert
 * content, not a control. Any row or container emptied by the strip is
 * dropped. The result keeps the session's final state visible and
 * readable, with nothing left to click.
 *
 * @module commit/freeze
 */

import { NodeKind } from '../tree/vocab.js';
import type { ContainerNode, LinkNode, RowNode, ViewNode } from '../tree/types.js';

/** Row after freeze: links only; undefined when the strip emptied it. */
function freezeRow(node: RowNode): RowNode | undefined {
	const children = node.children.filter((child): child is LinkNode => child.kind === NodeKind.link);
	return children.length > 0 ? { ...node, children } : undefined;
}

/** Container after freeze: text plus frozen rows; undefined when nothing survives. */
function freezeContainer(node: ContainerNode): ContainerNode | undefined {
	const children = [];
	for (const child of node.children) {
		if (child.kind === NodeKind.row) {
			const row = freezeRow(child);
			if (row !== undefined) {
				children.push(row);
			}
		} else {
			children.push(child);
		}
	}
	return children.length > 0 ? { ...node, children } : undefined;
}

/** Strips every interactive node from a rendered view, dropping emptied rows and containers. */
export function freezeTree(root: ViewNode): ViewNode {
	const children = [];
	for (const child of root.children) {
		if (child.kind === NodeKind.row) {
			const row = freezeRow(child);
			if (row !== undefined) {
				children.push(row);
			}
		} else if (child.kind === NodeKind.container) {
			const container = freezeContainer(child);
			if (container !== undefined) {
				children.push(container);
			}
		} else {
			children.push(child);
		}
	}
	return { ...root, children };
}
