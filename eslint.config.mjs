import { defineConfig } from 'eslint/config';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all,
});

export default defineConfig([
	{
		extends: compat.extends(
			'eslint:recommended',
			'plugin:@typescript-eslint/recommended',
		),

		plugins: {
			'@typescript-eslint': typescriptEslint,
		},

		languageOptions: {
			globals: {
				...globals.node,
			},
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.eslint.json',
			},
		},

		rules: {
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/explicit-function-return-type': 'warn',
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-console': 'off',
			'quotes': ['error', 'single', { avoidEscape: true }],
			'prefer-const': 'error',
			'semi': ['error', 'always'],
			'indent': ['error', 'tab', { FunctionDeclaration: { parameters: 'first' }, SwitchCase: 1 }],
		},
	},
	{
		// Core purity: the platform-free core must never import discord.js.
		// All Discord glue lives in src/discord (the /discord entry).
		files: ['src/**'],
		ignores: ['src/discord/**'],
		rules: {
			'no-restricted-imports': ['error', {
				patterns: [{
					group: ['discord.js'],
					message: 'Core purity: the fluxcord core is platform-free: Discord glue belongs in fluxcord/discord (src/discord).',
				}],
			}],
		},
	},
	{
		// The examples bot is its own package with its own tsconfig project.
		files: ['examples/src/**'],
		languageOptions: {
			parserOptions: {
				project: './examples/tsconfig.json',
			},
		},
	},
	{
		ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'examples/dist/**', 'node_modules/**'],
	},
]);
