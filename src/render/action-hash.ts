/**
 * A short, stable id for one handler.
 *
 * When a click comes back from Discord, the only thing it carries is the
 * small string we stamped on the control, so that string has to say which
 * handler to run. This module derives it from the handler's own source
 * code: hash `fn.toString()` and keep the first few characters. The same
 * source always hashes to the same id, even after a restart, and editing
 * the handler changes the id, so a button drawn before a deploy stops
 * working instead of quietly running new code.
 *
 * Source alone cannot tell two identical closures apart, because each
 * captures its own variables. The hash is therefore only the base:
 * `materializeTree` (`commit/frame.ts`) appends an occurrence count
 * (`-1`, `-2`, ...) when the same source shows up twice in one draw.
 *
 * Authors never see these ids. The commit phase computes them, the codec
 * carries them, and dispatch resolves them back to the handler.
 *
 * One standing constraint: the hash depends on readable source, so this
 * package must never ship minified or mangled code. Plain tsc output keeps
 * that true.
 *
 * @module render/action-hash
 */

import { createHash } from 'node:crypto';

/** Hash width. Base36 (digits and lowercase letters) keeps it short, and its alphabet can never contain the codec's ':' or '#' delimiters. */
const HASH_LENGTH = 6;

/**
 * Fingerprints one handler into a short, deterministic id. No registry and
 * no counter stands behind it: the id is a pure function of the source,
 * which is what keeps it stable across restarts.
 *
 * @param handler The handler to fingerprint. The parameter is typed
 *   `never` for the same reason the tree's control nodes use it: any
 *   flow's handler has to fit the slot.
 * @returns The hash, exactly six base36 characters.
 */
export function actionHash(handler: (event: never) => unknown): string {
	const digest = createHash('sha256').update(handler.toString()).digest();
	// Read the digest as one big number, write it in base36, then crop or
	// pad so every hash comes out exactly six characters.
	let value = 0n;
	for (const byte of digest) value = (value << 8n) | BigInt(byte);
	let encoded = value.toString(36);
	if (encoded.length > HASH_LENGTH) encoded = encoded.slice(0, HASH_LENGTH);
	return encoded.padStart(HASH_LENGTH, '0');
}
