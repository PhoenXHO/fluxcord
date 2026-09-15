/**
 * The session store: create, get, touch, close and sweep over the live
 * sessions, all in memory.
 *
 * Expiry is sliding and derived: a session is expired when
 * `now > lastActivityAt + ttlMs`, and every accepted event bumps
 * `lastActivityAt`, reviving the session for a full further window. A
 * session may also carry an absolute `expiresAt` ceiling (a wall-limited
 * surface such as an ephemeral line); that one never slides. An
 * expired-but-unswept session stays readable through `get`, because a
 * late revive can still claim it; deletion belongs to the sweeper alone.
 *
 * The store never calls Discord and never touches a database. End-of-life
 * side effects (parting views, message tidy) travel out through the
 * injected `onEnd` hook with the reason; the commit phase decides what
 * each reason does to the message.
 *
 * @module state/store
 */

import type { CreateSessionInput, Session } from './types.js';
import { EndReason, RemountPolicy } from './types.js';

// --- Ids & expiry ----------------------------------------------------------------

const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 8;

/**
 * Generates a short opaque id from the 62-char alphabet; session ids and
 * modal nonces both. Uniqueness among live sessions is guarded by the
 * collision loop in `create`; reuse after death is guarded by id space
 * (62^8) plus frame resolution: a wrong-session click misses that
 * session's frame and bounces as stale, so it can never misdeliver.
 */
export function generateId(): string {
	let id = '';
	for (let i = 0; i < ID_LENGTH; i += 1) {
		id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
	}
	return id;
}

/** The one expiry rule, as a comparison: the sliding TTL, or an absolute `expiresAt` ceiling when the surface has one. */
export function isExpired(session: Session<unknown>, now: number): boolean {
	return now > session.lastActivityAt + session.ttlMs || (session.expiresAt !== undefined && now > session.expiresAt);
}

// --- The store -------------------------------------------------------------------

/**
 * The store's public face: everything the pipeline and runtime may do with
 * live sessions. It is all synchronous, and death side effects travel out
 * through `onEnd` rather than return values.
 */
export interface SessionStore {
	/**
	 * Creates a session. Under remount `'replace'`, every live session of the
	 * same flow the owner already holds is closed through the full close
	 * path first.
	 * 
	 * @param input The session's flow, module, owner, message, TTL, and data.
	 *   The id is optional: it is pre-generated for the first payload of a mount,
	 *   and carried through revive clicks; otherwise it is generated here.
	 * @returns The new session, which is live and present in the store.
	 * @throws On a non-finite or non-positive `ttlMs`.
	 */
	create<TData>(input: CreateSessionInput<TData>): Session<TData>;
	/** @returns The session if present, even expired. */
	get(id: string): Session<unknown> | undefined;
	/**
	 * @returns The owner's live, unexpired session of this flow, if any:
	 * the revive path's old-yields check, where a newer session wins over
	 * a late click. It is the same match remount-replace applies at create
	 * time, exposed as a read.
	 */
	findLive(flowId: string, ownerId: string): Session<unknown> | undefined;
	/**
	 * Bumps `lastActivityAt`, sliding the revival window forward.
	 * 
	 * @returns `false` when the session is unknown or already expired;
	 * expiry never revives.
	 */
	touch(id: string): boolean;
	/**
	 * Deletes the session and fires `onEnd` with `'close'`.
	 * 
	 * @returns `false` when unknown.
	 */
	close(id: string): boolean;
	/**
	 * Reaps every expired session, firing `onEnd` with `'expire'` per reap.
	 *
	 * @returns The reap count.
	 */
	sweep(): number;
}

/** Options for {@link createSessionStore}. */
export interface SessionStoreOptions {
	/**
	 * Fired for every session death, close and expiry alike. Which behavior
	 * applies (tidy the message, parting view, leave untouched) is decided
	 * by the wiring from the `reason` and the session's own rehydrate field.
	 * Optional: with no hook, sessions still die and get deleted, but
	 * nobody is told.
	 *
	 * @param session The session that is ending.
	 * @param reason Why it ended: `'close'` or `'expire'`.
	 */
	onEnd?: (session: Session<unknown>, reason: EndReason) => void;
	/** Injectable clock, so tests move time by hand instead of waiting. Defaults to `Date.now`. */
	now?: () => number;
}

