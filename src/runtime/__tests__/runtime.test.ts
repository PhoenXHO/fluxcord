/**
 * Runtime tests, the assembled whole: mount (three target arms,
 * render-first order, rehydrate pairing), the handle (redraw semantics),
 * remount-replace through mount, the revive seam wired through dispatch,
 * and the sweeper. Everything outside is faked: platform calls recorded,
 * rehydration an in-memory row map, the clock injectable and advanced by
 * hand. The store is deliberately NOT injectable; these tests assert
 * behavior, not internals.
 *
 * @module runtime/__tests__/runtime
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentType } from 'discord-api-types/v10';
import { actionHash } from '../../render/action-hash.js';
import { encodeActionId } from '../../render/id-codec.js';
import type { V2MessagePayload } from '../../render/v2.js';
import { EventKind } from '../../pipeline/types.js';
import type { IncomingEvent, PlatformPort, PolicyDecision, PolicyPort } from '../../pipeline/types.js';
import { EndReason, RemountPolicy } from '../../state/types.js';
import type { MessageRef, RehydrateRow, RehydrateStore } from '../../state/types.js';
import { button, row, text, view } from '../../tree/builders.js';
import { flow } from '../../flow/token.js';
import type { FlowMeta, Flow, SessionEnd } from '../../flow/token.js';
import { buildFlowCatalog } from '../../boot/build.js';
import { createUiRuntime, DEFAULT_SWEEP_INTERVAL_MS } from '../create.js';
import type { MountHandle, MountTarget, UiRuntime } from '../types.js';

interface PanelData {
	count: number;
}

const CHANNEL_ID = 'channel-1';
const OWNER_ID = 'user-1';
const MINUTE = 60_000;

/** Every text display's content, top-level only; content assertions on payloads. */
function textBodies(payload: V2MessagePayload): string[] {
	return payload.components
		.filter((component): component is { readonly type: ComponentType.TextDisplay; readonly content: string } =>
			component.type === ComponentType.TextDisplay)
		.map((component) => component.content);
}

/** The host-side bridge: edit/reply/modal recorded, no Discord. */
function fakeBridge(): { platform: PlatformPort; edits: string[]; replies: string[] } {
	const edits: string[] = [];
	const replies: string[] = [];
	const platform: PlatformPort = {
		replyToActor: vi.fn(async (body: string): Promise<void> => {
			replies.push(body);
		}),
		redraw: vi.fn(async (): Promise<void> => undefined),
		commitParting: vi.fn(async (): Promise<void> => undefined),
		editMessage: vi.fn(async (ref: MessageRef): Promise<void> => {
			edits.push(ref.messageId);
		}),
		showModal: vi.fn(async (): Promise<void> => undefined),
	};
	return { platform, edits, replies };
}

/** What the world's mount helper accepts; the target arm defaults to the reply sender. */
interface MountArgs {
	readonly to?: MountTarget;
	readonly ownerId?: string;
	readonly rehydrateRef?: string;
	readonly context?: unknown;
}

export interface World {
	readonly clock: { now: number; advance: (ms: number) => number };
	readonly runtime: UiRuntime;
	readonly platform: PlatformPort;
	readonly edits: string[];
	readonly replies: string[];
	readonly rows: Map<string, RehydrateRow>;
	readonly sent: { channelId: string; payload: V2MessagePayload }[];
	readonly handler: ReturnType<typeof vi.fn>;
	readonly mount: (options?: MountArgs) => Promise<MountHandle<PanelData>>;
	readonly click: (sessionId: string, messageId: string, overrides?: Partial<IncomingEvent>) => Promise<void>;
}

