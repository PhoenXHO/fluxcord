/**
 * Flow layer tests: defineFlow's validations, the lens, and the pipeline
 * integration through the action map: resolution after a draw, stale
 * semantics, the error copy hook, and parting bundles on both death paths.
 *
 * @module flow/__tests__/flow
 */

import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { actionHash } from '../../render/action-hash.js';
import { encodeActionId } from '../../render/id-codec.js';
import { createSessionStore } from '../../state/store.js';
import type { SessionStore } from '../../state/store.js';
import type { Session } from '../../state/types.js';
import { activeFrame, DEFAULT_TTL_MS } from '../../state/types.js';
import { button, optionSelect, row, text, view } from '../../tree/builders.js';
import type { ViewNode } from '../../tree/types.js';
import { createCommit } from '../../commit/commit.js';
import type { CommitPhase } from '../../commit/commit.js';
import { createOnEnd } from '../../commit/onEnd.js';
import { createMakeUi } from '../../commit/ui.js';
import { action } from '../../pipeline/action.js';
import { DEFAULT_ERROR_MESSAGE, createDispatch } from '../../pipeline/dispatch.js';
import { createSessionQueue } from '../../pipeline/queue.js';
import { createCall } from '../../runtime/call.js';
import { EventKind } from '../../pipeline/types.js';
import type {
	ActionHandler,
	ErrorReport,
	IncomingEvent,
	PlatformPort,
	PolicyDecision,
	PolicyPort,
	PolicyRequest,
} from '../../pipeline/types.js';
import { defineFlow } from '../define.js';
import { viewOf } from '../../commit/commit.js';
import { screen, subview } from '../screen.js';
import { kitFor } from '../../tree/kit.js';
import { getPath, lensSession, setPath } from '../lens.js';
import { flow } from '../token.js';
import type { MountToken } from '../token.js';
import { buildFlowCatalog } from '../../boot/build.js';
import type { FlowDefinition } from '../types.js';
import type { ViewSession } from '../types.js';

interface LottoData {
	count: number;
	picker: { chosen: string };
}

/** Hand-built token for a raw definition: the frame resolves its screens through it. */
const tokenFor = <T,>(definition: FlowDefinition<T>, flowId: string): MountToken =>
	({ flowId, moduleId: flowId.slice(0, flowId.indexOf('/')), definition }) as unknown as MountToken;

/** Minimal token for sessions that never draw: the store only files it on the root frame. */
const BARE_TOKEN: MountToken = {
	flowId: 'lotto/lotto',
	moduleId: 'lotto',
	definition: { first: 'main', ttlMs: DEFAULT_TTL_MS, remount: 'coexist', screens: {} },
} as unknown as MountToken;

