import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

// Process boundaries are enforced here (see docs/ARCHITECTURE.md):
// - renderer and shared code never import electron or Node built-ins;
// - the renderer takes only types from zod, contract files and the composition
//   schema, so zod stays out of its bundles;
// - the preload never imports zod, and takes only types (plus the zod-free
//   `*.channels` files) from the shared contracts.
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];
const boundaryPaths = [
  { name: 'electron', message: 'Renderer and shared code reach the main process only through window.xbot.' },
  ...nodeBuiltins.map((name) => ({ name, message: 'Renderer and shared code must not use Node built-ins.' })),
];

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
    files: ['src/shared/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { paths: boundaryPaths }] },
  },
  {
    // The composition model and layout are imported by the renderer as values, so zod must never reach them.
    files: ['src/shared/composition/model.ts', 'src/shared/composition/layout.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [...boundaryPaths, { name: 'zod', message: 'The renderer imports this file; validation lives in ./schema.' }],
          patterns: [{ group: ['./schema'], message: 'The renderer imports this file; ./schema pulls in zod.' }],
        },
      ],
    },
  },
  {
    // The reminder schedule, labels and shortcut rules (T8) and preview mode's sample (T10) are
    // imported as values by code that must stay zod-free.
    files: ['src/shared/reminders/**/*.ts', 'src/shared/previewSample.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [...boundaryPaths, { name: 'zod', message: 'The renderer imports this folder; validation lives in the contracts.' }],
          patterns: [
            {
              regex: 'contracts/(?!.*\\.channels$)',
              allowTypeImports: true,
              message: 'The renderer imports this folder; take only types from contract files (they pull in zod).',
            },
          ],
        },
      ],
    },
  },
  {
    // zod stays out of the renderer bundles: types only from zod and from contract or schema files.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [...boundaryPaths, { name: 'zod', allowTypeImports: true, message: 'zod stays out of the renderer; validation runs in main.' }],
          patterns: [
            {
              regex: 'shared/(contracts/(?!.*\\.channels$)|composition/schema)',
              allowTypeImports: true,
              message: 'Import only types from contract and schema files; they pull in zod.',
            },
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
