/**
 * Launch engine tests: detached tracked work against a real store and a
 * real queue; the draw arm is recorded. The frame stack is the registry,
 * so every death rule reads as frame membership: on top = on screen,
 * in the stack but not top = away (write lands, no render), off the
 * stack or dead session = dropped quietly.
 *
 * @module runtime/__tests__/launch
 */

import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { MountToken } from '../../flow/token.js';
import type { CreateSessionInput, FlowFrame, Session } from '../../state/types.js';
import { createSessionStore } from '../../state/store.js';
import { createSessionQueue } from '../../pipeline/queue.js';
import type { LaunchEngine } from '../../pipeline/types.js';
import { createLaunch } from '../launch.js';

interface Bag {
	rows?: string[];
	child?: { count?: number };
	n?: number;
}

interface Harness {
	store: ReturnType<typeof createSessionStore>;
	session: Session<Bag>;
	frame: FlowFrame;
	launch: LaunchEngine['launch'];
	redraw: Mock;
	errors: unknown[];
	input: CreateSessionInput<Bag>;
	advance: (ms: number) => void;
}

const CHANNEL_ID = 'channel-1';
const MESSAGE_ID = 'message-1';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function harness(options: { ttlMs?: number } = {}): Harness {
	let nowMs = 1_000_000;
	const store = createSessionStore({ now: () => nowMs });
	const queue = createSessionQueue();
	const redraw = vi.fn(async (): Promise<void> => undefined);
	const errors: unknown[] = [];
	const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
	const definition = { first: 'main', ttlMs, remount: 'coexist', screens: {} };
	const token = { flowId: 'lot/lot', moduleId: 'lot', definition } as unknown as MountToken;
	const input = {
		flowId: 'lot/lot',
		moduleId: 'lot',
		ownerId: 'user-1',
		messageRef: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
		data: {},
		screen: 'main',
		ttlMs,
		remount: 'coexist' as const,
		token,
	};
	const session = store.create<Bag>(input);
	const engine = createLaunch({
		store,
		queue,
		platform: { redraw },
		now: () => nowMs,
		onError: (error) => {
			errors.push(error);
		},
	});
	// The method detached is safe: the engine closes over its options, no this.
	return { store, session, launch: engine.launch, redraw, errors, frame: session.frames[0], input, advance: (ms: number): void => { nowMs += ms; } };
}

/** A hand-built child frame: enough frame for the membership checks, nothing more. */
function childFrame(token: MountToken, slot: readonly string[]): FlowFrame {
	return {
		id: `frame-${slot.join('-')}`,
		flowId: 'other/other',
		moduleId: 'other',
		screen: 'main',
		history: [],
		modalNonce: 'nonce',
		actions: {},
		slot,
		token,
	};
}

