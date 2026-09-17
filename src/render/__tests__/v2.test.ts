import { describe, expect, it } from 'vitest';
import { button, checkbox, checkboxGroup, container, entitySelect, hr, input, link, modal, optionSelect, radioGroup, row, text, view } from '../../tree/builders.js';
import { SelectEntity } from '../../tree/vocab.js';
import { actionHash } from '../action-hash.js';
import { renderV2Message, renderV2Modal, RenderError } from '../v2.js';
import type { V2MessagePayload, V2ModalPayload } from '../v2.js';
import { materializeTree } from '../../commit/frame.js';
import type { ButtonNode, ControlNode, InputNode, ModalNode, ViewNode } from '../../tree/types.js';

/** Identity-bound fixture: the handler object itself is the binding. */
const go = (): void => {};

/** Escape hatch for boundary tests: inject nodes where the types forbid them. */
const force = <T,>(value: unknown): T => value as T;

const SESSION = 'sess';
const SCREEN = 'test/main';
const CUSTOM_ID = `ui2:${SESSION}:${SCREEN}#${actionHash(go)}`;
const render = (tree: ViewNode): V2MessagePayload => {
	const materialized = materializeTree(tree);
	return renderV2Message(tree, SESSION, SCREEN, materialized.stampOf);
};

describe('renderV2Message - message envelope', () => {
	it('always sets the Components V2 flag', () => {
		expect(render(view({}, text('x'))).flags).toBe(32768);
	});

	it('renders children flat at the top level', () => {
		const payload = render(view({}, text('a'), row({}, button({ onClick: go, label: 'Go' }))));
		expect(payload.components).toEqual([
			{ type: 10, content: 'a' },
			{ type: 1, components: [{ type: 2, style: 1, label: 'Go', custom_id: CUSTOM_ID }] },
		]);
	});
});

describe('renderV2Message - text', () => {
	it('renders a bare text node as a TextDisplay of its body', () => {
		expect(render(view({}, text('hello'))).components).toEqual([{ type: 10, content: 'hello' }]);
	});

	it('prefixes a title as a bold leading line', () => {
		expect(render(view({}, text({ title: 'T' }, 'b'))).components)
			.toEqual([{ type: 10, content: '**T**\nb' }]);
	});

	it('renders a view title as a # heading first', () => {
		const payload = render(view({ title: 'Panel' }, text('b')));
		expect(payload.components).toEqual([
			{ type: 10, content: '# Panel' },
			{ type: 10, content: 'b' },
		]);
	});
});

describe('renderV2Message - button & link', () => {
	it('defaults an unstyled button to Primary', () => {
		const payload = render(view({}, row({}, button({ onClick: go, label: 'Go' }))));
		expect(payload.components)
			.toEqual([{ type: 1, components: [{ type: 2, style: 1, label: 'Go', custom_id: CUSTOM_ID }] }]);
	});

	it('maps every tree button style', () => {
		for (const [flag, wire] of [
			[{ primary: true }, 1],
			[{ secondary: true }, 2],
			[{ success: true }, 3],
			[{ danger: true }, 4],
		] as const) {
			const payload = render(view({}, row({}, button({ onClick: go, label: 'Go', ...flag }))));
			expect(payload.components)
				.toEqual([{ type: 1, components: [{ type: 2, style: wire, label: 'Go', custom_id: CUSTOM_ID }] }]);
		}
	});

	it('loudly rejects a button style outside the vocabulary', () => {
		const styled = force<ButtonNode>({ ...button({ onClick: go, label: 'Go' }), style: 'neon' });
		expect(() => render(view({}, row({}, styled)))).toThrow(/unknown button style/);
	});

	it('marks a disabled button', () => {
		const payload = render(view({}, row({}, button({ onClick: go, label: 'Go', disabled: true }))));
		expect(payload.components)
			.toEqual([{ type: 1, components: [{ type: 2, style: 1, label: 'Go', custom_id: CUSTOM_ID, disabled: true }] }]);
	});

	it('renders a link as style 5 with a url and no custom_id', () => {
		const payload = render(view({}, row({}, link({ url: 'https://torn.com', label: 'Site' }))));
		expect(payload.components)
			.toEqual([{ type: 1, components: [{ type: 2, style: 5, label: 'Site', url: 'https://torn.com' }] }]);
	});
});

