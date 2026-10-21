import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

// Process boundaries are enforced here (see docs/ARCHITECTURE.md):
// - renderer and shared code never import electron or Node built-ins;
// - the preload never imports zod, and takes only types (plus the zod-free
//   `*.channels` files) from the shared contracts.
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig(
  // .fredrin/, .claude/ and .agents/ hold the ticket tooling, not xBot code.
  globalIgnores(['out/', 'dist/', 'test-results/', 'playwright-report/', 'node_modules/', '.fredrin/', '.claude/', '.agents/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Per-domain stub interfaces start empty and are filled in by sibling tickets.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Renderer and shared code reach the main process only through window.xbot.' },
            ...nodeBuiltins.map((name) => ({ name, message: 'Renderer and shared code must not use Node built-ins.' })),
          ],
        },
      ],
    },
  },
  {
    files: ['src/preload/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'zod', message: 'Validation runs in main; the sandboxed preload stays dependency-free.' }],
          patterns: [
            {
              regex: 'shared/contracts/(?!.*\\.channels$)',
              allowTypeImports: true,
              message: 'Import only types from contract files; channel names come from *.channels.ts.',
            },
          ],
        },
      ],
    },
  },
);
