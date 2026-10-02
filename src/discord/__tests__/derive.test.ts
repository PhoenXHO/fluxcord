/**
 * Command derivation tests: how a `command` declaration becomes the
 * registration-ready builder.
 *
 * @module discord/__tests__/derive
 */

import { describe, expect, it } from 'vitest';
import { command, mounts } from '../../command/declare.js';
import { screen } from '../../flow/screen.js';
import { flow } from '../../flow/token.js';
import { text, view } from '../../tree/builders.js';
import { deriveCommand } from '../derive.js';

const dummy = flow('dummy', {
	screens: { main: screen()(() => view({}, text('dummy'))) },
	first: 'main',
});

describe('deriveCommand - descriptions', () => {
	it('a bare leaf with its own description overrides the command description', () => {
		const cmd = command('tool', 'Command level', {
			mount: mounts(dummy, { description: 'Leaf level' }),
		});
		expect(deriveCommand(cmd).data.description).toBe('Leaf level');
	});

	it('a bare leaf without a description keeps the command description', () => {
		const cmd = command('tool', 'Command level', { mount: mounts(dummy) });
		expect(deriveCommand(cmd).data.description).toBe('Command level');
	});

	it('grouped subcommands carry their own descriptions', () => {
		const cmd = command('tool', 'Command level', {
			subcommands: {
				one: { ...mounts(dummy), description: 'First' },
				two: { ...mounts(dummy), description: 'Second' },
			},
		});
		const json = deriveCommand(cmd).data.toJSON();
		const options = json.options as { name: string; description: string }[];
		expect(options.map((option) => [option.name, option.description])).toEqual([
			['one', 'First'],
			['two', 'Second'],
		]);
	});
});