describe('renderV2Message - select', () => {
	it('renders options as a StringSelect with lean option objects', () => {
		const select = optionSelect({
			onSelect: go,
			options: [
				{ label: 'A', value: 'a' },
				{ label: 'B', value: 'b', description: 'second', default: true },
			],
		});
		expect(render(view({}, row({}, select))).components).toEqual([{
			type: 1,
			components: [{
				type: 3,
				custom_id: CUSTOM_ID,
				options: [
					{ label: 'A', value: 'a' },
					{ label: 'B', value: 'b', description: 'second', default: true },
				],
			}],
		}]);
	});

	it('spreads placeholder and value bounds onto the wire', () => {
		const select = optionSelect({
			onSelect: go,
			options: [{ label: 'A', value: 'a' }],
			placeholder: 'pick',
			minSelected: 1,
			maxSelected: 2,
		});
		expect(render(view({}, row({}, select))).components).toEqual([{
			type: 1,
			components: [{
				type: 3,
				custom_id: CUSTOM_ID,
				options: [{ label: 'A', value: 'a' }],
				placeholder: 'pick',
				min_values: 1,
				max_values: 2,
			}],
		}]);
	});

	it('maps every entity source to its platform select type', () => {
		for (const [entity, wire] of [
			[SelectEntity.Users, 5],
			[SelectEntity.Roles, 6],
			[SelectEntity.Mentionable, 7],
			[SelectEntity.Channels, 8],
		] as const) {
			const payload = render(view({}, row({}, entitySelect({ onSelect: go, entity }))));
			expect(payload.components)
				.toEqual([{ type: 1, components: [{ type: wire, custom_id: CUSTOM_ID }] }]);
		}
	});

	it('renders entity defaultIds as default_values', () => {
		const select = entitySelect({ onSelect: go, entity: SelectEntity.Roles, defaultIds: ['r1', 'r2'] });
		expect(render(view({}, row({}, select))).components).toEqual([{
			type: 1,
			components: [{
				type: 6,
				custom_id: CUSTOM_ID,
				default_values: [{ id: 'r1', type: 'role' }, { id: 'r2', type: 'role' }],
			}],
		}]);
	});

	it('loudly rejects defaultIds on a mentionable select', () => {
		const select = entitySelect({ onSelect: go, entity: SelectEntity.Mentionable, defaultIds: ['m1'] });
		expect(() => render(view({}, row({}, select)))).toThrow(/mentionable/);
	});

	it('loudly rejects a select that slipped through rule 8', () => {
		const neither = force<ControlNode>({ kind: 'select', onSelect: go });
		expect(() => render(view({}, row({}, neither)))).toThrow(RenderError);
	});

	it('loudly rejects a select carrying both options and entity', () => {
		const both = force<ControlNode>({ kind: 'select', onSelect: go, options: [{ label: 'A', value: 'a' }], entity: SelectEntity.Users });
		expect(() => render(view({}, row({}, both)))).toThrow(RenderError);
	});

	it('marks a disabled select', () => {
		const select = optionSelect({ onSelect: go, options: [{ label: 'A', value: 'a' }], disabled: true });
		expect(render(view({}, row({}, select))).components).toEqual([{
			type: 1,
			components: [{ type: 3, custom_id: CUSTOM_ID, options: [{ label: 'A', value: 'a' }], disabled: true }],
		}]);
	});

	it('loudly rejects a message select without a handler', () => {
		const silent = optionSelect({ options: [{ label: 'A', value: 'a' }] });
		expect(() => render(view({}, row({}, silent)))).toThrow(RenderError);
		expect(() => render(view({}, row({}, silent)))).toThrow(/needs a handler/);
	});
});

describe('renderV2Message - container', () => {
	it('renders a container with its color and children', () => {
		const payload = render(view({}, container(
			{ color: 0xff0000 },
			text('panel'),
			row({}, button({ onClick: go, label: 'Go' })),
		)));
		expect(payload.components).toEqual([{
			type: 17,
			accent_color: 0xff0000,
			components: [
				{ type: 10, content: 'panel' },
				{ type: 1, components: [{ type: 2, style: 1, label: 'Go', custom_id: CUSTOM_ID }] },
			],
		}]);
	});

	it('omits accent_color when unset', () => {
		const payload = render(view({}, container({}, text('x'))));
		expect(payload.components).toEqual([{ type: 17, components: [{ type: 10, content: 'x' }] }]);
	});
});

