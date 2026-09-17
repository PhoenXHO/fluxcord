import { describe, expect, it } from 'vitest';
import {
	button,
	code,
	codeblock,
	container,
	entitySelect,
	error,
	flattenTextContent,
	hr,
	info,
	input,
	link,
	modal,
	optionSelect,
	row,
	text,
	view,
	warning,
} from '../builders.js';
import { NodeKind, SelectEntity, SeparatorSpacing } from '../vocab.js';
import type { ButtonProps } from '../builders.js';
import type { TextChild } from '../types.js';

/** Identity-bound fixture: the handler object itself is the binding. */
const go = (): void => {};

/** Escape hatch for boundary tests: reach through readonly/frozen output. */
const force = <T,>(value: unknown): T => value as T;

describe('builders', () => {
	it('sets the kind matching each builder', () => {
		expect(view({}, text('x')).kind).toBe(NodeKind.view);
		expect(text('x').kind).toBe(NodeKind.text);
		expect(row({}, button({ onClick: go, label: 'Go' })).kind).toBe(NodeKind.row);
		expect(container({}, text('x')).kind).toBe(NodeKind.container);
		expect(button({ onClick: go, label: 'Go' }).kind).toBe(NodeKind.button);
		expect(link({ url: 'https://torn.com', label: 'Site' }).kind).toBe(NodeKind.link);
		expect(optionSelect({ onSelect: go, options: [] }).kind).toBe(NodeKind.select);
		expect(entitySelect({ onSelect: go, entity: SelectEntity.Users }).kind).toBe(NodeKind.select);
		expect(modal({ title: 'T' }, input({ id: 'f', label: 'L' })).kind).toBe(NodeKind.modal);
		expect(input({ id: 'f', label: 'L' }).kind).toBe(NodeKind.input);
		expect(hr().kind).toBe(NodeKind.hr);
	});

	it('passes props through', () => {
		const node = button({
			onClick: go,
			label: 'Go',
			danger: true,
			disabled: true,
		});
		expect(node.label).toBe('Go');
		expect(node.style).toBe('danger');
		expect(node.disabled).toBe(true);
		expect(node.onClick).toBe(go);

		const field = input({ id: 'notes', label: 'Notes', paragraph: true, value: 'prefilled' });
		expect(field.style).toBe('paragraph');
		expect(field.value).toBe('prefilled');

		const panel = container({ color: 0x5865f2 }, text('x'));
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
		const tree = view({ title: 'T' }, text('x'));
		expect(() => {
			force<{ title: string }>(tree).title = 'changed';
		}).toThrow();
		expect(() => {
			force<{ push: (n: unknown) => void }>(tree.children).push(text('y'));
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

describe('text content', () => {
	it('children carry the body; a bare string or number is content too', () => {
		const node = text('Hi');
		expect(node.kind).toBe(NodeKind.text);
		expect(node.body).toBe('Hi');
		expect(node.title).toBeUndefined();
		expect(text(42).body).toBe('42');
	});

	it('a title rides props, the body stays a child', () => {
		const node = text({ title: 'T' }, 'Body');
		expect(node.title).toBe('T');
		expect(node.body).toBe('Body');
	});

	it('throws when there is no content at all', () => {
		expect(() => text()).toThrow(/text needs content/);
		expect(() => text({ title: 'T' })).toThrow(/text needs content/);
	});

	it('flattenTextContent: nodes contribute their body, arrays flatten, falsey drops, rows throw', () => {
		expect(flattenTextContent([text('a'), 'b', 3])).toBe('ab3');
		expect(flattenTextContent([text({ title: 'T' }, code('x')), 'y'])).toBe('`x`y');
		expect(flattenTextContent(['a', [text('b'), [text('c')]]])).toBe('abc');
		expect(flattenTextContent([false, null, undefined, text('d')])).toBe('d');
		expect(() => flattenTextContent([row({}, button({ onClick: go, label: 'Go' }))])).toThrow();
	});

	it('code wraps in inline backticks, lengthening around embedded backticks', () => {
		expect(code('x').body).toBe('`x`');
		expect(code('a`b').body).toBe('``a`b``');
		expect(() => code('a\nb')).toThrow();
	});

	it('codeblock fences with a language and grows around long backtick runs', () => {
		expect(codeblock('x').body).toBe('```\nx\n```');
		expect(codeblock('x', 'ts').body).toBe('```ts\nx\n```');
		const grown = codeblock('x\n```\ny').body;
		expect(grown.startsWith('````')).toBe(true);
	});

	it('code and codeblock output is frozen', () => {
		expect(Object.isFrozen(code('x'))).toBe(true);
		expect(Object.isFrozen(codeblock('x'))).toBe(true);
	});
});

describe('control labels & style flags', () => {
	it('no flag means primary, and primary resolves explicitly', () => {
		expect(button({ onClick: go, label: 'Go' }).style).toBeUndefined();
		expect(button({ onClick: go, label: 'Go', primary: true }).style).toBe('primary');
	});

	it('each style flag resolves to its style value', () => {
		expect(button({ onClick: go, label: 'Go', secondary: true }).style).toBe('secondary');
		expect(button({ onClick: go, label: 'Go', success: true }).style).toBe('success');
		expect(button({ onClick: go, label: 'Go', danger: true }).style).toBe('danger');
	});

	it('two style flags, or a valued flag, throw at the build site', () => {
		expect(() => button({ onClick: go, label: 'Go', danger: true, success: true })).toThrow(/one style flag/);
		expect(() => button(force<ButtonProps>({ onClick: go, danger: false }))).toThrow(/takes no value/);
	});

	it('the label rides the children or the prop, never both, never neither', () => {
		expect(button({ onClick: go }, 'Go ', 3).label).toBe('Go 3');
		expect(() => button({ onClick: go, label: 'Go' }, 'Also')).toThrow(/never both/);
		expect(() => button({ onClick: go })).toThrow(/needs a label/);
	});

	it('link takes children as its label too', () => {
		expect(link({ url: 'https://torn.com' }, 'Site').label).toBe('Site');
		expect(() => link({ url: 'https://torn.com', label: 'Site' }, 'Also')).toThrow(/never both/);
	});

	it('input style flags resolve; both throw', () => {
		expect(input({ id: 'f', label: 'L' }).style).toBeUndefined();
		expect(input({ id: 'f', label: 'L', short: true }).style).toBe('short');
		expect(input({ id: 'f', label: 'L', paragraph: true }).style).toBe('paragraph');
		expect(() => input({ id: 'f', label: 'L', short: true, paragraph: true })).toThrow(/one style flag/);
	});
});

describe('callouts', () => {
	it('error, warning and info fence their message in their color', () => {
		expect(error('API key rejected').body).toBe('```ansi\n\u001b[0;31mAPI key rejected\u001b[0m\n```');
		expect(warning('careful').body).toBe('```ansi\n\u001b[0;33mcareful\u001b[0m\n```');
		expect(info('heads up').body).toBe('```ansi\n\u001b[0;34mheads up\u001b[0m\n```');
	});

	it('children fold like the text tag - numbers included', () => {
		expect(error('Key ', 42, ' rejected').body).toBe('```ansi\n\u001b[0;31mKey 42 rejected\u001b[0m\n```');
	});

	it('multi-line messages stay in one fence; a backtick run grows it', () => {
		expect(error('line1\nline2').body).toBe('```ansi\n\u001b[0;31mline1\nline2\u001b[0m\n```');
		expect(error('a```b').body.startsWith('````ansi')).toBe(true);
	});

	it('only copy belongs in a callout', () => {
		const rowNode = row({}, button({ onClick: go, label: 'Go' }));
		expect(() => error(force<TextChild>(rowNode))).toThrow(/not text content/);
	});

	it('callout output is frozen', () => {
		expect(Object.isFrozen(error('x'))).toBe(true);
		expect(Object.isFrozen(warning('x'))).toBe(true);
		expect(Object.isFrozen(info('x'))).toBe(true);
	});
});

describe('hr', () => {
	it('defaults to a visible line with small padding; props pass through', () => {
		expect(hr()).toEqual({ kind: NodeKind.hr });
		expect(hr({ spacing: SeparatorSpacing.Large, divider: false })).toEqual({
			kind: NodeKind.hr,
			divider: false,
			spacing: 'large',
		});
	});

	it('is frozen', () => {
		expect(Object.isFrozen(hr())).toBe(true);
	});
});
