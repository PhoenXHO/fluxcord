/**
 * Commit-phase tests: full event->commit cycles with everything real
 * except the bridge: real store, real onEnd wiring, real commit phase,
 * real toolkit, real dispatch. Only the Discord side is faked (message
 * edits, modal opens, actor replies, all recorded).
 *
 * @module commit/__tests__/commit
 */

import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ComponentType, MessageFlags } from 'discord-api-types/v10';
import { actionHash } from '../../render/action-hash.js';
import { encodeActionId } from '../../render/id-codec.js';
import type { V2MessagePayload, V2ModalPayload } from '../../render/v2.js';
import { createSessionStore } from '../../state/store.js';
import type { SessionStore } from '../../state/store.js';
import type { MessageRef, RehydrateRow, RehydrateStore, Session } from '../../state/types.js';
import { button, container, input, link, modal, optionSelect, row, text, view } from '../../tree/builders.js';
import type { ContainerNode, RowNode, TextNode, ViewNode } from '../../tree/types.js';
import { DEFAULT_ERROR_MESSAGE, createDispatch } from '../../pipeline/dispatch.js';
import { EventKind } from '../../pipeline/types.js';
import type {
	ActionEvent,
	ErrorReport,
	IncomingEvent,
	PlatformPort,
	PolicyDecision,
	PolicyPort,
	Screen,
	ScreenRegistry,
} from '../../pipeline/types.js';
import { createCommit } from '../commit.js';
import { freezeTree } from '../freeze.js';
import { createOnEnd } from '../onEnd.js';
import { partingView } from '../parting.js';
import { createMakeUi } from '../ui.js';

interface LottoData {
	tickets: number;
}

const CHANNEL_ID = 'channel-1';
const MESSAGE_ID = 'message-1';
const OWNER_ID = 'user-1';

/** Identity-bound fixture for the pure-transform tests below. */
const noop = (): void => {};

function confirmView(): ViewNode {
	return view({}, text({ body: 'Are you sure?' }));
}

/** Every text display's content, top-level only, for content assertions on payloads. */
function textContents(payload: V2MessagePayload): string[] {
	return payload.components
		.filter((component): component is { readonly type: ComponentType.TextDisplay; readonly content: string } =>
			component.type === ComponentType.TextDisplay)
		.map((component) => component.content);
}

/** True when any component in the payload is an action row (a clickable control survived). */
function hasActionRow(payload: V2MessagePayload): boolean {
	return payload.components.some((component) => component.type === ComponentType.ActionRow);
}

interface World {
	clock: { now: number; advance: (ms: number) => number };
	store: SessionStore;
	session: Session<LottoData>;
	handler: Mock;
	currentEvent: () => ActionEvent<LottoData>;
	decide: (next: PolicyDecision) => void;
	edits: { ref: MessageRef; payload: V2MessagePayload }[];
	modals: V2ModalPayload[];
	replies: string[];
	errors: ErrorReport[];
	onEndErrors: unknown[];
	rows: Map<string, RehydrateRow>;
	click: (overrides?: Partial<IncomingEvent>) => Promise<void>;
}