describe('renderV2Message - RenderError limits', () => {
	it('rejects text over 4000 chars with the node path', () => {
		const tree = view({}, text('x'.repeat(4001)));
		expect(() => render(tree)).toThrow(RenderError);
		expect(() => render(tree)).toThrow(/view\/text\[0\].*4000/);
	});

	it('rejects messages over 40 components', () => {
		const children = Array.from({ length: 41 }, () => text('x'));
		expect(() => render(view({}, ...children))).toThrow(/41 components, max is 40/);
	});

	it('rejects accent_color outside 24 bits', () => {
		expect(() => render(view({}, container({ color: 0x1000000 }, text('x')))))
			.toThrow(/accent_color/);
	});

	it('rejects a non-view root', () => {
		expect(() => renderV2Message(force<ViewNode>(text('x')), SESSION, SCREEN, () => '0')).toThrow(RenderError);
	});
});

describe('renderV2Modal', () => {
	const renderModal = (root: ModalNode): V2ModalPayload => renderV2Modal(root, 'ui2:sess:mod/edit#open');

	it('carries the caller-provided custom_id and the title', () => {
		const payload = renderModal(modal({ title: 'Edit draft' }, input({ id: 'f', label: 'L' })));
		expect(payload.custom_id).toBe('ui2:sess:mod/edit#open');
		expect(payload.title).toBe('Edit draft');
	});

	it('wraps each input in a Label; the TextInput itself is label-less', () => {
		const payload = renderModal(modal({ title: 'T' }, input({ id: 'draft', label: 'Your message' })));
		expect(payload.components).toEqual([{
			type: 18,
			label: 'Your message',
			component: { type: 4, style: 1, custom_id: 'draft', required: false },
		}]);
	});

	it('always sends required - never leans on the platform default of true', () => {
		const payload = renderModal(modal({ title: 'T' }, input({ id: 'f', label: 'L', required: true })));
		expect(payload.components[0]).toHaveProperty('component.required', true);
	});

	it('maps every tree input style and rejects a bogus one', () => {
		expect(renderModal(modal({ title: 'T' }, input({ id: 'f', label: 'L' }))).components[0])
			.toHaveProperty('component.style', 1);
		expect(renderModal(modal({ title: 'T' }, input({ id: 'f', label: 'L', paragraph: true }))).components[0])
			.toHaveProperty('component.style', 2);
		const junk = force<InputNode>({ ...input({ id: 'f', label: 'L' }), style: 'wide' });
		expect(() => renderModal(modal({ title: 'T' }, junk))).toThrow(/unknown input style/);
	});

	it('spreads placeholder, prefill and length bounds onto the wire', () => {
		const payload = renderModal(modal({ title: 'T' }, input({
			id: 'f',
			label: 'L',
			placeholder: 'ph',
			value: 'pre',
			minLength: 1,
			maxLength: 500,
		})));
		expect(payload.components[0]).toEqual({
			type: 18,
			label: 'L',
			component: {
				type: 4,
				style: 1,
				custom_id: 'f',
				required: false,
				placeholder: 'ph',
				value: 'pre',
				min_length: 1,
				max_length: 500,
			},
		});
	});

	it('passes text children through as TextDisplays', () => {
		const payload = renderModal(modal({ title: 'T' }, text('terms...')));
		expect(payload.components).toEqual([{ type: 10, content: 'terms...' }]);
	});

	it('rejects a non-modal root', () => {
		expect(() => renderV2Modal(force<ModalNode>(text('x')), 'x')).toThrow(RenderError);
	});
});

