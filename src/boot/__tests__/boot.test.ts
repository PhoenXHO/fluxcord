/**
 * Boot-layer tests: the authored flow and its registration, and the dev
 * coverage scan (the view-throw check; policy coverage is structural
 * pairing at load time). Everything here is pure: no Discord and no clock.
 *
 * @module boot/__tests__/boot
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { button, optionSelect, row, text, view } from '../../tree/builders.js';
import { command, mounts } from '../../command/declare.js';
import { flow } from '../../flow/token.js';
import type { Flow } from '../../flow/token.js';
import { flowIndex, flowTokens, resetFlowRegistry, tokenById, tokenOf } from '../../flow/registry.js';
import { coverageScan } from '../scan.js';

interface PanelData {
	count: number;
}

/** Identity-bound fixture: the handler object itself is the binding. */
const join = (): void => undefined;

/** A bare one-screen definition for the shape-validation cases. */
const bareScreens = { main: { view: () => view({}, text('m')) } } as const;
const bareOptions = { screens: bareScreens, first: 'main', initialData: {} } as const;

function makeFlow(id = 'host'): Flow<PanelData> {
	return flow<PanelData>(id, {
		screens: {
			main: {
				view: (data) => view(
					{},
					text(`count ${data.count}`),
					row({}, button({ onClick: join, label: 'Join' })),
				),
			},
		},
		first: 'main',
		initialData: { count: 0 },
	});
}

beforeEach(() => {
	resetFlowRegistry();
});

describe('flow', () => {
	it('freezes the flow; its name is its id', () => {
		const t = makeFlow();
		expect(t.id).toBe('host');
		expect(Object.isFrozen(t)).toBe(true);
	});

	it('rejects names that are not kebab case', () => {
		expect(() => flow('', bareOptions)).toThrow(/kebab/);
		expect(() => flow('panel/host', bareOptions)).toThrow(/kebab/);
		expect(() => flow('panel/', bareOptions)).toThrow(/kebab/);
		expect(() => flow('/host', bareOptions)).toThrow(/kebab/);
		expect(() => flow('pa~nel', bareOptions)).toThrow(/kebab/);
		expect(() => flow('Host', bareOptions)).toThrow(/kebab/);
	});
});

describe('the flow registry', () => {
	it('registers a flow the moment it is declared, under its own name', () => {
		const declared = makeFlow('lotto-panel');

		const token = tokenOf(declared);
		expect(token?.flowId).toBe('lotto-panel');
		expect(token?.definition).toBe(declared.definition);
		expect(tokenById('lotto-panel')).toBe(token);
		expect(flowIndex.get('lotto-panel')).toBe(token);
		expect(flowTokens()).toEqual([token]);
	});

	it('carries the flow\'s registration facts on its token', () => {
		const onSessionEnd = (): void => undefined;
		const withMeta = flow<PanelData>('with-meta', { ...bareOptions, initialData: { count: 0 } }, { onSessionEnd });

		expect(tokenOf(withMeta)?.meta?.onSessionEnd).toBe(onSessionEnd);
	});

	it('refuses a second flow with the same name, loudly, at its declaration', () => {
		makeFlow('lotto-panel');

		expect(() => makeFlow('lotto-panel')).toThrow(/'lotto-panel' is already declared/);
		expect(flowTokens()).toHaveLength(1);
	});

	it('knows nothing about an object flow() did not make', () => {
		const declared = makeFlow('real');
		const forged = { flowMark: true, id: 'real', definition: declared.definition } as unknown as Flow<PanelData>;

		expect(tokenOf(forged)).toBeUndefined();
		expect(tokenById('missing')).toBeUndefined();
	});

	it('learns the command line that mounts a flow, keeping the first one declared', () => {
		const declared = makeFlow('status-panel');
		command('chain', 'Chain tools', { subcommands: { status: mounts(declared, { description: 'Show the chain' }) } });
		command('other', 'Another way in', { mount: mounts(declared) });

		expect(tokenOf(declared)?.commandHint).toBe('chain status');
	});

	it('a command cannot mount something flow() did not make', () => {
		const forged = { flowMark: true, id: 'forged', definition: makeFlow('real').definition } as unknown as Flow<PanelData>;

		expect(() => command('forged', 'Forged', { mount: mounts(forged) })).toThrow(/not a flow made by flow\(\)/);
	});
});

describe('coverageScan', () => {
	/** A view that trusts a field the declared initialData leaves null: the honest scan trap. */
	it('reports a view that throws on the declared initialData', () => {
		flow<{ count: number; picked: string | null }>('host', {
			screens: {
				main: {
					view: (data) => view({}, text(`picked ${data.picked!.toUpperCase()}`)),
				},
			},
			first: 'main',
			initialData: { count: 0, picked: null },
		});
		const findings = coverageScan();
		expect(findings).toHaveLength(1);
		expect(findings[0]).toContain('host/main');
		expect(findings[0]).toContain('view threw on initialData');
	});

	it('reports a view that draws an illegal tree', () => {
		flow<PanelData>('host', {
			screens: {
				// A row mixing a select with a button is type-legal but breaks rule 22.
				main: { view: () => row({}, optionSelect({ onSelect: join, options: [{ label: 'A', value: 'a' }] }), button({ onClick: join, label: 'Join' })) },
			},
			first: 'main',
			initialData: { count: 0 },
		});
		const findings = coverageScan();
		expect(findings).toHaveLength(1);
		expect(findings[0]).toContain('illegal tree');
		expect(findings[0]).toContain('rule 22');
	});

	it('ignores views that render clean off the declared initialData', () => {
		makeFlow();
		expect(coverageScan()).toEqual([]);
	});

	it('ignores views with no actionable controls', () => {
		flow<PanelData>('host', {
			screens: { main: { view: () => view({}, text('just words')) } },
			first: 'main',
			initialData: { count: 0 },
		});
		expect(coverageScan()).toEqual([]);
	});
});
