/**
 * JSX runtime tests, authored in TSX on purpose: they exercise the real
 * syntax (tags, attributes, conditionals, fragments, components) through
 * the factory and assert the exact trees the builders produce. Syntax is
 * the only variable: an element IS its builder's node.
 *
 * @module tree/__tests__/jsx
 */

import { describe, expect, it } from 'vitest';
// Aliased: the compiler auto-imports jsx/Fragment from the runtime for tags;
// these bindings exist for the direct factory calls below.
import { jsx as factory, Fragment as FragmentTag } from '../jsx-runtime.js';
import { button, entitySelect, input, link, optionSelect, text, view } from '../builders.js';
import { runtimeKit } from '../kit.js';
import { validateTree } from '../validate.js';
import { SelectEntity } from '../vocab.js';
import type { ComponentResult } from '../jsx-runtime.js';
import type { CheckboxGroupNode, TextNode, TreeNode, ViewNode } from '../types.js';

const onClick = (): void => {};

/** Coerces an element (or expression) to a child list, for asserting children arrays. */
function kids(node: unknown): readonly TreeNode[] {
	const value = node as { children?: readonly TreeNode[] };
	return Array.isArray(node) ? (node as readonly TreeNode[]) : (value.children ?? []);
}

// --- Elements are builder nodes ---------------------------------------------------

describe('jsx elements', () => {
	it('a tagged element is the builder\'s node - same tree, frozen', () => {
		const viaTsx = <view title="t"><text>b</text></view>;
		const viaBuilders = view({ title: 't' }, text('b'));

		expect(viaTsx).toEqual(viaBuilders);
		expect(Object.isFrozen(viaTsx)).toBe(true);
		expect(Object.isFrozen((viaTsx as { children: readonly TreeNode[] }).children[0])).toBe(true);
	});

	it('kit control attributes ride props straight into the builder - handlers included', () => {
		const viaTsx = <runtimeKit.Button label="Go" success onClick={onClick} />;
		const viaBuilders = button({ label: 'Go', success: true, onClick });

		expect(viaTsx).toEqual(viaBuilders);
		expect((viaTsx as { onClick: unknown }).onClick).toBe(onClick);
	});

	it('a bare tag with no attributes passes empty props, not null', () => {
		const viaTsx = <text>x</text>;
		expect(viaTsx).toEqual(text('x'));

		const fromNull = factory('row', null);
		expect(fromNull.kind).toBe('row');
		expect(kids(fromNull)).toEqual([]);
	});

	it('the built tree passes validateTree untouched', () => {
		const tree = <view title="ok"><text>a</text><row><runtimeKit.Button label="Go" onClick={onClick} /></row></view>;
		expect(validateTree(tree as ViewNode)).toEqual([]);
	});
});

// --- Child coercion -----------------------------------------------------------------

describe('child coercion', () => {
	it('drops false/null/undefined - conditionals just work', () => {
		const show = false;
		const tree = <view>{show && <text>no</text>}{show ? <text>yes</text> : null}</view>;

		expect(kids(tree)).toEqual([]);
	});

	it('flattens mapped lists and nested arrays arbitrarily deep', () => {
		const items = ['a', 'b'];
		const tree = <view>{items.map((body) => <text>{body}</text>)}</view>;
		expect(kids(tree)).toEqual([text('a'), text('b')]);

		const nested = factory('view', { children: [<text>a</text>, [<text>b</text>, [<text>c</text>]]] });
		expect(kids(nested)).toEqual([text('a'), text('b'), text('c')]);
	});

	it('a bare string or number child still throws outside text - copy belongs in <text>', () => {
		expect(() => factory('view', { children: 'nope' })).toThrow(/bare string/);
		expect(() => factory('view', { children: [42] })).toThrow(/bare number/);
		expect(() => factory('row', { children: 'nope' })).toThrow(/bare string/);

		const fine = <view><text>plain {42}</text></view>;
		expect((kids(fine)[0] as TextNode).body).toBe('plain 42');
	});

	it('an unknown tag throws with the legal vocabulary', () => {
		const unknown = factory as unknown as (type: string, props: unknown) => TreeNode;
		expect(() => unknown('table', {})).toThrow(/unknown tag 'table'/);
	});
});

// --- Kit controls ----------------------------------------------------------------------

