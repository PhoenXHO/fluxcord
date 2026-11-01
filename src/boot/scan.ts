/**
 * The dev coverage scan: render every view against its flow's own
 * initialData, report views that throw. Pure; the host calls it in dev
 * boots. Policy gates are not scanned here: they are inert values the
 * host's engine evaluates per click, so there is nothing to walk
 * statically — the one boot check that exists is the duplicate-name
 * throw when a flow is declared.
 *
 * @module boot/scan
 */

import type { ViewSession } from '../flow/types.js';
import { kitFor } from '../tree/kit.js';
import { normalizeViewRoot } from '../tree/normalize.js';
import { validateTree } from '../tree/validate.js';
import { flowTokens } from '../flow/registry.js';

/**
 * Renders every screen of every declared flow against a clone of its own
 * initialData, reporting views that throw or fail tree validation. Call it
 * once the app's modules are loaded, so every flow exists.
 *
 * @returns One human-readable line per failing view; an empty array
 *   means every view rendered clean.
 */
export function coverageScan(): string[] {
	const lines: string[] = [];
	for (const token of flowTokens()) {
		const def = token.definition;
		for (const screenId of def.screenIds) {
			const screen = def.screens[screenId];
			const key = `${token.flowId}/${screenId}`;
			try {
				// A clone, so a misbehaving view cannot touch the declared bag;
				// the cast is safe here (the scan renders declared data, not a
				// live session). The session stub is zeroed: views reading the
				// session (an expiry line, a Back button) render their
				// zero-state without crashing the scan. The element root is
				// folded to a view node, same as commit: a dropped root
				// (conditional at the top) fails the scan loudly.
				const stub: ViewSession = {
					ownerId: '',
					createdAt: 0,
					screen: screenId,
					history: [],
					lastActivityAt: 0,
					ttlMs: def.ttlMs,
					belowRoot: false,
				};
				const tree = normalizeViewRoot(screen.view(structuredClone(def.initialData ?? {}) as never, kitFor(stub), stub));
				const violation = validateTree(tree)[0];
				if (violation !== undefined) {
					lines.push(`${key}: illegal tree at ${violation.path} (rule ${violation.rule}): ${violation.message}`);
					continue;
				}
				void tree;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				lines.push(`${key}: view threw on initialData (${message}): guard the view or declare richer initialData`);
			}
		}
	}
	return lines;
}