describe('defineFlow - validations', () => {
	it('builds screens with the framework defaults, carrying the declared initialData', () => {
		const def = defineFlow<LottoData>({
			screens: { main: { view: () => view({}, text('m')) } },
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
		});

		expect(def.screenIds).toEqual(['main']);
		expect(def.first).toBe('main');
		expect(def.ttlMs).toBe(DEFAULT_TTL_MS);
		expect(def.remount).toBe('replace');
		// Carried as-is: the definition freezes itself, never the bag.
		expect(def.initialData).toEqual({ count: 0, picker: { chosen: 'none' } });
		expect(Object.isFrozen(def)).toBe(true);
		expect(Object.isFrozen(def.screens)).toBe(true);
		expect(Object.isFrozen(def.initialData)).toBe(false);
	});

	it('builds a stateless flow when initialData is omitted', () => {
		const def = defineFlow({ screens: { main: { view: () => view({}, text('m')) } }, first: 'main' });

		expect(def.screenIds).toEqual(['main']);
		expect(def.first).toBe('main');
		expect(def.ttlMs).toBe(DEFAULT_TTL_MS);
		expect(def.initialData).toBeUndefined();
	});

	it('rejects non-finite and non-positive ttlMs', () => {
		const screens = { main: { view: () => view({}, text('m')) } } as const;
		expect(() => defineFlow({ screens, first: 'main', initialData: {}, ttlMs: Infinity })).toThrow(/ttlMs/);
		expect(() => defineFlow({ screens, first: 'main', initialData: {}, ttlMs: 0 })).toThrow(/ttlMs/);
		expect(() => defineFlow({ screens, first: 'main', initialData: {}, ttlMs: -1000 })).toThrow(/ttlMs/);
	});

	it('rejects screen ids the customId codec cannot carry', () => {
		expect(() => defineFlow({
			screens: { 'a:b': { view: () => view({}, text('m')) } },
			first: 'a:b',
			initialData: {},
		})).toThrow(/must not contain/);
	});

	it('composes component wraps left to right - later entries wrap earlier output', () => {
		const marker = view({}, text('first'));
		const second = vi.fn((tree: ViewNode): ViewNode => tree);
		const def = defineFlow<LottoData>({
			screens: { main: { view: () => view({}, text('m')) } },
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
			components: [
				(): ViewNode => marker,
				second,
			],
		});

		const fakeSession = {} as Session<LottoData>;
		const kit = kitFor(fakeSession);
		const base = view({}, text('base'));
		const result = def.wrap?.(base, fakeSession, kit);

		expect(second).toHaveBeenCalledWith(marker, fakeSession, kit);
		expect(result).toBe(marker);
	});

	it('declares no wrap when there are no components', () => {
		const def = defineFlow<LottoData>({
			screens: { main: { view: () => view({}, text('m')) } },
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
		});
		expect(def.wrap).toBeUndefined();
	});
});

describe('the drawn session', () => {
	it('views receive the session as their third parameter', () => {
		const seen: unknown[] = [];
		const def = defineFlow<LottoData>({
			screens: {
				main: {
					view: (_data, _kit, session) => {
						seen.push(session);
						return view({}, text(`owner ${session.ownerId} on ${session.screen}`));
					},
				},
			},
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
		});
		const session = createSessionStore().create<LottoData>({
			flowId: 'lotto/lotto',
			moduleId: 'lotto',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { count: 0, picker: { chosen: 'none' } },
			screen: 'main',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
			token: tokenFor(def, 'lotto/lotto'),
		});

		const tree = viewOf(session);

		// The live session went in, the same object reached the view...
		expect(seen[0]).toBe(session);
		// ...and the view drew from its read-only facts.
		const drawn = tree.children.find((child) => child.kind === 'text');
		expect(drawn).toMatchObject({ body: 'owner u1 on main' });
	});

	it('throws on an illegal tree at the draw seam instead of rendering it', () => {
		const onPick = (): void => undefined;
		const def = defineFlow<LottoData>({
			screens: {
				// A row mixing a select with a button is type-legal but breaks
				// rule 22: only the validator can catch it.
				main: { view: () => row({}, optionSelect({ onSelect: onPick, options: [{ label: 'A', value: 'a' }] }), button({ onClick: onPick, label: 'Go' })) },
			},
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
		});
		const session = createSessionStore().create<LottoData>({
			flowId: 'lotto/lotto',
			moduleId: 'lotto',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { count: 0, picker: { chosen: 'none' } },
			screen: 'main',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
			token: tokenFor(def, 'lotto/lotto'),
		});
		expect(() => viewOf(session)).toThrow(/rule 22/);
	});
});

