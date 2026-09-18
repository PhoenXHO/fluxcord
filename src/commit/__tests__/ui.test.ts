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
import { createSessionStore } from '../../state/store.js';
import { DEFAULT_TTL_MS } from '../../state/types.js';
import { input, modal, text, view } from '../../tree/builders.js';
import type { RegisteredScreen, ScreenRegistry, PlatformPort, UiToolkit } from '../../pipeline/types.js';
import type { Session } from '../../state/types.js';
import type { ActionAddress } from '../../render/id-codec.js';

const ADDRESS = { sessionId: 's1', screenKey: 'm/menu', actionHash: 'h0' } as ActionAddress;
const PLATFORM = {} as PlatformPort;

/** A session on a known screen with hand-set history: the verb's starting state. */
function onScreen(
	screen: string,
	history: readonly string[],
	platform: PlatformPort = PLATFORM,
): { session: Session<Record<string, never>>; ui: UiToolkit } {
	const store = createSessionStore();
	const session = store.create<Record<string, never>>({
		flowId: 'f',
		moduleId: 'm',
		ownerId: 'u1',
		messageRef: { channelId: 'c1', messageId: 'm1' },
		data: {},
		screen,
		ttlMs: DEFAULT_TTL_MS,
		remount: 'replace',
	});
	session.history = [...history];
	const { ui } = createMakeUi({ store })(session, ADDRESS, platform);
	return { session, ui };
}

/** A registry that resolves exactly the given '<module>/<screen>' keys. */
function registry(keys: readonly string[], roots: Record<string, string> = {}): ScreenRegistry {
	return {
		resolve: (key) => (keys.includes(key) ? { flow: { roots } } as unknown as RegisteredScreen : undefined),
	};
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
		const nonce = w.session.modalNonce;
		w.ui.go('counter');
		expect(w.session.screen).toBe('counter');
		expect(w.session.history).toEqual(['menu']);
		expect(w.session.modalNonce).toBe(nonce);
	});

	it('regenerates the modal nonce on a real screen change', () => {
		const w = onScreen('menu', []);
		const nonce = w.session.modalNonce;
		w.ui.go('counter');
		expect(w.session.modalNonce).not.toBe(nonce);
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
		const nonce = w.session.modalNonce;
		w.ui.push('counter');
		expect(w.session.history).toEqual(['menu']);
		expect(w.session.modalNonce).toBe(nonce);
	});
});

describe('ui.back', () => {
	it('pops one entry without naming a target', () => {
		const w = onScreen('counter', ['menu']);
		const nonce = w.session.modalNonce;
		w.ui.back();
		expect(w.session.screen).toBe('menu');
		expect(w.session.history).toEqual([]);
		expect(w.session.modalNonce).not.toBe(nonce);
	});

	it('is a no-op on empty history (the entry screen)', () => {
		const w = onScreen('menu', []);
		const nonce = w.session.modalNonce;
		w.ui.back();
		expect(w.session.screen).toBe('menu');
		expect(w.session.history).toEqual([]);
		expect(w.session.modalNonce).toBe(nonce);
	});
});

describe('the backstop (stringly targets)', () => {
	it('go throws on a target that resolves to no screen or root', () => {
		const store = createSessionStore();
		const session = store.create<Record<string, never>>({
			flowId: 'f', moduleId: 'm', ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {}, screen: 'menu', ttlMs: DEFAULT_TTL_MS, remount: 'replace',
		});
		const { ui } = createMakeUi({ store, screens: registry(['m/menu', 'm/counter']) })(session, ADDRESS, PLATFORM);
		expect(() => ui.go('nope')).toThrow(/targets no screen or subflow root/);
	});

	it('push throws the same way', () => {
		const store = createSessionStore();
		const session = store.create<Record<string, never>>({
			flowId: 'f', moduleId: 'm', ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {}, screen: 'menu', ttlMs: DEFAULT_TTL_MS, remount: 'replace',
		});
		const { ui } = createMakeUi({ store, screens: registry(['m/menu', 'm/counter']) })(session, ADDRESS, PLATFORM);
		expect(() => ui.push('nope')).toThrow(/targets no screen or subflow root/);
	});
});

describe('subflow roots', () => {
	it('resolve BEFORE the dedup lookup - go(root) pops to the root\'s entry screen', () => {
		const store = createSessionStore();
		const session = store.create<Record<string, never>>({
			flowId: 'f', moduleId: 'm', ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {}, screen: 'menu', ttlMs: DEFAULT_TTL_MS, remount: 'replace',
		});
		session.history = ['pick.first'];
		const { ui } = createMakeUi({
			store,
			screens: registry(['m/menu', 'm/pick.first'], { pick: 'pick.first' }),
		})(session, ADDRESS, PLATFORM);

		ui.go('pick');

		// Had the root NAME fed the lookup instead, this would have pushed.
		expect(session.screen).toBe('pick.first');
		expect(session.history).toEqual([]);
	});
});

/** The close test's world: session, its toolkit, and the owning store. */
interface CloseWorld {
	session: Session<Record<string, never>>;
	ui: UiToolkit;
	store: ReturnType<typeof createSessionStore>;
}

describe('ui.close - the authored goodbye', () => {
	function world(): CloseWorld {
		const store = createSessionStore();
		const session = store.create<Record<string, never>>({
			flowId: 'f', moduleId: 'm', ownerId: 'u1',
			messageRef: { channelId: 'c1', messageId: 'm1' },
			data: {}, screen: 'menu', ttlMs: DEFAULT_TTL_MS, remount: 'replace',
		});
		const { ui } = createMakeUi({ store })(session, ADDRESS, PLATFORM);
		return { session, ui, store };
	}

	it('plain close records no final view and ends the session', () => {
		const w = world();
		w.ui.close();
		expect(w.session.finalView).toBeUndefined();
		expect(w.store.get(w.session.id)).toBeUndefined();
	});

	it('close(view) records the goodbye and ends the session', () => {
		const w = world();
		w.ui.close(view({ title: 'Done' }, text('All set.')));
		expect(w.session.finalView?.kind).toBe('view');
		expect(w.store.get(w.session.id)).toBeUndefined();
	});
});

describe('ui.showModal - the opener\'s gate rides along', () => {
	const SHOW = { showModal: async (): Promise<void> => undefined } as unknown as PlatformPort;
	const DIALOG = modal({ title: 'M' }, input({ id: 'a', label: 'A' }));

	it('captures the opener record\'s policy next to the handler', async () => {
		const w = onScreen('menu', [], SHOW);
		const handler = (): void => { };
		const gate = { owner: { ownerOnly: false } };
		w.session.frame = { h0: { handler, label: 'open', policy: gate } };

		await w.ui.showModal(DIALOG);

		expect(w.session.modalHandler).toBe(handler);
		expect(w.session.modalPolicy).toBe(gate);
	});

	it('clears a previous capture when the opener declared no policy', async () => {
		const w = onScreen('menu', [], SHOW);
		const handler = (): void => { };
		w.session.frame = { h0: { handler, label: 'open' } };
		w.session.modalPolicy = { owner: { ownerOnly: true } }; // a previous modal's gate

		await w.ui.showModal(DIALOG);

		expect(w.session.modalPolicy).toBeUndefined();
	});
});