describe('kit controls', () => {
	it('Select with options is the optionSelect builder - same node', () => {
		const options = [{ label: '1h', value: '1h' }];
		const viaTsx = <runtimeKit.Select placeholder="Pick" options={options} onSelect={onClick} />;

		expect(viaTsx).toEqual(optionSelect({ placeholder: 'Pick', options, onSelect: onClick }));
	});

	it('Select with entity is the entitySelect builder - same node', () => {
		const viaTsx = <runtimeKit.Select entity={SelectEntity.Users} onSelect={onClick} />;

		expect(viaTsx).toEqual(entitySelect({ entity: SelectEntity.Users, onSelect: onClick }));
	});

	it('Select with both options and entity throws at construction', () => {
		const options = [{ label: '1h', value: '1h' }];
		expect(() => <runtimeKit.Select options={options} entity={SelectEntity.Users} onSelect={onClick} />).toThrow(/never both/);
	});

	it('Select takes no children - options ride the options prop', () => {
		const options = [{ label: '1h', value: '1h' }];
		const raw = factory as unknown as (type: unknown, props: unknown) => TreeNode;
		expect(() => raw(runtimeKit.Select, { options, onSelect: onClick, children: text('junk') })).toThrow(/no children/);
	});

	it('Button folds its JSX children into the label', () => {
		const viaTsx = <runtimeKit.Button onClick={onClick}>Go {2}</runtimeKit.Button>;
		expect(viaTsx).toEqual(button({ onClick, label: 'Go 2' }));
	});

	it('Button label prop and children together throw', () => {
		expect(() => <runtimeKit.Button label="Go" onClick={onClick}>Also</runtimeKit.Button>).toThrow(/never both/);
	});
});

// --- Control intrinsics -----------------------------------------------------------------

describe('jsx control surfaces', () => {
	it('a link folds its children into the label', () => {
		expect(<link url="https://torn.com">Site {1}</link>).toEqual(link({ url: 'https://torn.com' }, 'Site 1'));
	});

	it('an input resolves its style flags into the node', () => {
		expect(<input id="f" label="L" />).toEqual(input({ id: 'f', label: 'L' }));
		expect(<input id="f" label="L" paragraph />).toEqual({ kind: 'input', id: 'f', label: 'L', style: 'paragraph' });
	});

	it('an input takes no children', () => {
		const raw = factory as unknown as (type: string, props: unknown) => TreeNode;
		expect(() => raw('input', { id: 'f', label: 'L', children: [text('junk')] })).toThrow(/no children/);
	});
});

// --- Modal form controls ---------------------------------------------------------------

describe('jsx modal form controls', () => {
	it('a modal-select with an entity is the entitySelect builder - same node', () => {
		const viaTsx = <modal-select id="c" label="Channel" entity={SelectEntity.Channels} required />;
		expect(viaTsx).toEqual(entitySelect({ id: 'c', label: 'Channel', entity: SelectEntity.Channels, required: true }));
	});

	it('a modal-select lifts option children into the options list', () => {
		const viaTsx = (
			<modal-select id="p" label="Pick">
				<option value="1h">1 hour</option>
				<option value="6h" default>6 hours</option>
			</modal-select>
		);
		expect(viaTsx).toEqual(optionSelect({
			id: 'p',
			label: 'Pick',
			options: [{ label: '1 hour', value: '1h' }, { label: '6 hours', value: '6h', default: true }],
		}));
	});

	it('an options prop and option children together throw', () => {
		const options = [{ label: 'A', value: 'a' }];
		expect(() => (
			<modal-select id="p" label="Pick" options={options}>
				<option value="b">B</option>
			</modal-select>
		)).toThrow(/never both/);
	});

	it('a checkbox-group carries its lifted options', () => {
		const group = <checkbox-group id="g" label="G" required><option value="a">A</option></checkbox-group> as CheckboxGroupNode;
		expect(group.kind).toBe('checkbox-group');
		expect(group.required).toBe(true);
		expect(group.options).toEqual([{ label: 'A', value: 'a' }]);
	});

	it('a non-option child in a modal-select throws', () => {
		expect(() => (
			<modal-select id="p" label="Pick">
				<text>junk</text>
			</modal-select>
		)).toThrow(/only <option>/);
	});

	it('a bare checkbox tag is the checkbox node', () => {
		expect(<checkbox id="t" label="T" required />).toEqual({ kind: 'checkbox', id: 't', label: 'T', required: true });
	});
});

// --- Components & fragments ------------------------------------------------------------