describe('the lens', () => {
	it('getPath reads nested slots and returns undefined past missing or non-object hops', () => {
		const bag = { a: { b: { c: 7 } }, n: 5 };
		expect(getPath(bag, ['a', 'b', 'c'])).toBe(7);
		expect(getPath(bag, ['x'])).toBeUndefined();
		expect(getPath(bag, ['n', 'c'])).toBeUndefined();
	});

	it('setPath writes, creates missing intermediates, and refuses to replace primitives', () => {
		const bag: Record<string, unknown> = {};
		setPath(bag, ['picker', 'chosen'], 'x');
		expect(bag).toEqual({ picker: { chosen: 'x' } });

		expect(() => setPath(bag, ['n', 'c'], 1)).not.toThrow();
		bag.n = 5;
		expect(() => setPath(bag, ['n', 'c'], 1)).toThrow(/non-object/);
	});

	it('lensSession redirects data to the slot and forwards everything else live', () => {
		const session = createSessionStore().create<LottoData>({
			flowId: 'lotto/lotto',
			moduleId: 'lotto',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { count: 0, picker: { chosen: 'none' } },
			screen: 'main',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
			token: BARE_TOKEN,
		});
		const lens = lensSession<{ chosen: string }>(session, ['picker']);

		expect(lens.data).toEqual({ chosen: 'none' });
		expect(lens.id).toBe(session.id);

		lens.data.chosen = 'direct'; // in-place write through the facade
		expect(session.data.picker.chosen).toBe('direct');

		lens.data = { chosen: 'replaced' }; // setter replaces the slot value
		expect(session.data.picker).toEqual({ chosen: 'replaced' });

		activeFrame(session).screen = 'picker.pick'; // navigation writes the frame
		expect(lens.screen).toBe('picker.pick'); // and the lens forwards the read
	});
});

describe('screen', () => {
	it('validates shape and returns the frozen bundle', () => {
		const bundle = screen<LottoData>()(() => view({}, text('m')));
		expect(Object.isFrozen(bundle)).toBe(true);
		expect(() => screen<LottoData>()(undefined as never)).toThrow(/view/);
	});
});

describe('subview', () => {
	it('hands back the same arrow: the value is all at the type level', () => {
		const arrow = (): ViewNode => view({}, text('arm'));
		const helper = subview<LottoData>()(arrow);
		expect(helper).toBe(arrow);
	});

	it('draws when the screen forwards its kit: helpers are plain calls', () => {
		const helper = subview<LottoData>()((data) => view({}, text(`count: ${data.count}`)));
		const stub: ViewSession = { ownerId: '', createdAt: 0, screen: 'main', history: [], lastActivityAt: 0, ttlMs: 0 };
		const tree = helper({ count: 3, picker: { chosen: 'x' } }, kitFor(stub), stub);
		expect(tree).toEqual(view({}, text('count: 3')));
	});

	it('throws on a non-function view, mirroring screen', () => {
		expect(() => subview<LottoData>()(undefined as never)).toThrow(/view/);
	});
});

describe('action', () => {
	it('hands back the same arrow: the handler IS the product', () => {
		const run = (): void => { };
		expect(action<LottoData>()(run)).toBe(run);
	});

	it('throws on a non-function run, mirroring screen/subview', () => {
		expect(() => action<LottoData>()(undefined as never)).toThrow(/run/);
	});
});

/** What world() wires together: the full flow stack, every port recorded. */
interface World {
	clock: { now: number; advance: (ms: number) => number };
	store: SessionStore;
	session: Session<LottoData>;
	policy: PolicyPort & { authorize: Mock };
	platform: PlatformPort;
	commit: CommitPhase;
	calls: string[];
	replies: string[];
	partings: unknown[];
	edits: string[];
	errors: ErrorReport[];
	/** Draw the session's current screen through the real commit phase (writes the frame). */
	draw: () => Promise<void>;
	/** Label = the handler's wire hash (handlers are addressed by their authored control label). */
	hashOf: (label: string) => string;
	click: (label: string, overrides?: Partial<IncomingEvent>) => Promise<void>;
}

interface WorldOptions {
	onError?: (report: ErrorReport) => string | undefined;
	omitErrorHandler?: boolean;
}

