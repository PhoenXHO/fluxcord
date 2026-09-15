/**
 * Flow layer tests: defineFlow's validations, the subflow namespacing/
 * slot machinery, the lens, the registry erase helper, and the pipeline
 * integration through the frame: resolution after a draw, the rule-9
 * policy ladder, lensed delivery, the done round trip, stale semantics,
 * the error copy hook, and parting bundles on both death paths.
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
import { DEFAULT_TTL_MS } from '../../state/types.js';
import { button, row, text, view } from '../../tree/builders.js';
import type { ViewNode } from '../../tree/types.js';
import { createCommit } from '../../commit/commit.js';
import type { CommitPhase } from '../../commit/commit.js';
import { createOnEnd } from '../../commit/onEnd.js';
import { createMakeUi } from '../../commit/ui.js';
import { action } from '../../pipeline/action.js';
import { DEFAULT_ERROR_MESSAGE, createDispatch } from '../../pipeline/dispatch.js';
import { EventKind } from '../../pipeline/types.js';
import type {
	ActionEvent,
	ActionHandler,
	ErrorReport,
	IncomingEvent,
	PlatformPort,
	PolicyDecision,
	PolicyPort,
	PolicyRequest,
	RegisteredScreen,
	UiToolkit,
} from '../../pipeline/types.js';
import { defineFlow, subflow } from '../define.js';
import { viewOf } from '../../commit/commit.js';
import { screen, subview } from '../screen.js';
import { runtimeKit } from '../../tree/kit.js';
import { getPath, lensSession, setPath } from '../lens.js';
import { asScreenRegistry, screenEntries } from '../registry.js';
import { validateFlows } from '../validate.js';
import type { Screen, ViewSession } from '../types.js';

interface LottoData {
	count: number;
	picker: { chosen: string };
}

interface PickData {
	chosen: string;
}

/** The picker subflow's one handler: bound in its view, hashed by identity. */
const choose: ActionHandler<PickData> = (event) => {
	event.mutate((data) => {
		data.chosen = 'winner';
	});
};

/** Shared fixture: the one-screen picker subflow's screen. */
function pickerScreen(): Screen<PickData> {
	return screen<PickData>()((data) => view(
		{},
		text({ body: `picked: ${data.chosen}` }),
		row({}, button({ onClick: choose, label: 'choose' })),
	));
}

describe('defineFlow - validations', () => {
	it('builds screens with the framework defaults, carrying the declared initialData', () => {
		const def = defineFlow<LottoData>({
			screens: { main: { view: () => view({}, text({ body: 'm' })) } },
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
		});

		expect(def.screenIds).toEqual(['main']);
		expect(def.first).toBe('main');
		expect(def.ttlMs).toBe(DEFAULT_TTL_MS);
		expect(def.remount).toBe('replace');
		expect(def.slots).toEqual({ main: [] });
		expect(def.roots).toEqual({});
		// Carried as-is: the definition freezes itself, never the bag.
		expect(def.initialData).toEqual({ count: 0, picker: { chosen: 'none' } });
		expect(Object.isFrozen(def)).toBe(true);
		expect(Object.isFrozen(def.screens)).toBe(true);
		expect(Object.isFrozen(def.initialData)).toBe(false);
	});

	it('rejects non-finite and non-positive ttlMs', () => {
		const screens = { main: { view: () => view({}, text({ body: 'm' })) } } as const;
		expect(() => defineFlow({ screens, first: 'main', initialData: {}, ttlMs: Infinity })).toThrow(/ttlMs/);
		expect(() => defineFlow({ screens, first: 'main', initialData: {}, ttlMs: 0 })).toThrow(/ttlMs/);
		expect(() => defineFlow({ screens, first: 'main', initialData: {}, ttlMs: -1000 })).toThrow(/ttlMs/);
	});

	it('rejects screen ids and subflow keys the customId codec cannot carry', () => {
		expect(() => defineFlow({
			screens: { 'a.b': { view: () => view({}, text({ body: 'm' })) } },
			first: 'a.b',
			initialData: {},
		})).toThrow(/namespace separator/);
		expect(() => defineFlow({
			screens: { 'a:b': { view: () => view({}, text({ body: 'm' })) } },
			first: 'a:b',
			initialData: {},
		})).toThrow(/must not contain/);
	});

	it('composes component wraps left to right - later entries wrap earlier output', () => {
		const marker = view({}, text({ body: 'first' }));
		const second = vi.fn((tree: ViewNode): ViewNode => tree);
		const def = defineFlow<LottoData>({
			screens: { main: { view: () => view({}, text({ body: 'm' })) } },
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
			components: [
				(): ViewNode => marker,
				second,
			],
		});

		const fakeSession = {} as Session<LottoData>;
		const base = view({}, text({ body: 'base' }));
		const result = def.wrap?.(base, fakeSession);

		expect(second).toHaveBeenCalledWith(marker, fakeSession);
		expect(result).toBe(marker);
	});

	it('declares no wrap when there are no components', () => {
		const def = defineFlow<LottoData>({
			screens: { main: { view: () => view({}, text({ body: 'm' })) } },
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
		});
		expect(def.wrap).toBeUndefined();
	});
});

