/**
 * The call engine, unit-tested: call parks the parent on a queue-cut line,
 * exit unwinds one frame and settles the parked promise, crash rejects it,
 * and the root paths close through the store. A real session queue backs
 * every test so the resume ordering is honest.
 *
 * @module runtime/__tests__/call
 */

import { describe, expect, it } from 'vitest';
import { createCall } from '../call.js';
import { createSessionQueue } from '../../pipeline/queue.js';
import type { SessionQueue } from '../../pipeline/queue.js';
import { createSessionStore } from '../../state/store.js';
import { activeFrame, DEFAULT_TTL_MS } from '../../state/types.js';
import type { EventTools, PlatformPort } from '../../pipeline/types.js';
import type { Session } from '../../state/types.js';
import type { FlowDefinition } from '../../flow/types.js';
import type { Flow, MountToken } from '../../flow/token.js';
import { text, view } from '../../tree/builders.js';
import type { ComponentResult } from '../../tree/types.js';

interface ChildData {
	n: number;
}

const MINUTE = 60_000;
const PLATFORM = {} as PlatformPort;

/** The flow object handed to call(); only its identity and id matter here. */
const CHILD_FLOW = { id: 'mod/child' } as unknown as Flow<unknown, unknown>;

const CHILD_TOKEN: MountToken<ChildData> = {
	flowId: 'mod/child',
	moduleId: 'mod',
	definition: {
		first: 'child-main',
		ttlMs: MINUTE,
		remount: 'coexist',
		screens: { 'child-main': {} as never },
	} as unknown as FlowDefinition<ChildData>,
};

