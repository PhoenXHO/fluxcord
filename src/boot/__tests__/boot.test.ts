/**
 * Boot-layer tests: the token, the catalog build, and the dev coverage
 * scan (the view-throw check; policy coverage is structural pairing at
 * load time). Everything here is pure: catalogs built by hand, no Discord
 * and no clock.
 *
 * @module boot/__tests__/boot
 */

import { describe, expect, it } from 'vitest';
import { button, row, text, view } from '../../tree/builders.js';
import { defineFlow } from '../../flow/define.js';
import { uiFlow } from '../../flow/token.js';
import type { FlowToken } from '../../flow/token.js';
import { buildFlowCatalog } from '../build.js';
import { coverageScan } from '../scan.js';

interface PanelData {
	count: number;
}

/** Identity-bound fixture: the handler object itself is the binding. */
const join = (): void => undefined;

/** A bare one-screen definition for the shape-validation cases. */
const bareScreens = { main: { view: () => view({}, text({ body: 'm' })) } } as const;
const bareOptions = { screens: bareScreens, first: 'main', initialData: {} } as const;

type FlowOverrides = Parameters<typeof defineFlow<PanelData>>[0];

function token(overrides: Partial<FlowOverrides> = {}): FlowToken<PanelData> {
	return uiFlow<PanelData>('host', {
		screens: {
			main: {
				view: (data) => view(
					{},
					text({ body: `count ${data.count}` }),
					row({}, button({ onClick: join, label: 'Join' })),
				),
			},
		},
		first: 'main',
		initialData: { count: 0 },
		...overrides,
	});
}

describe('uiFlow', () => {
	it('freezes the token; the bare name is the only id on it', () => {
		const t = token();
		expect(t.id).toBe('host');
		expect(Object.isFrozen(t)).toBe(true);
	});

	it('rejects names that are not bare kebab', () => {
		expect(() => uiFlow('', bareOptions)).toThrow(/bare kebab/);
		expect(() => uiFlow('panel/host', bareOptions)).toThrow(/bare kebab/);
		expect(() => uiFlow('panel/', bareOptions)).toThrow(/bare kebab/);
		expect(() => uiFlow('/host', bareOptions)).toThrow(/bare kebab/);
		expect(() => uiFlow('pa~nel', bareOptions)).toThrow(/bare kebab/);
		expect(() => uiFlow('Host', bareOptions)).toThrow(/bare kebab/);
	});
});

describe('buildFlowCatalog', () => {
	it("assembles '<module>/<name>', keys screens '<module>/<screen>', and indexes both by flowId and authored token", () => {
		const t = token();
		const catalog = buildFlowCatalog([{ module: 'panel', token: t }]);
		expect(Object.keys(catalog.entries)).toEqual(['panel/main']);
		expect(catalog.entries['panel/main']?.view).toBeDefined();
		expect(catalog.byFlowId.get('panel/host')).toBeDefined();
		expect(catalog.byToken.get(t)?.flowId).toBe('panel/host');
		expect(catalog.tokens).toHaveLength(1);
	});

	it('the same bare name in two modules coexists - the prefix disambiguates', () => {
		const other = uiFlow<PanelData>('host', {
			screens: { extra: { view: () => view({}, text({ body: 'e' })) } },
			first: 'extra',
			initialData: { count: 0 },
		});
		const catalog = buildFlowCatalog([{ module: 'panel', token: token() }, { module: 'other', token: other }]);
		expect(Object.keys(catalog.entries).sort()).toEqual(['other/extra', 'panel/main']);
		expect(catalog.byFlowId.get('panel/host')).toBeDefined();
		expect(catalog.byFlowId.get('other/host')).toBeDefined();
	});

	it('merges entries across flows and throws on a duplicate flowId', () => {
		const other = uiFlow<PanelData>('other', {
			screens: { extra: { view: () => view({}, text({ body: 'e' })) } },
			first: 'extra',
			initialData: { count: 0 },
		});
		const catalog = buildFlowCatalog([{ module: 'panel', token: token() }, { module: 'panel', token: other }]);
		expect(Object.keys(catalog.entries).sort()).toEqual(['panel/extra', 'panel/main']);

		// Same module + same name: the flowId guard fires.
		const twin = uiFlow<PanelData>('host', {
			screens: { alt: { view: () => view({}, text({ body: 'a' })) } },
			first: 'alt',
			initialData: { count: 0 },
		});
		expect(() => buildFlowCatalog([{ module: 'panel', token: token() }, { module: 'panel', token: twin }])).toThrow(/declared twice/);
	});

	it('throws when one screen key belongs to two flows (validateFlows passthrough)', () => {
		const evil = uiFlow<PanelData>('twin', {
			screens: { main: { view: () => view({}, text({ body: 'm' })) } },
			first: 'main',
			initialData: { count: 0 },
		});
		expect(() => buildFlowCatalog([{ module: 'panel', token: token() }, { module: 'panel', token: evil }])).toThrow(/screen 'panel\/main'/);
	});
});

describe('coverageScan', () => {
	/** A view that trusts a field the declared initialData leaves null: the honest scan trap. */
	it('reports a view that throws on the declared initialData', () => {
		const catalog = buildFlowCatalog([{ module: 'panel', token: uiFlow<{ count: number; picked: string | null }>('host', {
			screens: {
				main: {
					view: (data) => view({}, text({ body: `picked ${data.picked!.toUpperCase()}` })),
				},
			},
			first: 'main',
			initialData: { count: 0, picked: null },
		}) }]);
		const findings = coverageScan(catalog);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toContain('view threw on initialData');
	});

	it('ignores views that render clean off the declared initialData', () => {
		const catalog = buildFlowCatalog([{ module: 'panel', token: token() }]);
		expect(coverageScan(catalog)).toEqual([]);
	});

	it('ignores views with no actionable controls', () => {
		const catalog = buildFlowCatalog([{ module: 'panel', token: uiFlow<PanelData>('host', {
			screens: { main: { view: () => view({}, text({ body: 'just words' })) } },
			first: 'main',
			initialData: { count: 0 },
		}) }]);
		expect(coverageScan(catalog)).toEqual([]);
	});
});
