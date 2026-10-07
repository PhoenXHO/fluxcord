/**
 * Dispatch core tests: the full event journey with every outside touch
 * faked: policy decisions scripted, platform calls recorded, handlers as
 * spies. No Discord anywhere.
 *
 * @module pipeline/__tests__/dispatch
 */

import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { actionHash } from '../../render/action-hash.js';
import { encodeActionId } from '../../render/id-codec.js';
import { createSessionStore } from '../../state/store.js';
import type { SessionStore } from '../../state/store.js';
import { activeFrame } from '../../state/types.js';
import type { Session } from '../../state/types.js';
import { text, view } from '../../tree/builders.js';
import type { ViewNode } from '../../tree/types.js';
import type { MountToken } from '../../flow/token.js';
import type { Dispatch } from '../dispatch.js';
import { policy } from '../policy.js';
import { DEFAULT_DENY_MESSAGE, DEFAULT_ERROR_MESSAGE, createDispatch } from '../dispatch.js';
import { createLaunch } from '../../runtime/launch.js';
import { createSessionQueue } from '../queue.js';
import { EventKind } from '../types.js';
import type {
	ErrorReport,
	EventTools,
	IncomingEvent,
	PlatformPort,
	PolicyDecision,
	PolicyPort,
} from '../types.js';

interface LottoData {
	tickets: number;
}

const CHANNEL_ID = 'channel-1';
const MESSAGE_ID = 'message-1';
const OWNER_ID = 'user-1';

/** The registered screen's template, dispatch tests never render it (the platform is fake). */
const lottoView: ViewNode = view({}, text('Lotto main'));

function fakePolicy(decision: PolicyDecision = { allowed: true }): PolicyPort & { decide(next: PolicyDecision): void } {
	let current = decision;
	return {
		authorize: vi.fn(async (): Promise<PolicyDecision> => current),
		decide: (next: PolicyDecision): void => {
			current = next;
		},
	};
}

function fakePlatform(): { platform: PlatformPort; calls: string[] } {
	const calls: string[] = [];
	const platform: PlatformPort = {
		replyToActor: vi.fn(async (textValue: string): Promise<void> => {
			calls.push(`reply:${textValue}`);
		}),
		redraw: vi.fn(async (session: Session<unknown>): Promise<void> => {
			calls.push(`redraw:${session.screen}`);
		}),
		commitParting: vi.fn(async (ref: { messageId: string }): Promise<void> => {
			calls.push(`parting:${ref.messageId}`);
		}),
		editMessage: vi.fn(async (): Promise<void> => undefined),
		showModal: vi.fn(async (): Promise<void> => undefined),
		ack: vi.fn(async (): Promise<void> => {
			calls.push('ack');
		}),
	};
	return { platform, calls };
}

/** What world() wires together: every port recorded, the store real. */
interface World {
	clock: { now: number; advance: (ms: number) => number };
	store: SessionStore;
	session: Session<LottoData>;
	handler: Mock;
	tools: EventTools;
	policy: PolicyPort & { decide(next: PolicyDecision): void };
	platform: PlatformPort;
	calls: string[];
	token: MountToken;
	tryRevive: Mock;
	errors: ErrorReport[];
	dispatch: Dispatch;
	click: (overrides?: Partial<IncomingEvent>) => Promise<void>;
}