/** The wired world: everything real except the bridge. */
function world(overrides: { rehydrate?: { ref: string }; captureErrors?: boolean } = {}): World {
	const clock = { now: 1_000_000, advance: (ms: number): number => (clock.now += ms) };

	// The bridge: the only faked piece.
	const edits: { ref: MessageRef; payload: V2MessagePayload }[] = [];
	const modals: V2ModalPayload[] = [];
	const replies: string[] = [];
	const errors: ErrorReport[] = [];
	const onEndErrors: unknown[] = [];
	const bridge = {
		replyToActor: async (textValue: string): Promise<void> => {
			replies.push(textValue);
		},
		editMessage: async (ref: MessageRef, payload: V2MessagePayload): Promise<void> => {
			edits.push({ ref, payload });
		},
		showModal: async (payload: V2ModalPayload): Promise<void> => {
			modals.push(payload);
		},
	};

	const handler = vi.fn(async (_event?: unknown): Promise<void> => undefined);
	// The view binds the handler by identity: the same object the frame
	// harvest registers on every draw.
	const mainView = (data: unknown): ViewNode => {
		const { tickets } = data as LottoData;
		return view(
			{ title: 'Lotto' },
			text({ body: `Tickets: ${tickets}` }),
			row({}, button({ onClick: handler, label: 'Join' }), button({ onClick: handler, label: 'Open modal' })),
		);
	};
	const screens: ScreenRegistry = {
		resolve: (viewKey: string): Screen | undefined => {
			if (viewKey === 'lotto/main') {
				return { view: mainView };
			}
			if (viewKey === 'lotto/confirm') {
				return { view: confirmView };
			}
			return undefined;
		},
	};

	const rows = new Map<string, RehydrateRow>();
	const rehydrateStore: RehydrateStore = {
		put: async (row): Promise<void> => {
			rows.set(row.messageId, row);
		},
		get: async (messageId: string): Promise<RehydrateRow | undefined> => rows.get(messageId),
		delete: async (messageId: string): Promise<void> => {
			rows.delete(messageId);
		},
	};

	const commit = createCommit({ platform: bridge, screens });
	const store = createSessionStore({
		now: () => clock.now,
		onEnd: createOnEnd({ commit, rehydrate: rehydrateStore, onError: (error) => onEndErrors.push(error) }),
	});

	const platform: PlatformPort = {
		...bridge,
		redraw: commit.redraw,
		commitParting: commit.commitParting,
	};

	let decision: PolicyDecision = { allowed: true };
	const policy: PolicyPort = {
		authorize: async (): Promise<PolicyDecision> => decision,
	};

	const dispatch = createDispatch({
		store,
		policy,
		platform,
		screens,
		tryRevive: async (): Promise<Session<unknown> | undefined> => undefined,
		makeUi: createMakeUi({ store }),
		...(overrides.captureErrors === true ? { onError: (report: ErrorReport): void => { errors.push(report); } } : {}),
		now: () => clock.now,
	});

	const session = store.create<LottoData>({
		flowId: 'lotto',
		moduleId: 'lotto',
		ownerId: OWNER_ID,
		messageRef: { channelId: CHANNEL_ID, messageId: MESSAGE_ID },
		data: { tickets: 3 },
		screen: 'main',
		ttlMs: 30 * 60 * 1000,
		remount: 'coexist',
		...(overrides.rehydrate !== undefined ? { rehydrate: overrides.rehydrate } : {}),
	});
	if (overrides.rehydrate !== undefined) {
		rows.set(MESSAGE_ID, { messageId: MESSAGE_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, flowId: 'lotto', ref: overrides.rehydrate.ref });
	}
	// The frame a real draw of 'main' would have written: two buttons, one
	// shared handler. Tests that change what the message shows rewrite this.
	session.frame = { [actionHash(handler)]: { handler, label: 'Join' } };

	/** The event handed to the current handler invocation; mock args are recorded before the implementation runs. */
	function currentEvent(): ActionEvent<LottoData> {
		return handler.mock.calls[0][0] as ActionEvent<LottoData>;
	}

	function click(clickOverrides: Partial<IncomingEvent> = {}): Promise<void> {
		return dispatch({
			kind: EventKind.Button,
			customId: encodeActionId({ sessionId: session.id, screenKey: 'lotto/main', actionHash: actionHash(handler) }),
			actorId: OWNER_ID,
			channelId: CHANNEL_ID,
			messageId: MESSAGE_ID,
			...clickOverrides,
		});
	}

	return { clock, store, session, handler, decide: (next) => (decision = next), edits, modals, replies, errors, onEndErrors, rows, click, currentEvent };
}

