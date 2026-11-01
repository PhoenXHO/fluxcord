/**
 * The actor's roles at the command door: a role-based gate (an app's admin
 * privilege) can only hold if the door tells the policy engine which roles
 * the actor has. Covers the role reader on both member shapes and the door
 * handing the roles to the policy port.
 *
 * @module discord/__tests__/door-roles
 */

import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { mounts, command } from '../../command/declare.js';
import { screen } from '../../flow/screen.js';
import { flow } from '../../flow/token.js';
import type { Flow } from '../../flow/token.js';
import { policy } from '../../pipeline/policy.js';
import type { PolicyRequest } from '../../pipeline/types.js';
import { text, view } from '../../tree/builders.js';
import { createBot } from '../create-bot.js';
import { memberRoleIds } from '../flatten.js';
import { uiHost } from '../ui-host.js';

describe('memberRoleIds', () => {
	it('reads a hydrated member (a role manager with a cache)', () => {
		const member = { roles: { cache: new Map([['r1', {}], ['r2', {}]]) } };
		expect(memberRoleIds({ member })).toEqual(['r1', 'r2']);
	});

	it('reads a plain API member (an array of ids)', () => {
		expect(memberRoleIds({ member: { roles: ['r1', 'r2'] } })).toEqual(['r1', 'r2']);
	});

	it('reads nothing outside a guild or from a member without roles', () => {
		expect(memberRoleIds({ member: null })).toBeUndefined();
		expect(memberRoleIds({ member: undefined })).toBeUndefined();
		expect(memberRoleIds({ member: {} })).toBeUndefined();
	});
});

describe('the command door', () => {
	it('tells the policy port which roles the actor holds', async () => {
		const authorize = vi.fn(async (_request: PolicyRequest) => ({ allowed: true }));
		const panel = flow('panel', { screens: { main: screen()(() => view({}, text('hi'))) }, first: 'main' });
		const door = command('panel', 'A gated panel', { mount: mounts(panel, { policy: policy.privilege('admin') }) });
		const client = {
			isReady: (): boolean => true,
			on: vi.fn(),
			once: vi.fn(),
			login: vi.fn(async () => undefined),
			destroy: vi.fn(async () => undefined),
			application: { commands: { set: vi.fn(async () => []) } },
		} as unknown as Client;
		createBot({ modules: [{ name: 'panel', commands: [door] }], token: 't', policy: { authorize }, client, sweeper: false });

		const interaction = {
			user: { id: 'u1' },
			guildId: 'g1',
			channelId: 'c1',
			member: { roles: { cache: new Map([['admin-role', {}]]) } },
		} as unknown as ChatInputCommandInteraction;
		await uiHost().checkDoor?.(panel as Flow<unknown>, policy.privilege('admin'), interaction);

		expect(authorize).toHaveBeenCalledTimes(1);
		expect(authorize.mock.calls[0][0]).toMatchObject({ actorId: 'u1', guildId: 'g1', actorRoleIds: ['admin-role'] });
	});
});
