import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '.astro/**', '.wrangler/**', 'node_modules/**', '**/*.d.ts', '**/*.ts'] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/lib/{uploads,reply-files,attachments,office}.js'],
    // These file-boundary validators deliberately reject control characters.
    rules: { 'no-control-regex': 'off' },
  },
];
