import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Makes vitest resolve the JSX runtime's "fluxcord/jsx-runtime"
		// import to src (fresh) instead of the compiled dist copy.
		conditions: ['development'],
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
		coverage: {
			provider: 'v8',
			// Every source file counts, tests excluded: the report is about
			// what the shipped code's tests touch, not about the tests.
			include: ['src/**/*.ts', 'src/**/*.tsx'],
			exclude: ['src/**/__tests__/**'],
			reporter: ['text', 'html'],
		},
	},
});
