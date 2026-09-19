/**
 * kitFor's session-aware member: Back. The draw-time facts (disabled on
 * an empty history, default label and style) plus the generated
 * handler's contract: onLeave runs before the pop, and a throw from it
 * cancels the nav.
 *
 * @module tree/__tests__/kit
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActionEvent } from '../../pipeline/types.js';
import { kitFor } from '../kit.js';
import type { ButtonNode } from '../types.js';

/** A minimal fake event: Back's handler only touches ui.back. */
function fakeEvent(back: () => void): ActionEvent<never, string> {
	return { ui: { back } } as unknown as ActionEvent<never, string>;
}

describe('kitFor Back - draw', () => {
	it('an empty history renders the entry-screen Back: disabled, secondary, default label', () => {
		const node = kitFor({ history: [] }).Back({});
		expect(node).toEqual({
			kind: 'button',
			label: 'Back',
			style: 'secondary',
			disabled: true,
			onClick: expect.any(Function),
		});
	});

	it('a non-empty history enables the button', () => {
		const node = kitFor({ history: ['hub'] }).Back({});
		expect(node.disabled).toBe(false);
	});

	it('the label prop and one style flag override the defaults', () => {
		const node = kitFor({ history: ['hub'] }).Back({ label: 'Return', danger: true });
		expect(node.label).toBe('Return');
		expect(node.style).toBe('danger');
		expect(node.disabled).toBe(false);
	});

	it('two style flags still throw, through the button builder', () => {
		expect(() => kitFor({ history: [] }).Back({ danger: true, success: true })).toThrow(/at most one/);
	});

	it('the disabled state is final: props cannot re-enable an empty history', () => {
		const node = kitFor({ history: [] }).Back({ disabled: false } as never);
		expect(node.disabled).toBe(true);
	});
});

describe('kitFor Back - the generated handler', () => {
	it('runs onLeave before the pop', async () => {
		const order: string[] = [];
		const back = vi.fn();
		const node: ButtonNode = kitFor({ history: ['hub'] }).Back({
			onLeave: () => { order.push('leave'); },
		});

		await node.onClick(fakeEvent(back));

		expect(order).toEqual(['leave']);
		expect(back).toHaveBeenCalledTimes(1);
	});

	it('a throwing onLeave cancels the nav: the error propagates, the pop never runs', async () => {
		const back = vi.fn();
		const node: ButtonNode = kitFor({ history: ['hub'] }).Back({
			onLeave: () => { throw new Error('unsaved changes'); },
		});

		await expect(node.onClick(fakeEvent(back))).rejects.toThrow('unsaved changes');
		expect(back).not.toHaveBeenCalled();
	});

	it('with no onLeave the click is the bare pop', async () => {
		const back = vi.fn();
		const node: ButtonNode = kitFor({ history: ['hub'] }).Back({});

		await node.onClick(fakeEvent(back));

		expect(back).toHaveBeenCalledTimes(1);
	});
});
