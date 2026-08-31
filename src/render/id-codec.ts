/**
 * The `custom_id` codec: the only code that builds and reads the ids the
 * renderer stamps onto interactive controls.
 *
 * Wire format:  `ui2:<sessionId>:<screenKey>#<actionHash>`
 * Example:      `ui2:9x7K2mQp:core/panel#a3f9x2`
 *
 * A `custom_id` is the only thing Discord echoes back on a click, so it has
 * to carry everything needed to route that click: which session, which
 * screen, which handler. The `actionHash` part is the control's stamp, the
 * handler's source hash plus an occurrence count within the draw (see
 * `commit/frame.ts`); authors never choose or see any of it.
 *
 * encode is the single construction point, so a format change is one
 * string in this file. It rejects ':' and '#' inside any part, because
 * only those two are structural: a `screenKey` may contain '/', it is
 * `'<moduleId>/<screenId>'`. The stamp's occurrence suffix (`'-1'`, `'-2'`, ...)
 * rides in the same part as the hash and cannot collide with it, since
 * base36 never contains `'-'`. encode also throws past the platform's
 * 100-character `custom_id` cap.
 *
 * decode is strict: anything malformed throws, nothing is guessed, and
 * the final proof is re-encoding the parsed parts and requiring the exact
 * original string back. Session ids are opaque here; whoever generates
 * them must keep the delimiters out.
 *
 * @module render/id-codec
 */

const PREFIX = 'ui2:';

/** Discord caps a `custom_id` at 100 characters; encode refuses to build a longer one. */
const MAX_CUSTOM_ID = 100;

/**
 * One parsed `custom_id`, everything the router needs to route a click: the
 * `sessionId` finds the live session, the screenKey finds the screen the
 * control was drawn on, and the `actionHash` finds the handler inside that
 * screen.
 */
export interface ActionAddress {
	/** The live session the control was drawn in. */
	readonly sessionId: string;
	/** The registry key of the screen the control was drawn on, `'<moduleId>/<screenId>'`. */
	readonly screenKey: string;
	/** The control's stamp: the handler's source hash (`action-hash.ts`) plus an occurrence suffix ('-1', '-2', ...) when the same source appears more than once in a draw. */
	readonly actionHash: string;
}

/**
 * Packs the three parts into one wire string.
 *
 * @param address The parts to pack.
 * @returns The `custom_id`, `ui2:<sessionId>:<screenKey>#<actionHash>`.
 * @throws When a part is empty, contains `':'` or `'#'`, or the built string
 *   would pass the 100-character platform cap.
 */
export function encodeActionId(address: ActionAddress): string {
	const { sessionId, screenKey, actionHash } = address;
	for (const [field, value] of Object.entries({ sessionId, screenKey, actionHash })) {
		if (value.length === 0) throw new Error(`encodeActionId: '${field}' must not be empty`);
		if (/[:#]/.test(value)) {
			throw new Error(`encodeActionId: '${field}' must not contain ':' or '#'`);
		}
	}
	const id = `${PREFIX}${sessionId}:${screenKey}#${actionHash}`;
	if (id.length > MAX_CUSTOM_ID) {
		throw new Error(`encodeActionId: built id is ${id.length} chars, max is ${MAX_CUSTOM_ID}`);
	}
	return id;
}

/** Tells whether a `custom_id` is one of ours. The interaction router checks this before routing, so ids other code put on components are left alone. It lives here because only this file knows the prefix. */
export function isActionId(id: string): boolean {
	return id.startsWith(PREFIX);
}

/**
 * Unpacks a wire string back into its parts.
 *
 * @param id The `custom_id` from an incoming interaction.
 * @returns The parsed address.
 * @throws When the id is not ours, is missing a delimiter, or has empty
 *   parts or stray delimiters.
 */
export function decodeActionId(id: string): ActionAddress {
	if (!id.startsWith(PREFIX)) {
		throw new Error(`decodeActionId: id must start with '${PREFIX}'`);
	}
	const rest = id.slice(PREFIX.length);
	const sessionEnd = rest.indexOf(':');
	const hashIndex = rest.indexOf('#');
	if (sessionEnd === -1 || hashIndex === -1) {
		throw new Error('decodeActionId: malformed id (missing delimiters)');
	}
	const address: ActionAddress = {
		sessionId: rest.slice(0, sessionEnd),
		screenKey: rest.slice(sessionEnd + 1, hashIndex),
		actionHash: rest.slice(hashIndex + 1),
	};
	// Slicing alone accepts strings encode would never build (a ':' inside
	// the hash part still slices cleanly), so the real acceptance test is
	// re-encoding the parts and requiring the exact original back.
	let roundTrip: string;
	try {
		roundTrip = encodeActionId(address);
	} catch {
		throw new Error('decodeActionId: malformed id (empty parts or embedded delimiters)');
	}
	if (roundTrip !== id) {
		throw new Error('decodeActionId: malformed id (empty parts or embedded delimiters)');
	}
	return address;
}
