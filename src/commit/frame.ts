/**
 * Tree materialization: the wiring lives in the draw.
 *
 * One walk per draw stamps every actionable control and builds the frame.
 * A control's wire id is a pure function of the tree it was rendered in:
 * the handler's source hash plus its occurrence within the draw.
 * Occurrence 0 emits the bare hash (byte-compatible with every wire id
 * ever sent); occurrence 1, 2 and up append `-1`, `-2`. The counter resets
 * every draw and counts in document order, so the same screen drawn from
 * the same data yields the same ids: inline and generated handlers are
 * fully legal, and revived flows keep their ids by construction.
 *
 * The frame half is the click registry: what the engine last drew is the
 * whole truth about what is clickable. The stampOf half is the renderer's
 * window into the same walk: rendering without materializing (and thus
 * emitting colliding bare hashes) is structurally impossible.
 *
 * The label comes from the control itself: a button's label prop, a
 * select's placeholder (or 'select'). Diagnostic only, like every label.
 *
 * @module commit/frame
 */

import { actionHash } from '../render/action-hash.js';
import type { StampLookup } from '../render/v2.js';
import { NodeKind } from '../tree/vocab.js';
import type { ActionHandler, ActionRecord } from '../pipeline/types.js';
import type { ButtonNode, RowNode, SelectNode, ViewNode } from '../tree/types.js';

/** One draw's wiring: the click registry plus the renderer's stamps. */
export interface MaterializedTree {
	readonly frame: Readonly<Record<string, ActionRecord>>;
	readonly stampOf: StampLookup;
}

/**
 * Stamps each actionable control and builds the frame in one document-order
 * walk. The walk mirrors the tree's legal shapes: controls live in rows,
 * rows at the top level or inside containers. A frozen (stripped) tree
 * materializes to an empty frame, closing the message for clicks.
 */
export function materializeTree(tree: ViewNode): MaterializedTree {
	const stamps = new Map<ButtonNode | SelectNode, string>();
	const occurrences = new Map<string, number>();
	const frame: Record<string, ActionRecord> = {};

	/** Base hash + occurrence = stamp. Occurrence 0 is the bare hash. */
	function stamp(handler: ActionHandler<never>, control: ButtonNode | SelectNode, label: string): void {
		const base = actionHash(handler);
		const seen = occurrences.get(base) ?? 0;
		occurrences.set(base, seen + 1);
		const id = seen === 0 ? base : `${base}-${seen}`;
		stamps.set(control, id);
		// The cast is the one type-erase point: controls carry never-typed
		// handlers so any flow's typed handler fits, while the frame speaks
		// the erased form. A control-declared policy rides its record to the
		// policy consult.
		frame[id] = {
			handler: handler as ActionHandler<unknown>,
			label,
			...(control.policy !== undefined ? { policy: control.policy } : {}),
		};
	}

	function stampRow(row: RowNode): void {
		for (const control of row.children) {
			if (control.kind === NodeKind.button) {
				stamp(control.onClick, control, control.label);
			} else if (control.kind === NodeKind.select && control.onSelect !== undefined) {
				// onSelect is optional on the node for the modal context; rule 31
				// (and the renderer's own loud gate) rejects it in messages.
				stamp(control.onSelect, control, control.placeholder ?? 'select');
			}
		}
	}

	for (const child of tree.children) {
		if (child.kind === NodeKind.row) {
			stampRow(child);
		} else if (child.kind === NodeKind.container) {
			for (const grandchild of child.children) {
				if (grandchild.kind === NodeKind.row) {
					stampRow(grandchild);
				}
			}
		}
	}

	return {
		frame: Object.freeze(frame),
		stampOf: (control): string => {
			const id = stamps.get(control);
			if (id === undefined) {
				throw new Error('materialize: control was not stamped; render the tree materializeTree walked');
			}
			return id;
		},
	};
}