/** The wired flow world: a real makeUi and commit phase, recorded platform. */
function world(options: WorldOptions = {}): World {
	const clock = { now: 1_000_000, advance: (ms: number): number => (clock.now += ms) };
	const calls: string[] = [];
	const replies: string[] = [];
	const partings: unknown[] = [];
	const edits: string[] = [];
	const errors: ErrorReport[] = [];

	// Handlers are module-level objects; the views bind them and the frame
	// harvest registers them; there is no actions declaration anywhere.
	const bump: ActionHandler<LottoData> = (event) => {
		event.mutate((data) => {
			data.count += 1;
		});
	};
	const refresh: ActionHandler<LottoData> = (event) => {
		event.mutate((data) => {
			// A different expression from bump on purpose: source-identical
			// handlers share one action hash, and the stale-frame test below
			// needs 'bump' truly absent from counter's frame.
			data.count = data.count + 1;
		});
	};
	const open: ActionHandler<LottoData> = (event) => {
		event.ui.go('counter');
	};
	const boom: ActionHandler<LottoData> = () => {
		throw new Error('boom');
	};

	const lotto = flow<LottoData>('lotto', {
		screens: {
			main: screen<LottoData>()((data) => view(
				{},
				text(`count: ${data.count}`),
				row({},
					button({ onClick: bump, label: 'bump' }),
					button({ onClick: open, label: 'open' }),
					button({ onClick: boom, label: 'boom' }),
				),
			)),
			counter: { view: (data) => view({}, text(`count: ${data.count}`)) },
		},
		first: 'main',
		initialData: { count: 0, picker: { chosen: 'none' } },
		components: [
			(tree, _session, kit): ViewNode => view({},
				...tree.children,
				text('flow chrome'),
				row({},
					kit.Button({ onClick: refresh, label: 'refresh' }),
				),
			),
		],
		parting: { command: 'lotto', note: 'The lotto ended.' },
		...(options.onError !== undefined ? { onError: options.onError } : {}),
	});
	const catalog = buildFlowCatalog([{ module: 'lotto', flow: lotto }]);
	const token = catalog.byFlowId.get('lotto/lotto')!;

	const platform: PlatformPort = {
		replyToActor: vi.fn(async (textValue: string): Promise<void> => {
			replies.push(textValue);
		}),
		redraw: vi.fn(async (session: Session<unknown>): Promise<void> => {
			calls.push(`redraw:${session.screen}`);
		}),
		commitParting: vi.fn(async (ref: { messageId: string }, parting?: unknown): Promise<void> => {
			calls.push(`parting:${ref.messageId}`);
			partings.push(parting);
		}),
		editMessage: vi.fn(async (_ref: unknown, payload: unknown): Promise<void> => {
			edits.push(JSON.stringify(payload));
		}),
		showModal: vi.fn(async (): Promise<void> => undefined),
	};
	const commit = createCommit({ platform });
	const store = createSessionStore({
		now: () => clock.now,
		onEnd: createOnEnd({ commit }),
	});
	const session = store.create<LottoData>({
		flowId: 'lotto/lotto',
		moduleId: 'lotto',
		ownerId: 'u1',
		messageRef: { channelId: 'c1', messageId: 'm1' },
		data: { count: 0, picker: { chosen: 'none' } },
		screen: 'main',
		ttlMs: DEFAULT_TTL_MS,
		remount: 'coexist',
		token,
	});
	const policy = {
		authorize: vi.fn(async (_request: PolicyRequest): Promise<PolicyDecision> => ({ allowed: true })),
	};
	const dispatch = createDispatch({
		store,
		policy,
		platform,
		reviveIndex: catalog.byFlowId,
		tryRevive: vi.fn(async () => undefined),
		makeUi: createMakeUi({ exit: createCall({ store, queue: createSessionQueue(), commit: { redraw: commit.redraw }, byToken: new Map() }).exit }),
		call: {
			call: async () => {
				throw new Error('no call engine in test');
			},
			exit: () => {},
			crash: () => false,
		},
		...(options.omitErrorHandler !== true ? { onError: (report: ErrorReport): void => { errors.push(report); } } : {}),
		now: () => clock.now,
	});

	/** Label = wire hash: tests address handlers by the label they authored on the control. */
	const handlers: Record<string, ActionHandler<never>> = { bump, refresh, open, boom };
	function hashOf(label: string): string {
		return actionHash(handlers[label]);
	}

	async function draw(): Promise<void> {
		await commit.redraw(session);
	}

	function click(label: string, overrides: Partial<IncomingEvent> = {}): Promise<void> {
		return dispatch({
			kind: EventKind.Button,
			customId: encodeActionId({ sessionId: session.id, screenKey: `lotto/lotto/${session.screen}`, actionHash: hashOf(label) }),
			actorId: 'u1',
			channelId: 'c1',
			messageId: 'm1',
			...overrides,
		});
	}

	return {
		clock, store, session, policy, platform, commit,
		calls, replies, partings, edits, errors, draw, hashOf, click,
	};
}

