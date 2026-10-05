/**
 * The UI host accessor: how command handlers reach the fluxcord runtime.
 *
 * The runtime and bridge are locals of the composition root; module
 * command handlers that mount a flow need exactly two abilities: mounting
 * a flow onto a live interaction's reply, and building that reply sender.
 * This module is the single injection point: set once during boot,
 * consumed from anywhere. The composition root owns the objects; modules
 * never import it.
 *
 * @module discord/ui-host
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import type { Flow } from '../flow/token.js';
import type { Policy, PolicyDecision } from '../pipeline/types.js';
import type { InteractionSender, MountHandle, MountOptions } from '../runtime/types.js';

/** The two runtime abilities a command handler needs to open a flow. */
export interface UiHost {
	/** Mounts a flow's first screen; see UiRuntime.mount. */
	mount<TData>(flow: Flow<TData>, options: MountOptions): Promise<MountHandle<TData>>;
	/** Builds the reply target for one live command interaction; `{ ephemeral: true }` rides the interaction line. */
	replySender(interaction: ChatInputCommandInteraction, as?: { ephemeral?: boolean }): InteractionSender;
	/**
	 * The command door: answers whether this interaction may mount this
	 * flow at all, from the invocation's identity and the leaf's gate.
	 * Wired by the composition root from the policy port and the boot
	 * catalog; absent when the host declared no policy option (nothing
	 * gated, nothing asked).
	 */
	checkDoor?(flow: Flow<unknown>, gate: Policy, interaction: ChatInputCommandInteraction): Promise<PolicyDecision>;
}

let host: UiHost | undefined;

/** Called once from the composition root, after the runtime and bridge exist. */
export function setUiHost(next: UiHost): void {
	host = next;
}

/** The host accessor. Throws if read before boot wiring: a mount before the runtime exists is a bug. */
export function uiHost(): UiHost {
	if (!host) {
		throw new Error('uiHost: not wired: setUiHost must run during boot, before any flow mount');
	}
	return host;
}
