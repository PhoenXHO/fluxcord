/**
 * Command arguments: what the `arg` helpers build, how their values are
 * typed for the data resolver, and the declare-time checks against
 * Discord's rules.
 *
 * @module command/__tests__/args
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { screen } from '../../flow/screen.js';
import { flow } from '../../flow/token.js';
import { text, view } from '../../tree/builders.js';
import { arg } from '../args.js';
import type { ArgValues } from '../args.js';
import { command, mounts } from '../declare.js';

const dummy = flow('dummy', {
	screens: { main: screen()(() => view({}, text('dummy'))) },
	first: 'main',
});

describe('arg helpers', () => {
	it('build plain frozen data, optional unless required', () => {
		const member = arg.user('member', 'Who to look up');
		expect(member).toEqual({ name: 'member', kind: 'user', description: 'Who to look up', required: false });
		expect(Object.isFrozen(member)).toBe(true);
		expect(arg.user('member', 'Who', { required: true }).required).toBe(true);
	});

	it('carry the limits that belong to their kind', () => {
		expect(arg.integer('torn_id', 'Torn id', { min: 1, max: 99 })).toMatchObject({ kind: 'integer', min: 1, max: 99 });
		expect(arg.string('note', 'A note', { maxLength: 40 })).toMatchObject({ kind: 'string', maxLength: 40 });
	});

	it('normalize choices: a bare value is its own label', () => {
		const status = arg.string('status', 'Status', { choices: ['verified', { name: 'Not linked', value: 'pending' }] });
		expect(status.choices).toEqual([
			{ name: 'verified', value: 'verified' },
			{ name: 'Not linked', value: 'pending' },
		]);
		expect(arg.integer('days', 'Days', { choices: [1, 7] }).choices).toEqual([
			{ name: '1', value: 1 },
			{ name: '7', value: 7 },
		]);
	});
});

describe('arg value types', () => {
	it('key the values by name, optional unless required, with literal choices', () => {
		const args = [
			arg.user('member', 'Who', { required: true }),
			arg.integer('torn_id', 'Torn id'),
			arg.string('status', 'Status', { choices: ['verified', 'pending'], required: true }),
			arg.boolean('loud', 'Loud'),
		] as const;
		expectTypeOf(args).not.toBeNever();
		type Values = ArgValues<typeof args>;
		expectTypeOf<Values>().toEqualTypeOf<
			{ member: string; status: 'verified' | 'pending' } & { torn_id?: number; loud?: boolean }
		>();
	});

	it('are empty for a leaf with no arguments', () => {
		expectTypeOf<keyof ArgValues<readonly []>>().toEqualTypeOf<never>();
		const values: ArgValues<readonly []> = {};
		expect(values).toEqual({});
	});

	it('reach the data resolver typed from the same list', () => {
		mounts(dummy, {
			args: [arg.user('member', 'Who', { required: true }), arg.integer('torn_id', 'Id')],
			data: (_context, args) => {
				expectTypeOf(args.member).toEqualTypeOf<string>();
				expectTypeOf(args.torn_id).toEqualTypeOf<number | undefined>();
				return undefined;
			},
		});
	});
});

describe('command() argument checks', () => {
	const declare = (args: Parameters<typeof mounts>[1] extends infer S ? S : never): (() => unknown) =>
		() => command('tool', 'A tool', { mount: mounts(dummy, args as never) });

	it('accepts a well-formed list', () => {
		expect(declare({ args: [arg.user('member', 'Who', { required: true }), arg.integer('torn_id', 'Id', { min: 1 })] })).not.toThrow();
	});

	it('names the leaf path in its errors, subcommands included', () => {
		expect(() => command('tool', 'A tool', {
			subcommands: {
				run: { ...mounts(dummy, { args: [arg.user('Member', 'Who')] }), description: 'Run' },
			},
		})).toThrow(/command 'tool run': argument 'Member' must be 1 to 32 lowercase/);
	});

	it('rejects bad names and duplicates', () => {
		expect(declare({ args: [arg.user('has space', 'Who')] })).toThrow(/lowercase/);
		expect(declare({ args: [arg.user('a', 'One'), arg.user('a', 'Two')] })).toThrow(/declared twice/);
	});

	it('rejects empty and over-long descriptions', () => {
		expect(declare({ args: [arg.user('a', '')] })).toThrow(/description of 1 to 100/);
		expect(declare({ args: [arg.user('a', 'x'.repeat(101))] })).toThrow(/description of 1 to 100/);
	});

	it('rejects a required argument after an optional one', () => {
		expect(declare({ args: [arg.user('a', 'First'), arg.user('b', 'Second', { required: true })] })).toThrow(/required arguments first/);
	});

	it('rejects more than 25 arguments', () => {
		const many = Array.from({ length: 26 }, (_, i) => arg.boolean(`flag${i}`, 'A flag'));
		expect(declare({ args: many })).toThrow(/Discord allows 25/);
	});

	it('rejects limits on the wrong kind and choices mixed with limits', () => {
		expect(declare({ args: [arg.integer('n', 'N', { min: 5, max: 1 })] })).toThrow(/min above its max/);
		expect(declare({ args: [arg.integer('n', 'N', { min: 1.5 })] })).toThrow(/not a whole number/);
		expect(declare({ args: [arg.string('s', 'S', { choices: ['a'], maxLength: 5 })] })).toThrow(/cannot be combined/);
		expect(declare({ args: [arg.integer('n', 'N', { choices: [1.5] })] })).toThrow(/not a whole number/);
	});

	it('rejects more than 25 choices', () => {
		const choices = Array.from({ length: 26 }, (_, i) => `c${i}`);
		expect(declare({ args: [arg.string('s', 'S', { choices })] })).toThrow(/1 to 25 choices/);
	});
});
