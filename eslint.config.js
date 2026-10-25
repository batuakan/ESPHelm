import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.esphome/**',
      'packages/*/generated/**',
      'packages/plugin/public/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // `any` needs a justification comment (CLAUDE.md §6); enforce via explicit disables.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
