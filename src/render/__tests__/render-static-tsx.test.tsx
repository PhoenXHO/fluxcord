import { describe, expect, it } from 'vitest';
import { button, container, text, view } from '../../tree/builders.js';
import { renderStatic, RenderError } from '../v2.js';

describe('renderStatic with TSX', () => {
	it('renders a TSX view to the same body as the builder view', () => {
		const fromTsx = renderStatic(
			<view title="Hi">
				<container color={0x5865f2}>
					<text>a</text>
				</container>
			</view>,
		);
		const fromBuilders = renderStatic(view({ title: 'Hi' }, container({ color: 0x5865f2 }, text('a'))));
		expect(fromTsx).toEqual(fromBuilders);
		expect(fromTsx.components[0]).toEqual({ type: 10, content: '# Hi' });
	});

	it('takes a bare container the way a screen may return one', () => {
		const payload = renderStatic(
			<container>
				<text>only a container</text>
			</container>,
		);
		expect(payload.flags).toBe(32768);
		expect(payload.components).toHaveLength(1);
	});

	it('still rejects a button in a TSX view', () => {
		expect(() => renderStatic(
			<view>
				<row>
					{button({ label: 'Go', onClick: () => undefined })}
				</row>
			</view>,
		)).toThrow(RenderError);
	});
});