describe('dispatch - flow integration through the frame', () => {
	it('runs a handler the frame carries and auto-redraws once', async () => {
		const w = world();
		await w.draw();

		await w.click('bump');

		expect(w.session.data.count).toBe(1);
		expect(w.calls).toEqual(['redraw:main']);
	});

	it('a hash the frame does not carry is stale: one snap redraw, no error, no run', async () => {
		const w = world();
		await w.draw();
		const stray = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/lotto/main', actionHash: actionHash(() => { }) });

		await w.click('bump', { customId: stray });

		expect(w.session.data.count).toBe(0);
		expect(w.calls).toEqual(['redraw:main']);
		expect(w.errors).toHaveLength(0);
	});

	it('a click on a handler absent from the current frame is stale: no run', async () => {
		const w = world();
		await w.draw();
		await w.click('open'); // session -> counter

		await w.draw(); // the frame is counter's; bump is not on it
		await w.click('bump');

		expect(w.session.data.count).toBe(0);
		expect(w.calls).toEqual(['redraw:counter', 'redraw:counter']);
	});

	it('redraw renders a second screen through the flow wrap', async () => {
		const w = world();
		activeFrame(w.session).screen = 'counter';

		await w.draw();

		expect(w.edits).toHaveLength(1);
		expect(w.edits[0]).toContain('count: 0');
		expect(w.edits[0]).toContain('flow chrome'); // the component drew around it
	});

	it('the flow onError hook decides the reply copy over the default', async () => {
		const seen: ErrorReport[] = [];
		const w = world({
			onError: (report) => {
				seen.push(report);
				return 'flow copy';
			},
			omitErrorHandler: true,
		});
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await w.draw();

		await w.click('boom');
		expect(w.replies).toEqual(['flow copy']);
		expect(seen[0].screen).toBe('lotto/lotto/main');
		expect(seen[0].action).toBe('boom');

		await w.click('boom'); // hook again: replies accumulate per failure
		expect(w.replies).toEqual(['flow copy', 'flow copy']);
		log.mockRestore();
	});

	it('a hook with no opinion falls through to the generic copy', async () => {
		const w = world({ onError: () => undefined, omitErrorHandler: true });
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await w.draw();

		await w.click('boom');
		expect(w.replies).toEqual([DEFAULT_ERROR_MESSAGE]);
		log.mockRestore();
	});

	it('a throwing hook is logged and treated as no opinion', async () => {
		const w = world({
			onError: () => {
				throw new Error('hook broke');
			},
			omitErrorHandler: true,
		});
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await w.draw();

		await w.click('boom');
		expect(w.replies).toEqual([DEFAULT_ERROR_MESSAGE]);
		expect(log).toHaveBeenCalledWith('[fluxcord] flow onError hook failed:', expect.any(Error));
		log.mockRestore();
	});

	it('the custom error socket receives suggestedReply from the hook', async () => {
		const w = world({ onError: () => 'flow copy' });
		await w.draw();

		await w.click('boom');

		expect(w.errors).toHaveLength(1);
		expect(w.errors[0].suggestedReply).toBe('flow copy');
		expect(w.replies).toEqual([]); // the custom socket owns delivery
	});

	it('a dead click edits the message into the flow\'s parting bundle', async () => {
		const w = world();
		const id = encodeActionId({ sessionId: 'zzzzzzzz', screenKey: 'lotto/lotto/main', actionHash: actionHash(() => { }) });

		await w.click('bump', { customId: id });

		expect(w.calls).toEqual(['parting:m1']);
		expect(w.partings[0]).toEqual({ command: 'lotto', note: 'The lotto ended.' });
	});

	it('the sweeper parts an expired session with the same bundle (once)', async () => {
		const w = world();

		w.clock.advance(31 * 60 * 1000);
		expect(w.store.sweep()).toBe(1);
		w.store.sweep();

		expect(w.edits).toHaveLength(1);
		expect(w.edits[0]).toContain('Run `/lotto`');
		expect(w.edits[0]).toContain('The lotto ended.');
	});
});

