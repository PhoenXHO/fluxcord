/**
 * The expiry line: a flow's deadline, shown as a live countdown.
 *
 * Discord renders `<t:seconds:R>` as a dynamic timestamp the client keeps
 * ticking on its own, so a panel draws once and the countdown stays
 * current with no further edits. {@link expiryEpoch} reads the session's
 * death line (the ephemeral wall when the mount has a ceiling, the
 * sliding window otherwise) and `<Expiry>` renders it as one text node.
 * Placement is the author's: a wrap arrow shows the line once per flow
 * (the session is in scope there), and a view places it anywhere the
 * deadline is already known.
 *
 * @module flow/expiry
 */

import type { Session } from '../state/types.js';
import { text } from '../tree/builders.js';
import type { TextNode } from '../tree/types.js';

/**
 * The session's death line as Unix seconds, ready for a `<t:...:R>`
 * timestamp. The absolute `expiresAt` ceiling wins when the session has
 * one (an ephemeral line); otherwise the sliding window is computed at
 * call time, so a draw made after a click shows the moved deadline.
 *
 * @param session The live session being drawn.
 * @returns The death line as Unix seconds (floored).
 */
export function expiryEpoch(session: Session<unknown>): number {
	const ms = session.expiresAt ?? session.lastActivityAt + session.ttlMs;
	return Math.floor(ms / 1000);
}

/** `<Expiry>` props: the deadline and its word. */
export interface ExpiryProps {
	/** The death line as Unix seconds: `expiryEpoch(session)` at draw time. */
	readonly until: number;
	/** The word before the timestamp. Default: 'Expires'. */
	readonly label?: string;
}

/**
 * The expiry line as one text node: `Expires <t:epoch:R>`, ticking
 * client-side with no further edits. A wrap arrow places it once per
 * flow, where the session is in scope; spreading the drawn tree into the
 * new view (`<view {...tree}>`) keeps its title and content around the
 * line.
 *
 * @param props The deadline, and the word before it.
 * @returns The text node carrying the countdown.
 */
export function Expiry(props: ExpiryProps): TextNode {
	return text({ body: `${props.label ?? 'Expires'} <t:${props.until}:R>` });
}
