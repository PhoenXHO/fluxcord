/**
 * The default parting screen: what an expired, non-rehydratable message
 * becomes. Framework-owned: built directly as a tree here, never a
 * registered module view. The command hint is flow metadata that reaches
 * this screen through wiring, not through the registry.
 *
 * @module commit/parting
 */

import { text, view } from '../tree/builders.js';
import type { ViewNode } from '../tree/types.js';

/**
 * Builds the parting tree. `commandHint` is the flow's command name without
 * the slash (e.g. 'lotto'); `note` is the flow's extra line under the copy
 * (e.g. why it expired). Both arrive through the flow's parting bundle.
 */
export function partingView(commandHint?: string, note?: string): ViewNode {
	const lines: string[] = ['This screen has expired.'];
	if (commandHint !== undefined) lines.push('', `Run \`/${commandHint}\` to start a new one.`);
	if (note !== undefined) lines.push('', note);
	return view({}, text({ body: lines.join('\n') }));
}