describe('defineFlow - subflow plugs', () => {
	it('namespaces screens, rebases slot paths, and maps the root', () => {
		const plug = subflow({ use: defineFlow<PickData>({ screens: { pick: pickerScreen() }, first: 'pick', initialData: { chosen: 'none' } }), at: 'picker' });
		const def = defineFlow<LottoData>({
			screens: { main: { view: () => view({}, text({ body: 'm' })) } },
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
			subflows: [plug],
		});

		expect(def.screenIds).toEqual(['main', 'picker.pick']);
		expect(def.slots['picker.pick']).toEqual(['picker']);
		expect(def.slots.main).toEqual([]);
		expect(def.roots).toEqual({ picker: 'picker.pick' });
		// The namespaced screen is the source screen, unmolested: the done
		// handler is the parent's to bind in a view, not defineFlow's to install.
		expect(def.screens['picker.pick'].view).toBe(plug.use.screens.pick.view);
	});

	it('composes namespaces and slot paths through nested plugs', () => {
		const leaf = defineFlow<{ n: number }>({
			screens: { leaf: { view: (data) => view({}, text({ body: `n ${data.n}` })) } },
			first: 'leaf',
			initialData: { n: 0 },
		});
		const middle = defineFlow<{ m: string }>({
			screens: { mid: { view: (data) => view({}, text({ body: data.m })) } },
			first: 'mid',
			initialData: { m: 'm' },
			subflows: [subflow({ use: leaf, at: 'inner' })],
		});
		const outer = defineFlow<{ top: boolean }>({
			screens: { top: { view: () => view({}, text({ body: 'top' })) } },
			first: 'top',
			initialData: { top: false },
			subflows: [subflow({ use: middle, at: 'mid' })],
		});

		expect(outer.screenIds).toEqual(['top', 'mid.mid', 'mid.inner.leaf']);
		expect(outer.slots['mid.mid']).toEqual(['mid']);
		expect(outer.slots['mid.inner.leaf']).toEqual(['mid', 'inner']);
		expect(outer.roots).toEqual({ mid: 'mid.mid', inner: 'mid.inner.leaf' });
	});

	it('throws on duplicate plug keys and keys colliding with own screens', () => {
		const picker = defineFlow<PickData>({ screens: { pick: pickerScreen() }, first: 'pick', initialData: { chosen: 'none' } });
		expect(() => defineFlow({
			screens: { main: { view: () => view({}, text({ body: 'm' })) } },
			first: 'main',
			initialData: {},
			subflows: [subflow({ use: picker, at: 'x' }), subflow({ use: picker, at: 'x' })],
		})).toThrow(/one plug per key/);
		expect(() => defineFlow({
			screens: { main: { view: () => view({}, text({ body: 'm' })) } },
			first: 'main',
			initialData: {},
			subflows: [subflow({ use: picker, at: 'main' })],
		})).toThrow(/collides with own screen/);
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
						return view({}, text({ body: `owner ${session.ownerId} on ${session.screen}` }));
					},
				},
			},
			first: 'main',
			initialData: { count: 0, picker: { chosen: 'none' } },
		});
		const session = createSessionStore().create<LottoData>({
			flowId: 'lotto',
			moduleId: 'lotto',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { count: 0, picker: { chosen: 'none' } },
			screen: 'main',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
		});

		const tree = viewOf(session, asScreenRegistry(screenEntries('lotto', def)));

		// The live session went in, the same object reached the view...
		expect(seen[0]).toBe(session);
		// ...and the view drew from its read-only facts.
		const drawn = tree.children.find((child) => child.kind === 'text');
		expect(drawn).toMatchObject({ body: 'owner u1 on main' });
	});
});

