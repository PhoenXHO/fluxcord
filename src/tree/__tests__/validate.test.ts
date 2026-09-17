import { describe, expect, it } from 'vitest';
import {
	button,
	container,
	entitySelect,
	hr,
	input,
	link,
	modal,
	optionSelect,
	row,
	text,
	view,
} from '../builders.js';
import { NodeKind, SelectEntity } from '../vocab.js';
import { validateTree } from '../validate.js';
import type { ButtonNode, ContainerChild, ControlNode, InputNode, ModalChild, SelectNode, TreeRoot, ViewChild } from '../types.js';

/** Identity-bound fixture: the handler object itself is the binding. */
const handler = (): void => {};

/** Escape hatch for boundary tests: inject nodes where the types forbid them. */
const force = <T,>(value: unknown): T => value as T;

const rulesOf = (root: TreeRoot): number[] => validateTree(root).map((v) => v.rule);

const go = (): ReturnType<typeof button> => button({ onClick: handler, label: 'Go' });
const note = (): ReturnType<typeof input> => input({ id: 'note', label: 'L' });
const pick = (): ReturnType<typeof optionSelect> =>
	optionSelect({ onSelect: handler, options: [{ label: 'A', value: 'a' }] });

describe('validateTree - happy path', () => {
	it('accepts a fully valid view', () => {
		const tree = view(
			{ title: 'T' },
			text('hello'),
			row({}, go(), link({ url: 'https://torn.com', label: 'Site' })),
		);
		expect(validateTree(tree)).toEqual([]);
	});

	it('accepts colored and colorless containers', () => {
		const tree = view(
			{},
			container({ color: 0xff0000 }, text('panel')),
			container({}, row({}, go())),
		);
		expect(validateTree(tree)).toEqual([]);
	});

	it('accepts a fully valid modal', () => {
		expect(validateTree(modal({ title: 'T' }, note(), text('terms...')))).toEqual([]);
	});
});

describe('validateTree - structure rules', () => {
	it('rule 1: root must be view or modal', () => {
		expect(rulesOf(force<TreeRoot>({ kind: 'garbage' }))).toEqual([1]);
	});

	it('rule 2: view needs at least one child', () => {
		expect(rulesOf(view({}))).toEqual([2]);
	});

	it('rule 3: view children are text/row/container only', () => {
		const tree = view({}, force<ViewChild>(go()));
		expect(rulesOf(tree)).toEqual([3]);
	});

	it('rule 4: row children are controls only', () => {
		const tree = view({}, row({}, force<ControlNode>(text('x'))));
		expect(rulesOf(tree)).toEqual([4]);
	});

	it('rule 5: row max 5 children', () => {
		const tree = view({}, row({}, go(), go(), go(), go(), go(), go()));
		expect(rulesOf(tree)).toEqual([5]);
	});

	it('rule 6: modal children are input/text only', () => {
		const tree = modal({ title: 'T' }, force<ModalChild>(go()));
		expect(rulesOf(tree)).toEqual([6]);
	});

	it('rule 7: modal max 5 children', () => {
		const inputs = [0, 1, 2, 3, 4, 5].map((i) => input({ id: `n${i}`, label: 'L' }));
		const tree = modal({ title: 'T' }, ...inputs);
		expect(rulesOf(tree)).toEqual([7]);
	});

	it('rule 8: select must set exactly one of options/entity (both)', () => {
		const both = force<SelectNode>({
			...entitySelect({ onSelect: handler, entity: SelectEntity.Users }),
			options: [{ label: 'A', value: 'a' }],
		});
		const tree = view({}, row({}, both));
		expect(rulesOf(tree)).toEqual([8]);
	});

	it('rule 8: select must set exactly one of options/entity (neither)', () => {
		const neither = force<SelectNode>({ kind: NodeKind.select, onSelect: handler });
		expect(rulesOf(view({}, row({}, neither)))).toEqual([8]);
	});

	it('rule 9: unknown node kind', () => {
		const tree = view({}, force<ViewChild>({ kind: 'junk' }));
		expect(rulesOf(tree)).toEqual([9]);
	});

	it('rule 22: row with a select has exactly one child', () => {
		expect(rulesOf(view({}, row({}, pick(), go())))).toEqual([22]);
		expect(rulesOf(view({}, row({}, pick(), pick())))).toEqual([22]);
		expect(rulesOf(view({}, row({}, pick())))).toEqual([]);
	});

	it('rule 23: container children are text/row only (no nesting)', () => {
		const nested = container({}, force<ContainerChild>(container({}, text('x'))));
		expect(rulesOf(view({}, nested))).toEqual([23]);
		expect(rulesOf(view({}, container({}, force<ContainerChild>(go()))))).toEqual([23]);
	});

	it('rule 24: container needs at least one child', () => {
		expect(rulesOf(view({}, container({})))).toEqual([24]);
	});
});