describe('the launch engine', () => {
	it('delivers a settled value into the as slot and redraws once', async () => {
		const h = harness();
		h.launch(h.session, h.frame, async () => ['a', 'b'], { as: 'rows' });
		await vi.waitFor(() => expect(h.session.data.rows).toEqual(['a', 'b']));
		expect(h.redraw).toHaveBeenCalledTimes(1);
	});

	it('lands every job mutate and redraws per mutate, in order', async () => {
		const h = harness();
		h.launch(h.session, h.frame, async (job) => {
			job.mutate((data) => {
				data.n = 1;
			});
			job.mutate((data) => {
				data.n = 2;
			});
		});
		await vi.waitFor(() => expect(h.session.data.n).toBe(2));
		expect(h.redraw).toHaveBeenCalledTimes(2);
	});

	it('a write while the user is elsewhere lands in the bag and renders nothing', async () => {
		const h = harness();
		const child = childFrame({} as MountToken, ['child']);
		h.session.frames.push(child);
		await h.launch(h.session, h.frame, async (job) => {
			job.mutate((data) => {
				data.rows = ['x'];
			});
		});
		await vi.waitFor(() => expect(h.session.data.rows).toEqual(['x']));
		expect(h.redraw).not.toHaveBeenCalled();
		// Back on the root frame, the same verb redraws.
		h.session.frames.pop();
		await h.launch(h.session, h.frame, async (job) => {
			job.mutate((data) => {
				data.rows = ['y'];
			});
		});
		await vi.waitFor(() => expect(h.redraw).toHaveBeenCalledTimes(1));
		expect(h.session.data.rows).toEqual(['y']);
	});

	it('a job from a called flow lenses to its own slot', async () => {
		const h = harness();
		const child = childFrame({} as MountToken, ['child']);
		h.session.frames.push(child);
		// The slot is seeded before the launch, exactly what event.call does
		// for a real child frame (the lens contract: seed before entering).
		h.session.data.child = {};
		await h.launch(h.session, child, async (job) => {
			job.mutate((data) => {
				data.count = 7;
			});
		});
		await vi.waitFor(() => expect(h.session.data.child?.count).toBe(7));
		expect(h.redraw).toHaveBeenCalled();
	});

	it('a closed session drops the write quietly', async () => {
		const h = harness();
		h.store.close(h.session.id);
		await h.launch(h.session, h.frame, async (job) => {
			job.mutate((data) => {
				data.n = 1;
			});
		});
		await sleep(15);
		expect(h.session.data.n).toBeUndefined();
		expect(h.redraw).not.toHaveBeenCalled();
	});

	it('an expired session drops the write quietly', async () => {
		const h = harness({ ttlMs: 100 });
		await h.launch(h.session, h.frame, async (job) => {
			await sleep(5);
			h.advance(10_000);
			job.mutate((data) => {
				data.n = 1;
			});
		});
		await sleep(15);
		expect(h.session.data.n).toBeUndefined();
		expect(h.redraw).not.toHaveBeenCalled();
	});

	it('a revive-replaced id drops the old session job (identity, not just presence)', async () => {
		const h = harness();
		const id = h.session.id;
		h.store.close(id);
		h.store.create<Bag>({ ...h.input, id });
		await h.launch(h.session, h.frame, async (job) => {
			job.mutate((data) => {
				data.rows = ['ghost'];
			});
		});
		await sleep(15);
		expect(h.session.data.rows).toBeUndefined();
		expect(h.redraw).not.toHaveBeenCalled();
	});

	it('a settled as value is dropped when the frame died before the settle', async () => {
		const h = harness();
		h.launch(h.session, h.frame, async () => {
			await sleep(20);
			return ['late'];
		}, { as: 'rows' });
		h.store.close(h.session.id);
		await sleep(40);
		expect(h.session.data.rows).toBeUndefined();
		expect(h.redraw).not.toHaveBeenCalled();
	});

	it('a job throw routes to the error unit and writes nothing', async () => {
		const h = harness();
		h.launch(h.session, h.frame, async () => {
			throw new Error('boom');
		}, { as: 'rows' });
		await vi.waitFor(() => expect(h.errors).toHaveLength(1));
		expect(h.session.data.rows).toBeUndefined();
	});

	it('job writes never touch the sliding TTL', async () => {
		const h = harness();
		const before = h.session.lastActivityAt;
		h.advance(5_000);
		await h.launch(h.session, h.frame, async (job) => {
			job.mutate((data) => {
				data.n = 1;
			});
		});
		await vi.waitFor(() => expect(h.session.data.n).toBe(1));
		expect(h.session.lastActivityAt).toBe(before);
	});

	it('a chatty job coalesces its redraws to the drain pace', async () => {
		const h = harness();
		h.redraw.mockImplementation(async () => {
			await sleep(10);
		});
		await h.launch(h.session, h.frame, async (job) => {
			for (let i = 1; i <= 6; i += 1) {
				job.mutate((data) => {
					data.n = i;
				});
			}
		});
		await vi.waitFor(() => expect(h.session.data.n).toBe(6));
		await sleep(25);
		// Six writes, but at most one edit in flight plus one trailing
		// round: the FIFO never waits behind a rate-limited edit.
		expect(h.redraw).toHaveBeenCalledTimes(2);
	});

	it('the drain stops when the frame leaves the stack mid-edit', async () => {
		const h = harness();
		h.redraw.mockImplementation(async () => {
			await sleep(20);
		});
		await h.launch(h.session, h.frame, async (job) => {
			job.mutate((data) => {
				data.n = 1;
			});
			await sleep(5);
			job.mutate((data) => {
				data.n = 2;
			});
			h.session.frames.pop();
			await sleep(60);
		});
		await sleep(30);
		// Round one rendered; round two's guard (the frame is no longer on
		// top) stopped the drain instead of rendering past the death.
		expect(h.redraw).toHaveBeenCalledTimes(1);
	});
});
