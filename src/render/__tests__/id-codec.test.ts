import { describe, expect, it } from 'vitest';
import { decodeActionId, encodeActionId } from '../id-codec.js';
import { actionHash } from '../action-hash.js';

describe('encodeActionId', () => {
	it('builds the documented wire format', () => {
		expect(encodeActionId({ sessionId: 's', screenKey: 'mod/main', actionHash: 'a3f9x2' }))
			.toBe('ui2:s:mod/main#a3f9x2');
	});

	it('throws on an empty part', () => {
		expect(() => encodeActionId({ sessionId: '', screenKey: 'mod/main', actionHash: 'a3f9x2' })).toThrow();
		expect(() => encodeActionId({ sessionId: 's', screenKey: 'mod/main', actionHash: '' })).toThrow();
	});

	it("throws on ':' or '#' inside any part", () => {
		expect(() => encodeActionId({ sessionId: 'a:b', screenKey: 'mod/main', actionHash: 'a3f9x2' })).toThrow();
		expect(() => encodeActionId({ sessionId: 's', screenKey: 'mod/main', actionHash: 'a#b' })).toThrow();
	});

	it('accepts a slash inside the screen key (module separator, not a delimiter)', () => {
		expect(() => encodeActionId({ sessionId: 's', screenKey: 'core/panel', actionHash: 'a3f9x2' })).not.toThrow();
	});

	it('throws past the 100-char custom_id cap', () => {
		expect(() => encodeActionId({
			sessionId: 's'.repeat(95),
			screenKey: 'mod/main',
			actionHash: 'a3f9x2',
		})).toThrow(/100/);
	});
});

describe('decodeActionId', () => {
	it('round-trips every field', () => {
		const address = { sessionId: 's', screenKey: 'mod/main', actionHash: 'a3f9x2' };
		expect(decodeActionId(encodeActionId(address))).toEqual(address);
	});

	it('rejects ids without the ui2 prefix', () => {
		expect(() => decodeActionId('other:s:mod/main#a3f9x2')).toThrow();
	});

	it('rejects ids missing delimiters', () => {
		expect(() => decodeActionId('ui2:s:mod#')).toThrow();
		expect(() => decodeActionId('ui2:s:mod/main')).toThrow();
		expect(() => decodeActionId('ui2:s#a3f9x2')).toThrow();
	});

	it('rejects embedded delimiters that shift the parse', () => {
		expect(() => decodeActionId('ui2:s:mod//main#a3f9x2')).not.toThrow(); // '/' is legal in the screen key
		expect(() => decodeActionId('ui2:s:mod/main#go:extra')).toThrow(); // ':' inside the hash part shifts nothing but re-encode rejects it
	});

	it('rejects empty parts', () => {
		expect(() => decodeActionId('ui2:s:mod/main#')).toThrow();
	});
});

describe('actionHash', () => {
	it('is deterministic across calls', () => {
		const handler = (): void => undefined;
		expect(actionHash(handler)).toBe(actionHash(handler));
	});

	it('is stable across restarts (same source, fresh function)', () => {
		const source = '(event) => event.ui.close()';
		expect(actionHash(new Function('return ' + source)())).toBe(actionHash(new Function('return ' + source)()));
	});

	it('changes when the handler source changes', () => {
		const one = (): void => undefined;
		const two = (): number => 1;
		expect(actionHash(one)).not.toBe(actionHash(two));
	});

	it('is 6 base36 chars (fits any wire budget)', () => {
		expect(actionHash((): void => undefined)).toMatch(/^[0-9a-z]{6}$/);
	});
});