describe('the subflow done handler', () => {
	it('pops history through the lens and hands onDone the slot state', async () => {
		const store = createSessionStore();
		const session = store.create<LottoData>({
			flowId: 'lotto',
			moduleId: 'lotto',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { count: 0, picker: { chosen: 'seed' } },
			screen: 'picker.pick',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
		});
		session.history = ['main'];
		session.modalNonce = 'old-nonce';

		const onDone = vi.fn();
		const plug = subflow({ use: defineFlow<PickData>({ screens: { pick: pickerScreen() }, first: 'pick', initialData: { chosen: 'none' } }), at: 'picker', onDone });

		const ui: UiToolkit = { go: vi.fn(), push: vi.fn(), back: vi.fn(), close: vi.fn(), showModal: vi.fn(async () => undefined) };
		const event = {
			kind: EventKind.Button,
			name: 'Done',
			actorId: 'u1',
			session: lensSession<PickData>(session, ['picker']),
			ui,
			task: <T>(fn: () => Promise<T>): Promise<T> => fn(),
			mutate: vi.fn(),
		};
		await plug.done(event as unknown as ActionEvent<never>);

		expect(onDone).toHaveBeenCalledWith({ chosen: 'seed' }, ui);
		expect(session.screen).toBe('main');
		expect(session.history).toEqual([]);
		expect(session.modalNonce).not.toBe('old-nonce');
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
			flowId: 'lotto',
			moduleId: 'lotto',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { count: 0, picker: { chosen: 'none' } },
			screen: 'main',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
		});
		const lens = lensSession<PickData>(session, ['picker']);

		expect(lens.data).toEqual({ chosen: 'none' });
		expect(lens.id).toBe(session.id);

		lens.data.chosen = 'direct'; // in-place write through the facade
		expect(session.data.picker.chosen).toBe('direct');

		lens.data = { chosen: 'replaced' }; // setter replaces the slot value
		expect(session.data.picker).toEqual({ chosen: 'replaced' });

		lens.screen = 'picker.pick'; // navigation writes forward to the record
		expect(session.screen).toBe('picker.pick');
	});
});

