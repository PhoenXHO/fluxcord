/**
 * The navigation verbs, go (smart) / push / back, unit-tested straight
 * against createMakeUi's toolkit (nav amendment). Stack mechanics only;
 * the wiring-level consequences (one edit per handler, redraw of the
 * final screen) live in commit.test.ts and flow.test.ts.
 *
 * @module commit/__tests__/ui
 */

import { describe, expect, it } from 'vitest';
import { createMakeUi } from '../ui.js';
import { buildFlowCatalog } from '../../boot/build.js';
import { flow } from '../../flow/token.js';
import { createSessionStore } from '../../state/store.js';
import { activeFrame, DEFAULT_TTL_MS } from '../../state/types.js';
import { input, modal, text, view } from '../../tree/builders.js';
import type { PlatformPort, UiToolkit } from '../../pipeline/types.js';
import type { Session } from '../../state/types.js';
import type { ComponentResult } from '../../tree/types.js';
import type { ActionAddress } from '../../render/id-codec.js';

const ADDRESS = { sessionId: 's1', screenKey: 'm/f/menu', actionHash: 'h0' } as ActionAddress;
const PLATFORM = {} as PlatformPort;

// Real token: the verbs resolve their targets through the frame's screens.
const TOKEN = buildFlowCatalog([{
	module: 'm',
	flow: flow<void, 'menu' | 'counter' | 'picker'>('f', {
		first: 'menu',
		screens: { menu: { view: () => text('menu') }, counter: { view: () => text('counter') }, picker: { view: () => text('picker') } },
	}),
}]).byFlowId.get('m/f')!;

/** A session on a known screen with hand-set history: the verb's starting state. */
function onScreen(
	screen: string,
	history: readonly string[],
	platform: PlatformPort = PLATFORM,
): { session: Session<Record<string, never>>; ui: UiToolkit } {
	const store = createSessionStore();
	const session = store.create<Record<string, never>>({
		flowId: 'm/f',
		moduleId: 'm',
		ownerId: 'u1',
		messageRef: { channelId: 'c1', messageId: 'm1' },
		data: {},
		screen,
		ttlMs: DEFAULT_TTL_MS,
		remount: 'replace',
		token: TOKEN,
	});
	activeFrame(session).history = [...history];
	const { ui } = createMakeUi({ exit: () => {} })(session, ADDRESS, platform);
	return { session, ui };
}

describe('ui.go (smart)', () => {
	it('pushes when the target is not in history', () => {
		const w = onScreen('menu', []);
		w.ui.go('counter');
		expect(w.session.screen).toBe('counter');
		expect(w.session.history).toEqual(['menu']);
	});

	it('pops to the target and prunes the branch above it', () => {
		const w = onScreen('picker', ['menu', 'counter']);
		w.ui.go('counter');
		expect(w.session.screen).toBe('counter');
		expect(w.session.history).toEqual(['menu']);
	});

	it('pops to the topmost occurrence when the target appears twice', () => {
		const w = onScreen('picker', ['menu', 'counter', 'menu']);
		w.ui.go('menu');
		expect(w.session.screen).toBe('menu');
		expect(w.session.history).toEqual(['menu', 'counter']);
	});

	it('re-entering the hub flattens the history completely', () => {
		const w = onScreen('counter', ['menu']);
		w.ui.go('menu');
		expect(w.session.screen).toBe('menu');
		expect(w.session.history).toEqual([]);
	});

	it('navigating to the current screen is a no-op - no push, no nonce regen', () => {
		const w = onScreen('counter', ['menu']);
		const nonce = activeFrame(w.session).modalNonce;
		w.ui.go('counter');
		expect(w.session.screen).toBe('counter');
		expect(w.session.history).toEqual(['menu']);
		expect(activeFrame(w.session).modalNonce).toBe(nonce);
	});

	it('regenerates the modal nonce on a real screen change', () => {
		const w = onScreen('menu', []);
		const nonce = activeFrame(w.session).modalNonce;
		w.ui.go('counter');
		expect(activeFrame(w.session).modalNonce).not.toBe(nonce);
	});
});

describe('ui.push (plain)', () => {
	it('always appends, even when the target is already in history', () => {
		const w = onScreen('counter', ['menu']);
		w.ui.push('menu');
		expect(w.session.screen).toBe('menu');
		expect(w.session.history).toEqual(['menu', 'counter']);
	});

	it('navigating to the current screen is a no-op', () => {
		const w = onScreen('counter', ['menu']);
		const nonce = activeFrame(w.session).modalNonce;
		w.ui.push('counter');
		expect(w.session.history).toEqual(['menu']);
		expect(activeFrame(w.session).modalNonce).toBe(nonce);
	});
});

describe('ui.back', () => {
	it('pops one entry without naming a target', () => {
		const w = onScreen('counter', ['menu']);
		const nonce = activeFrame(w.session).modalNonce;
		w.ui.back();
		expect(w.session.screen).toBe('menu');
		expect(w.session.history).toEqual([]);
		expect(activeFrame(w.session).modalNonce).not.toBe(nonce);
	});

	it('is a no-op on empty history (the entry screen)', () => {
		const w = onScreen('menu', []);
		const nonce = activeFrame(w.session).modalNonce;
		w.ui.back();
		expect(w.session.screen).toBe('menu');
		expect(w.session.history).toEqual([]);
		expect(activeFrame(w.session).modalNonce).toBe(nonce);
	});
});