/**
 * Builds a session store.
 *
 * `onEnd` fires for every session death, close and expiry alike; which
 * end-of-life behavior applies (tidy, parting view, leave untouched) is
 * decided by the wiring from the `reason` and the session's own rehydrate
 * field. `now` defaults to `Date.now` and exists so TTL tests can move
 * time by hand.
 * 
 * @param options The store's end-of-life hook and clock.
 * @returns The store, which is all synchronous and in-memory.
 */
export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
	const now = options.now ?? Date.now;
	const sessions = new Map<string, Session<unknown>>();

	/** The exit path for real deaths: delete first, then report. The silent revive-replace in `create` is the one deliberate bypass. */
	function end(session: Session<unknown>, reason: EndReason): void {
		sessions.delete(session.id);
		options.onEnd?.(session, reason);
	}

	return {
		create<TData>(input: CreateSessionInput<TData>): Session<TData> {
			if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
				throw new Error(`ttlMs must be finite and positive, got ${String(input.ttlMs)}`);
			}
			// The caller may pass an id it already has: mount needs one
			// before the message exists (the first payload embeds it), and
			// revive must reuse the id the click carried. A dead record
			// under that id is dropped quietly, without the end path. The
			// create is itself the revival, and the end path would freeze
			// the message being revived and delete its rehydrate row. A
			// live record under that id means two sessions claim one id,
			// and that throws.
			let id: string;
			if (input.id !== undefined) {
				const existing = sessions.get(input.id);
				if (existing !== undefined) {
					if (isExpired(existing, now())) {
						sessions.delete(input.id);
					} else {
						throw new Error(`session id '${input.id}' is already live`);
					}
				}
				id = input.id;
			} else {
				id = generateId();
				while (sessions.has(id)) {
					id = generateId();
				}
			}
			// Replace closes every live session of this flow the owner
			// holds, not just the first one found: coexist can have stacked
			// several. The loop walks a copy because end() deletes from
			// the map mid-iteration.
			if (input.remount === RemountPolicy.Replace) {
				for (const existing of [...sessions.values()]) {
					if (existing.flowId === input.flowId && existing.ownerId === input.ownerId) {
						end(existing, EndReason.Close);
					}
				}
			}
			const at = now();
			const session: Session<TData> = {
				id,
				flowId: input.flowId,
				moduleId: input.moduleId,
				ownerId: input.ownerId,
				messageRef: input.messageRef,
				createdAt: at,
				ttlMs: input.ttlMs,
				...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
				rehydrate: input.rehydrate,
				lastActivityAt: at,
				data: input.data,
				screen: input.screen,
				history: [],
				modalNonce: generateId(),
				frame: {},
			};
			sessions.set(id, session);
			return session;
		},

		get(id: string): Session<unknown> | undefined {
			return sessions.get(id);
		},

		findLive(flowId: string, ownerId: string): Session<unknown> | undefined {
			const at = now();
			for (const session of sessions.values()) {
				if (session.flowId === flowId && session.ownerId === ownerId && !isExpired(session, at)) {
					return session;
				}
			}
			return undefined;
		},

		touch(id: string): boolean {
			const session = sessions.get(id);
			if (!session) return false;
			const at = now();
			if (isExpired(session, at)) return false;
			session.lastActivityAt = at;
			return true;
		},

		close(id: string): boolean {
			const session = sessions.get(id);
			if (!session) return false;
			end(session, EndReason.Close);
			return true;
		},

		sweep(): number {
			const at = now();
			let reaped = 0;
			// A copy again: end() deletes from the map mid-iteration.
			for (const session of [...sessions.values()]) {
				if (isExpired(session, at)) {
					end(session, EndReason.Expire);
					reaped += 1;
				}
			}
			return reaped;
		},
	};
}
