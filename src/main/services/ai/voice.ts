import { randomUUID } from 'node:crypto';
import { aiCopy } from '../../../shared/aiCopy';
import { VOICE_LIMITS, type VoicePatch, type VoiceProfile } from '../../../shared/contracts/ai';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';

// The voice profile (migration 202610220000_ai_voice.sql). Stored locally;
// the style brief is derived only from examples the user approved.

interface ProfileRow {
  casual_polished: number;
  dry_playful: number;
  technical_accessible: number;
  emoji: VoiceProfile['emoji'];
  profanity: VoiceProfile['profanity'];
  banned_phrases: string;
  style_brief: string;
}

export type VoiceStore = ReturnType<typeof createVoiceStore>;

export function createVoiceStore(db: Db, now: () => Date = () => new Date()) {
  const selectProfile = db.prepare<[], ProfileRow>(
    'SELECT casual_polished, dry_playful, technical_accessible, emoji, profanity, banned_phrases, style_brief FROM voice_profile WHERE id = 1',
  );
  const selectExamples = db.prepare<[], { id: string; text: string; created_at: string }>(
    'SELECT id, text, created_at FROM voice_examples ORDER BY created_at DESC, rowid DESC',
  );
  const countExamples = db.prepare<[], { n: number }>('SELECT count(*) AS n FROM voice_examples');
  const insertExample = db.prepare('INSERT INTO voice_examples (id, text, created_at) VALUES (?, ?, ?)');
  const deleteExample = db.prepare('DELETE FROM voice_examples WHERE id = ?');

  function get(): VoiceProfile {
    const row = selectProfile.get();
    if (!row) throw new Error('voice: the profile row is missing');
    let banned: string[] = [];
    try {
      const parsed = JSON.parse(row.banned_phrases) as unknown;
      if (Array.isArray(parsed)) banned = parsed.filter((p): p is string => typeof p === 'string');
    } catch {
      // CHECK (json_valid) makes this unreachable; keep the profile readable anyway.
    }
    return {
      casualPolished: row.casual_polished,
      dryPlayful: row.dry_playful,
      technicalAccessible: row.technical_accessible,
      emoji: row.emoji,
      profanity: row.profanity,
      bannedPhrases: banned,
      styleBrief: row.style_brief,
      examples: selectExamples.all().map((e) => ({ id: e.id, text: e.text, createdAt: e.created_at })),
    };
  }

  const columns: Record<Exclude<keyof VoicePatch, 'bannedPhrases'>, string> = {
    casualPolished: 'casual_polished',
    dryPlayful: 'dry_playful',
    technicalAccessible: 'technical_accessible',
    emoji: 'emoji',
    profanity: 'profanity',
    styleBrief: 'style_brief',
  };

  return {
    get,
    /** Updates only the fields in `patch`, in one statement. */
    save(patch: VoicePatch): VoiceProfile {
      const sets: string[] = [];
      const values: (string | number)[] = [];
      for (const [key, value] of Object.entries(patch) as [keyof VoicePatch, unknown][]) {
        if (value === undefined) continue;
        if (key === 'bannedPhrases') {
          const unique = [...new Set((value as string[]).map((p) => p.trim()).filter(Boolean))].slice(0, VOICE_LIMITS.bannedPhrases);
          sets.push('banned_phrases = ?');
          values.push(JSON.stringify(unique));
        } else {
          sets.push(`${columns[key]} = ?`);
          values.push(value as string | number);
        }
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE voice_profile SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`).run(...values, now().toISOString());
      }
      return get();
    },
    addExample(text: string): VoiceProfile {
      db.transaction(() => {
        if ((countExamples.get()?.n ?? 0) >= VOICE_LIMITS.examples) {
          throw new IpcError('voice_examples_full', aiCopy.errors.voice_examples_full);
        }
        insertExample.run(randomUUID(), text.trim(), now().toISOString());
      })();
      return get();
    },
    removeExample(id: string): VoiceProfile {
      deleteExample.run(id);
      return get();
    },
  };
}