/** The assembled world: real runtime over a one-screen panel flow, all ports faked. */
function world(options: {
	rehydratable?: boolean;
	noRehydrateStore?: boolean;
	failSend?: boolean;
	failPut?: boolean;
	remount?: RemountPolicy;
	/** The flow's registration facts; the lifecycle-hook tests land here. */
	meta?: FlowMeta<PanelData>;
	/** Default false: most tests drive the sweeper by hand. */
	sweeper?: boolean;
} = {}): World {
	const clock = { now: 1_000_000, advance: (ms: number): number => (clock.now += ms) };
	const handler = vi.fn(async (_event?: unknown): Promise<void> => undefined);

	const panelFlow: Flow<PanelData> = flow<PanelData>('host', {
		screens: {
			main: {
				view: (data) => view(
					{},
					text(`count ${data.count}`),
					row({}, button({ onClick: handler, label: 'Join' })),
				),
			},
		},
		first: 'main',
		// The flow-owned fresh bag: mount clones this per session.
		initialData: { count: 3 },
		ttlMs: 30 * MINUTE,
		...(options.remount !== undefined ? { remount: options.remount } : {}),
		// 'dead-ref' models a domain object that no longer exists: undefined = dead.
		...(options.rehydratable === true
			? { rehydrate: (ref: string): PanelData | undefined => (ref === 'dead-ref' ? undefined : { count: 77 }) }
			: {}),
	}, options.meta);

	const { platform, edits, replies } = fakeBridge();
	const rows = new Map<string, RehydrateRow>();
	const rehydrateStore: RehydrateStore = {
		put: async (row): Promise<void> => {
			if (options.failPut === true) throw new Error('db down');
			rows.set(row.messageId, row);
		},
		get: async (messageId: string): Promise<RehydrateRow | undefined> => rows.get(messageId),
		delete: async (messageId: string): Promise<void> => {
			rows.delete(messageId);
		},
	};
	const sent: { channelId: string; payload: V2MessagePayload }[] = [];
	let sendCounter = 0;
	const sendToChannel = vi.fn(async (channelId: string, payload: V2MessagePayload): Promise<MessageRef> => {
		if (options.failSend === true) throw new Error('send failed');
		sendCounter += 1;
		sent.push({ channelId, payload });
		return { channelId, messageId: `sent-${sendCounter}` };
	});
	const replySender = {
		send: async (payload: V2MessagePayload): Promise<MessageRef> => {
			sendCounter += 1;
			sent.push({ channelId: 'ch-reply', payload });
			return { channelId: 'ch-reply', messageId: `replied-${sendCounter}` };
		},
	};
	const policy: PolicyPort = {
		authorize: async (): Promise<PolicyDecision> => ({ allowed: true }),
	};

	const runtime = createUiRuntime({
		platform,
		sendToChannel,
		policy,
		flows: buildFlowCatalog([{ module: 'panel', flow: panelFlow }]),
		...(options.noRehydrateStore === true ? {} : { rehydrate: rehydrateStore }),
		now: () => clock.now,
		sweeper: options.sweeper ?? false,
	});

	async function mount(mountOptions: MountArgs = {}): Promise<MountHandle<PanelData>> {
		return runtime.mount(panelFlow, {
			to: mountOptions.to ?? { reply: replySender },
			ownerId: mountOptions.ownerId ?? OWNER_ID,
			...(mountOptions.rehydrateRef !== undefined ? { rehydrateRef: mountOptions.rehydrateRef } : {}),
			...(mountOptions.context !== undefined ? { context: mountOptions.context } : {}),
		});
	}

	async function click(sessionId: string, messageId: string, overrides: Partial<IncomingEvent> = {}): Promise<void> {
		await runtime.dispatch({
			kind: EventKind.Button,
			customId: encodeActionId({ sessionId, screenKey: 'panel/main', actionHash: actionHash(handler) }),
			actorId: OWNER_ID,
			channelId: CHANNEL_ID,
			messageId,
			...overrides,
		});
	}

	return { clock, runtime, platform, edits, replies, rows, sent, handler, mount, click };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('mount - the three target arms', () => {
	it('reply arm: sends the first payload as the interaction reply and births a live session', async () => {
		const w = world();
		const handle = await w.mount();

		expect(w.sent).toHaveLength(1);
		expect(w.sent[0].channelId).toBe('ch-reply');
		expect(textBodies(w.sent[0].payload)).toContain('count 3');
		expect(handle.sessionId).toMatch(/^[0-9A-Za-z]{8}$/);
		expect(handle.messageId).toMatch(/^replied-/);
		expect(w.edits).toEqual([]);

		// The session is real: a click reaches the handler and auto-redraws through the commit phase.
		await w.click(handle.sessionId, handle.messageId);
		expect(w.handler).toHaveBeenCalledTimes(1);
		expect(w.handler.mock.calls[0][0].session.data).toEqual({ count: 3 });
		expect(w.edits).toEqual([handle.messageId]);
	});

	it('channel arm: sends a new channel message; the handle points at it', async () => {
		const w = world();
		const handle = await w.mount({ to: { channel: 'ch-9' } });

		expect(w.sent).toHaveLength(1);
		expect(w.sent[0].channelId).toBe('ch-9');
		expect(handle.messageId).toBe('sent-1');
	});

	it('existing arm: edits the given message in place, nothing new sent', async () => {
		const w = world();
		const existing: MessageRef = { channelId: 'ch-1', messageId: 'panel-msg' };
		const handle = await w.mount({ to: { existing } });

		expect(w.sent).toEqual([]);
		expect(w.edits).toEqual(['panel-msg']);
		expect(handle.messageId).toBe('panel-msg');
	});
});

describe('mount - wall ceilings', () => {
	/** A reply sender standing in for an ephemeral line: fixed message, declared ceiling. */
	function ceilingSender(): { ceilingMs: number; send: (payload: V2MessagePayload) => Promise<MessageRef> } {
		return {
			ceilingMs: 10 * MINUTE,
			send: async (): Promise<MessageRef> => ({ channelId: 'ch-reply', messageId: 'replied-wall' }),
		};
	}

	it('the absolute ceiling does not slide: activity cannot push the wall out', async () => {
		const w = world();
		const handle = await w.mount({ to: { reply: ceilingSender() } });

		w.clock.advance(5 * MINUTE);
		await w.click(handle.sessionId, handle.messageId); // fresh sliding window from here
		w.clock.advance(5 * MINUTE + 1); // past the ceiling; sliding TTL (30 min) nowhere near out

		expect(await handle.redraw()).toBe(false);
	});

	it('an ordinary sender leaves no ceiling: life is the sliding TTL alone', async () => {
		const w = world();
		const handle = await w.mount();

		w.clock.advance(10 * MINUTE + 1);
		await w.click(handle.sessionId, handle.messageId);
		w.clock.advance(10 * MINUTE + 1);

		expect(await handle.redraw()).toBe(true);
	});

	it('an ephemeral mount cannot rehydrate (resume means rerun)', async () => {
		const w = world({ rehydratable: true });

		await expect(w.mount({ to: { reply: ceilingSender() }, rehydrateRef: 'cfg:1' }))
			.rejects.toThrow('cannot rehydrate on an ephemeral mount');
	});
});

describe('mount - the flow-owned bag', () => {
	it('clones the initialData per mount - two sessions never share bag state', async () => {
		// Coexist so both panels stay live (replace would close the first).
		const w = world({ remount: RemountPolicy.Coexist });
		const a = await w.mount({ to: { channel: 'ch-1' } });
		const b = await w.mount({ to: { channel: 'ch-2' } });

		// An in-place write on a's bag must not leak into b's.
		await a.redraw((data) => {
			data.count = 99;
		});

		let seen = 0;
		await b.redraw((data) => {
			seen = data.count;
		});
		expect(seen).toBe(3);
	});
});

describe('mount - render-first, create-after-send', () => {
	it('a failed send rejects to the caller; no session, no row, nothing to sweep', async () => {
		const w = world({ rehydratable: true, failSend: true });

		await expect(w.mount({ to: { channel: 'ch-1' }, rehydrateRef: 'lotto:1' })).rejects.toThrow('send failed');
		expect(w.sent).toEqual([]);
		expect(w.rows.size).toBe(0);

		// No session was born: a sweep past the TTL commits nothing.
		vi.useFakeTimers();
		try {
			w.runtime.startSweeper(DEFAULT_SWEEP_INTERVAL_MS);
			w.clock.advance(31 * MINUTE);
			await vi.advanceTimersByTimeAsync(DEFAULT_SWEEP_INTERVAL_MS);
			expect(w.edits).toEqual([]);
		} finally {
			w.runtime.stopSweeper();
			vi.useRealTimers();
		}
	});
});

describe('mount - rehydrate pairing (loud in every direction)', () => {
	it('flow opted in, runtime has no rehydrate store: throws', async () => {
		const w = world({ rehydratable: true, noRehydrateStore: true });
		await expect(w.mount({ rehydrateRef: 'lotto:1' })).rejects.toThrow(/no rehydrate store/);
	});

	it('flow opted in, caller gave no rehydrateRef: throws', async () => {
		const w = world({ rehydratable: true });
		await expect(w.mount()).rejects.toThrow(/no rehydrateRef/);
	});

	it('flow has no rehydrate callback, caller gave a ref: throws', async () => {
		const w = world();
		await expect(w.mount({ rehydrateRef: 'lotto:1' })).rejects.toThrow(/declares no rehydrate callback/);
	});

	it('happy pairing writes the row with the full edit target', async () => {
		const w = world({ rehydratable: true });
		const handle = await w.mount({ to: { channel: 'ch-2' }, rehydrateRef: 'lotto:42' });

		expect(w.rows.get(handle.messageId)).toEqual({
			messageId: handle.messageId,
			channelId: 'ch-2',
			flowId: 'panel/host',
			ref: 'lotto:42',
			ownerId: OWNER_ID,
		});
	});

	it('a failed row write degrades loudly but never fails the mount', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const w = world({ rehydratable: true, failPut: true });

		const handle = await w.mount({ rehydrateRef: 'lotto:1' });
		await vi.waitFor(() => {
			// No host error unit wired; the shipped default receives the
			// report (framework source) and fails loud to the console.
			expect(log).toHaveBeenCalledWith('[fluxcord] framework failure:', expect.objectContaining({
				message: expect.stringContaining('rehydrate row write failed'),
			}));
		});

		// The session is alive and usable despite the row loss.
		await w.click(handle.sessionId, handle.messageId);
		expect(w.handler).toHaveBeenCalledTimes(1);
		log.mockRestore();
	});
});

