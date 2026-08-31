/**
 * The Discord bridge: binds the fluxcord runtime's ports to a live client.
 *
 * Three jobs live here and nowhere else:
 *
 * 1. Delivery: editMessage / sendToChannel / replySender turn the renderer's
 *    raw V2 payloads into Discord API calls. Payloads are already
 *    wire-shaped, so the casts say "trust the renderer", not "hope".
 *    Failures throw to the pipeline, whose error policy owns them.
 *
 * 2. Interaction binding: replyToActor and showModal need the live
 *    interaction object (a raw id cannot be replied to: the token lives on
 *    the object), but the runtime holds one singleton platform port. The
 *    bridge binds the interaction for the duration of one dispatch, which
 *    works because the dispatch core's per-session queue resolves only when
 *    the whole job (handler included) finishes, so `await core(incoming)`
 *    covers every reply/modal the handler triggers. Concurrent interactions
 *    would race the singleton binding, so dispatches serialize on a chain
 *    (mutex). The per-session FIFO still governs WITHIN a session; the mutex
 *    The per-session FIFO still governs within a session; the mutex
 *    trades a little cross-session latency for correctness.
 *
 * 3. Success ack: a component click that was neither replied to (denial or
 *    error copy) nor deferred is deferUpdate()d when its dispatch
 *    finishes. A message edit is not an acknowledgment: an unanswered
 *    interaction renders as a stuck spinner and, three seconds in, an "app
 *    didn't respond" failure painted onto whatever button now sits first in
 *    the row. Content keeps flowing through edits; the ack only closes
 *    Discord's response window. A modal counts as the answer itself, so
 *    those dispatches skip the ack.
 *
 * Ephemeral panels are unsupported by design: the framework edits messages
 * by MessageRef, and ephemeral replies are unreachable after the interaction
 * expires. Mounts therefore reply publicly (fetchReply): denials and error
 * copy reach the actor via replyToActor, ephemeral unless the host's
 * ephemeralAsPublic option flips it public for dev observability.
 *
 * @module discord/platform
 */

import { MessageFlags } from 'discord.js';
import type {
	ChatInputCommandInteraction,
	Client,
	InteractionReplyOptions,
	MessageCreateOptions,
	MessageEditOptions,
	ModalComponentData,
} from 'discord.js';
import type { BridgePort, IncomingEvent } from '../pipeline/types.js';
import type { InteractionSender } from '../runtime/types.js';
import type { MessageRef } from '../state/types.js';
import type { V2MessagePayload, V2ModalPayload } from '../render/v2.js';
import type { NewUiComponentInteraction } from './flatten.js';
import { flattenInteraction } from './flatten.js';

/** What the bridge logs through: the host's logger, or silence. */
export interface BridgeLogger {
	debug(message: string, ...details: unknown[]): void;
	warn(message: string, ...details: unknown[]): void;
}

const SILENT: BridgeLogger = Object.freeze({
	debug: () => undefined,
	warn: () => undefined,
});

/** What the host may hand the bridge at wiring time. */
export interface BridgeOptions {
	/** Logs bridge-side anomalies (dropped replies, ack failures). Defaults to silence. */
	readonly logger?: BridgeLogger;
	/**
	 * Sends actor-facing copy (denials, error copy) publicly instead of
	 * ephemeral, the host's dev-observability switch. Defaults to false.
	 */
	readonly ephemeralAsPublic?: boolean;
}

/** What createUiBridge hands the host app. */
export interface UiBridge {
	/** The bridge arm of the platform port (replyToActor, editMessage, showModal). */
	readonly platform: BridgePort;
	/** The { channel } mount arm: sends a new message, reports where it landed. */
	readonly sendToChannel: (channelId: string, payload: V2MessagePayload) => Promise<MessageRef>;
	/** The { reply } mount arm for a live command interaction (public reply + fetchReply). */
	readonly replySender: (interaction: ChatInputCommandInteraction) => InteractionSender;
	/**
	 * One component interaction in, one dispatch out: flatten, bind, serialize,
	 * hand to the core. The runtime's dispatch fn is passed per call so the
	 * bridge never imports the runtime (wiring stays in the composition root).
	 */
	readonly dispatch: (interaction: NewUiComponentInteraction, core: (incoming: IncomingEvent) => Promise<void>) => Promise<void>;
}

/**
 * Binds one client to the framework's seams.
 *
 * @param client The logged-in Discord client delivering interactions.
 * @param options Optional logger and ephemeral switch.
 * @returns The bridge: the platform port, the mount arms and dispatch.
 */