describe('the draw pipeline (redraw)', () => {
	it('a click that mutates redraws from the mutated data - one edit, V2 payload', async () => {
		const w = world();
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			w.session.data.tickets = 4;
		});
		await w.click();

		expect(w.edits).toHaveLength(1);
		const { ref, payload } = w.edits[0];
		expect(ref).toEqual({ channelId: CHANNEL_ID, messageId: MESSAGE_ID });
		expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
		expect(textContents(payload)).toEqual(['# Lotto', 'Tickets: 4']);
		expect(hasActionRow(payload)).toBe(true);
	});

	it('a stale click redraws the current screen through the commit phase, running nothing', async () => {
		const w = world();
		w.session.screen = 'confirm';
		w.session.frame = {}; // confirm's draw carried no controls
		await w.click();

		expect(w.handler).not.toHaveBeenCalled();
		expect(w.edits).toHaveLength(1);
		expect(textContents(w.edits[0].payload)).toContain('Are you sure?');
	});

	it('multiple go calls in one handler produce ONE edit - the final screen wins, no flash', async () => {
		const w = world();
		const nonceBefore = w.session.modalNonce;
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			const event = w.currentEvent();
			event.ui.go('confirm');
			event.ui.go('main');
		});
		await w.click();

		expect(w.edits).toHaveLength(1);
		expect(textContents(w.edits[0].payload)).toContain('Tickets: 3');
		// Navigation state: smart go popped back to main (confirm pruned),
		// nonce regenerated per screen change.
		expect(w.session.screen).toBe('main');
		expect(w.session.history).toEqual([]);
		expect(w.session.modalNonce).not.toBe(nonceBefore);
	});
});

describe('deny', () => {
	it('actor reply, no edit', async () => {
		const w = world();
		w.decide({ allowed: false, denyMessage: 'Hosts only.' });
		await w.click();

		expect(w.replies).toEqual(['Hosts only.']);
		expect(w.edits).toHaveLength(0);
	});
});

describe('close freezes the message', () => {
	it('strips controls, keeps the final content, deletes the rehydrate row, kills the session', async () => {
		const w = world({ rehydrate: { ref: 'lotto:8421' } });
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			const event = w.currentEvent();
			event.mutate((data) => {
				data.tickets = 5;
			});
			event.ui.close();
		});
		await w.click();
		await vi.waitFor(() => expect(w.edits).toHaveLength(1));

		const payload = w.edits[0].payload;
		expect(textContents(payload)).toEqual(['# Lotto', 'Tickets: 5']);
		expect(hasActionRow(payload)).toBe(false);
		expect(w.store.get(w.session.id)).toBeUndefined();
		await vi.waitFor(() => expect(w.rows.has(MESSAGE_ID)).toBe(false));
		expect(w.onEndErrors).toEqual([]);
	});

	it('a laggy dead click after close cannot overwrite the frozen screen', async () => {
		const w = world();
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			w.currentEvent().ui.close();
		});
		await w.click();
		await vi.waitFor(() => expect(w.edits).toHaveLength(1));

		await w.click(); // submitted from the pre-freeze render
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(w.edits).toHaveLength(1); // still the frozen payload
		expect(textContents(w.edits[0].payload)).toContain('Tickets: 3');
	});
});

describe('the death map (onEnd wiring)', () => {
	it('expiry of a non-rehydratable session parts the message', async () => {
		const w = world();
		w.clock.advance(31 * 60 * 1000);
		w.store.sweep();
		await vi.waitFor(() => expect(w.edits).toHaveLength(1));

		expect(textContents(w.edits[0].payload)).toContain('This screen has expired.');
		expect(w.onEndErrors).toEqual([]);
	});

	it('a dead click parts first; the later sweep cannot re-part (dedupe)', async () => {
		const w = world();
		w.clock.advance(31 * 60 * 1000);
		await w.click(); // dead click on the expired-but-unswept session
		await vi.waitFor(() => expect(w.edits).toHaveLength(1));

		w.store.sweep();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(w.edits).toHaveLength(1);
	});

	it('the sweep parts first; a later dead click cannot re-part either', async () => {
		const w = world();
		w.clock.advance(31 * 60 * 1000);
		w.store.sweep();
		await vi.waitFor(() => expect(w.edits).toHaveLength(1));

		await w.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(w.edits).toHaveLength(1);
	});

	it('expiry of a rehydratable session leaves the message untouched - the row survives', async () => {
		const w = world({ rehydrate: { ref: 'lotto:8421' } });
		w.clock.advance(31 * 60 * 1000);
		w.store.sweep();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(w.edits).toHaveLength(0);
		expect(w.rows.has(MESSAGE_ID)).toBe(true);
	});
});

