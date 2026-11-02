/**
 * Static flows: display-only messages. A mount draws the message and keeps
 * no session, so nothing sweeps, nothing is parted, and a control or a
 * rehydrate row is refused loudly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { V2MessagePayload } from '../../render/v2.js';
import type { PlatformPort, PolicyDecision, PolicyPort } from '../../pipeline/types.js';
import type { MessageRef } from '../../state/types.js';
import { button, row, text, view } from '../../tree/builders.js';
import { flow } from '../../flow/token.js';
import { createUiRuntime, DEFAULT_SWEEP_INTERVAL_MS } from '../create.js';

const MINUTE = 60_000;

const alertFlow = flow('plain-note', {
	screens: { main: { view: () => view({}, text('a note')) } },
	first: 'main',
	static: true,
});

const buttonFlow = flow('note-with-button', {
	screens: { main: { view: () => view({}, text('a note'), row({}, button({ onClick: async () => undefined, label: 'Press' }))) } },
	first: 'main',
	static: true,
});

interface World {
	runtime: ReturnType<typeof createUiRuntime>;
	edits: string[];
	partings: MessageRef[];
	sent: V2MessagePayload[];
	clock: { now: number };
}

function setup(): World {
	const clock = { now: 1_000_000 };
	const edits: string[] = [];
	const partings: MessageRef[] = [];
	const sent: V2MessagePayload[] = [];
	const platform: PlatformPort = {
		replyToActor: vi.fn(async (): Promise<void> => undefined),
		redraw: vi.fn(async (): Promise<void> => undefined),
		commitParting: vi.fn(async (ref: MessageRef): Promise<void> => {
			partings.push(ref);
		}),
		editMessage: vi.fn(async (ref: MessageRef): Promise<void> => {
			edits.push(ref.messageId);
		}),
		showModal: vi.fn(async (): Promise<void> => undefined),
	};
	const policy: PolicyPort = { authorize: async (): Promise<PolicyDecision> => ({ allowed: true }) };
	const runtime = createUiRuntime({
		platform,
		sendToChannel: async (channelId: string, payload: V2MessagePayload): Promise<MessageRef> => {
			sent.push(payload);
			return { channelId, messageId: `sent-${sent.length}` };
		},
		policy,
		now: () => clock.now,
		sweeper: false,
	});
	return { runtime, edits, partings, sent, clock };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('a static flow', () => {
	it('declares: refuses ttlMs, remount, rehydrate, and session hooks', () => {
		const screens = { main: { view: (): ReturnType<typeof view> => view({}, text('x')) } };
		expect(() => flow('clash-a', { screens, first: 'main', static: true, ttlMs: 1000 })).toThrow(/cannot declare 'ttlMs'/);
		expect(() => flow('clash-b', { screens, first: 'main', static: true, remount: 'coexist' })).toThrow(/'remount'/);
		expect(() => flow('clash-c', { screens, first: 'main', static: true, rehydrate: () => ({}) })).toThrow(/'rehydrate'/);
		expect(() => flow('clash-d', { screens, first: 'main', static: true }, { onSessionEnd: () => undefined })).toThrow(/onSessionStart or onSessionEnd/);
	});

	it('mounts to a channel and to an existing message, with no session behind the handle', async () => {
		const world = setup();

		const posted = await world.runtime.mount(alertFlow, { to: { channel: 'ch-1' }, ownerId: 'bot' });
		expect(world.sent).toHaveLength(1);
		expect(posted.sessionId).toBe('');
		expect(posted.messageId).toBe('sent-1');

		const edited = await world.runtime.mount(alertFlow, { to: { existing: { channelId: 'ch-1', messageId: 'sent-1' } }, ownerId: 'bot' });
		expect(world.edits).toEqual(['sent-1']);
		expect(edited.messageId).toBe('sent-1');
	});

	it('redraw and go resolve false: there is nothing to redraw', async () => {
		const world = setup();
		const handle = await world.runtime.mount(alertFlow, { to: { channel: 'ch-1' }, ownerId: 'bot' });

		await expect(handle.redraw()).resolves.toBe(false);
		await expect(handle.go('main')).resolves.toBe(false);
		await expect(handle.close()).resolves.toBe(false);
	});

	it('is never swept or parted, however long it sits', async () => {
		const world = setup();
		await world.runtime.mount(alertFlow, { to: { channel: 'ch-1' }, ownerId: 'bot' });
		await world.runtime.mount(alertFlow, { to: { channel: 'ch-1' }, ownerId: 'bot' });

		vi.useFakeTimers();
		world.runtime.startSweeper(DEFAULT_SWEEP_INTERVAL_MS);
		try {
			world.clock.now += 24 * 60 * MINUTE;
			await vi.advanceTimersByTimeAsync(DEFAULT_SWEEP_INTERVAL_MS);
		} finally {
			world.runtime.stopSweeper();
		}
		expect(world.partings).toEqual([]);
		expect(world.edits).toEqual([]);
	});

	it('refuses a screen with a control before anything is sent', async () => {
		const world = setup();

		await expect(world.runtime.mount(buttonFlow, { to: { channel: 'ch-1' }, ownerId: 'bot' })).rejects.toThrow(/static and keeps no session, but its screen 'main' renders controls/);
		expect(world.sent).toEqual([]);
	});

	it('refuses a rehydrate ref', async () => {
		const world = setup();

		await expect(world.runtime.mount(alertFlow, { to: { channel: 'ch-1' }, ownerId: 'bot', rehydrateRef: 'x:1' })).rejects.toThrow(/rehydrate/);
		expect(world.sent).toEqual([]);
	});
});