export function createUiBridge(client: Client, options: BridgeOptions = {}): UiBridge {
	const log = options.logger ?? SILENT;
	// --- Interaction binding (see module doc, job 2) ---------------------------
	let bound: NewUiComponentInteraction | null = null;
	/** True while the dispatch in flight answered with a modal (an ack would kill it). */
	let modalOpen = false;
	let chain: Promise<unknown> = Promise.resolve();

	async function replyToActor(text: string): Promise<void> {
		const interaction = bound;
		if (interaction === null) {
			log.warn(`replyToActor outside a dispatch window, text dropped: "${text.slice(0, 80)}"`);
			return;
		}
		try {
			// Ephemeral copy unless the host's ephemeralAsPublic switch flips
			// it public for dev observability. The replied/deferred switch
			// matters: a followUp lands beside the panel; a fresh reply on
			// an answered interaction would throw.
			const flags: { flags?: MessageFlags.Ephemeral } = options.ephemeralAsPublic === true ? {} : { flags: MessageFlags.Ephemeral };
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({ content: text, ...flags });
			} else {
				await interaction.reply({ content: text, ...flags });
			}
		} catch (err) {
			// Expired/acknowledged interactions cannot take the copy: drop it
			// rather than throw: the pipeline cannot act on a lost denial.
			log.debug('replyToActor failed (interaction likely expired)', err);
		}
	}

	async function showModal(payload: V2ModalPayload): Promise<void> {
		const interaction = bound;
		if (interaction === null) {
			log.warn('showModal outside a dispatch window: modal dropped');
			return;
		}
		// Modals open from component clicks only: a modal submit cannot carry
		// another modal. d.js types agree (no showModal there).
		if (interaction.isModalSubmit()) {
			log.warn('showModal on a modal-submit interaction: modal dropped');
			return;
		}
		// Raw-API payload handed to d.js verbatim: the builders exist to emit
		// exactly this wire shape.
		await interaction.showModal(payload as unknown as ModalComponentData);
		modalOpen = true;
	}

	// --- Delivery (see module doc, job 1) ----------------------------------------

	async function editMessage(ref: MessageRef, payload: V2MessagePayload): Promise<void> {
		const channel = await client.channels.fetch(ref.channelId);
		if (channel === null || !channel.isSendable()) {
			throw new Error(`bridge editMessage: channel ${ref.channelId} is not a message channel`);
		}
		const message = await channel.messages.fetch(ref.messageId);
		await message.edit(payload as unknown as MessageEditOptions);
	}

	async function sendToChannel(channelId: string, payload: V2MessagePayload): Promise<MessageRef> {
		const channel = await client.channels.fetch(channelId);
		if (channel === null || !channel.isSendable()) {
			throw new Error(`bridge sendToChannel: channel ${channelId} is not a message channel`);
		}
		const sent = await channel.send(payload as unknown as MessageCreateOptions);
		return { channelId, messageId: sent.id };
	}

	function replySender(interaction: ChatInputCommandInteraction): InteractionSender {
		return {
			async send(payload: V2MessagePayload): Promise<MessageRef> {
				// Public + fetchReply: the session must own an editable message.
				// The cast keeps the fetchReply literal so d.js picks the
				// Message-returning overload.
				const options = { ...payload, fetchReply: true } as unknown as InteractionReplyOptions & { fetchReply: true };
				const message = await interaction.reply(options);
				return { channelId: message.channelId, messageId: message.id };
			},
		};
	}

	// --- Dispatch: flatten, bind, serialize -------------------------------------

	async function dispatch(
		interaction: NewUiComponentInteraction,
		core: (incoming: IncomingEvent) => Promise<void>,
	): Promise<void> {
		const run = chain.then(async () => {
			const incoming = flattenInteraction(interaction);
			if (incoming === undefined) {
				log.warn(`Interaction without a backing message dropped (customId '${interaction.customId.slice(0, 40)}')`);
				return;
			}
			bound = interaction;
			modalOpen = false;
			try {
				await core(incoming);
			} finally {
				// Success ack (job 3): if the dispatch answered through the
				// interaction itself (denial copy, error copy, modal) the window
				// is closed; otherwise close it now: the content already went
				// out as edits, this is bookkeeping so Discord doesn't render
				// the click as a failed one.
				if (!modalOpen && !interaction.replied && !interaction.deferred) {
					await interaction.deferUpdate().catch((err) => log.debug('deferUpdate ack failed', err));
				}
				bound = null;
			}
		});
		// The chain swallows outcomes so a failed dispatch never jams the mutex;
		// the caller still sees the original rejection via `run`.
		chain = run.then(() => undefined, () => undefined);
		await run;
	}

	return { platform: { replyToActor, showModal, editMessage }, sendToChannel, replySender, dispatch };
}