/** The wired world: real store + one registered screen + recorded everything. */
function world(options: { omitErrorHandler?: boolean; throwInErrorHandler?: boolean; ackAfterMs?: number } = {}): World {
	const clock = { now: 1_000_000, advance: (ms: number): number => (clock.now += ms) };
	// Hand-built token: dispatch never renders, it only checks screen
	// membership and reads the flow's onError. Unfrozen so tests patch it.
	const definition = {
		first: 'main',
		ttlMs: 30 * 60 * 1000,
		remount: 'coexist',
		screens: { main: { view: (): ViewNode => lottoView } },
	};
	const token = { flowId: 'lotto/lotto', moduleId: 'lotto', definition } as unknown as MountToken;
	const store = createSessionStore({ now: () => clock.now });
	const session = store.create<LottoData>({
		flowId: 'lotto/lotto',
		moduleId: 'lotto',
		ownerId: OWNER_ID,
		messageRef: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
		data: { tickets: 3 },
		screen: 'main',
		ttlMs: 30 * 60 * 1000,
		remount: 'coexist',
		token,
	});

	const handler = vi.fn(async (_event?: unknown): Promise<void> => undefined);
	const policy = fakePolicy();
	const { platform, calls } = fakePlatform();
	// The action map a real commit phase would have written: the drawn
	// message carried one button, 'join', bound to the spy. Tests that
	// want a stale map empty it by hand.
	activeFrame(session).actions = { [actionHash(handler)]: { handler, label: 'join' } };
	const tryRevive = vi.fn(async (): Promise<Session<unknown> | undefined> => undefined);
	const errors: ErrorReport[] = [];

	/** A stand-in toolkit: the root exit is wired to the real store so exit-path tests are honest. */
	const tools: EventTools = {
		ui: {
			go: () => undefined,
			push: () => undefined,
			back: () => undefined,
			exit: (): void => {
				store.close(session.id);
			},
			showModal: () => Promise.resolve(),
		},
		task: <T>(fn: () => Promise<T>): Promise<T> => fn(),
		mutate: (fn: (data: unknown) => void): void => {
			fn(session.data);
		},
		resetPhase: () => undefined,
	};

	const dispatch = createDispatch({
		store,
		policy,
		platform,
		reviveIndex: new Map([['lotto/lotto', token]]),
		tryRevive,
		makeUi: () => tools,
		// No call engine under test here: handlers that call throw, and the
		// crash seam answers false so handler throws still report as before.
		call: {
			call: async () => {
				throw new Error('no call engine in test');
			},
			exit: () => {},
			crash: () => false,
		},
		launch: createLaunch({ store, queue: createSessionQueue(), platform }),
		...(options.omitErrorHandler !== true
			? {
				onError: (report: ErrorReport): void => {
					if (options.throwInErrorHandler === true) throw new Error('unit exploded');
					errors.push(report);
				},
			}
			: {}),
		now: () => clock.now,
		...(options.ackAfterMs !== undefined ? { ackAfterMs: options.ackAfterMs } : {}),
	});

	/** A button click on 'join' (or any action/view/session override). */
	function click(overrides: Partial<IncomingEvent> = {}): Promise<void> {
		return dispatch({
			kind: EventKind.Button,
			customId: encodeActionId({ sessionId: session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(handler) }),
			actorId: OWNER_ID,
			channelId: CHANNEL_ID,
			messageId: MESSAGE_ID,
			...overrides,
		});
	}

	return { clock, store, session, handler, tools, policy, platform, calls, token, tryRevive, errors, dispatch, click };
}