describe('registry population and cross-flow validation', () => {
	const flow = defineFlow<LottoData>({
		screens: { main: { view: () => view({}, text({ body: 'm' })) } },
		first: 'main',
		initialData: { count: 0, picker: { chosen: 'none' } },
		parting: { command: 'lotto' },
		subflows: [subflow({ use: defineFlow<PickData>({ screens: { pick: pickerScreen() }, first: 'pick', initialData: { chosen: 'none' } }), at: 'picker' })],
	});

	it('screenEntries keys entries and carries slot plus the flow slice', () => {
		const entries = screenEntries('lotto', flow);

		expect(Object.keys(entries)).toEqual(['lotto/main', 'lotto/picker.pick']);
		expect(entries['lotto/picker.pick']?.slot).toEqual(['picker']);
		expect(entries['lotto/main']?.slot).toBeUndefined();
		expect(entries['lotto/main']?.flow?.roots).toEqual({ picker: 'picker.pick' });
		expect(entries['lotto/main']?.flow?.parting).toEqual({ command: 'lotto' });
		expect(asScreenRegistry(entries).resolve('lotto/main')).toBe(entries['lotto/main']);
	});

	it('validateFlows throws when two flows declare the same screen key', () => {
		const other = defineFlow<unknown>({ screens: { main: { view: () => view({}, text({ body: 'o' })) } }, first: 'main', initialData: {} });
		expect(() => validateFlows([
			{ moduleId: 'lotto', flowId: 'lottoWizard', definition: flow },
			{ moduleId: 'lotto', flowId: 'otherWizard', definition: other },
		])).toThrow(/lotto\/main.*lottoWizard.*otherWizard/);

		expect(() => validateFlows([
			{ moduleId: 'lotto', definition: flow },
			{ moduleId: 'raffle', definition: other },
		])).not.toThrow();
	});
});

describe('screen', () => {
	it('validates shape and returns the frozen bundle', () => {
		const bundle = screen<LottoData>()(() => view({}, text({ body: 'm' })));
		expect(Object.isFrozen(bundle)).toBe(true);
		expect(() => screen<LottoData>()(undefined as never)).toThrow(/view/);
	});
});