describe('renderV2Modal - form controls', () => {
	const renderModal = (root: ModalNode): V2ModalPayload => renderV2Modal(root, 'ui2:sess:mod/edit#open');

	it('renders a bare checkbox as a Label-wrapped checkbox, required false explicit', () => {
		expect(renderModal(modal({ title: 'T' }, checkbox({ id: 'c', label: 'T' }))).components).toEqual([{
			type: 18,
			label: 'T',
			component: { type: 23, custom_id: 'c', required: false },
		}]);
	});

	it('a checked checkbox sends default: true', () => {
		const payload = renderModal(modal({ title: 'T' }, checkbox({ id: 'c', label: 'T', checked: true })));
		expect(payload.components[0]).toHaveProperty('component.default', true);
	});

	it('a required checkbox renders as a one-option checkbox group', () => {
		expect(renderModal(modal({ title: 'T' }, checkbox({ id: 'c', label: 'T', required: true }))).components).toEqual([{
			type: 18,
			label: 'T',
			component: { type: 22, custom_id: 'c', required: true, min_values: 1, max_values: 1, options: [{ label: 'T', value: 'on' }] },
		}]);
	});

	it('renders a checkbox group with min/max and the required default', () => {
		expect(renderModal(modal({ title: 'T' }, checkboxGroup({
			id: 'g',
			label: 'G',
			options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b', description: 'second', default: true }],
			minSelected: 1,
			maxSelected: 2,
		}))).components).toEqual([{
			type: 18,
			label: 'G',
			component: {
				type: 22,
				custom_id: 'g',
				options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b', description: 'second', default: true }],
				min_values: 1,
				max_values: 2,
				required: true,
			},
		}]);
	});

	it('renders a radio group without bounds and the required default', () => {
		expect(renderModal(modal({ title: 'T' }, radioGroup({
			id: 'r',
			label: 'R',
			options: [{ label: 'A', value: 'a', default: true }, { label: 'B', value: 'b' }],
		}))).components).toEqual([{
			type: 18,
			label: 'R',
			component: {
				type: 21,
				custom_id: 'r',
				options: [{ label: 'A', value: 'a', default: true }, { label: 'B', value: 'b' }],
				required: true,
			},
		}]);
	});

	it('a modal select sends required even when unset', () => {
		const payload = renderModal(modal({ title: 'T' }, optionSelect({
			id: 'p',
			label: 'Pick',
			options: [{ label: 'A', value: 'a' }],
		})));
		expect(payload.components).toEqual([{
			type: 18,
			label: 'Pick',
			component: { type: 3, custom_id: 'p', options: [{ label: 'A', value: 'a' }], required: true },
		}]);
	});

	it('required: false rides through when set, with placeholder and bounds', () => {
		const payload = renderModal(modal({ title: 'T' }, optionSelect({
			id: 'p',
			label: 'Pick',
			options: [{ label: 'A', value: 'a' }],
			required: false,
			placeholder: 'ph',
			minSelected: 0,
			maxSelected: 2,
		})));
		expect(payload.components).toEqual([{
			type: 18,
			label: 'Pick',
			component: {
				type: 3,
				custom_id: 'p',
				options: [{ label: 'A', value: 'a' }],
				placeholder: 'ph',
				min_values: 0,
				max_values: 2,
				required: false,
			},
		}]);
	});

	it('an entity select maps to its wire type without the ActionRow wrapper', () => {
		const payload = renderModal(modal({ title: 'T' }, entitySelect({
			id: 'c',
			label: 'Channel',
			entity: SelectEntity.Channels,
			defaultIds: ['ch1'],
		})));
		expect(payload.components).toEqual([{
			type: 18,
			label: 'Channel',
			component: { type: 8, custom_id: 'c', required: true, default_values: [{ id: 'ch1', type: 'channel' }] },
		}]);
	});

	it('a description lands on the Label', () => {
		const payload = renderModal(modal({ title: 'T' }, checkbox({ id: 'c', label: 'T', description: 'why' })));
		expect(payload.components[0]).toHaveProperty('description', 'why');
	});

	it('the input description lands on the existing Label', () => {
		const payload = renderModal(modal({ title: 'T' }, input({ id: 'f', label: 'L', description: 'hint' })));
		expect(payload.components[0]).toHaveProperty('description', 'hint');
	});

	it('loudly rejects a modal select that lost its label or id', () => {
		const bare = force<ModalNode>({ ...modal({ title: 'T' }), children: [{ kind: 'select', options: [{ label: 'A', value: 'a' }] }] });
		expect(() => renderModal(bare)).toThrow(/needs a label and an id/);
	});
});

describe('renderV2Message - hr (Separator)', () => {
	it('renders the platform default payload when no props are set', () => {
		expect(render(view({}, text('a'), hr())).components[1]).toEqual({ type: 14 });
	});

	it('maps spacing and divider:false onto the payload', () => {
		expect(render(view({}, hr({ spacing: 'large' }))).components[0]).toEqual({ type: 14, spacing: 2 });
		expect(render(view({}, hr({ divider: false }))).components[0]).toEqual({ type: 14, divider: false });
	});

	it('renders inside containers', () => {
		const payload = render(view({}, container({}, text('x'), hr({ spacing: 'large' }))));
		expect(payload.components[0]).toEqual({
			type: 17,
			components: [{ type: 10, content: 'x' }, { type: 14, spacing: 2 }],
		});
	});
});
