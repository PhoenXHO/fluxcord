/**
 * materializeTree tests: the stamped-ids amendment's unit surface: one
 * walk stamps each actionable control (hash + occurrence) and builds the
 * frame. Occurrence 0 is the bare hash (byte-compatible with every wire
 * id ever sent); repeats append -1, -2... in document order; the counter
 * resets every draw.
 *
 * @module commit/__tests__/frame
 */

import { describe, expect, it } from 'vitest';
import { actionHash } from '../../render/action-hash.js';
import { button, container, optionSelect, row, text, view } from '../../tree/builders.js';
import { runtimeKit } from '../../tree/kit.js';
import { screenKitAt } from '../commit.js';
import { materializeTree } from '../frame.js';

/** Two products of one factory share byte-identical source: the collision shape. */
const factory = (): (() => void) => (): void => {};

describe('materializeTree - stamps', () => {
	it('occurrence 0 is the bare hash; repeats append -1, -2 in document order', () => {
		const one = button({ onClick: factory(), label: 'one' });
		const two = button({ onClick: factory(), label: 'two' });
		const three = button({ onClick: factory(), label: 'three' });
		const tree = view({}, row({}, one, two, three));
		const base = actionHash(one.onClick);

		const { stampOf, frame } = materializeTree(tree);

		expect(stampOf(one)).toBe(base);
		expect(stampOf(two)).toBe(`${base}-1`);
		expect(stampOf(three)).toBe(`${base}-2`);
		expect(Object.keys(frame)).toEqual([base, `${base}-1`, `${base}-2`]);
	});

	it('counts across top-level rows and container rows in document order', () => {
		const one = button({ onClick: factory(), label: 'one' });
		const two = button({ onClick: factory(), label: 'two' });
		const three = button({ onClick: factory(), label: 'three' });
		const tree = view({},
			row({}, one),
			container({}, text('chrome'), row({}, two)),
			row({}, three),
		);

		const { stampOf } = materializeTree(tree);

		expect(stampOf(two)).toBe(`${stampOf(one)}-1`);
		expect(stampOf(three)).toBe(`${stampOf(one)}-2`);
	});

	it('one handler object bound twice gets two stamps - both frame entries carry it', () => {
		const shared = (): void => {};
		const one = button({ onClick: shared, label: 'one' });
		const two = button({ onClick: shared, label: 'two' });
		const tree = view({}, row({}, one, two));

		const { stampOf, frame } = materializeTree(tree);

		expect(stampOf(two)).toBe(`${stampOf(one)}-1`);
		expect(frame[stampOf(one)].handler).toBe(shared);
		expect(frame[stampOf(two)].handler).toBe(shared);
	});

	it('the counter resets every draw - a fresh tree of the same shape starts bare', () => {
		const build = (): ReturnType<typeof view> => view({}, row({}, button({ onClick: factory(), label: 'x' })));

		const first = materializeTree(build());
		const second = materializeTree(build());

		expect(Object.keys(second.frame)).toEqual([Object.keys(first.frame)[0]]);
	});

	it('stampOf throws for a control the walk never saw', () => {
		const { stampOf } = materializeTree(view({}, text('x')));

		expect(() => stampOf(button({ onClick: factory(), label: 'stray' }))).toThrow(/not stamped/);
	});
});

describe('materializeTree - the frame', () => {
	it('records a button by its label, a select by placeholder or the plain word', () => {
		const click = button({ onClick: (): void => {}, label: 'Go' });
		const withHint = optionSelect({ onSelect: (): void => {}, options: [{ label: 'A', value: 'a' }], placeholder: 'pick one' });
		const bare = optionSelect({ onSelect: (): void => {}, options: [{ label: 'A', value: 'a' }] });
		const { frame, stampOf } = materializeTree(view({}, row({}, click, withHint, bare)));

		expect(frame[stampOf(click)].label).toBe('Go');
		expect(frame[stampOf(withHint)].label).toBe('pick one');
		expect(frame[stampOf(bare)].label).toBe('select');
	});

	it('returns a frozen frame; a stripped tree materializes empty', () => {
		const stamped = materializeTree(view({}, row({}, button({ onClick: (): void => {}, label: 'Go' }))));
		expect(Object.isFrozen(stamped.frame)).toBe(true);

		const stripped = materializeTree(view({}, text('frozen screen')));
		expect(stripped.frame).toEqual({});
	});

	it('a control-declared policy rides its record; undeclared stays absent', () => {
		const gate = { owner: { ownerOnly: false } };
		const open = button({ onClick: (): void => {}, label: 'Open', policy: gate });
		const plain = button({ onClick: (): void => {}, label: 'Plain' });
		const picked = optionSelect({
			onSelect: (): void => {},
			options: [{ label: 'A', value: 'a' }],
			policy: { owner: { ownerOnly: true, allowAdminOverride: true } },
		});
		const { frame, stampOf } = materializeTree(view({}, row({}, open, plain, picked)));

		expect(frame[stampOf(open)].policy).toBe(gate);
		expect('policy' in frame[stampOf(plain)]).toBe(false);
		expect(frame[stampOf(picked)].policy).toEqual({ owner: { ownerOnly: true, allowAdminOverride: true } });
	});

	it('an untagged control carries no slot: dispatch falls back to the screen lens', () => {
		const node = runtimeKit.Button({ onClick: (): void => {}, label: 'Go' });
		const { frame, stampOf } = materializeTree(view({}, row({}, node)));

		expect('slot' in frame[stampOf(node)]).toBe(false);
	});
});

describe('screenKitAt - draw-phase ownership tags', () => {
	it('tags buttons and selects with the slot, and the record carries it', () => {
		const kit = screenKitAt(['picker']);
		const node = kit.Button({ onClick: (): void => {}, label: 'Go' });
		const picked = kit.Select({ options: [{ label: 'A', value: 'a' }], onSelect: (): void => {} });
		const { frame, stampOf } = materializeTree(view({}, row({}, node, picked)));

		expect(node.slot).toEqual(['picker']);
		expect(picked.slot).toEqual(['picker']);
		expect(frame[stampOf(node)].slot).toEqual(['picker']);
		expect(frame[stampOf(picked)].slot).toEqual(['picker']);
	});

	it('an empty tag is the root bag, not the absence of one', () => {
		const kit = screenKitAt([]);
		const node = kit.Button({ onClick: (): void => {}, label: 'Go' });
		const { frame, stampOf } = materializeTree(view({}, row({}, node)));

		expect(node.slot).toEqual([]);
		expect(frame[stampOf(node)].slot).toEqual([]);
	});
});
