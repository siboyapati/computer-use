"use client";

/**
 * Client-side profile storage.
 *
 * Survives refresh via localStorage under `autoapply.profile.v1`. The
 * profile shape is shared with the server side via
 * `src/lib/agent/profile-types.ts` — that module exports the types and
 * the `normalizeQuestion` helper, no DOM access.
 *
 * Persistence is best-effort (localStorage can be blocked in private mode
 * or hit quota); failures are silent. The session still works without it.
 */

import {
  EMPTY_PROFILE,
  normalizeQuestion,
  type LearnedAnswer,
  type ProfileExtras,
  type UserProfile,
} from "./agent/profile-types";

const KEY = "autoapply.profile.v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadProfile(): UserProfile {
  if (!isBrowser()) return { ...EMPTY_PROFILE };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_PROFILE };
    const parsed = JSON.parse(raw) as UserProfile;
    // Defensive: missing properties fall back to defaults so older
    // schemas don't crash the UI.
    return {
      extras: parsed.extras ?? {},
      learnedAnswers: parsed.learnedAnswers ?? {},
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(profile: UserProfile): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...profile, updatedAt: Date.now() }),
    );
  } catch {
    // QuotaExceededError or private-mode block — silent
  }
}

export function clearProfile(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Patch the `extras` block, merging onto whatever's saved. */
export function patchExtras(patch: Partial<ProfileExtras>): UserProfile {
  const current = loadProfile();
  const next: UserProfile = {
    ...current,
    extras: { ...current.extras, ...patch },
  };
  // Drop keys whose patch value is `undefined` or empty string so the
  // caller can clear a field by patching it to "".
  for (const k of Object.keys(patch) as (keyof ProfileExtras)[]) {
    const v = patch[k];
    if (v === undefined || v === "") delete next.extras[k];
  }
  saveProfile(next);
  return next;
}

/**
 * Record an answer the user gave for a specific question label.
 *
 * The dictionary is keyed by the normalized form of the label, so
 * "Why are you interested in this role?" and the slightly-different
 * "Why are you interested in this role" map to the same key.
 */
export function recordAnswer(
  label: string,
  answer: string,
  fieldType?: string,
): UserProfile {
  if (!answer.trim()) return loadProfile();
  const key = normalizeQuestion(label);
  if (!key) return loadProfile();
  const current = loadProfile();
  const prior = current.learnedAnswers[key];
  const next: UserProfile = {
    ...current,
    learnedAnswers: {
      ...current.learnedAnswers,
      [key]: {
        answer: answer.trim(),
        fieldType: fieldType ?? prior?.fieldType,
        lastLabel: label,
        timesUsed: (prior?.timesUsed ?? 0) + 1,
        lastUsedAt: Date.now(),
      },
    },
  };
  saveProfile(next);
  return next;
}

/**
 * Save or update a reusable answer from Settings. Unlike `recordAnswer`,
 * this doesn't increment `timesUsed`; the agent will still report the saved
 * answer as reusable profile data when it fills a matching application field.
 */
export function saveAnswer(
  question: string,
  answer: string,
  fieldType = "textarea",
): UserProfile {
  const key = normalizeQuestion(question);
  const current = loadProfile();
  if (!key) return current;
  const learnedAnswers = { ...current.learnedAnswers };
  const trimmed = answer.trim();
  if (!trimmed) {
    delete learnedAnswers[key];
  } else {
    const prior = learnedAnswers[key];
    learnedAnswers[key] = {
      answer: trimmed,
      fieldType: prior?.fieldType ?? fieldType,
      lastLabel: question.trim(),
      timesUsed: prior?.timesUsed ?? 0,
      lastUsedAt: prior?.lastUsedAt ?? 0,
    };
  }
  const next: UserProfile = { ...current, learnedAnswers };
  saveProfile(next);
  return next;
}

/** Delete a single learned answer by its label (or its normalized key). */
export function forgetAnswer(labelOrKey: string): UserProfile {
  const key = normalizeQuestion(labelOrKey) || labelOrKey;
  const current = loadProfile();
  if (!(key in current.learnedAnswers)) return current;
  const learnedAnswers = { ...current.learnedAnswers };
  delete learnedAnswers[key];
  const next: UserProfile = { ...current, learnedAnswers };
  saveProfile(next);
  return next;
}

/**
 * Lookup helper used by the UI to preview what the agent WOULD fill into a
 * given label, based on extras + learnedAnswers. Returns undefined if
 * nothing in the profile matches.
 */
export function previewProfileAnswer(
  label: string,
  profile?: UserProfile,
): { value: string; source: "extras" | "learned" } | undefined {
  const p = profile ?? loadProfile();
  const key = normalizeQuestion(label);
  const learned = p.learnedAnswers[key];
  if (learned) return { value: learned.answer, source: "learned" };
  return undefined;
}

export type { UserProfile, ProfileExtras, LearnedAnswer };
