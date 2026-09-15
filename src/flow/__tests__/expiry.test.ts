import { describe, expect, it } from 'vitest';
import type { Session } from '../../state/types.js';
import { Expiry, expiryEpoch } from '../expiry.js';

/** A minimal session: only the fields the deadline math reads. */
function fakeSession(fields: Partial<Session<never>> = {}): Session<never> {
	return {
		lastActivityAt: 1_000_000,
		ttlMs: 10 * 60_000,
		...fields,
	} as unknown as Session<never>;
}

describe('expiryEpoch', () => {
	it('computes the sliding window at call time', () => {
		// 1_000_000 + 600_000 = 1_600_000 ms -> 1600 s.
		expect(expiryEpoch(fakeSession())).toBe(1600);
	});

	it('prefers the absolute ceiling when the session has one', () => {
		const session = fakeSession({ expiresAt: 2_000_000 });
		// The sliding window ends at 1600 s; the wall is later and wins.
		expect(expiryEpoch(session)).toBe(2000);
	});

	it('floors partial seconds', () => {
		// 1_000_999 + 500 = 1_001_499 ms -> 1001 s.
		expect(expiryEpoch(fakeSession({ lastActivityAt: 1_000_999, ttlMs: 500 }))).toBe(1001);
	});
});

describe('Expiry', () => {
	it('renders the default label and a relative timestamp', () => {
		const node = Expiry({ until: 1600 });
		expect(node.kind).toBe('text');
		expect(node.title).toBeUndefined();
		expect(node.body).toBe('Expires <t:1600:R>');
	});

	it('takes a custom label', () => {
		expect(Expiry({ until: 1600, label: 'Closes' }).body).toBe('Closes <t:1600:R>');
	});
});
