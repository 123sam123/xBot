import type { AiModel, CatalogEntry } from '../../../shared/contracts/ai';

// The downloads xBot offers, verified on ollama.com/library on 2026-10-21
// (docs/OLLAMA.md → "Suggested models"). Only these names can be pulled from
// inside xBot. Memory figures are approximate.

export const CATALOG: readonly CatalogEntry[] = [
  { name: 'gemma3:4b', downloadBytes: 3.4e9, sizeLabel: '3.4 GB', minRamGB: 8, note: 'About 5 GB of memory while writing.', recommended: true },
  { name: 'llama3.2:3b', downloadBytes: 2.0e9, sizeLabel: '2.0 GB', minRamGB: 8, note: 'About 3 GB of memory while writing.', recommended: false },
  {
    name: 'gemma3:1b',
    downloadBytes: 8.06e8,
    sizeLabel: '806 MB',
    minRamGB: 4,
    note: 'Fastest, weakest drafts. About 1.5 GB of memory while writing.',
    recommended: false,
  },
  {
    name: 'gemma3:12b',
    downloadBytes: 8.2e9,
    sizeLabel: '8.2 GB',
    minRamGB: 16,
    note: 'Best drafts, slower. About 10 GB of memory while writing.',
    recommended: false,
  },
];

export function isCatalogModel(name: string): boolean {
  return CATALOG.some((entry) => entry.name === name);
}

/** The catalog entries this Mac's memory can run, in catalog order, at most 4. */
export function recommend(totalMemBytes: number): CatalogEntry[] {
  const ramGB = Math.round(totalMemBytes / 2 ** 30);
  return CATALOG.filter((entry) => entry.minRamGB <= ramGB).slice(0, 4);
}

/** Ollama lists `gemma3:4b` as is, and an untagged pull as `<name>:latest`. */
function sameModel(a: string, b: string): boolean {
  const norm = (n: string) => (n.includes(':') ? n : `${n}:latest`);
  return norm(a) === norm(b);
}

export function findModel<T extends { name: string }>(models: readonly T[], name: string): T | undefined {
  return models.find((m) => sameModel(m.name, name));
}

/**
 * The automatic pick: an installed local `gemma3:4b`; otherwise any installed
 * local model in catalog order; otherwise the smallest installed local model.
 */
export function pickDefault(models: readonly AiModel[]): string | null {
  const local = models.filter((m) => m.verdict === 'local');
  for (const entry of CATALOG) {
    const found = findModel(local, entry.name);
    if (found) return found.name;
  }
  const smallest = [...local].sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
  return smallest?.name ?? null;
}
