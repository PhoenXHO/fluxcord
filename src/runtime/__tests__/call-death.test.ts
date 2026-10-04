/**
 * Death paths vs parked calls: close, the sweeper, remount-replace and
 * the quiet revive-replace all drop a session's pending calls WITHOUT
 * settling them. The parked parent continuation never resumes (in-flight
 * calls die with the session), and the probe proves the stronger fact:
 * no settle of any kind, resolve or reject. Every parked promise gets a
 * settle observer, so a stray reject would flip the probe rather than
 * surface as an unhandled rejection.
 *
 * The revive shape is also checked here: the rebuilt session starts at a
 * single root frame with an empty pending map.
 *
 * @module runtime/__tests__/call-death
 */

import { describe, expect, it } from 'vitest';
import { createCall } from '../call.js';
import { createSessionQueue } from '../../pipeline/queue.js';
import { createSessionStore } from '../../state/store.js';
import { RemountPolicy } from '../../state/types.js';
import type { EventTools } from '../../pipeline/types.js';
import type { Session } from '../../state/types.js';
import type { FlowDefinition } from '../../flow/types.js';
import type { Flow, MountToken } from '../../flow/token.js';

interface ChildData {
	n: number;
}

const MINUTE = 60_000;

/** The flow object handed to call(); only its identity matters here. */
const CHILD_FLOW = { id: 'mod/child' } as unknown as Flow<unknown, unknown>;

const CHILD_TOKEN: MountToken<ChildData> = {
	flowId: 'mod/child',
	moduleId: 'mod',
	definition: {
		first: 'child-main',
		ttlMs: MINUTE,
		remount: 'coexist',
		screens: {},
	} as unknown as FlowDefinition<ChildData>,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** One macrotask turn: a dropped pending call must survive it unsettled. */
const tick = async (): Promise<void> => sleep(0);

/** Attaches a settle observer: flips if the promise settles by any means. */
function probe(parked: Promise<unknown>): { readonly settled: () => boolean; readonly outcome: () => string } {
	let done = false;
	let how = '';
	void parked.then(
		() => {
			done = true;
			how = 'resolved';
		},
		(error: unknown) => {
			done = true;
			how = `rejected: ${String(error)}`;
		},
	);
	return { settled: (): boolean => done, outcome: (): string => how };
}

/** Real store (hand-moved clock), real queue, real call engine. */
function deathWorld(): {
	store: ReturnType<typeof createSessionStore>;
	session: Session<Record<string, unknown>>;
	advance: (ms: number) => void;
	/** Parks one call and returns the pending promise boxed, so awaiting the park itself settles. */
	park: () => Promise<{ readonly promise: Promise<unknown> }>;
	} {
	let t = 1_000_000;
	const store = createSessionStore({ now: () => t });
	const session = store.create<Record<string, unknown>>({
		flowId: 'mod/root',
		moduleId: 'mod',
		ownerId: 'u1',
		messageRef: { channelId: 'c1', messageId: 'm1' },
		data: {},
		screen: 'root',
		ttlMs: MINUTE,
		remount: RemountPolicy.Coexist,
	});
	const call = createCall({
		store,
		queue: createSessionQueue(),
		commit: { redraw: async () => undefined },
		byToken: new Map([[CHILD_FLOW, CHILD_TOKEN as MountToken]]),
	});
	const tools: EventTools = {
		ui: {
			go: () => undefined,
			push: () => undefined,
			back: () => undefined,
			exit: () => undefined,
			showModal: () => Promise.resolve(),
		},
		task: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
		mutate: (fn: (data: unknown) => void): void => {
			fn(session.data);
		},
		resetPhase: (): void => undefined,
	};
	return {
		store,
		session,
		advance: (ms: number): void => {
			t += ms;
		},
		park: async (): Promise<{ readonly promise: Promise<unknown> }> => {
			const promise = call.call(session, session.frames[0], tools, CHILD_FLOW, { as: 'picker', args: { n: 1 } });
			await tick();
			return { promise };
		},
	};
}

describe('death paths drop pending calls without settling', () => {
	it('store.close drops them', async () => {
		const w = deathWorld();
		const watched = probe((await w.park()).promise);

		expect(w.store.close(w.session.id)).toBe(true);
		await tick();

		expect(watched.settled()).toBe(false);
		expect(w.store.get(w.session.id)).toBeUndefined();
	});

	it('the sweeper drops them', async () => {
		const w = deathWorld();
		const watched = probe((await w.park()).promise);

		w.advance(MINUTE + 1);
		expect(w.store.sweep()).toBe(1);
		await tick();

		expect(watched.settled()).toBe(false);
		expect(w.store.get(w.session.id)).toBeUndefined();
	});

	it('remount-replace drops the replaced session\'s', async () => {
		const w = deathWorld();
		const watched = probe((await w.park()).promise);

		w.store.create({
			flowId: 'mod/root',
			moduleId: 'mod',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm2' },
			data: {},
			screen: 'root',
			ttlMs: MINUTE,
			remount: RemountPolicy.Replace,
		});
		await tick();

		expect(watched.settled()).toBe(false);
		expect(w.store.get(w.session.id)).toBeUndefined();
	});

	it('the quiet revive-replace drops them and the rebuilt session starts at a single root frame', async () => {
		const w = deathWorld();
		const watched = probe((await w.park()).promise);

		w.advance(MINUTE + 1); // expired, but still readable through get
		const revived = w.store.create({
			id: w.session.id,
			flowId: 'mod/root',
			moduleId: 'mod',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {},
			screen: 'root',
			ttlMs: MINUTE,
			remount: RemountPolicy.Coexist,
		});
		await tick();

		expect(watched.settled()).toBe(false);
		expect(w.store.get(w.session.id)).toBe(revived);
		expect(revived.frames).toHaveLength(1);
		expect(revived.frames[0].slot).toEqual([]);
		expect(revived.pending.size).toBe(0);
	});
});
