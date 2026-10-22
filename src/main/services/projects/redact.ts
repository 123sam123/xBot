// Secret redaction: defence in depth behind the deny list. Every string taken
// from a project is redacted whole when it is read (before any excerpt is cut
// from it, so a cut can't leave half a token that no longer matches) and again
// when sources for the model are built. Each match becomes `[redacted]`; for a
// `name = value` pair or URL credentials only the secret part is replaced.

export const REDACTED = '[redacted]';

interface Rule {
  name: string;
  pattern: RegExp;
  /** Builds the replacement from the match; the default replaces it all. */
  replace?: (match: string, ...groups: string[]) => string;
}

const SECRET_NAME =
  '(?:secret|token|password|passwd|pwd|passphrase|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|authorization|credentials?|session[_-]?key|signing[_-]?key|encryption[_-]?key)';

const RULES: readonly Rule[] = [
  // Private keys: to the END line, or to the end of the text when the block is cut off.
  {
    name: 'private-key',
    pattern: /-----BEGIN[ A-Z0-9]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[ A-Z0-9]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
  { name: 'aws-key-id', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA|APKA|ASCA)[A-Z0-9]{16}\b/g },
  { name: 'gcp-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { name: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { name: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
  { name: 'stripe-key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'stripe-webhook', pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/g },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'huggingface-token', pattern: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { name: 'google-oauth', pattern: /\bya29\.[0-9A-Za-z_-]{20,}/g },
  { name: 'sendgrid-key', pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // scheme://user:pass@host → scheme://[redacted]@host (also a bare token in the user part).
  { name: 'url-credentials', pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, replace: (_m, scheme) => `${scheme}${REDACTED}@` },
  { name: 'bearer', pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g, replace: (_m, word) => `${word} ${REDACTED}` },
  // name = value, name: value, "name": "value" (only the value goes).
  {
    name: 'secret-assignment',
    pattern: new RegExp(`(["']?[\\w.-]*${SECRET_NAME}[\\w.-]*["']?\\s*(?:=>|:=|[:=])\\s*)(["']?)(?!(?:Bearer|Basic|Token) )([^\\s"',;]{4,})\\2`, 'gi'),
    replace: (_m, lead, quote) => `${lead}${quote}${REDACTED}${quote}`,
  },
];

const RUN = /[A-Za-z0-9+/_=-]{32,}/g;

/** Shannon entropy in bits per character. */
export function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A random-looking token: letters and digits, and entropy above what words and identifiers reach. */
function looksRandom(token: string): boolean {
  if (token.length < 32 || !/[A-Za-z]/.test(token) || !/\d/.test(token)) return false;
  const hex = /^[0-9a-fA-F]+$/.test(token);
  return entropy(token) >= (hex ? 3.3 : 4.3);
}

function redactHighEntropy(text: string): string {
  return text.replace(RUN, (run) => {
    // A path-like run (3+ slashes) is scored per segment, so ordinary file paths stay readable.
    if ((run.match(/\//g)?.length ?? 0) >= 3) {
      return run
        .split('/')
        .map((segment) => (looksRandom(segment) ? REDACTED : segment))
        .join('/');
    }
    return looksRandom(run) ? REDACTED : run;
  });
}

/** Replaces every secret-looking part of `text` with `[redacted]`. */
export function redact(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = rule.replace ? out.replace(rule.pattern, rule.replace as (m: string, ...g: string[]) => string) : out.replace(rule.pattern, REDACTED);
  }
  return redactHighEntropy(out);
}