describe('the error policy (E4, through the shipped default)', () => {
	it('handler throws: generic reply to the clicker, message untouched, session survives', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const w = world();
		w.handler.mockRejectedValueOnce(new Error('boom'));
		await w.click();

		expect(w.replies).toEqual([DEFAULT_ERROR_MESSAGE]);
		expect(w.edits).toHaveLength(0);
		expect(w.store.get(w.session.id)).toBeDefined();
		log.mockRestore();
	});

	it('task after mutate throws - the phase door', async () => {
		const w = world({ captureErrors: true });
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			const event = w.currentEvent();
			event.mutate((data) => {
				data.tickets = 4;
			});
			await event.task(async (): Promise<number> => 1);
		});
		await w.click();

		expect(w.edits).toHaveLength(0);
		expect(w.errors).toHaveLength(1);
		expect((w.errors[0].error as Error).message).toContain('after event.mutate()');
		// The mutate ran before the throw: the diagnostic reports it.
		expect(w.errors[0].dirtyKeys).toEqual(['tickets']);
	});

	it('dirtyKeys reports direct writes before a throw - the bypass the hooks cannot see', async () => {
		const w = world({ captureErrors: true });
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			w.session.data.tickets = 99;
			throw new Error('boom');
		});
		await w.click();

		expect(w.errors[0].source).toBe('handler');
		expect(w.errors[0].dirtyKeys).toEqual(['tickets']);
	});
});

describe('modals (event-based, E1)', () => {
	it('showModal opens with a nonce-stamped customId routing back to the same action', async () => {
		const w = world();
		w.handler.mockImplementationOnce(async (): Promise<void> => {
			await w.currentEvent().ui.showModal(modal({ title: 'Join' }, input({ id: 'amount', label: 'Amount' })));
		});
		await w.click();

		expect(w.modals).toHaveLength(1);
		const clickId = encodeActionId({ sessionId: w.session.id, screenKey: 'lotto/main', actionHash: actionHash(w.handler) });
		expect(w.modals[0].custom_id).toBe(`${clickId}~${w.session.modalNonce}`);
		// A modal-open still counts as an event: exactly one redraw.
		expect(w.edits).toHaveLength(1);
	});
});

describe('freezeTree (pure transform)', () => {
	it('strips buttons and selects, keeps links and text, drops emptied rows', () => {
		const frozen = freezeTree(view({},
			text({ body: 'Final state' }),
			row({}, button({ onClick: noop, label: 'Join' }), link({ url: 'https://torn.com', label: 'Open' })),
			row({}, optionSelect({ onSelect: noop, options: [{ label: 'One', value: '1' }] })),
			row({}, link({ url: 'https://example.com', label: 'Docs' })),
		));

		expect(frozen.children).toHaveLength(3);
		expect((frozen.children[0] as TextNode).body).toBe('Final state');
		const mixed = frozen.children[1] as RowNode;
		expect(mixed.children).toHaveLength(1);
		expect(mixed.children[0].kind).toBe('link');
		const docs = frozen.children[2] as RowNode;
		expect(docs.children).toHaveLength(1);
	});

	it('drops emptied containers, keeps containers with surviving content', () => {
		const frozen = freezeTree(view({},
			container({}, row({}, button({ onClick: noop, label: 'Join' }))),
			container({}, text({ body: 'Summary' })),
		));

		expect(frozen.children).toHaveLength(1);
		const surviving = frozen.children[0] as ContainerNode;
		expect(surviving.children).toHaveLength(1);
		expect((surviving.children[0] as TextNode).body).toBe('Summary');
	});
});

describe('partingView', () => {
	it('default copy stands alone', () => {
		const tree = partingView();
		expect((tree.children[0] as TextNode).body).toBe('This screen has expired.');
	});

	it('a command hint appends the restart line', () => {
		const tree = partingView('lotto');
		expect((tree.children[0] as TextNode).body).toContain('Run `/lotto` to start a new one.');
	});
});