describe('dispatch - allow path', () => {
	it('delivers a typed event to the handler', async () => {
		const w = world();
		await w.click();

		expect(w.handler).toHaveBeenCalledTimes(1);
		const event = w.handler.mock.calls[0][0];
		expect(event.kind).toBe('button');
		expect(event.name).toBe('join');
		expect(event.actorId).toBe(OWNER_ID);
		expect(event.ui).toBe(w.tools.ui);
		expect(event.task).toBe(w.tools.task);
		expect(event.mutate).toBe(w.tools.mutate);
	});

	it('hands the handler the LIVE session record - same object as the store', async () => {
		const w = world();
		await w.click();

		const event = w.handler.mock.calls[0][0];
		expect(event.session).toBe(w.store.get(w.session.id));
		expect(event.session.data).toEqual({ tickets: 3 });
	});

	it('passes select values through, fresh from the wire', async () => {
		const w = world();
		await w.click({ kind: EventKind.Select, values: ['a', 'b'] });

		expect(w.handler.mock.calls[0][0].values).toEqual(['a', 'b']);
	});

	it('passes modal inputs through, keyed by authored input id', async () => {
		const w = world();
		activeFrame(w.session).modalHandler = w.handler; // what showModal records when the modal opens
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ kind: EventKind.ModalSubmit, customId: `${id}~${activeFrame(w.session).modalNonce}`, inputs: { amount: '10' } });

		expect(w.handler.mock.calls[0][0].inputs).toEqual({ amount: '10' });
	});

	it('modal submits route by nonce + the recorded opener - the id\'s hash segment goes unread', async () => {
		const w = world();
		activeFrame(w.session).modalHandler = w.handler;
		// A ui.go() before showModal strands the old address; the submit
		// still finds its handler because routing never read the hash.
		const elsewhere = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/confirm', actionHash: actionHash(() => { }) });
		await w.click({ kind: EventKind.ModalSubmit, customId: `${elsewhere}~${activeFrame(w.session).modalNonce}`, inputs: { amount: '10' } });

		expect(w.handler).toHaveBeenCalledTimes(1);
		expect(w.handler.mock.calls[0][0].inputs).toEqual({ amount: '10' });
	});

	it('a modal submit lenses to the opener\'s slot, so a called flow\'s modal writes its own bag', async () => {
		const w = world();
		const frame = activeFrame(w.session);
		// The shape event.call builds: the top frame owns a slot, and the
		// opener's action record carries it.
		frame.slot = ['delivery'];
		(w.session.data as unknown as Record<string, unknown>).delivery = {};
		frame.actions = { ...frame.actions, [actionHash(w.handler)]: { handler: w.handler, label: 'set-address', slot: ['delivery'] } };
		frame.modalHandler = w.handler;
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ kind: EventKind.ModalSubmit, customId: `${id}~${frame.modalNonce}`, inputs: { address: '221B' } });

		const event = w.handler.mock.calls[0][0];
		event.mutate((d: Record<string, unknown>) => {
			d.address = '221B';
		});
		expect((w.session.data as unknown as Record<string, unknown>).delivery).toEqual({ address: '221B' });
		expect((w.session.data as unknown as Record<string, unknown>).address).toBeUndefined();
	});

	it('slides the TTL window: a click touches the session', async () => {
		const w = world();
		w.clock.advance(10 * 60 * 1000);
		await w.click();

		expect(w.session.lastActivityAt).toBe(w.clock.now);
	});
});

describe('dispatch - touch only accepted events', () => {
	it('a denied click leaves the TTL window alone', async () => {
		const w = world();
		w.policy.decide({ allowed: false });
		const before = w.session.lastActivityAt;
		w.clock.advance(10 * 60 * 1000);
		await w.click();

		expect(w.session.lastActivityAt).toBe(before);
	});

	it('a stale click (frame miss) leaves the TTL window alone', async () => {
		const w = world();
		activeFrame(w.session).actions = {};
		const before = w.session.lastActivityAt;
		w.clock.advance(10 * 60 * 1000);
		await w.click();

		expect(w.session.lastActivityAt).toBe(before);
	});
});

