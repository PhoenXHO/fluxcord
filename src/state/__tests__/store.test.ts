import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionStore, isExpired } from '../store.js';
import { DEFAULT_TTL_MS, EndReason, RemountPolicy } from '../types.js';
import type { CreateSessionInput, RehydrateRow, RehydrateStore } from '../types.js';

const MINUTE = 60_000;

/** Injectable clock: deterministic time, advanced by hand. */
function clock(): { now: () => number; advance: (ms: number) => void } {
	let t = 1_000_000;
	return {
		now: () => t,
		advance: (ms: number): void => {
			t += ms;
		},
	};
}

interface LottoData {
	tickets: number;
	names: string[];
}

function input(overrides: Partial<CreateSessionInput<LottoData>> = {}): CreateSessionInput<LottoData> {
	return {
		flowId: 'lotto.host',
		moduleId: 'lotto',
		ownerId: 'user-1',
		messageRef: { channelId: 'ch-1', messageId: 'msg-1' },
		data: { tickets: 3, names: ['ada', 'bob'] },
		screen: 'main',
		ttlMs: 30 * MINUTE,
		remount: RemountPolicy.Coexist,
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('create', () => {
	it('seeds every session field', () => {
		const c = clock();
		const store = createSessionStore({ now: c.now });
		const session = store.create(input());

		expect(session.id).toMatch(/^[0-9A-Za-z]{8}$/);
		expect(session.flowId).toBe('lotto.host');
		expect(session.moduleId).toBe('lotto');
		expect(session.ownerId).toBe('user-1');
		expect(session.messageRef).toEqual({ channelId: 'ch-1', messageId: 'msg-1' });
		expect(session.createdAt).toBe(session.lastActivityAt);
		expect(session.ttlMs).toBe(30 * MINUTE);
		expect(session.history).toEqual([]);
		expect(session.screen).toBe('main');
		expect(session.data).toEqual({ tickets: 3, names: ['ada', 'bob'] });
		expect(session.rehydrate).toBeUndefined();
		expect(session.modalNonce).toMatch(/^[0-9A-Za-z]{8}$/);
	});

	it('regenerates the id on collision, keeping live ids unique', () => {
		// Draw accounting: create #1 consumes 8 draws (id) + 8 (nonce);
		// create #2's first id attempt consumes 8 more, all forced to the
		// same value, so it collides and the loop regenerates with the
		// different value drawn afterwards.
		let draws = 0;
		const random = vi.spyOn(Math, 'random').mockImplementation(() => (draws++ < 24 ? 0.5 : 0.99));

		const store = createSessionStore();
		const first = store.create(input());
		const second = store.create(input({ messageRef: { channelId: 'ch-1', messageId: 'msg-2' } }));

		expect(second.id).not.toBe(first.id);
		expect(store.get(first.id)).toBeDefined();
		expect(store.get(second.id)).toBeDefined();
		random.mockRestore();
	});

	it('rejects a non-finite or non-positive ttlMs', () => {
		const store = createSessionStore();
		expect(() => store.create(input({ ttlMs: Infinity }))).toThrow(/ttlMs/);
		expect(() => store.create(input({ ttlMs: 0 }))).toThrow(/ttlMs/);
		expect(() => store.create(input({ ttlMs: -1 }))).toThrow(/ttlMs/);
	});
});

describe('typed access', () => {
	it('captures the flow data type and keeps one live bag', () => {
		const store = createSessionStore();
		const session = store.create(input());

		const data: LottoData = session.data;
		expect(data.tickets).toBe(3);

		session.data.tickets = 7;
		expect(store.get(session.id)?.data).toEqual({ tickets: 7, names: ['ada', 'bob'] });
	});
});

describe('sliding TTL', () => {
	it('touch revives the session for a full further window', () => {
		const c = clock();
		const store = createSessionStore({ now: c.now });
		const session = store.create(input());

		c.advance(29 * MINUTE);
		expect(store.touch(session.id)).toBe(true);

		c.advance(29 * MINUTE);
		expect(isExpired(store.get(session.id)!, c.now())).toBe(false);

		c.advance(2 * MINUTE);
		expect(isExpired(store.get(session.id)!, c.now())).toBe(true);
	});

	it('expires from creation when untouched', () => {
		const c = clock();
		const store = createSessionStore({ now: c.now });
		const session = store.create(input());

		c.advance(31 * MINUTE);
		expect(isExpired(store.get(session.id)!, c.now())).toBe(true);
	});

	it('touch never revives an expired session; the sweeper owns deletion', () => {
		const c = clock();
		const store = createSessionStore({ now: c.now });
		const session = store.create(input());
		const last = session.lastActivityAt;

		c.advance(45 * MINUTE);
		expect(store.touch(session.id)).toBe(false);
		expect(session.lastActivityAt).toBe(last);
		expect(store.get(session.id)).toBeDefined();
	});

	it('touch on an unknown id returns false', () => {
		const store = createSessionStore();
		expect(store.touch('nope')).toBe(false);
	});
});

describe('close', () => {
	it('deletes the session and reports the close reason once', () => {
		const onEnd = vi.fn();
		const store = createSessionStore({ onEnd });
		const session = store.create(input());

		expect(store.close(session.id)).toBe(true);
		expect(store.get(session.id)).toBeUndefined();
		expect(onEnd).toHaveBeenCalledTimes(1);
		expect(onEnd).toHaveBeenCalledWith(session, EndReason.Close);

		expect(store.close(session.id)).toBe(false);
		expect(onEnd).toHaveBeenCalledTimes(1);
	});
});

describe('sweep', () => {
	it('reaps only expired sessions and reports the expire reason', () => {
		const c = clock();
		const onEnd = vi.fn();
		const store = createSessionStore({ onEnd, now: c.now });
		const fresh = store.create(input());
		const stale = store.create(input({ messageRef: { channelId: 'ch-1', messageId: 'msg-2' } }));

		c.advance(29 * MINUTE);
		expect(store.touch(fresh.id)).toBe(true);
		c.advance(16 * MINUTE);

		expect(store.sweep()).toBe(1);
		expect(store.get(stale.id)).toBeUndefined();
		expect(store.get(fresh.id)).toBeDefined();
		expect(onEnd).toHaveBeenCalledWith(stale, EndReason.Expire);
	});

	it('reports expiry for rehydratable sessions too - the wiring leaves the message alone', () => {
		const c = clock();
		const onEnd = vi.fn();
		const store = createSessionStore({ onEnd, now: c.now });
		store.create(input({ rehydrate: { ref: 'lotto:8421' } }));

		c.advance(31 * MINUTE);
		expect(store.sweep()).toBe(1);
		expect(onEnd).toHaveBeenCalledWith(
			expect.objectContaining({ rehydrate: { ref: 'lotto:8421' } }),
			EndReason.Expire,
		);
	});

	it('reports nothing when no session is expired', () => {
		const onEnd = vi.fn();
		const store = createSessionStore({ onEnd });
		store.create(input());

		expect(store.sweep()).toBe(0);
		expect(onEnd).not.toHaveBeenCalled();
	});
});

describe('remount', () => {
	it('replace closes the owner\'s previous session of the same flow', () => {
		const onEnd = vi.fn();
		const store = createSessionStore({ onEnd });
		const first = store.create(input({ remount: RemountPolicy.Replace }));
		const second = store.create(input({
			remount: RemountPolicy.Replace,
			messageRef: { channelId: 'ch-1', messageId: 'msg-2' },
		}));

		expect(store.get(first.id)).toBeUndefined();
		expect(store.get(second.id)).toBeDefined();
		expect(onEnd).toHaveBeenCalledWith(first, EndReason.Close);
	});

	it('coexist keeps both sessions of the same flow and owner', () => {
		const onEnd = vi.fn();
		const store = createSessionStore({ onEnd });
		const first = store.create(input());
		const second = store.create(input({ messageRef: { channelId: 'ch-1', messageId: 'msg-2' } }));

		expect(store.get(first.id)).toBeDefined();
		expect(store.get(second.id)).toBeDefined();
		expect(onEnd).not.toHaveBeenCalled();
	});

	it('replace matches only the same flow and the same owner', () => {
		const onEnd = vi.fn();
		const store = createSessionStore({ onEnd });
		const mine = store.create(input({ remount: RemountPolicy.Replace }));
		const theirs = store.create(input({
			ownerId: 'user-2',
			remount: RemountPolicy.Replace,
		}));
		const otherFlow = store.create(input({
			flowId: 'report.file',
			remount: RemountPolicy.Replace,
		}));

		expect(store.get(mine.id)).toBeDefined();
		expect(store.get(theirs.id)).toBeDefined();
		expect(store.get(otherFlow.id)).toBeDefined();
		expect(onEnd).not.toHaveBeenCalled();
	});
});

describe('RehydrateStore', () => {
	it('is satisfiable by a memory implementation and round-trips rows', async () => {
		const rows = new Map<string, RehydrateRow>();
		const rehydrateStore: RehydrateStore = {
			put: async (row) => {
				rows.set(row.messageId, row);
			},
			get: async (messageId) => rows.get(messageId),
			delete: async (messageId) => {
				rows.delete(messageId);
			},
		};

		await rehydrateStore.put({ messageId: 'm1', channelId: 'c1', ownerId: 'u1', flowId: 'lotto.host', ref: 'lotto:8421' });
		expect((await rehydrateStore.get('m1'))?.ref).toBe('lotto:8421');
		await rehydrateStore.delete('m1');
		expect(await rehydrateStore.get('m1')).toBeUndefined();
	});
});

describe('create with an explicit id', () => {
	it('honors the id verbatim (mount pre-generates it for the first payload)', () => {
		const c = clock();
		const store = createSessionStore({ now: c.now });
		const session = store.create(input({ id: 'fixed001' }));

		expect(session.id).toBe('fixed001');
		expect(store.get('fixed001')).toBe(session);
	});

	it('replaces a dead record under the same id silently - its parting never fired', () => {
		const c = clock();
		const onEnd = vi.fn();
		const store = createSessionStore({ now: c.now, onEnd });
		const first = store.create(input({ id: 'fixed001' }));

		c.advance(31 * MINUTE); // first is expired but unswept

		const second = store.create(input({ id: 'fixed001', messageRef: { channelId: 'ch-1', messageId: 'msg-2' } }));

		expect(second.id).toBe('fixed001');
		expect(second.createdAt).toBe(c.now());
		expect(second.messageRef.messageId).toBe('msg-2');
		// Silent replacement: no close/end fired for the dead record.
		expect(onEnd).not.toHaveBeenCalled();
		expect(store.get('fixed001')).toBe(second);
		void first;
	});

	it('stays silent under remount replace too - the revive path must not freeze the message it revives', () => {
		const c = clock();
		const onEnd = vi.fn();
		const store = createSessionStore({ now: c.now, onEnd });
		store.create(input({ id: 'fixed001', remount: RemountPolicy.Replace }));

		c.advance(31 * MINUTE); // expired but unswept

		// Without the id-first ordering, the replace sweep would close the
		// corpse: freeze edit on the message being revived, row deleted.
		store.create(input({ id: 'fixed001', remount: RemountPolicy.Replace }));

		expect(onEnd).not.toHaveBeenCalled();
	});

	it('throws on a live record under the same id - two sources of truth', () => {
		const store = createSessionStore();
		store.create(input({ id: 'fixed001' }));

		expect(() => store.create(input({ id: 'fixed001' }))).toThrow(/already live/);
	});
});

describe('findLive', () => {
	it('matches on flow AND owner together - no cross matches', () => {
		const c = clock();
		const store = createSessionStore({ now: c.now });
		const mine = store.create(input());
		const theirs = store.create(input({ ownerId: 'user-2', messageRef: { channelId: 'ch-1', messageId: 'msg-2' } }));
		const otherFlow = store.create(input({ flowId: 'lotto.other', messageRef: { channelId: 'ch-1', messageId: 'msg-3' } }));

		expect(store.findLive('lotto.host', 'user-1')).toBe(mine);
		expect(store.findLive('lotto.host', 'user-2')).toBe(theirs);
		expect(store.findLive('lotto.other', 'user-1')).toBe(otherFlow);
		expect(store.findLive('lotto.host', 'user-3')).toBeUndefined();
		expect(store.findLive('lotto.guess', 'user-1')).toBeUndefined();
	});

	it('excludes expired sessions - the successor check never matches a corpse', () => {
		const c = clock();
		const store = createSessionStore({ now: c.now });
		store.create(input());

		c.advance(31 * MINUTE);
		expect(store.findLive('lotto.host', 'user-1')).toBeUndefined();
	});
});

describe('defaults', () => {
	it('pins the framework TTL at 30 minutes', () => {
		expect(DEFAULT_TTL_MS).toBe(30 * 60 * 1000);
	});
});