describe('subview', () => {
	it('hands back the same arrow: the value is all at the type level', () => {
		const arrow = (): ViewNode => view({}, text({ body: 'arm' }));
		const helper = subview<LottoData>()(arrow);
		expect(helper).toBe(arrow);
	});

	it('draws when the screen forwards its kit: helpers are plain calls', () => {
		const helper = subview<LottoData>()((data) => view({}, text({ body: `count: ${data.count}` })));
		const stub: ViewSession = { ownerId: '', createdAt: 0, screen: 'main', history: [], lastActivityAt: 0, ttlMs: 0 };
		const tree = helper({ count: 3, picker: { chosen: 'x' } }, runtimeKit, stub);
		expect(tree).toEqual(view({}, text({ body: 'count: 3' })));
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
	entries: Record<string, RegisteredScreen>;
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
	onDone?: (state: unknown, ui: UiToolkit) => void;
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
			data.count += 1;
		});
	};
	const open: ActionHandler<LottoData> = (event) => {
		event.ui.go('picker');
	};
	const boom: ActionHandler<LottoData> = () => {
		throw new Error('boom');
	};

	const plug = subflow({
		use: defineFlow<PickData>({ screens: { pick: pickerScreen() }, first: 'pick', initialData: { chosen: 'none' } }),
		at: 'picker',
		onDone: options.onDone,
	});

	const flow = defineFlow<LottoData>({
		screens: {
			main: screen<LottoData>()((data) => view(
				{},
				text({ body: `count: ${data.count}` }),
				row({},
					button({ onClick: bump, label: 'bump' }),
					button({ onClick: open, label: 'open' }),
					button({ onClick: boom, label: 'boom' }),
				),
			)),
		},
		first: 'main',
		initialData: { count: 0, picker: { chosen: 'none' } },
		components: [
			(tree, session): ViewNode => view({},
				...tree.children,
				text({ body: 'flow chrome' }),
				row({},
					button({ onClick: refresh, label: 'refresh' }),
					...(session.screen.startsWith('picker.') ? [button({ onClick: plug.done, label: 'Done' })] : []),
				),
			),
		],
		subflows: [plug],
		parting: { command: 'lotto', note: 'The lotto ended.' },
		...(options.onError !== undefined ? { onError: options.onError } : {}),
	});

	const entries: Record<string, RegisteredScreen> = { ...screenEntries('lotto', flow) };
	const screens = asScreenRegistry(entries);
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
	const commit = createCommit({ platform, screens });
	const store = createSessionStore({
		now: () => clock.now,
		onEnd: createOnEnd({ commit, screens }),
	});
	const session = store.create<LottoData>({
		flowId: 'lotto',
		moduleId: 'lotto',
		ownerId: 'u1',
		messageRef: { channelId: 'c1', messageId: 'm1' },
		data: { count: 0, picker: { chosen: 'none' } },
		screen: 'main',
		ttlMs: DEFAULT_TTL_MS,
		remount: 'coexist',
	});
	const policy = {
		authorize: vi.fn(async (_request: PolicyRequest): Promise<PolicyDecision> => ({ allowed: true })),
	};
	const dispatch = createDispatch({
		store,
		policy,
		platform,
		screens,
		tryRevive: vi.fn(async () => undefined),
		makeUi: createMakeUi({ store, screens }),
		...(options.omitErrorHandler !== true ? { onError: (report: ErrorReport): void => { errors.push(report); } } : {}),
		now: () => clock.now,
	});

	/** Label = wire hash: tests address handlers by the label they authored on the control. */
	const handlers: Record<string, ActionHandler<never>> = { bump, refresh, open, boom, choose, done: plug.done };
	function hashOf(label: string): string {
		return actionHash(handlers[label]);
	}

	async function draw(): Promise<void> {
		await commit.redraw(session);
	}

	function click(label: string, overrides: Partial<IncomingEvent> = {}): Promise<void> {
		return dispatch({
			kind: EventKind.Button,
			customId: encodeActionId({ sessionId: session.id, screenKey: `lotto/${session.screen}`, actionHash: hashOf(label) }),
			actorId: 'u1',
			channelId: 'c1',
			messageId: 'm1',
			...overrides,
		});
	}

	return {
		clock, store, session, entries, policy, platform, commit,
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
		const stray = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/main', actionHash: actionHash(() => { }) });

		await w.click('bump', { customId: stray });

		expect(w.session.data.count).toBe(0);
		expect(w.calls).toEqual(['redraw:main']);
		expect(w.errors).toHaveLength(0);
	});

	it('a laggy click on a handler the frame still carries RUNS: the address screen is decorative', async () => {
		const w = world();
		w.session.screen = 'picker.pick';
		await w.draw(); // the frame is picker.pick's: choose, refresh, Done
		const fromMain = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/main', actionHash: w.hashOf('choose') });

		await w.click('choose', { customId: fromMain });

		// Ran, through the slot lens the current screen owns: the old
		// screen-key guard would have called this click stale.
		expect(w.session.data.picker.chosen).toBe('winner');
		expect(w.calls).toEqual(['redraw:picker.pick']);
	});

	it('a click on a handler absent from the current frame is stale: no run', async () => {
		const w = world();
		await w.draw();
		await w.click('open'); // session -> picker.pick

		await w.draw(); // the frame is picker.pick's; bump is not on it
		await w.click('bump');

		expect(w.session.data.count).toBe(0);
		expect(w.calls).toEqual(['redraw:picker.pick', 'redraw:picker.pick']);
	});

	it('delivers subflow screens against the lensed slot', async () => {
		const w = world();
		w.session.screen = 'picker.pick';
		await w.draw();

		await w.click('choose');

		expect(w.session.data.picker).toEqual({ chosen: 'winner' }); // the mutate hook wrote through the slot
		expect(w.calls).toEqual(['redraw:picker.pick']);
	});

	it('ui.go resolves a subflow root to its entry screen', async () => {
		const w = world();
		await w.draw();

		await w.click('open');

		expect(w.session.screen).toBe('picker.pick');
		expect(w.session.history).toEqual(['main']);
	});

	it('done pops back, fires onDone with the slot state, and redraws the parent', async () => {
		const onDone = vi.fn();
		const w = world({ onDone });

		await w.draw();
		await w.click('open');
		await w.draw(); // picker.pick's frame carries the wrap's Done button
		await w.click('done');

		expect(onDone).toHaveBeenCalledWith({ chosen: 'none' }, expect.anything());
		expect(w.session.screen).toBe('main');
		expect(w.session.history).toEqual([]);
		expect(w.calls).toEqual(['redraw:picker.pick', 'redraw:main']);
	});

	it('redraw renders a slotted screen through the flow wrap', async () => {
		const w = world();
		w.session.screen = 'picker.pick';

		await w.draw();

		expect(w.edits).toHaveLength(1);
		expect(w.edits[0]).toContain('picked: none'); // the slot's data, not the bag
		expect(w.edits[0]).toContain('flow chrome'); // the component drew around it
		expect(w.edits[0]).toContain('Done'); // the wrap's subflow chrome
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
		expect(seen[0].screen).toBe('lotto/main');
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
		const id = encodeActionId({ sessionId: 'zzzzzzzz', screenKey: 'lotto/main', actionHash: actionHash(() => { }) });

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
		const flow = defineFlow<ListData>({
			screens: {
				main: screen<ListData>()((data) => view(
					{},
					text({ body: `picked: ${data.picked.join(', ') || 'none'}` }),
					row({}, ...items.map((item) => button({ onClick: pick(item), label: item }))),
				)),
			},
			first: 'main',
			initialData: { picked: [] },
		});
		const screens = asScreenRegistry(screenEntries('list', flow));
		const platform: PlatformPort = {
			replyToActor: vi.fn(async (): Promise<void> => undefined),
			redraw: vi.fn(async (): Promise<void> => undefined),
			commitParting: vi.fn(async (): Promise<void> => undefined),
			editMessage: vi.fn(async (_ref: unknown, _payload: unknown): Promise<void> => undefined),
			showModal: vi.fn(async (): Promise<void> => undefined),
		};
		const commit = createCommit({ platform, screens });
		const store = createSessionStore({ onEnd: createOnEnd({ commit, screens }) });
		const session = store.create<ListData>({
			flowId: 'list',
			moduleId: 'list',
			ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: { picked: [] },
			screen: 'main',
			ttlMs: DEFAULT_TTL_MS,
			remount: 'coexist',
		});
		const policy = { authorize: vi.fn(async (_request: PolicyRequest): Promise<PolicyDecision> => ({ allowed: true })) };
		const dispatch = createDispatch({
			store,
			policy,
			platform,
			screens,
			tryRevive: vi.fn(async () => undefined),
			makeUi: createMakeUi({ store, screens }),
		});

		async function draw(): Promise<void> {
			await commit.redraw(session);
		}

		function clickStamp(stamp: string): Promise<void> {
			return dispatch({
				kind: EventKind.Button,
				customId: encodeActionId({ sessionId: session.id, screenKey: 'list/main', actionHash: stamp }),
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

		const stamps = Object.keys(w.session.frame); // document order
		expect(stamps).toHaveLength(3);
		expect(new Set(stamps).size).toBe(3);
		expect(stamps.map((stamp) => w.session.frame[stamp].label)).toEqual(['a', 'b', 'c']);

		await w.clickStamp(stamps[0]);
		expect(w.session.data.picked).toEqual(['a']); // its OWN closure, not the last one

		await w.clickStamp(stamps[1]);
		await w.clickStamp(stamps[2]);
		expect(w.session.data.picked).toEqual(['a', 'b', 'c']);
	});

	it('a re-draw of the same screen from the same data re-stamps identically: restart continuity', async () => {
		const w = listWorld(['a', 'b', 'c']);
		await w.draw();
		const before = Object.keys(w.session.frame);

		await w.draw();

		expect(Object.keys(w.session.frame)).toEqual(before);
	});
});