const ROOT_TOKEN: MountToken = {
	flowId: 'mod/root',
	moduleId: 'mod',
	definition: {
		first: 'root',
		ttlMs: DEFAULT_TTL_MS,
		remount: 'coexist',
		screens: { root: {} as never },
	} as unknown as FlowDefinition,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** One macrotask turn: queue chains settle in microtasks, the gate release needs a real turn. */
const tick = async (): Promise<void> => sleep(0);

/** The harness: real store, real queue (suspend spied), recorded redraws and phase resets. */
function world(commitOverride?: (session: Session<unknown>) => Promise<void>): {
	store: ReturnType<typeof createSessionStore>;
	session: Session<Record<string, unknown>>;
	queue: SessionQueue;
	realQueue: SessionQueue;
	suspended: string[];
	redraws: Session<unknown>[];
	call: ReturnType<typeof createCall>;
	tools: EventTools;
	phaseResets: () => number;
	acks: () => number;
	PLATFORM: PlatformPort;
} {
	const store = createSessionStore();
	const session = store.create<Record<string, unknown>>({
		flowId: 'mod/root',
		moduleId: 'mod',
		ownerId: 'u1',
		messageRef: { channelId: 'c1', messageId: 'm1' },
		data: {},
		screen: 'root',
		ttlMs: DEFAULT_TTL_MS,
		remount: 'coexist',
		token: ROOT_TOKEN,
	});
	const realQueue = createSessionQueue();
	const suspended: string[] = [];
	const queue: SessionQueue = {
		enqueue: (key, job) => realQueue.enqueue(key, job),
		suspend: (key) => {
			suspended.push(key);
			realQueue.suspend(key);
		},
	};
	const redraws: Session<unknown>[] = [];
	const commit = {
		redraw: commitOverride ?? (async (s: Session<unknown>): Promise<void> => {
			redraws.push(s);
		}),
	};
	let phaseResets = 0;
	let acks = 0;
	const call = createCall({
		store,
		queue,
		commit,
		byToken: new Map([[CHILD_FLOW, CHILD_TOKEN as MountToken]]),
		ack: async (): Promise<void> => {
			acks += 1;
		},
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
		resetPhase: (): void => {
			phaseResets++;
		},
	};
	return { store, session, queue, realQueue, suspended, redraws, call, tools, phaseResets: (): number => phaseResets, acks: (): number => acks, PLATFORM };
}

describe('call - parking', () => {
	it('pushes a child frame, seeds a cloned bag, draws, and suspends the line', async () => {
		const w = world();
		const args = { n: 1, list: [1] };
		const parked = w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'picker', args });
		await tick();

		expect(w.session.frames).toHaveLength(2);
		const top = activeFrame(w.session);
		expect(top.flowId).toBe('mod/child');
		expect(top.moduleId).toBe('mod');
		expect(top.slot).toEqual(['picker']);
		// The child's bag is a structuredClone of the args: same shape, fresh object.
		expect(w.session.data.picker).toEqual(args);
		expect(w.session.data.picker).not.toBe(args);
		(w.session.data.picker as ChildData & { list: number[] }).list.push(2);
		expect(args.list).toEqual([1]);
		expect(w.redraws).toEqual([w.session]);
		// The caller's click is acked right before the park.
		expect(w.acks()).toBe(1);
		expect(w.suspended).toEqual([w.session.id]);

		// The promise stays pending until an exit presses resolve.
		let settled = false;
		void parked.then(() => {
			settled = true;
		});
		await tick();
		expect(settled).toBe(false);
		expect(w.phaseResets()).toBe(0);
	});

	it('falls back to the definition seed when no args are given', async () => {
		const w = world();
		const tokenWithSeed: MountToken<ChildData> = {
			...CHILD_TOKEN,
			definition: { ...CHILD_TOKEN.definition, initialData: { n: 7 } } as unknown as FlowDefinition<ChildData>,
		};
		const call = createCall({ store: w.store, queue: w.queue, commit: { redraw: async () => undefined }, byToken: new Map([[CHILD_FLOW, tokenWithSeed as MountToken]]) });
		const parked = call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'picker' });
		await tick();

		expect(w.session.data.picker).toEqual({ n: 7 });
		await call.exit(w.session, 'done');
		await expect(parked).resolves.toBe('done');
	});

	it('an unlisted flow assembles its token from the calling frame, so same-module calls need no listing', async () => {
		const w = world();
		const engine = createCall({ store: w.store, queue: w.realQueue, commit: { redraw: async () => undefined }, byToken: new Map() });
		const bare = { id: 'child', definition: CHILD_TOKEN.definition } as unknown as Flow<unknown, unknown>;

		const parked = engine.call(w.session, w.session.frames[0], w.tools, bare, { as: 'picker', args: { n: 1 } });
		await tick();

		const child = w.session.frames[1];
		expect(child.flowId).toBe('mod/child');
		expect(child.token.flowId).toBe('mod/child');
		expect(child.token.moduleId).toBe('mod');
		expect(child.token.definition).toBe(CHILD_TOKEN.definition);

		await engine.exit(w.session, 'done');
		await expect(parked).resolves.toBe('done');
	});

	it('throws when the calling frame already holds a pending call', async () => {
		const w = world();
		const frame = activeFrame(w.session);
		w.session.pending.set('phantom', {
			parentFrameId: frame.id,
			resolve: () => undefined,
			reject: () => undefined,
			resetParentPhase: () => undefined,
		});
		await expect(w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'other', args: { n: 2 } })).rejects.toThrow(/one call per frame/);
		expect(w.session.frames).toHaveLength(1);
		expect(w.session.pending.get('phantom')).toBeDefined();
	});

	it('a second call from one handler throws, even though the child frame is already on top', async () => {
		const w = world();
		// call() pushes its child frame synchronously, so a second call in
		// the same handler body finds the child on top of the stack. The
		// guard judges the delivering frame, not the top, so it still fires.
		const parked = w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'picker', args: { n: 1 } });
		await expect(w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'other', args: { n: 2 } })).rejects.toThrow(/one call per frame/);
		expect(w.session.frames).toHaveLength(2);
		expect(w.session.pending.size).toBe(1);
		await tick();
		await w.call.exit(w.session, 'x');
		await tick();
		await expect(parked).resolves.toBe('x');
	});
});