describe('dispatch - the error socket', () => {
	it('a custom error unit that throws is contained; the default copy still lands', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const w = world({ throwInErrorHandler: true });
		w.handler.mockRejectedValueOnce(new Error('boom'));
		try {
			await w.click();
			expect(w.calls).toContain(`reply:${DEFAULT_ERROR_MESSAGE}`);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('a framework failure with the flow\'s chosen copy replies with it', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const w = world({ omitErrorHandler: true });
		(w.token.definition as { onError?: (report: ErrorReport) => string }).onError = (): string => 'flow words';
		w.policy.authorize = vi.fn(async (): Promise<PolicyDecision> => {
			throw new Error('policy exploded');
		});
		try {
			await w.click();
			expect(w.calls).toContain('reply:flow words');
		} finally {
			errorSpy.mockRestore();
		}
	});
});

describe('dispatch - the permission choke point', () => {
	it('asks exactly one question with the full context', async () => {
		const w = world();
		await w.click({ guildId: 'guild-1' });

		expect(w.policy.authorize).toHaveBeenCalledTimes(1);
		expect(w.policy.authorize).toHaveBeenCalledWith({
			actorId: OWNER_ID,
			ownerId: OWNER_ID,
			guildId: 'guild-1',
			channelId: CHANNEL_ID,
			flowId: 'lotto/lotto',
			view: 'lotto/lotto/main',
		});
	});

	it('carries the clicker\'s role ids into the one question', async () => {
		const w = world();
		await w.click({ guildId: 'guild-1', actorRoleIds: ['r-1', 'r-2'] });

		expect(w.policy.authorize).toHaveBeenCalledWith({
			actorId: OWNER_ID,
			actorRoleIds: ['r-1', 'r-2'],
			ownerId: OWNER_ID,
			guildId: 'guild-1',
			channelId: CHANNEL_ID,
			flowId: 'lotto/lotto',
			view: 'lotto/lotto/main',
		});
	});

	it('a control-declared gate rides the one question as actionPolicy', async () => {
		const w = world();
		const gate = policy.owner();
		activeFrame(w.session).actions = { [actionHash(w.handler)]: { handler: w.handler, label: 'join', policy: gate } };
		await w.click({ guildId: 'guild-1' });

		expect(w.policy.authorize).toHaveBeenCalledWith({
			actorId: OWNER_ID,
			ownerId: OWNER_ID,
			guildId: 'guild-1',
			channelId: CHANNEL_ID,
			flowId: 'lotto/lotto',
			view: 'lotto/lotto/main',
			actionPolicy: gate,
		});
	});

	it('a modal submit consults under the gate the opening button carried', async () => {
		const w = world();
		const gate = policy.owner();
		activeFrame(w.session).modalHandler = w.handler; // what showModal records when the modal opens
		activeFrame(w.session).modalPolicy = gate; // and the opener's policy alongside it
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ kind: EventKind.ModalSubmit, customId: `${id}~${activeFrame(w.session).modalNonce}`, inputs: {} });

		expect(w.policy.authorize).toHaveBeenCalledTimes(1);
		expect(vi.mocked(w.policy.authorize).mock.calls[0][0].actionPolicy).toBe(gate);
	});

	it('deny: actor reply with the engine\'s message, no handler, no edit', async () => {
		const w = world();
		w.policy.decide({ allowed: false, denyMessage: 'Hosts only.' });
		await w.click();

		expect(w.calls).toEqual(['reply:Hosts only.']);
		expect(w.handler).not.toHaveBeenCalled();
	});

	it('deny without a message falls back to the default copy', async () => {
		const w = world();
		w.policy.decide({ allowed: false });
		await w.click();

		expect(w.calls).toEqual([`reply:${DEFAULT_DENY_MESSAGE}`]);
	});
});

describe('dispatch - auto-redraw', () => {
	it('edits the message once after a successful handler', async () => {
		const w = world();
		await w.click();

		expect(w.calls).toEqual(['redraw:main']);
	});

	it('skips the redraw when the handler exited the session - the root exit owns the message', async () => {
		const w = world();
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			w.tools.ui.exit();
		});
		await w.click();

		expect(w.calls).toEqual([]);
		expect(w.store.get(w.session.id)).toBeUndefined();
	});

	it('skips the redraw when the session expired mid-handler - the sweeper owns the message', async () => {
		const w = world();
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			w.clock.advance(31 * 60 * 1000);
		});
		await w.click();

		expect(w.calls).toEqual([]);
	});
});