describe('mount - remount replace', () => {
	it('a second mount of the same flow+owner closes the first: freeze edit, dead handle', async () => {
		const w = world();
		const first = await w.mount({ to: { channel: 'ch-1' } });
		w.edits.length = 0;

		const second = await w.mount({ to: { channel: 'ch-2' } });

		// The close path froze the first message (one edit, controls stripped).
		expect(w.edits).toEqual([first.messageId]);
		await expect(first.redraw()).resolves.toBe(false);
		await expect(second.redraw()).resolves.toBe(true);
	});
});

describe('the handle - redraw', () => {
	it('mutates the data, edits the message, and slides the TTL window', async () => {
		const w = world();
		const handle = await w.mount();
		w.edits.length = 0;

		await expect(handle.redraw((data) => {
			data.count = 42;
		})).resolves.toBe(true);

		expect(w.edits).toEqual([handle.messageId]);
		const payloads = (w.platform.editMessage as ReturnType<typeof vi.fn>).mock.calls
			.map((call) => textBodies(call[1] as V2MessagePayload));
		expect(payloads.at(-1)).toContain('count 42');

		// Push-redraw counts as activity: 29 minutes later it still works...
		w.clock.advance(29 * MINUTE);
		await expect(handle.redraw()).resolves.toBe(true);
		// ...but the window slides from that touch, and expiry eventually wins.
		w.clock.advance(31 * MINUTE);
		await expect(handle.redraw()).resolves.toBe(false);
	});

	it('returns false once the session is gone (expired), editing nothing', async () => {
		const w = world();
		const handle = await w.mount();
		w.clock.advance(31 * MINUTE);
		w.edits.length = 0;

		await expect(handle.redraw()).resolves.toBe(false);
		expect(w.edits).toEqual([]);
	});

	it('rejects when the edit itself fails - APIs throw', async () => {
		const w = world();
		const handle = await w.mount();
		(w.platform.editMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('429'));

		await expect(handle.redraw()).rejects.toThrow('429');
	});
});