describe('exit', () => {
	it('below the root: pops the frame and resolves the parked promise with the value', async () => {
		const w = world();
		const parked = w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'picker', args: { n: 1 } });
		await tick();

		w.call.exit(w.session, 'picked');
		await expect(parked).resolves.toBe('picked');

		expect(w.session.frames).toHaveLength(1);
		expect(w.session.pending.size).toBe(0);
		// The resume is queue work: the parent's phase machine is legal again.
		expect(w.phaseResets()).toBe(1);
		expect(w.store.get(w.session.id)).toBe(w.session);
	});

	it('at the root: closes the session through the store', async () => {
		const w = world();
		w.call.exit(w.session, undefined);
		expect(w.session.frames).toHaveLength(1);
		expect(w.session.finalView).toBeUndefined();
		expect(w.store.get(w.session.id)).toBeUndefined();
	});

	it('at the root with a final view: the goodbye rides the session before it dies', async () => {
		const w = world();
		const goodbye: ComponentResult = view({ title: 'Done' }, text('All set.'));
		w.call.exit(w.session, undefined, goodbye);
		expect(w.store.get(w.session.id)).toBeUndefined();
		expect(w.session.finalView?.kind).toBe('view');
	});

	it('with a final view below the root: throws and pops nothing', async () => {
		const w = world();
		const parked = w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'picker', args: { n: 1 } });
		await tick();

		const goodbye: ComponentResult = view({ title: 'Done' }, text('All set.'));
		expect(() => w.call.exit(w.session, 'x', goodbye)).toThrow(/a final view only works at the root/);
		expect(w.session.frames).toHaveLength(2);
		await w.call.exit(w.session, 'out');
		await expect(parked).resolves.toBe('out');
	});
});

describe('crash', () => {
	it('below the root: pops the frame, rejects the parked promise, answers true', async () => {
		const w = world();
		const parked = w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'picker', args: { n: 1 } });
		await tick();

		expect(w.call.crash(w.session, new Error('boom'))).toBe(true);
		await expect(parked).rejects.toThrow('boom');
		expect(w.session.frames).toHaveLength(1);
		expect(w.session.pending.size).toBe(0);
		expect(w.phaseResets()).toBe(1);
	});

	it('at the root: answers false and pops nothing', async () => {
		const w = world();
		expect(w.call.crash(w.session, new Error('boom'))).toBe(false);
		expect(w.session.frames).toHaveLength(1);
		expect(w.store.get(w.session.id)).toBe(w.session);
	});
});

describe('queue serialization across a parked call', () => {
	it('a pre-suspend job finishes first, and two post-suspend jobs run sequentially', async () => {
		const order: string[] = [];
		let releaseRedraw!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseRedraw = resolve;
		});
		const w = world(async () => {
			await gate;
		});
		const job = (name: string): (() => Promise<void>) => async () => {
			order.push(`start:${name}`);
			await sleep(5);
			order.push(`end:${name}`);
		};

		// call() is parked inside its redraw, before suspend: the line is untouched.
		const parked = w.call.call(w.session, w.session.frames[0], w.tools, CHILD_FLOW, { as: 'picker', args: { n: 1 } });
		const j0 = w.queue.enqueue(w.session.id, job('J0'));
		await j0;
		// J0 is done; only now does the call cut the line.
		releaseRedraw();
		await tick();

		// Both enqueued back to back: J2 must wait for J1 to finish.
		w.queue.enqueue(w.session.id, job('J1'));
		w.queue.enqueue(w.session.id, job('J2'));
		expect(order).toEqual(['start:J0', 'end:J0']);

		// The exit's resume enqueues behind J1 and J2, so settling drains them first.
		w.call.exit(w.session, 'done');
		await expect(parked).resolves.toBe('done');

		expect(order).toEqual(['start:J0', 'end:J0', 'start:J1', 'end:J1', 'start:J2', 'end:J2']);
	});
});