describe('dispatch - dead paths', () => {
	it('unknown session: revive consulted, then parting edit', async () => {
		const w = world();
		const id = encodeActionId({ sessionId: 'zzzzzzzz', screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ customId: id });

		expect(w.tryRevive).toHaveBeenCalledWith('zzzzzzzz', MESSAGE_ID);
		expect(w.calls).toEqual([`parting:${MESSAGE_ID}`]);
		expect(w.handler).not.toHaveBeenCalled();
		expect(w.errors).toEqual([]);
	});

	it('expired session: same dead path, revive still consulted', async () => {
		const w = world();
		w.clock.advance(31 * 60 * 1000);
		await w.click();

		expect(w.tryRevive).toHaveBeenCalledWith(w.session.id, MESSAGE_ID);
		expect(w.calls).toEqual([`parting:${MESSAGE_ID}`]);
		expect(w.handler).not.toHaveBeenCalled();
	});

	it('revived session is drawn once, then receives the event normally - no parting', async () => {
		const w = world();
		w.clock.advance(31 * 60 * 1000); // kill the live session so revive is consulted
		const revived: Session<unknown> = {
			...w.session,
			data: { tickets: 99 },
		};
		w.tryRevive.mockResolvedValue(revived);

		await w.click();

		expect(w.handler).toHaveBeenCalledTimes(1);
		expect(w.handler.mock.calls[0][0].session).toBe(revived);
		expect(w.handler.mock.calls[0][0].session.data).toEqual({ tickets: 99 });
		expect(w.calls).toEqual(['redraw:main']); // the revive draw, snapping the client to reality
	});

	it('a revived miss skips the second redraw - the revive draw was the snap', async () => {
		const w = world();
		w.clock.advance(31 * 60 * 1000);
		const revived: Session<unknown> = {
			...w.session,
		};
		activeFrame(revived).actions = {}; // fresh record: nothing is clickable until drawn
		w.tryRevive.mockResolvedValue(revived);

		await w.click();

		expect(w.handler).not.toHaveBeenCalled();
		expect(w.calls).toEqual(['redraw:main']); // only the revive draw, no second edit
	});

	it('malformed customId: parting edit plus onError, no throw', async () => {
		const w = world();
		await w.click({ customId: 'ui2:garbage' });

		expect(w.errors).toHaveLength(1);
		expect(w.calls).toEqual([`parting:${MESSAGE_ID}`]);
	});

	it('modal submit without a nonce suffix: same malformed path', async () => {
		const w = world();
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ kind: EventKind.ModalSubmit, customId: id });

		expect(w.errors).toHaveLength(1);
		expect(w.calls).toEqual([`parting:${MESSAGE_ID}`]);
	});

	it('dead path without a channelId: logged, nothing committed', async () => {
		const w = world();
		const id = encodeActionId({ sessionId: 'zzzzzzzz', screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ customId: id, channelId: undefined });

		expect(w.errors).toHaveLength(1);
		expect(w.platform.commitParting).not.toHaveBeenCalled();
	});
});

describe('dispatch - staleness (the frame wins)', () => {
	it('stale click (hash not in the frame): redraw the current screen, run nothing, ask nothing', async () => {
		const w = world();
		activeFrame(w.session).actions = {}; // the last draw carried no such control
		await w.click();

		expect(w.calls).toEqual(['redraw:main']);
		expect(w.handler).not.toHaveBeenCalled();
		expect(w.policy.authorize).not.toHaveBeenCalled();
	});

	it('stale modal submit (nonce mismatch): redraw, run nothing', async () => {
		const w = world();
		activeFrame(w.session).modalHandler = w.handler;
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ kind: EventKind.ModalSubmit, customId: `${id}~stale1234`, inputs: { amount: '10' } });

		expect(w.calls).toEqual(['redraw:main']);
		expect(w.handler).not.toHaveBeenCalled();
	});

	it('modal submit with no recorded opener: stale semantics - redraw, run nothing', async () => {
		const w = world();
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		await w.click({ kind: EventKind.ModalSubmit, customId: `${id}~${activeFrame(w.session).modalNonce}`, inputs: { amount: '10' } });

		expect(w.calls).toEqual(['redraw:main']);
		expect(w.handler).not.toHaveBeenCalled();
	});
});