describe('validateTree - value & bounds rules', () => {
	const withSelect = (select: SelectNode): TreeRoot => view({}, row({}, select));

	it('rule 10: max 25 options', () => {
		const options = Array.from({ length: 26 }, (_, i) => ({ label: `O${i}`, value: `${i}` }));
		expect(rulesOf(withSelect(optionSelect({ onSelect: handler, options })))).toContain(10);
	});

	it('rule 11: non-empty labels/values, unique values', () => {
		const select = optionSelect({
			onSelect: handler,
			options: [
				{ label: '', value: 'a' },
				{ label: 'B', value: 'a' },
			],
		});
		const rules = rulesOf(withSelect(select));
		expect(rules.filter((r) => r === 11)).toHaveLength(2);
	});

	it('rule 12: minSelected/maxSelected bounds, ordering, and option count', () => {
		expect(rulesOf(withSelect(optionSelect({
			onSelect: handler,
			options: [{ label: 'A', value: 'a' }],
			minSelected: 2,
		})))).toContain(12);
		expect(rulesOf(withSelect(optionSelect({
			onSelect: handler,
			options: [
				{ label: 'A', value: 'a' },
				{ label: 'B', value: 'b' },
			],
			minSelected: 2,
			maxSelected: 1,
		})))).toContain(12);
		expect(rulesOf(withSelect(entitySelect({
			onSelect: handler,
			entity: SelectEntity.Users,
			minSelected: -1,
		})))).toContain(12);
	});

	it('rule 26: preselected options fit the selection cap', () => {
		const three = [
			{ label: 'A', value: 'a', default: true },
			{ label: 'B', value: 'b', default: true },
			{ label: 'C', value: 'c', default: true },
		];
		expect(rulesOf(withSelect(optionSelect({ onSelect: handler, options: three, maxSelected: 2 })))).toContain(26);
		expect(rulesOf(withSelect(optionSelect({ onSelect: handler, options: three })))).toContain(26);
		expect(rulesOf(withSelect(optionSelect({
			onSelect: handler,
			options: [
				{ label: 'A', value: 'a', default: true },
				{ label: 'B', value: 'b' },
			],
			maxSelected: 1,
		})))).toEqual([]);
	});

	it('rule 26: entity defaultIds fit the selection cap', () => {
		expect(rulesOf(withSelect(entitySelect({
			onSelect: handler,
			entity: SelectEntity.Roles,
			defaultIds: ['1', '2', '3'],
			maxSelected: 2,
		})))).toContain(26);
		expect(rulesOf(withSelect(entitySelect({
			onSelect: handler,
			entity: SelectEntity.Roles,
			defaultIds: ['1', '2'],
		})))).toContain(26);
		expect(rulesOf(withSelect(entitySelect({
			onSelect: handler,
			entity: SelectEntity.Roles,
			defaultIds: ['1'],
			maxSelected: 3,
		})))).toEqual([]);
	});

	it('rule 8: defaultIds rejected on a static options select (cast arrivals)', () => {
		const sneaky = optionSelect({ onSelect: handler, options: [{ label: 'A', value: 'a' }] });
		const node = { ...sneaky, defaultIds: ['1'] } as unknown as SelectNode;
		expect(rulesOf(withSelect(node))).toContain(8);
	});

	it('rule 13: input length bounds and ordering', () => {
		expect(rulesOf(modal({ title: 'T' }, input({ id: 'f', label: 'L', minLength: -1 })))).toContain(13);
		expect(rulesOf(modal({ title: 'T' }, input({ id: 'f', label: 'L', maxLength: 4001 })))).toContain(13);
		expect(rulesOf(modal({ title: 'T' }, input({ id: 'f', label: 'L', minLength: 5, maxLength: 2 })))).toContain(13);
	});

	it('rule 14: prefill value max 4000 chars', () => {
		const tree = modal({ title: 'T' }, input({ id: 'f', label: 'L', value: 'x'.repeat(4001) }));
		expect(rulesOf(tree)).toContain(14);
	});

	it('rule 15: button/link label 1-80 chars', () => {
		expect(rulesOf(view({}, row({}, button({ onClick: handler, label: '' }))))).toContain(15);
		expect(rulesOf(view({}, row({}, link({ url: 'https://x.com', label: 'x'.repeat(81) }))))).toContain(15);
	});

	it('rule 16: option label/value/description max 100 chars', () => {
		const select = optionSelect({
			onSelect: handler,
			options: [{ label: 'x'.repeat(101), value: 'a', description: 'y'.repeat(101) }],
		});
		expect(rulesOf(withSelect(select)).filter((r) => r === 16)).toHaveLength(2);
	});

	it('rule 17: placeholder max 150 select / 100 input', () => {
		const select = optionSelect({
			onSelect: handler,
			options: [{ label: 'A', value: 'a' }],
			placeholder: 'p'.repeat(151),
		});
		expect(rulesOf(withSelect(select))).toContain(17);
		expect(rulesOf(modal({ title: 'T' }, input({ id: 'f', label: 'L', placeholder: 'p'.repeat(101) })))).toContain(17);
	});

	it('rule 18: input label 1-45 chars', () => {
		expect(rulesOf(modal({ title: 'T' }, input({ id: 'f', label: 'x'.repeat(46) })))).toContain(18);
	});

	it('rule 19: modal title 1-45 chars', () => {
		expect(rulesOf(modal({ title: '' }, note()))).toContain(19);
	});

	it('rule 20: link url must be http(s)', () => {
		expect(rulesOf(view({}, row({}, link({ url: 'ftp://example.com', label: 'X' }))))).toContain(20);
		expect(rulesOf(view({}, row({}, link({ url: 'not-a-url', label: 'X' }))))).toContain(20);
	});

	it('rule 21: container color integer in range', () => {
		expect(rulesOf(view({}, container({ color: 0x1000000 }, text('x'))))).toContain(21);
		expect(rulesOf(view({}, container({ color: 1.5 }, text('x'))))).toContain(21);
	});

	it('rule 25: input id 1-100 chars, unique within the modal', () => {
		expect(rulesOf(modal({ title: 'T' }, input({ id: '', label: 'L' })))).toContain(25);
		expect(rulesOf(modal({ title: 'T' }, input({ id: 'x'.repeat(101), label: 'L' })))).toContain(25);
		const dup = modal({ title: 'T' }, input({ id: 'same', label: 'A' }), input({ id: 'same', label: 'B' }));
		expect(rulesOf(dup).filter((r) => r === 25)).toHaveLength(1);
	});
});