describe('session lifecycle hooks', () => {
	it('onSessionStart fires once the session is born - the same handle object mount returns, plus the context', async () => {
		let seenHandle: MountHandle<PanelData> | undefined;
		let seenContext: unknown;
		const w = world({
			meta: {
				onSessionStart: (handle, context) => {
					seenHandle = handle;
					seenContext = context;
				},
			},
		});
		const context = { guild: 'g-1' };
		const handle = await w.mount({ context });

		expect(seenHandle).toBe(handle);
		expect(seenContext).toBe(context);
		// The hook's handle is live: redraw through it works.
		await expect(handle.redraw()).resolves.toBe(true);
	});

	it('onSessionEnd fires when a replace-remount closes the session - the dying identity, close reason', async () => {
		const ends: SessionEnd[] = [];
		const w = world({
			meta: {
				onSessionEnd: (end) => {
					ends.push(end);
				},
			},
		});
		const first = await w.mount({ to: { channel: 'ch-1' } });
		await w.mount({ to: { channel: 'ch-2' } });

		expect(ends).toEqual([{
			sessionId: first.sessionId,
			messageId: first.messageId,
			flowId: 'panel/host',
			reason: EndReason.Close,
		}]);
	});

	it('onSessionEnd fires on the sweeper\'s reap, with the expire reason', async () => {
		vi.useFakeTimers();
		const ends: SessionEnd[] = [];
		const w = world({
			meta: {
				onSessionEnd: (end) => {
					ends.push(end);
				},
			},
		});
		try {
			const handle = await w.mount({ to: { channel: 'ch-1' } });
			w.runtime.startSweeper(5_000);

			w.clock.advance(31 * MINUTE);
			await vi.advanceTimersByTimeAsync(5_000);

			expect(ends).toEqual([{
				sessionId: handle.sessionId,
				messageId: handle.messageId,
				flowId: 'panel/host',
				reason: EndReason.Expire,
			}]);
		} finally {
			w.runtime.stopSweeper();
			vi.useRealTimers();
		}
	});

	it('a revived session does not re-run onSessionStart - rehydrate is its bind', async () => {
		const starts: string[] = [];
		const w = world({
			rehydratable: true,
			meta: {
				onSessionStart: (handle) => {
					starts.push(handle.sessionId);
				},
			},
		});
		const handle = await w.mount({ to: { channel: 'ch-1' }, rehydrateRef: 'lotto:42' });
		expect(starts).toEqual([handle.sessionId]);

		w.clock.advance(31 * MINUTE); // expired but unswept
		await w.click(handle.sessionId, handle.messageId); // revives under the same id

		expect(w.handler).toHaveBeenCalledTimes(1);
		expect(starts).toEqual([handle.sessionId]);
	});
});