describe('dispatch - the error socket', () => {
	it('routes handler failures as source handler, with the session in the report', async () => {
		const w = world();
		w.handler.mockRejectedValueOnce(new Error('boom'));
		await w.click();

		expect(w.errors).toHaveLength(1);
		const report = w.errors[0];
		expect(report.source).toBe('handler');
		expect(report.error).toEqual(new Error('boom'));
		expect(report.session).toBe(w.session);
		expect(report.incoming?.messageId).toBe(MESSAGE_ID);
		expect(report.dirtyKeys).toBeUndefined();
		// No auto-redraw on failure: the message keeps its last good render.
		expect(w.calls).toEqual([]);
	});

	it('reports dirty data keys when a failed handler mutated the bag directly', async () => {
		const w = world();
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			w.session.data.tickets = 99; // direct write, bypasses mutate
			throw new Error('boom');
		});
		await w.click();

		expect(w.errors[0].dirtyKeys).toEqual(['tickets']);
	});

	it('routes pipeline failures as source framework, no session attached', async () => {
		const w = world();
		activeFrame(w.session).screen = 'ghost';
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/ghost', actionHash: actionHash(w.handler) });
		await w.click({ customId: id });

		expect(w.errors).toHaveLength(1);
		expect(w.errors[0].source).toBe('framework');
		expect(w.errors[0].session).toBeUndefined();
		expect(w.calls).toEqual([]);
	});

	it('the shipped default replies to the clicker for handler failures only', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const w = world({ omitErrorHandler: true });

		w.handler.mockRejectedValueOnce(new Error('boom'));
		await w.click();
		expect(w.calls).toEqual([`reply:${DEFAULT_ERROR_MESSAGE}`]);

		// Framework failures log but never reply: "try again" advice would be useless.
		w.calls.length = 0;
		activeFrame(w.session).screen = 'ghost';
		const id = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/ghost', actionHash: actionHash(w.handler) });
		await w.click({ customId: id });
		expect(w.calls).toEqual([]);
		log.mockRestore();
	});
});

describe('dispatch - the per-session line', () => {
	it('two clicks on one session run in order, never interleaved', async () => {
		const w = world();
		const order: string[] = [];
		let release: (() => void) | undefined;
		let signalFirst: (() => void) | undefined;
		let signalSecond: (() => void) | undefined;
		const firstBegan = new Promise<void>((resolve) => {
			signalFirst = resolve;
		});
		const secondBegan = new Promise<void>((resolve) => {
			signalSecond = resolve;
		});
		let invocations = 0;
		w.handler.mockImplementation(async (): Promise<void> => {
			invocations += 1;
			order.push('start');
			if (invocations === 1) signalFirst?.();
			if (invocations === 2) signalSecond?.();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			order.push('end');
		});

		const first = w.click();
		const second = w.click();

		// First handler started and is parked; second must not have started.
		await firstBegan;
		expect(order).toEqual(['start']);
		release?.();
		await first;
		// The second handler runs now and parks on the same gate.
		await secondBegan;
		expect(order).toEqual(['start', 'end', 'start']);
		release?.();
		await second;

		expect(order).toEqual(['start', 'end', 'start', 'end']);
	});

	it('different sessions never block each other', async () => {
		const w = world();
		const other = w.store.create<LottoData>({
			flowId: 'lotto/lotto',
			moduleId: 'lotto',
			ownerId: 'user-2',
			messageRef: { channelId: CHANNEL_ID, messageId: 'message-2' },
			data: { tickets: 1 },
			screen: 'main',
			ttlMs: 30 * 60 * 1000,
			remount: 'coexist',
			token: w.token,
		});
		activeFrame(other).actions = { [actionHash(w.handler)]: { handler: w.handler, label: 'join' } };

		let release: (() => void) | undefined;
		w.handler.mockImplementation(async () => {
			if (!release) {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
		});

		const blocked = w.click();
		const otherId = encodeActionId({ sessionId: other.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(w.handler) });
		const free = w.click({ customId: otherId, actorId: 'user-2', messageId: 'message-2' });

		// The other session's handler completes while the first is parked.
		await free;
		release?.();
		await blocked;

		expect(w.handler).toHaveBeenCalledTimes(2);
	});
});

describe('the ack race timer', () => {
	it('acks early when the handler outlasts the threshold', async () => {
		const w = world({ ackAfterMs: 5 });
		w.handler.mockImplementationOnce(async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
		});
		await w.click();
		expect(w.platform.ack as Mock).toHaveBeenCalledTimes(1);
	});

	it('never acks when the handler settles inside the window', async () => {
		const w = world({ ackAfterMs: 5 });
		await w.click();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(w.platform.ack as Mock).not.toHaveBeenCalled();
	});
});