describe('components', () => {
	it('a function tag is called with its props (children inside), spliced by result', () => {
		const Card = (props: { title: string; children?: ComponentResult }): ComponentResult => (
			<container>
				<text title={props.title}>card</text>
				{props.children}
			</container>
		);

		const tree = <view><Card title="T"><text>inner</text></Card></view>;

		expect((tree as { kind: string }).kind).toBe('view');
		const card = kids(tree)[0] as TreeNode;
		expect(card.kind).toBe('container');
		expect(kids(card)).toEqual([text({ title: 'T' }, 'card'), text('inner')]);
	});

	it('an array-returning component splices flat; a falsey return drops', () => {
		const Pair = (): ComponentResult => [<text>1</text>, <text>2</text>];
		const Maybe = (props: { show: boolean }): ComponentResult => (props.show && <text>maybe</text>);

		const full = <view><Pair /><Maybe show={false} /></view>;
		expect(kids(full)).toEqual([text('1'), text('2')]);
	});
});

describe('fragments', () => {
	it('builds nothing of its own - its children splice into the parent', () => {
		const tree = <view><><text>a</text><text>b</text></><text>c</text></view>;

		expect(kids(tree)).toEqual([text('a'), text('b'), text('c')]);
	});

	it('the Fragment factory is an intercept-by-identity marker, never called', () => {
		expect(typeof FragmentTag).toBe('function');
		const fromTag = factory(FragmentTag, { children: <text>x</text> });
		expect(fromTag).toEqual([text('x')]);
	});
});

// --- Text content (children carry the body) --------------------------------------------

describe('jsx text content', () => {
	it('adjacent strings and expressions join into one body', () => {
		expect((<text>Hello {'world'}</text> as TextNode).body).toBe('Hello world');
	});

	it('a title rides props; inline code contributes its delimiters', () => {
		const node = <text title="T">a<code>b</code>c</text> as TextNode;
		expect(node.title).toBe('T');
		expect(node.body).toBe('a`b`c');
	});

	it('falsey expressions drop mid-body', () => {
		const cond = false;
		expect((<text>{cond && 'x'}y</text> as TextNode).body).toBe('y');
	});

	it('code and codeblock are text nodes with fenced bodies', () => {
		expect((<code>{'v'}</code> as TextNode).body).toBe('`v`');
		expect((<codeblock lang="ansi">{'X'}</codeblock> as TextNode).body).toBe('```ansi\nX\n```');
	});

	it('code tags are legal inside view and arrive as text-kind nodes', () => {
		const tree = <view><code>x</code></view>;
		expect(kids(tree)[0].kind).toBe('text');
	});
});

// --- Callouts & hr ------------------------------------------------------------------------

describe('jsx callouts', () => {
	it('the callout tags fold their children into colored ansi fences', () => {
		expect((<error>Key {'k'} rejected</error> as TextNode).body).toBe('```ansi\n\u001b[0;31mKey k rejected\u001b[0m\n```');
		expect((<warning>w</warning> as TextNode).body).toBe('```ansi\n\u001b[0;33mw\u001b[0m\n```');
		expect((<info>i</info> as TextNode).body).toBe('```ansi\n\u001b[0;34mi\u001b[0m\n```');
	});

	it('a callout folds inside a text body like any other text node', () => {
		expect((<text>Step 2 failed: <error>bad key</error></text> as TextNode).body)
			.toBe('Step 2 failed: ```ansi\n\u001b[0;31mbad key\u001b[0m\n```');
	});
});

describe('jsx hr flags', () => {
	it('bare hr is the default node; flags map to clean props', () => {
		expect(<hr />).toEqual({ kind: 'hr' });
		expect(<hr p-small />).toEqual({ kind: 'hr', spacing: 'small' });
		expect(<hr p-large />).toEqual({ kind: 'hr', spacing: 'large' });
		expect(<hr no-divider p-large />).toEqual({ kind: 'hr', divider: false, spacing: 'large' });
	});

	it('flag typos and valued flags throw - the compiler skips hyphenated attributes', () => {
		const raw = factory as unknown as (type: string, props: unknown) => TreeNode;
		expect(() => raw('hr', { 'p-lage': true })).toThrow(/unknown hr flag 'p-lage'/);
		expect(() => raw('hr', { 'p-large': false })).toThrow(/takes no value/);
		expect(() => raw('hr', { divider: false })).toThrow(/unknown hr flag 'divider'/);
	});

	it('hr is legal in views and containers', () => {
		const tree = <view><text>a</text><hr /><container><text>b</text><hr /></container></view>;
		expect(validateTree(tree as ViewNode)).toEqual([]);
	});
});
