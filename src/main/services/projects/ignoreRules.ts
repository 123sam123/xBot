import ignore, { type Ignore } from 'ignore';

// Which files in an approved folder xBot may read. The built-in deny list
// comes first and nothing in the folder can undo it. Then every ignore file
// the folder has (.gitignore at any depth, .git/info/exclude, .xbotignore)
// is its own layer, and a path is excluded when ANY layer excludes it: a `!`
// line only re-includes within its own file, so a committed .xbotignore or
// .gitignore can never re-include a denied or user-excluded path. Matching
// ignores case (APFS does), folders are tested with a trailing `/` (the
// `ignore` package only matches `dir/` patterns that way), and any error
// from the matcher counts as excluded.

/** Secrets, dumps, dependencies, build output, editor churn, media and binaries. */
export const DENY_PATTERNS: readonly string[] = [
  // OS and editor churn
  '.DS_Store', '.idea/', '.vscode/', '*.swp', '*.swo', '*~',
  // Secrets and credentials
  '.env*', '*.pem', '*.key', 'id_*', '*.p12', '*.pfx', '*.keystore', '*.jks', '*.kdbx', '*.gpg', '*.asc',
  '*.crt', '*.cer', '*.der', '*.csr', '*.ovpn', '*.tfstate*', '*.tfvars', '.npmrc', '.netrc', '.pypirc',
  '.pgpass', '.htpasswd', '.git-credentials', '.aws/', '.ssh/', '.gnupg/', '.docker/', '.kube/',
  '*credentials*', '*secret*', 'service-account*.json',
  // Databases and dumps
  '*.sqlite*', '*.db', '*.sql', '*.dump', '*.bak',
  // Dependencies, build output and caches
  'node_modules/', 'vendor/', 'dist/', 'build/', 'out/', '.next/', '.nuxt/', '.svelte-kit/', '.output/', '.vercel/',
  'target/', 'coverage/', '.venv/', 'venv/', '__pycache__/', '.cache/', '.turbo/', '.parcel-cache/', '.gradle/',
  'Pods/', 'DerivedData/', '.terraform/', '.git/', '*.log',
  // Lockfiles
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'composer.lock', 'go.sum',
  // Media, fonts, archives, executables and model weights
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.heic', '*.bmp', '*.tiff', '*.ico', '*.icns', '*.svgz', '*.psd',
  '*.sketch', '*.fig', '*.mp3', '*.wav', '*.m4a', '*.aac', '*.flac', '*.ogg', '*.mp4', '*.mov', '*.m4v', '*.avi',
  '*.mkv', '*.webm', '*.ttf', '*.otf', '*.woff', '*.woff2', '*.eot', '*.zip', '*.tar', '*.gz', '*.tgz', '*.bz2',
  '*.xz', '*.7z', '*.rar', '*.dmg', '*.pkg', '*.iso', '*.exe', '*.dll', '*.so', '*.dylib', '*.o', '*.a', '*.class',
  '*.jar', '*.wasm', '*.bin', '*.pdf', '*.parquet', '*.pkl', '*.npy', '*.onnx', '*.pt', '*.ckpt', '*.safetensors', '*.gguf',
];

export interface IgnoreRules {
  /** True when `rel` (a `/`-separated path relative to the folder) must not be read, listed or named. */
  isExcluded(rel: string, isDir: boolean): boolean;
  /** Adds an ignore file's lines as a layer scoped to `dir` ('' for the folder itself). */
  add(dir: string, content: string): void;
  /** Excludes `dir` and everything in it: its ignore file exists but couldn't be read. */
  excludeDir(dir: string): void;
}

interface Layer {
  dir: string;
  matcher: Ignore;
}

const deny = ignore({ ignorecase: true }).add([...DENY_PATTERNS]);

const within = (rel: string, dir: string) => dir === '' || rel === dir || rel.startsWith(`${dir}/`);

export function createIgnoreRules(): IgnoreRules {
  const layers: Layer[] = [];
  const excludedDirs: string[] = [];

  function isExcluded(rel: string, isDir: boolean): boolean {
    try {
      if (rel === '' || deny.ignores(isDir ? `${rel}/` : rel)) return true;
      if (excludedDirs.some((dir) => within(rel, dir))) return true;
      for (const layer of layers) {
        if (layer.dir !== '' && !rel.startsWith(`${layer.dir}/`)) continue;
        const sub = layer.dir === '' ? rel : rel.slice(layer.dir.length + 1);
        if (layer.matcher.ignores(isDir ? `${sub}/` : sub)) return true;
      }
      return false;
    } catch {
      // RangeError for non-relative paths, TypeError for '': never read what can't be matched.
      return true;
    }
  }

  return {
    isExcluded,
    add(dir, content) {
      layers.push({ dir, matcher: ignore({ ignorecase: true }).add(content) });
    },
    excludeDir(dir) {
      excludedDirs.push(dir);
    },
  };
}
