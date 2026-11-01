/**
 * The two verbs that speak to whoever clicked: `ui.reply` (a static,
 * ephemeral message) and `ui.open` (an ephemeral panel the clicker owns).
 * The panel here is public and owned by `host`; the clicker is someone
 * else, let through by a control-level `policy.allow()`. Everything
 * outside the runtime is faked, as in runtime.test.ts.
 *
 * @module runtime/__tests__/actor-verbs
 */

import { describe, expect, it, vi } from 'vitest';
import { actionHash } from '../../render/action-hash.js';
import { decodeActionId, encodeActionId } from '../../render/id-codec.js';
import { RenderError } from '../../render/v2.js';
import type { V2MessagePayload } from '../../render/v2.js';
import { EventKind } from '../../pipeline/types.js';
import type { ActionEvent, IncomingEvent, PlatformPort, PolicyDecision, PolicyPort } from '../../pipeline/types.js';
import { policy as policies } from '../../pipeline/policy.js';
import type { MessageRef } from '../../state/types.js';
import { button, row, text, view } from '../../tree/builders.js';
import { flow } from '../../flow/token.js';
import type { Flow } from '../../flow/token.js';
import { resetFlowRegistry } from '../../flow/registry.js';
import { createUiRuntime } from '../create.js';
import type { InteractionSender } from '../types.js';

const HOST = 'host';
const GUEST = 'guest';
const CHANNEL = 'channel-1';

interface PanelData {
	logs: number;
}

interface SideData {
	query: string;
}

/** Every button custom id in a payload, depth-first. */
function buttonIds(node: unknown): string[] {
	if (typeof node !== 'object' || node === null) return [];
	const record = node as { custom_id?: unknown; components?: unknown[]; accessory?: unknown };
	const own = typeof record.custom_id === 'string' ? [record.custom_id] : [];
	return [...own, ...(record.components ?? []).flatMap(buttonIds), ...buttonIds(record.accessory)];
}

/** The honest policy of the tests: a control's `allow` opens it, otherwise owner only. */
const ownerOrAllowed: PolicyPort = {
	authorize: async (request): Promise<PolicyDecision> => {
		if (request.actionPolicy?.kind === 'allow') return { allowed: true };
		return request.actorId === request.ownerId ? { allowed: true } : { allowed: false };
	},
};

function setup(options: { actorSender?: boolean } = {}): {
	runtime: ReturnType<typeof createUiRuntime>;
	sendToActor: ReturnType<typeof vi.fn>;
	actorSent: V2MessagePayload[];
	sideClick: ReturnType<typeof vi.fn>;
	sideFlow: Flow<SideData>;
	run: (verb: (event: ActionEvent<PanelData>) => Promise<void>, actorId?: string) => Promise<void>;
	clickSide: (actorId: string) => Promise<void>;
	panelEdits: string[];
} {
	const panelEdits: string[] = [];
	const actorSent: V2MessagePayload[] = [];
	const sendToActor = vi.fn(async (payload: V2MessagePayload): Promise<void> => {
		actorSent.push(payload);
	});
	const sideClick = vi.fn(async (): Promise<void> => undefined);
	let verb: (event: ActionEvent<PanelData>) => Promise<void> = async () => undefined;
	const feedHandler = vi.fn(async (event: ActionEvent<PanelData>): Promise<void> => {
		await verb(event);
	});

	resetFlowRegistry();
	const panelFlow = flow<PanelData>('panel', {
		screens: {
			main: {
				view: (data) => view(
					{},
					text(`logs ${data.logs}`),
					row({}, button({ onClick: feedHandler, label: 'Add a log', policy: policies.allow() })),
				),
			},
		},
		first: 'main',
		initialData: { logs: 0 },
		remount: 'coexist',
	});
	const sideFlow = flow<SideData>('side', {
		screens: {
			main: {
				view: (data) => view({}, text(`query ${data.query}`), row({}, button({ onClick: sideClick, label: 'Next' }))),
			},
		},
		first: 'main',
		initialData: { query: '' },
	});

	let counter = 0;
	const actorSender: InteractionSender = {
		ceilingMs: 60_000,
		send: async (payload: V2MessagePayload): Promise<MessageRef> => {
			counter += 1;
			actorSent.push(payload);
			return { channelId: 'ephemeral', messageId: `eph-${counter}` };
		},
	};
	const platform: PlatformPort = {
		replyToActor: vi.fn(async (): Promise<void> => undefined),
		sendToActor,
		...(options.actorSender === false ? {} : { actorSender: (): InteractionSender => actorSender }),
		redraw: vi.fn(async (): Promise<void> => undefined),
		commitParting: vi.fn(async (): Promise<void> => undefined),
		editMessage: vi.fn(async (ref: MessageRef): Promise<void> => {
			panelEdits.push(ref.messageId);
		}),
		showModal: vi.fn(async (): Promise<void> => undefined),
	};
	const runtime = createUiRuntime({
		platform,
		sendToChannel: async (channelId: string): Promise<MessageRef> => ({ channelId, messageId: 'panel-msg' }),
		policy: ownerOrAllowed,
		sweeper: false,
	});

	let panel: { sessionId: string } | undefined;
	async function run(next: (event: ActionEvent<PanelData>) => Promise<void>, actorId: string = GUEST): Promise<void> {
		verb = next;
		panel ??= await runtime.mount(panelFlow, { to: { channel: CHANNEL }, ownerId: HOST });
		await runtime.dispatch({
			kind: EventKind.Button,
			customId: encodeActionId({ sessionId: panel.sessionId, screenKey: `${panelFlow.id}/main`, actionHash: actionHash(feedHandler) }),
			actorId,
			channelId: CHANNEL,
			messageId: 'panel-msg',
		});
		await new Promise((resolve) => setImmediate(resolve));
	}

	async function clickSide(actorId: string): Promise<void> {
		const opened = actorSent.at(-1);
		const customId = buttonIds(opened)[0];
		const address = decodeActionId(customId);
		const incoming: IncomingEvent = {
			kind: EventKind.Button,
			customId,
			actorId,
			channelId: 'ephemeral',
			messageId: 'eph-1',
		};
		expect(address.sessionId).not.toBe('');
		await runtime.dispatch(incoming);
		await new Promise((resolve) => setImmediate(resolve));
	}

	return { runtime, sendToActor, actorSent, sideClick, sideFlow, run, clickSide, panelEdits };
}