describe('the backstop (stringly targets)', () => {
	it('go throws on a target that resolves to no screen', () => {
		const store = createSessionStore();
		const session = store.create<Record<string, never>>({
			flowId: 'm/f', moduleId: 'm', ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {}, screen: 'menu', ttlMs: DEFAULT_TTL_MS, remount: 'replace', token: TOKEN,
		});
		const { ui } = createMakeUi({ exit: () => {} })(session, ADDRESS, PLATFORM);
		expect(() => ui.go('nope')).toThrow(/targets no screen of flow/);
	});

	it('push throws the same way', () => {
		const store = createSessionStore();
		const session = store.create<Record<string, never>>({
			flowId: 'm/f', moduleId: 'm', ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {}, screen: 'menu', ttlMs: DEFAULT_TTL_MS, remount: 'replace', token: TOKEN,
		});
		const { ui } = createMakeUi({ exit: () => {} })(session, ADDRESS, PLATFORM);
		expect(() => ui.push('nope')).toThrow(/targets no screen of flow/);
	});
});

/** The exit test's world: session, its toolkit, and the calls the seam saw. */
interface ExitWorld {
	session: Session<Record<string, never>>;
	ui: UiToolkit;
	exits: Array<{ session: Session<unknown>; value: unknown; final?: ComponentResult }>;
}

describe('ui.exit - the injected seam', () => {
	function world(): ExitWorld {
		const store = createSessionStore();
		const session = store.create<Record<string, never>>({
			flowId: 'm/f', moduleId: 'm', ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {}, screen: 'menu', ttlMs: DEFAULT_TTL_MS, remount: 'replace', token: TOKEN,
		});
		const exits: ExitWorld['exits'] = [];
		const { ui } = createMakeUi({
			exit: (s, value, final) => {
				exits.push({ session: s, value, final });
			},
		})(session, ADDRESS, PLATFORM);
		return { session, ui, exits };
	}

	it('plain exit hands the session and no value to the seam', () => {
		const w = world();
		w.ui.exit();
		expect(w.exits).toEqual([{ session: w.session, value: undefined, final: undefined }]);
		expect(w.session.finalView).toBeUndefined();
	});

	it('exit({ final }) passes the goodbye through untouched', () => {
		const w = world();
		const goodbye = view({ title: 'Done' }, text('All set.'));
		w.ui.exit({ final: goodbye });
		expect(w.exits).toEqual([{ session: w.session, value: undefined, final: goodbye }]);
		expect(w.session.finalView).toBeUndefined();
	});

	it('exit({ value }) passes the value through', () => {
		const w = world();
		w.ui.exit({ value: 'done' });
		expect(w.exits).toEqual([{ session: w.session, value: 'done', final: undefined }]);
	});
});

describe('ui.showModal - the opener\'s gate rides along', () => {
	const SHOW = { showModal: async (): Promise<void> => undefined } as unknown as PlatformPort;
	const DIALOG = modal({ title: 'M' }, input({ id: 'a', label: 'A' }));

	it('captures the opener record\'s policy next to the handler', async () => {
		const w = onScreen('menu', [], SHOW);
		const handler = (): void => { };
		const gate = { owner: { ownerOnly: false } };
		activeFrame(w.session).actions = { h0: { handler, label: 'open', policy: gate } };

		await w.ui.showModal(DIALOG);

		expect(activeFrame(w.session).modalHandler).toBe(handler);
		expect(activeFrame(w.session).modalPolicy).toBe(gate);
	});

	it('clears a previous capture when the opener declared no policy', async () => {
		const w = onScreen('menu', [], SHOW);
		const handler = (): void => { };
		activeFrame(w.session).actions = { h0: { handler, label: 'open' } };
		activeFrame(w.session).modalPolicy = { owner: { ownerOnly: true } }; // a previous modal's gate

		await w.ui.showModal(DIALOG);

		expect(activeFrame(w.session).modalPolicy).toBeUndefined();
	});

	it('stamps a fresh nonce per open, so a reopened modal gets a new custom_id', async () => {
		const seen: string[] = [];
		const CAPTURE = {
			showModal: async (payload: { custom_id: string }): Promise<void> => { seen.push(payload.custom_id); },
		} as unknown as PlatformPort;
		const w = onScreen('menu', [], CAPTURE);

		await w.ui.showModal(DIALOG);
		await w.ui.showModal(DIALOG);

		expect(seen).toHaveLength(2);
		expect(seen[0]).not.toBe(seen[1]);
		// The session's nonce matches the id just shown, so a submit from this
		// modal passes the check.
		expect(activeFrame(w.session).modalNonce).toBe(seen[1]!.split('~')[1]);
	});

	it('a failed open throws and records no submit destination', () => {
		const w = onScreen('menu', [], SHOW);
		activeFrame(w.session).actions = { h0: { handler: (): void => { }, label: 'open' } };

		expect(() => w.ui.showModal(text('not a modal'))).toThrow(/needs a <modal> root/);
		expect(activeFrame(w.session).modalHandler).toBeUndefined();
		expect(activeFrame(w.session).modalPolicy).toBeUndefined();
	});
});