describe('revive - dead clicks through the runtime', () => {
	it('a click on an expired rehydratable message revives under the clicked id', async () => {
		const w = world({ rehydratable: true });
		const handle = await w.mount({ to: { channel: 'ch-1' }, rehydrateRef: 'lotto:42' });
		w.clock.advance(31 * MINUTE); // expired but unswept

		await w.click(handle.sessionId, handle.messageId);

		// The revived session received the event with rehydrated data; no parting.
		expect(w.handler).toHaveBeenCalledTimes(1);
		expect(w.handler.mock.calls[0][0].session.data).toEqual({ count: 77 });
		expect(w.handler.mock.calls[0][0].session.id).toBe(handle.sessionId);
		// Two edits: the revive draw (builds the frame, snaps the client to the
		// rehydrated screen), then the post-handler auto-redraw.
		expect(w.edits).toEqual([handle.messageId, handle.messageId]);
		expect(w.rows.has(handle.messageId)).toBe(true);

		// Live again: a second click runs without reviving.
		await w.click(handle.sessionId, handle.messageId);
		expect(w.handler).toHaveBeenCalledTimes(2);
	});

	it('a dead ref (rehydrate returns undefined) gets the parting screen', async () => {
		const w = world({ rehydratable: true });
		const handle = await w.mount({ to: { channel: 'ch-1' }, rehydrateRef: 'dead-ref' });
		w.clock.advance(31 * MINUTE);

		await w.click(handle.sessionId, handle.messageId);

		expect(w.handler).not.toHaveBeenCalled();
		expect(w.edits).toEqual([handle.messageId]);
	});

	it('the old message yields: a live successor of the same flow wins', async () => {
		// coexist, or the fresh mount's replace-close would freeze the old
		// message and delete its row before the click ever arrives.
		const w = world({ rehydratable: true, remount: RemountPolicy.Coexist });
		const old = await w.mount({ to: { channel: 'ch-1' }, rehydrateRef: 'lotto:1' });
		w.clock.advance(31 * MINUTE);

		// The owner mounted a fresh session; the old message is now superseded.
		const fresh = await w.mount({ to: { channel: 'ch-2' }, rehydrateRef: 'lotto:2' });
		w.edits.length = 0;

		await w.click(old.sessionId, old.messageId);

		expect(w.handler).not.toHaveBeenCalled();
		expect(w.edits).toEqual([old.messageId]); // parting on the old message only
		await expect(fresh.redraw()).resolves.toBe(true);
	});

	it('no row for the clicked message: parting, nothing revived', async () => {
		const w = world({ rehydratable: true });
		await w.click('zzzzzzzz', 'never-seen');

		expect(w.handler).not.toHaveBeenCalled();
		expect(w.edits).toEqual(['never-seen']);
	});

	it('a row whose flowId the catalog does not know: parting', async () => {
		const w = world({ rehydratable: true });
		w.rows.set('ghost-msg', { messageId: 'ghost-msg', channelId: CHANNEL_ID, ownerId: OWNER_ID, flowId: 'ghost/flow', ref: 'x' });

		await w.click('zzzzzzzz', 'ghost-msg');

		expect(w.handler).not.toHaveBeenCalled();
		expect(w.edits).toEqual(['ghost-msg']);
	});
});