describe('validateTree - violation details', () => {
	it('reports kind-and-index paths', () => {
		const tree = view({}, row({}, go(), button({ onClick: handler, label: '' })));
		const violation = validateTree(tree).find((v) => v.rule === 15);
		expect(violation?.path).toBe('view/row[0]/button[1]');
	});
});

describe('validateTree - hr', () => {
	it('accepts an hr in views and containers', () => {
		expect(rulesOf(view({}, text('a'), hr(), container({}, text('b'), hr())))).toEqual([]);
	});

	it('rule 6: an hr is not a modal child', () => {
		expect(rulesOf(force<TreeRoot>(
			modal({ title: 'T' }, note(), force<ModalChild>(hr())),
		))).toContain(6);
	});

	it('rule 27: hr spacing must be small or large', () => {
		expect(rulesOf(view({}, force<ViewChild>(hr({ spacing: 'huge' as never }))))).toContain(27);
	});
});

describe('validateTree - control styles', () => {
	it('rule 28: button style must be a known vocabulary value', () => {
		const junk = force<ButtonNode>({ ...go(), style: 'neon' });
		expect(rulesOf(view({}, row({}, junk)))).toContain(28);
		expect(rulesOf(view({}, row({}, go())))).toEqual([]);
	});

	it('rule 29: input style must be short or paragraph', () => {
		const junk = force<InputNode>({ ...note(), style: 'wide' });
		expect(rulesOf(modal({ title: 'T' }, junk))).toContain(29);
		expect(rulesOf(modal({ title: 'T' }, note()))).toEqual([]);
	});
});