describe('dispatch - generated lists of inline closures (stamped ids)', () => {
	interface ListData {
		picked: string[];
	}

	/**
	 * Factory closures: byte-identical source, distinct captures: the exact
	 * shape the bare hash silently collided (every button ran the last one).
	 */
	const pick = (item: string): ActionHandler<ListData> => (event) => {
		event.mutate((data) => {
			data.picked.push(item);
		});
	};

	/** A one-screen flow whose row is a generated list of inline closures. */
	function listWorld(items: string[]): {
		session: Session<ListData>;
		draw: () => Promise<void>;
		clickStamp: (stamp: string) => Promise<void>;
	} {
		const list = flow<ListData>('list', {
			screens: {
				main: screen<ListData>()((data) => view(
					{},
					text(`picked: ${data.picked.join(', ') || 'none'}`),
					row({}, ...items.map((item) => button({ onClick: pick(item), label: item }))),
				)),
			},
			first: 'main',
			initialData: { picked: [] },
		});
		const catalog = buildFlowCatalog([{ module: 'list', flow: list }]);
		const token = catalog.byFlowId.get('list/list')!;
		const platform: PlatformPort = {
			replyToActor: vi.fn(async (): Promise<void> => undefined),
			redraw: vi.fn(async (): Promise<void> => undefined),
			commitParting: vi.fn(async (): Promise<void> => undefined),
			editMessage: vi.fn(async (_ref: unknown, _payload: unknown): Promise<void> => undefined),
			showModal: vi.fn(async (): Promise<void> => undefined),
		};
		const commit = createCommit({ platform });
		const store = createSessionStore({ onEnd: createOnEnd({ commit }) });
		const session = store.create<ListData>({
			flowId: 'list/list',
			moduleId: 'list',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { picked: [] },
			screen: 'main',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
			token,
		});
		const policy = { authorize: vi.fn(async (_request: PolicyRequest): Promise<PolicyDecision> => ({ allowed: true })) };
		const dispatch = createDispatch({
			store,
			policy,
			platform,
			reviveIndex: catalog.byFlowId,
			tryRevive: vi.fn(async () => undefined),
			makeUi: createMakeUi({ exit: createCall({ store, queue: createSessionQueue(), commit: { redraw: commit.redraw }, byToken: new Map() }).exit }),
			call: {
				call: async () => {
					throw new Error('no call engine in test');
				},
				exit: () => {},
				crash: () => false,
			},
		});

		async function draw(): Promise<void> {
			await commit.redraw(session);
		}

		function clickStamp(stamp: string): Promise<void> {
			return dispatch({
				kind: EventKind.Button,
				customId: encodeActionId({ sessionId: session.id, screenKey: 'list/list/main', actionHash: stamp }),
				actorId: 'u1',
				channelId: 'c1',
				messageId: 'm1',
			});
		}

		return { session, draw, clickStamp };
	}

	it('clicks each generated button through its own stamp: each closure runs with its own capture', async () => {
		const w = listWorld(['a', 'b', 'c']);
		await w.draw();

		const stamps = Object.keys(activeFrame(w.session).actions); // document order
		expect(stamps).toHaveLength(3);
		expect(new Set(stamps).size).toBe(3);
		expect(stamps.map((stamp) => activeFrame(w.session).actions[stamp].label)).toEqual(['a', 'b', 'c']);

		await w.clickStamp(stamps[0]);
		expect(w.session.data.picked).toEqual(['a']); // its OWN closure, not the last one

		await w.clickStamp(stamps[1]);
		await w.clickStamp(stamps[2]);
		expect(w.session.data.picked).toEqual(['a', 'b', 'c']);
	});

	it('a re-draw of the same screen from the same data re-stamps identically: restart continuity', async () => {
		const w = listWorld(['a', 'b', 'c']);
		await w.draw();
		const before = Object.keys(activeFrame(w.session).actions);

		await w.draw();

		expect(Object.keys(activeFrame(w.session).actions)).toEqual(before);
	});
});
