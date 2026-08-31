import { describe, expect, it } from 'vitest';
import {
	button,
	container,
	entitySelect,
	input,
	link,
	modal,
	optionSelect,
	row,
	text,
	view,
} from '../builders.js';
import { ButtonStyle, InputStyle, NodeKind, SelectEntity } from '../vocab.js';

/** Identity-bound fixture: the handler object itself is the binding. */
const go = (): void => {};

/** Escape hatch for boundary tests: reach through readonly/frozen output. */
const force = <T,>(value: unknown): T => value as T;

describe('builders', () => {
	it('sets the kind matching each builder', () => {
		expect(view({}, text({ body: 'x' })).kind).toBe(NodeKind.view);
		expect(text({ body: 'x' }).kind).toBe(NodeKind.text);
		expect(row({}, button({ onClick: go, label: 'Go' })).kind).toBe(NodeKind.row);
		expect(container({}, text({ body: 'x' })).kind).toBe(NodeKind.container);
		expect(button({ onClick: go, label: 'Go' }).kind).toBe(NodeKind.button);
		expect(link({ url: 'https://torn.com', label: 'Site' }).kind).toBe(NodeKind.link);
		expect(optionSelect({ onSelect: go, options: [] }).kind).toBe(NodeKind.select);
		expect(entitySelect({ onSelect: go, entity: SelectEntity.Users }).kind).toBe(NodeKind.select);
		expect(modal({ title: 'T' }, input({ id: 'f', label: 'L' })).kind).toBe(NodeKind.modal);
		expect(input({ id: 'f', label: 'L' }).kind).toBe(NodeKind.input);
	});

	it('passes props through', () => {
		const node = button({
			onClick: go,
			label: 'Go',
			style: ButtonStyle.Primary,
			disabled: true,
		});
		expect(node.label).toBe('Go');
		expect(node.style).toBe(ButtonStyle.Primary);
		expect(node.disabled).toBe(true);
		expect(node.onClick).toBe(go);

		const field = input({ id: 'notes', label: 'Notes', style: InputStyle.Paragraph, value: 'prefilled' });
		expect(field.style).toBe(InputStyle.Paragraph);
		expect(field.value).toBe('prefilled');

		const panel = container({ color: 0x5865f2 }, text({ body: 'x' }));
		expect(panel.color).toBe(0x5865f2);
	});

	it('freezes nodes deeply - node, children array, nested options', () => {
		const tree = view(
			{ title: 'T' },
			row(
				{},
				optionSelect({
					onSelect: go,
					options: [{ label: 'A', value: 'a', description: 'first' }],
				}),
			),
		);
		expect(Object.isFrozen(tree)).toBe(true);
		expect(Object.isFrozen(tree.children)).toBe(true);
		const rowNode = tree.children[0];
		expect(Object.isFrozen(rowNode)).toBe(true);
		const select = rowNode.kind === NodeKind.row ? rowNode.children[0] : undefined;
		if (!select || select.kind !== NodeKind.select) throw new Error('expected select');
		expect(Object.isFrozen(select.options)).toBe(true);
		expect(Object.isFrozen(select.options?.[0])).toBe(true);
	});

	it('throws on mutation attempts at any depth', () => {
		const tree = view({ title: 'T' }, text({ body: 'x' }));
		expect(() => {
			force<{ title: string }>(tree).title = 'changed';
		}).toThrow();
		expect(() => {
			force<{ push: (n: unknown) => void }>(tree.children).push(text({ body: 'y' }));
		}).toThrow();
	});

	it('optionSelect carries options and no entity; entitySelect the reverse', () => {
		const options = optionSelect({ onSelect: go, options: [{ label: 'A', value: 'a' }] });
		expect(options.options).toHaveLength(1);
		expect(options.entity).toBeUndefined();

		const entity = entitySelect({ onSelect: go, entity: SelectEntity.Roles });
		expect(entity.entity).toBe(SelectEntity.Roles);
		expect(entity.options).toBeUndefined();
	});
});
