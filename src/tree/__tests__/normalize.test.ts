import { describe, expect, it } from 'vitest';
import { button, container, link, modal, optionSelect, row, text, view } from '../builders.js';
import { coerceChildren, normalizeModalRoot, normalizeViewRoot } from '../normalize.js';
import type { ContainerChild } from '../types.js';

/** Identity-bound fixture: the handler object itself is the binding. */
const handler = (): void => {};

/** Escape hatch for boundary tests: inject nodes where the types forbid them. */
const force = <T,>(value: unknown): T => value as T;

const pick = (): ReturnType<typeof optionSelect> =>
	optionSelect({ onSelect: handler, options: [{ label: 'A', value: 'a' }] });
const go = (): ReturnType<typeof button> => button({ onClick: handler, label: 'Go' });
const docs = (): ReturnType<typeof link> => link({ label: 'Docs', url: 'https://example.com' });

describe('normalizeViewRoot - root shapes', () => {
	it('keeps a view root as-is', () => {
		const root = view({}, text('hello'));
		expect(normalizeViewRoot(root)).toBe(root);
	});

	it('wraps a single non-view node in a view', () => {
		const node = text('hello');
		expect(normalizeViewRoot(node)).toEqual(view({}, node));
	});

	it('wraps a dropped root as a thrown error', () => {
		expect(() => normalizeViewRoot(false)).toThrow(/view returned nothing/);
		expect(() => normalizeViewRoot(undefined)).toThrow(/view returned nothing/);
	});
});

describe('normalizeViewRoot - bare control wrapping', () => {
	it('wraps a bare select that is the only view child', () => {
		const select = pick();
		expect(normalizeViewRoot(view({}, select))).toEqual(view({}, row({}, select)));
	});

	it('wraps a bare button that is the only view child', () => {
		const btn = go();
		expect(normalizeViewRoot(view({}, btn))).toEqual(view({}, row({}, btn)));
	});

	it('wraps a bare link the same way', () => {
		const manual = view({}, docs());
		expect(normalizeViewRoot(manual)).toEqual(view({}, row({}, docs())));
	});

	it('gives each bare control its own row instead of merging them', () => {
		const select = pick();
		const result = normalizeViewRoot(view({}, go(), docs(), select));
		expect(result.children).toEqual([row({}, go()), row({}, docs()), row({}, select)]);
	});

	it('wraps a bare select among siblings without touching them', () => {
		const select = pick();
		const note = text('call a number');
		const actions = row({}, go());
		const result = normalizeViewRoot(view({}, note, select, actions));
		expect(result.children[0]).toBe(note);
		expect(result.children[1]).toEqual(row({}, select));
		expect(result.children[2]).toBe(actions);
	});

	it('wraps a bare select inside a container, keeping the accent color', () => {
		const select = pick();
		const result = normalizeViewRoot(view({}, container({ color: 0xff0000 }, force<ContainerChild>(select))));
		const box = result.children[0];
		expect(box).toEqual(container({ color: 0xff0000 }, row({}, select)));
	});

	it('wraps a select that arrives as the whole root', () => {
		const select = pick();
		expect(normalizeViewRoot(select)).toEqual(view({}, row({}, select)));
	});

	it('wraps a select inside a fragment root', () => {
		const select = pick();
		const result = normalizeViewRoot([text('a'), select]);
		expect(result).toEqual(view({}, text('a'), row({}, select)));
	});

	it('preserves the view title when wrapping', () => {
		const select = pick();
		expect(normalizeViewRoot(view({ title: 'T' }, select))).toEqual(view({ title: 'T' }, row({}, select)));
	});

	it('leaves a manual select row untouched, identity included', () => {
		const manual = view({}, row({}, pick()));
		expect(normalizeViewRoot(manual)).toBe(manual);
	});
});

describe('normalizeModalRoot', () => {
	it('keeps a modal root as-is', () => {
		const root = modal({ title: 'T' }, text('terms'));
		expect(normalizeModalRoot(root)).toBe(root);
	});

	it('still throws on a fragment or non-modal root', () => {
		expect(() => normalizeModalRoot([text('a')])).toThrow(/<modal> root/);
		expect(() => normalizeModalRoot(force<Parameters<typeof normalizeModalRoot>[0]>(view({}, text('a'))))).toThrow(/<modal> root/);
	});
});

describe('coerceChildren', () => {
	it('drops falsy fragments and flattens arrays', () => {
		const node = text('a');
		expect(coerceChildren([false, [undefined, node], true])).toEqual([node]);
	});

	it('throws on bare scalars', () => {
		expect(() => coerceChildren('hello')).toThrow(/bare string/);
	});
});
