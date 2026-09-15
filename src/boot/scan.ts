/**
 * The dev coverage scan: render every view against its flow's own
 * initialData, report views that throw. Pure; the host calls it in dev
 * boots. Policy coverage is not scanned here: every flow must carry an
 * entry in its module's policies catalog, and the app-side loader fails
 * the boot on a missing (or dead) entry, a static check stronger than
 * any tree walk.
 *
 * @module boot/scan
 */

import type { ViewSession } from '../flow/types.js';
import { runtimeKit } from '../tree/kit.js';
import { normalizeViewRoot } from '../tree/normalize.js';
import type { FlowCatalog } from './build.js';

/**
 * Renders every screen of every flow in the catalog against a clone of
 * its own initialData.
 *
 * @returns One human-readable line per failing view; an empty array
 *   means every view rendered clean.
 */
export function coverageScan(catalog: FlowCatalog): string[] {
	const lines: string[] = [];
	for (const token of catalog.tokens) {
		const def = token.definition;
		for (const screenId of def.screenIds) {
			const screen = def.screens[screenId];
			const key = `${token.moduleId}/${screenId}`;
			try {
				// A clone, so a misbehaving view cannot touch the declared bag;
				// the cast is safe here (the scan renders declared data, not a
				// live session). The session stub is zeroed: views reading the
				// session (an expiry line) render their zero-state without
				// crashing the scan. The element root is folded to a view node,
				// same as commit: a dropped root (conditional at the top)
				// fails the scan loudly.
				const stub: ViewSession = {
					ownerId: '',
					createdAt: 0,
					screen: screenId,
					history: [],
					lastActivityAt: 0,
					ttlMs: def.ttlMs,
				};
				const tree = normalizeViewRoot(screen.view(structuredClone(def.initialData) as never, runtimeKit, stub));
				void tree;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				lines.push(`${key}: view threw on initialData (${message}): guard the view or declare richer initialData`);
			}
		}
	}
	return lines;
}
