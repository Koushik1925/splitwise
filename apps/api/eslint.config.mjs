import { baseConfig } from '@splitwise/config/eslint/base.mjs';

export default [
  ...baseConfig,
  {
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
