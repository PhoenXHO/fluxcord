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
import { button, entitySelect, optionSelect, text, view } from '../builders.js';
import { runtimeKit } from '../kit.js';
import { validateTree } from '../validate.js';
import { ButtonStyle, SelectEntity } from '../vocab.js';
import type { ComponentResult } from '../jsx-runtime.js';
import type { TreeNode, ViewNode } from '../types.js';

const onClick = (): void => {};

/** Coerces an element (or expression) to a child list, for asserting children arrays. */
function kids(node: unknown): readonly TreeNode[] {
	const value = node as { children?: readonly TreeNode[] };
	return Array.isArray(node) ? (node as readonly TreeNode[]) : (value.children ?? []);
}

// --- Elements are builder nodes ---------------------------------------------------

describe('jsx elements', () => {
	it('a tagged element is the builder\'s node - same tree, frozen', () => {
		const viaTsx = <view title="t"><text body="b" /></view>;
		const viaBuilders = view({ title: 't' }, text({ body: 'b' }));

		expect(viaTsx).toEqual(viaBuilders);
		expect(Object.isFrozen(viaTsx)).toBe(true);
		expect(Object.isFrozen((viaTsx as { children: readonly TreeNode[] }).children[0])).toBe(true);
	});

	it('kit control attributes ride props straight into the builder - handlers included', () => {
		const viaTsx = <runtimeKit.Button label="Go" style={ButtonStyle.Success} onClick={onClick} />;
		const viaBuilders = button({ label: 'Go', style: ButtonStyle.Success, onClick });

		expect(viaTsx).toEqual(viaBuilders);
		expect((viaTsx as { onClick: unknown }).onClick).toBe(onClick);
	});

	it('a bare tag with no attributes passes empty props, not null', () => {
		const viaTsx = <text body="x" />;
		expect(viaTsx).toEqual(text({ body: 'x' }));

		const fromNull = factory('row', null);
		expect(fromNull.kind).toBe('row');
		expect(kids(fromNull)).toEqual([]);
	});

	it('the built tree passes validateTree untouched', () => {
		const tree = <view title="ok"><text body="a" /><row><runtimeKit.Button label="Go" onClick={onClick} /></row></view>;
		expect(validateTree(tree as ViewNode)).toEqual([]);
	});
});

// --- Child coercion -----------------------------------------------------------------

describe('child coercion', () => {
	it('drops false/null/undefined - conditionals just work', () => {
		const show = false;
		const tree = <view>{show && <text body="no" />}{show ? <text body="yes" /> : null}</view>;

		expect(kids(tree)).toEqual([]);
	});

	it('flattens mapped lists and nested arrays arbitrarily deep', () => {
		const items = ['a', 'b'];
		const tree = <view>{items.map((body) => <text body={body} />)}</view>;
		expect(kids(tree)).toEqual([text({ body: 'a' }), text({ body: 'b' })]);

		const nested = factory('view', { children: [factory('text', { body: 'a' }), [factory('text', { body: 'b' }), [factory('text', { body: 'c' })]]] });
		expect(kids(nested)).toEqual([text({ body: 'a' }), text({ body: 'b' }), text({ body: 'c' })]);
	});

	it('a bare string or number child throws loudly - copy belongs in <text>', () => {
		expect(() => factory('view', { children: 'nope' })).toThrow(/bare string/);
		expect(() => factory('view', { children: [42] })).toThrow(/bare number/);
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
});

// --- Components & fragments ------------------------------------------------------------

describe('components', () => {
	it('a function tag is called with its props (children inside), spliced by result', () => {
		const Card = (props: { title: string; children?: ComponentResult }): ComponentResult => (
			<container>
				<text title={props.title} body="card" />
				{props.children}
			</container>
		);

		const tree = <view><Card title="T"><text body="inner" /></Card></view>;

		expect((tree as { kind: string }).kind).toBe('view');
		const card = kids(tree)[0] as TreeNode;
		expect(card.kind).toBe('container');
		expect(kids(card)).toEqual([text({ title: 'T', body: 'card' }), text({ body: 'inner' })]);
	});

	it('an array-returning component splices flat; a falsey return drops', () => {
		const Pair = (): ComponentResult => [<text body="1" />, <text body="2" />];
		const Maybe = (props: { show: boolean }): ComponentResult => (props.show && <text body="maybe" />);

		const full = <view><Pair /><Maybe show={false} /></view>;
		expect(kids(full)).toEqual([text({ body: '1' }), text({ body: '2' })]);
	});
});

describe('fragments', () => {
	it('builds nothing of its own - its children splice into the parent', () => {
		const tree = <view><><text body="a" /><text body="b" /></><text body="c" /></view>;

		expect(kids(tree)).toEqual([text({ body: 'a' }), text({ body: 'b' }), text({ body: 'c' })]);
	});

	it('the Fragment factory is an intercept-by-identity marker, never called', () => {
		expect(typeof FragmentTag).toBe('function');
		const fromTag = factory(FragmentTag, { children: <text body="x" /> });
		expect(fromTag).toEqual([text({ body: 'x' })]);
	});
});
