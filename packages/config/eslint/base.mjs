// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared base ESLint rules used across apps/web, apps/api, and packages/*.
 * Framework-specific configs (Next.js, NestJS) spread this array and append
 * their own plugin configs on top.
 */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: ['dist/**', 'build/**', '.next/**', 'node_modules/**', 'coverage/**'],
  },
);

export default baseConfig;