describe('the sweeper', () => {
	it('reaps expired sessions on the interval; non-rehydratable ones get the parting edit', async () => {
		vi.useFakeTimers();
		const w = world();
		try {
			const handle = await w.mount({ to: { channel: 'ch-1' } });
			w.runtime.startSweeper(5_000);

			w.clock.advance(31 * MINUTE);
			await vi.advanceTimersByTimeAsync(5_000);

			expect(w.edits).toEqual([handle.messageId]); // the parting edit

			// Stopped: no further reaps fire even past another full TTL.
			w.runtime.stopSweeper();
			await w.mount({ to: { channel: 'ch-2' } });
			w.clock.advance(31 * MINUTE);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(w.edits).toEqual([handle.messageId]);
		} finally {
			w.runtime.stopSweeper();
			vi.useRealTimers();
		}
	});

	it('rehydratable sessions expire silently: message untouched, row survives for late clicks', async () => {
		vi.useFakeTimers();
		const w = world({ rehydratable: true });
		try {
			const handle = await w.mount({ to: { channel: 'ch-1' }, rehydrateRef: 'lotto:42' });
			w.runtime.startSweeper(5_000);

			w.clock.advance(31 * MINUTE);
			await vi.advanceTimersByTimeAsync(5_000);

			expect(w.edits).toEqual([]);
			expect(w.rows.has(handle.messageId)).toBe(true);
		} finally {
			w.runtime.stopSweeper();
			vi.useRealTimers();
		}
	});

	it('starts by default at create, so no one has to remember it', async () => {
		vi.useFakeTimers();
		const w = world({ sweeper: true });
		try {
			const handle = await w.mount({ to: { channel: 'ch-1' } });

			w.clock.advance(31 * MINUTE);
			await vi.advanceTimersByTimeAsync(DEFAULT_SWEEP_INTERVAL_MS);

			expect(w.edits).toEqual([handle.messageId]); // reaped with no startSweeper call anywhere
		} finally {
			w.runtime.stopSweeper();
			vi.useRealTimers();
		}
	});

	it('sweeper: false hands the lifecycle to the host until it starts one', async () => {
		vi.useFakeTimers();
		const w = world({ sweeper: false });
		try {
			const handle = await w.mount({ to: { channel: 'ch-1' } });

			w.clock.advance(31 * MINUTE);
			await vi.advanceTimersByTimeAsync(DEFAULT_SWEEP_INTERVAL_MS);

			expect(w.edits).toEqual([]); // expired but unswept: nobody is watching

			w.runtime.startSweeper(DEFAULT_SWEEP_INTERVAL_MS);
			await vi.advanceTimersByTimeAsync(DEFAULT_SWEEP_INTERVAL_MS);
			expect(w.edits).toEqual([handle.messageId]); // the host's start takes over
		} finally {
			w.runtime.stopSweeper();
			vi.useRealTimers();
		}
	});
});