describe('ui.reply', () => {
	it('sends a static view to the clicker, who is not the owner', async () => {
		const w = setup();
		await w.run(async (event) => {
			await event.ui.reply(view({}, text('You added a log.')));
		});

		expect(w.sendToActor).toHaveBeenCalledTimes(1);
		const [payload] = w.sendToActor.mock.calls[0] as [V2MessagePayload];
		expect(JSON.stringify(payload)).toContain('You added a log.');
	});

	it('refuses a view with controls before anything is sent', async () => {
		const w = setup();
		const failure = vi.fn();
		await w.run(async (event) => {
			try {
				await event.ui.reply(view({}, row({}, button({ onClick: () => undefined, label: 'Nope' }))));
			} catch (error) {
				failure(error);
			}
		});

		expect(failure).toHaveBeenCalledTimes(1);
		expect(failure.mock.calls[0][0]).toBeInstanceOf(RenderError);
		expect(w.sendToActor).not.toHaveBeenCalled();
	});

	it('still lets the handler change the shared panel', async () => {
		const w = setup();
		await w.run(async (event) => {
			event.mutate((data) => {
				data.logs += 1;
			});
			await event.ui.reply(view({}, text('Log added.')));
		});

		expect(w.panelEdits).toContain('panel-msg');
		expect(w.sendToActor).toHaveBeenCalledTimes(1);
	});
});

describe('ui.open', () => {
	it('mounts the flow as a panel the clicker owns, seeded with the data', async () => {
		const w = setup();
		await w.run(async (event) => {
			await event.ui.open(w.sideFlow, { data: { query: 'ph' } });
		});

		expect(JSON.stringify(w.actorSent.at(-1))).toContain('query ph');
		// The clicker can press the new panel's button; the host cannot.
		await w.clickSide(GUEST);
		expect(w.sideClick).toHaveBeenCalledTimes(1);
		await w.clickSide(HOST);
		expect(w.sideClick).toHaveBeenCalledTimes(1);
	});

	it('leaves the shared panel alive for the next clicker', async () => {
		const w = setup();
		await w.run(async (event) => {
			await event.ui.open(w.sideFlow);
		});
		await w.run(async (event) => {
			event.mutate((data) => {
				data.logs += 1;
			});
		}, 'someone-else');

		expect(w.panelEdits.length).toBeGreaterThan(0);
	});

	it('fails loudly when the host bridge cannot open a panel for the clicker', async () => {
		const w = setup({ actorSender: false });
		const failure = vi.fn();
		await w.run(async (event) => {
			try {
				await event.ui.open(w.sideFlow);
			} catch (error) {
				failure(error);
			}
		});

		expect(failure).toHaveBeenCalledTimes(1);
		expect(String((failure.mock.calls[0][0] as Error).message)).toContain('ephemeral');
	});
});

