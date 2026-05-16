"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  AlertCircle,
  Loader2,
  Settings as SettingsIcon,
  ExternalLink,
  Eye,
  EyeOff,
  Trash2,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  loadKeys,
  saveKeys,
  clearKeys,
  maskKey,
  type StoredKeys,
} from "@/lib/keys";
import { normalizeQuestion } from "@/lib/agent/profile-types";

type Provider = "anthropic" | "google" | "steel";

interface ProviderMeta {
  id: Provider;
  label: string;
  description: string;
  hint: string;
  placeholder: string;
  console: string;
  required: boolean;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    description:
      "Required. Drives résumé parsing, custom-question answers, and the Claude agent (if selected).",
    hint: "Looks like sk-ant-…",
    placeholder: "sk-ant-…",
    console: "https://console.anthropic.com",
    required: true,
  },
  {
    id: "steel",
    label: "Steel.dev",
    description: "Required. Provisions the cloud Chromium session that the agent drives.",
    hint: "Looks like ste_…",
    placeholder: "ste_…",
    console: "https://app.steel.dev",
    required: true,
  },
  {
    id: "google",
    label: "Google Gemini",
    description:
      "Optional. Only required if you pick the Gemini agent on the Confirm screen instead of Claude.",
    hint: "Looks like AIza… or a custom key",
    placeholder: "AIza…",
    console: "https://aistudio.google.com/app/apikey",
    required: false,
  },
];

export default function SettingsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [keys, setKeys] = useState<StoredKeys>({});

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setKeys(loadKeys());
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSave(updated: StoredKeys) {
    saveKeys(updated);
    setKeys(updated);
    toast.success("Settings saved");
  }

  function handleClear() {
    clearKeys();
    setKeys({});
    toast.message("Cleared all keys", {
      description: "The server's env-var keys will be used instead.",
    });
  }

  return (
    <main className="relative flex min-h-screen flex-col">
      <Header />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 28 }}
        className="mx-auto w-full max-w-2xl px-6 pt-24 pb-16"
      >
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <SettingsIcon className="size-3 text-primary" />
          Settings
        </div>

        <h1 className="font-display text-4xl font-light leading-tight text-foreground md:text-5xl">
          Settings
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Bring your own keys and keep reusable answers for repeated application
          questions. Everything here stays in this browser.
        </p>

        {!hydrated ? (
          <div className="mt-10 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="mt-10 flex flex-col gap-4">
            {PROVIDERS.map((p) => (
              <KeyCard
                key={p.id}
                meta={p}
                value={keys[p.id] ?? ""}
                onChange={(v) => handleSave({ ...keys, [p.id]: v })}
              />
            ))}

            <ProfileSection />

            <div className="mt-4 flex items-center justify-between">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <ArrowLeft className="size-3" />
                Back to dashboard
              </Link>
              {Object.keys(keys).filter((k) => keys[k as Provider]).length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/[0.06] px-3 py-1.5 text-xs text-destructive transition hover:bg-destructive/10"
                >
                  <Trash2 className="size-3" />
                  Forget all keys
                </button>
              )}
            </div>
            <SecurityNote />
          </div>
        )}
      </motion.div>
    </main>
  );
}

function Header() {
  return (
    <div className="pointer-events-none fixed left-6 top-5 z-30">
      <Link
        href="/"
        className="pointer-events-auto inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.28em] text-foreground/85"
      >
        <span className="font-display lowercase italic tracking-normal text-base">a/a</span>
        <span className="hidden text-foreground/60 sm:inline">AutoApply</span>
      </Link>
    </div>
  );
}

interface KeyCardProps {
  meta: ProviderMeta;
  value: string;
  onChange: (next: string) => void;
}

function KeyCard({ meta, value, onChange }: KeyCardProps) {
  const [draft, setDraft] = useState(value);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDraft(value);
      setResult(null);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const dirty = draft !== value;
  const hasKey = Boolean(value);

  async function handleTest() {
    if (!draft.trim()) {
      setResult({ ok: false, message: "Enter a key first." });
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/test-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: meta.id, key: draft.trim() }),
      });
      const body = (await res.json()) as { ok: boolean; info?: string; error?: string };
      if (body.ok) {
        setResult({ ok: true, message: body.info ?? "Key works." });
      } else {
        setResult({ ok: false, message: body.error ?? "Test failed." });
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Couldn't reach the test endpoint." });
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    onChange(draft.trim());
  }

  function handleClearThis() {
    setDraft("");
    onChange("");
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <Label className="text-base font-medium text-foreground">{meta.label}</Label>
            {meta.required && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-primary">
                Required
              </span>
            )}
            {!meta.required && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Optional
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <a
          href={meta.console}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Get key <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={meta.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="h-11 pr-10 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={show ? "Hide key" : "Show key"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="h-11 px-4"
          onClick={handleTest}
          disabled={testing || !draft.trim()}
        >
          {testing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Testing…
            </>
          ) : (
            "Test"
          )}
        </Button>
        <Button
          type="button"
          className="h-11 px-4"
          onClick={handleSave}
          disabled={!dirty}
        >
          Save
        </Button>
      </div>

      {hasKey && !dirty && (
        <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">Saved: {maskKey(value)}</span>
          <span className="text-muted-foreground/40">·</span>
          <button
            type="button"
            onClick={handleClearThis}
            className="inline-flex items-center gap-1 text-muted-foreground/70 transition hover:text-destructive"
          >
            <Trash2 className="size-3" />
            Clear
          </button>
        </div>
      )}

      {result && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
            result.ok
              ? "border border-primary/30 bg-primary/[0.06] text-foreground"
              : "border border-destructive/30 bg-destructive/[0.06] text-destructive"
          }`}
        >
          {result.ok ? (
            <Check className="mt-px size-3.5 shrink-0 text-primary" />
          ) : (
            <AlertCircle className="mt-px size-3.5 shrink-0" />
          )}
          <span className="leading-relaxed">{result.message}</span>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/70">{meta.hint}</p>
    </div>
  );
}

function SecurityNote() {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">Where your data lives:</span> Saved
      to <code className="rounded bg-card px-1 py-0.5 font-mono text-[11px]">localStorage</code> in
      this browser only — keys, profile extras, and learned answers all stay client-side. Each run
      sends them to the server in the request body; the server uses them for the duration of the
      call and discards them. We don&apos;t log keys, don&apos;t store them in any database, and
      don&apos;t share them with third parties beyond the provider you pointed each key at. If you
      don&apos;t configure a key here, the server falls back to its
      own <code className="rounded bg-card px-1 py-0.5 font-mono text-[11px]">.env.local</code>{" "}
      values.
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Profile section — manages ProfileExtras (structured fields that ATSes
// commonly ask but aren't in the standard résumé schema) + a list of
// learnedAnswers the user has saved on previous runs.
// ──────────────────────────────────────────────────────────────────────────

interface ExtrasField {
  id: keyof import("@/lib/agent/profile-types").ProfileExtras;
  label: string;
  placeholder: string;
  type: "text" | "number" | "select" | "boolean";
  options?: string[];
  hint?: string;
}

const EXTRAS_FIELDS: ExtrasField[] = [
  {
    id: "workAuthorization",
    label: "Work authorization",
    placeholder: "Yes, US citizen",
    type: "text",
    hint: "Free-form. Used when forms ask 'Are you authorized to work in the US?'",
  },
  {
    id: "requiresSponsorship",
    label: "Requires visa sponsorship?",
    placeholder: "",
    type: "select",
    options: ["", "no", "yes", "later"],
  },
  {
    id: "salaryMin",
    label: "Salary minimum",
    placeholder: "180000",
    type: "number",
    hint: "Numeric. Currency below.",
  },
  {
    id: "salaryMax",
    label: "Salary maximum",
    placeholder: "240000",
    type: "number",
  },
  {
    id: "salaryCurrency",
    label: "Currency",
    placeholder: "USD",
    type: "text",
  },
  {
    id: "earliestStartDate",
    label: "Earliest start date",
    placeholder: "2 weeks",
    type: "text",
    hint: "ISO date or free-form ('Immediately', '2 weeks').",
  },
  {
    id: "noticePeriodDays",
    label: "Notice period (days)",
    placeholder: "14",
    type: "number",
  },
  {
    id: "willingToRelocate",
    label: "Willing to relocate?",
    placeholder: "",
    type: "boolean",
  },
  {
    id: "yearsExperience",
    label: "Total years of experience",
    placeholder: "8",
    type: "number",
  },
  {
    id: "howDidYouHear",
    label: "How did you hear about us?",
    placeholder: "LinkedIn / Referral / Job board",
    type: "text",
  },
  {
    id: "referredBy",
    label: "Referred by",
    placeholder: "",
    type: "text",
  },
];

const COMMON_QUESTIONS = [
  {
    question: "Why are you interested in this role?",
    placeholder: "A reusable, truthful answer you are comfortable sending.",
  },
  {
    question: "Are you authorized to work in the United States?",
    placeholder: "Yes, I am authorized to work in the United States.",
  },
  {
    question: "Will you now or in the future require sponsorship?",
    placeholder: "No, I do not require sponsorship.",
  },
  {
    question: "What are your salary expectations?",
    placeholder: "Open to discussing a fair range based on scope and total compensation.",
  },
  {
    question: "When can you start?",
    placeholder: "I can start after two weeks' notice.",
  },
  {
    question: "How did you hear about us?",
    placeholder: "Company careers page, LinkedIn, referral, etc.",
  },
];

function ProfileSection() {
  const [profile, setProfile] = useState<
    import("@/lib/profile").UserProfile | null
  >(null);
  const [customQuestion, setCustomQuestion] = useState("");
  const [customAnswer, setCustomAnswer] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { loadProfile } = await import("@/lib/profile");
      if (!cancelled) setProfile(loadProfile());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePatch(
    patch: Partial<import("@/lib/agent/profile-types").ProfileExtras>,
  ) {
    const { patchExtras } = await import("@/lib/profile");
    const next = patchExtras(patch);
    setProfile(next);
  }

  async function handleForget(key: string) {
    const { forgetAnswer } = await import("@/lib/profile");
    const next = forgetAnswer(key);
    setProfile(next);
    toast.message("Answer forgotten");
  }

  async function handleSaveAnswer(question: string, answer: string) {
    const { saveAnswer } = await import("@/lib/profile");
    const next = saveAnswer(question, answer);
    setProfile(next);
    toast.success(answer.trim() ? "Saved answer" : "Cleared answer");
  }

  async function handleAddCustom() {
    if (!customQuestion.trim() || !customAnswer.trim()) return;
    await handleSaveAnswer(customQuestion, customAnswer);
    setCustomQuestion("");
    setCustomAnswer("");
  }

  if (profile === null) {
    return null;
  }

  const commonKeys = new Set(COMMON_QUESTIONS.map((item) => normalizeQuestion(item.question)));
  const learnedEntries = Object.entries(profile.learnedAnswers)
    .filter(([key]) => !commonKeys.has(key))
    .sort((a, b) => (b[1].lastUsedAt ?? 0) - (a[1].lastUsedAt ?? 0));

  return (
    <>
      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-medium text-foreground">
              Profile extras
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              Pre-populate common ATS fields once. The agent uses these before
              calling the LLM — zero tokens per match.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EXTRAS_FIELDS.map((f) => (
            <ExtrasInput
              key={f.id}
              field={f}
              value={profile.extras[f.id]}
              onChange={(v) =>
                void handlePatch({
                  [f.id]: v === "" ? undefined : v,
                } as Partial<
                  import("@/lib/agent/profile-types").ProfileExtras
                >)
              }
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div>
          <Label className="text-base font-medium text-foreground">
            Saved Answer Library
          </Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable Q&amp;A for repeated application questions. The agent checks
            these before asking the model, including close wording variants like
            &quot;Why this job?&quot; and &quot;What interests you?&quot;.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {COMMON_QUESTIONS.map((item) => {
            const key = normalizeQuestion(item.question);
            return (
              <AnswerEditor
                key={key}
                question={item.question}
                value={profile.learnedAnswers[key]?.answer ?? ""}
                placeholder={item.placeholder}
                onSave={(answer) => void handleSaveAnswer(item.question, answer)}
                onForget={() => void handleForget(key)}
              />
            );
          })}
        </div>

        <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3">
          <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Add custom question
          </Label>
          <Input
            value={customQuestion}
            onChange={(e) => setCustomQuestion(e.target.value)}
            placeholder="Question label to match"
            className="mt-2 h-9 text-sm"
          />
          <textarea
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            placeholder="Answer to reuse"
            className="mt-2 min-h-20 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleAddCustom()}
              disabled={!customQuestion.trim() || !customAnswer.trim()}
            >
              Save custom answer
            </Button>
          </div>
        </div>

        {learnedEntries.length > 0 && (
          <div className="mt-5">
            <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              Other saved answers
            </Label>
            <div className="mt-2 flex flex-col gap-3">
              {learnedEntries.map(([key, entry]) => (
                <AnswerEditor
                  key={key}
                  question={entry.lastLabel ?? key}
                  value={entry.answer}
                  placeholder="Reusable answer"
                  meta={`Used ${entry.timesUsed ?? 0}x · last ${timeAgo(entry.lastUsedAt)}`}
                  onSave={(answer) => void handleSaveAnswer(entry.lastLabel ?? key, answer)}
                  onForget={() => void handleForget(key)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function AnswerEditor({
  question,
  value,
  placeholder,
  meta,
  onSave,
  onForget,
}: {
  question: string;
  value: string;
  placeholder: string;
  meta?: string;
  onSave: (answer: string) => void;
  onForget: () => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDraft(value);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const dirty = draft !== value;
  const hasValue = Boolean(value.trim());

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="text-sm font-medium text-foreground">{question}</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className="mt-2 min-h-20 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground/70">
          {meta ?? (hasValue ? "Saved and ready to reuse" : "Not saved yet")}
        </div>
        <div className="flex gap-2">
          {hasValue && (
            <Button type="button" size="sm" variant="ghost" onClick={onForget}>
              Clear
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => onSave(draft)}
            disabled={!dirty}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExtrasInput({
  field,
  value,
  onChange,
}: {
  field: ExtrasField;
  value: unknown;
  onChange: (
    v:
      | string
      | number
      | boolean
      | undefined
      | "yes"
      | "no"
      | "later",
  ) => void;
}) {
  const stringValue =
    value === undefined || value === null ? "" : String(value);

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {field.label}
      </Label>
      {field.type === "select" && field.options ? (
        <select
          value={stringValue}
          onChange={(e) => onChange(e.target.value as "yes" | "no" | "later" | "")}
          className="mt-1.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground"
        >
          {field.options.map((opt) => (
            <option key={opt || "_blank"} value={opt}>
              {opt || "—"}
            </option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <select
          value={stringValue === "" ? "" : stringValue === "true" ? "true" : "false"}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : v === "true");
          }}
          className="mt-1.5 h-9 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <Input
          type={field.type === "number" ? "number" : "text"}
          value={stringValue}
          placeholder={field.placeholder}
          inputMode={field.type === "number" ? "numeric" : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(undefined);
            if (field.type === "number") {
              const n = Number(raw);
              onChange(Number.isFinite(n) ? n : undefined);
            } else {
              onChange(raw);
            }
          }}
          className="mt-1.5 h-9 text-sm"
        />
      )}
      {field.hint && (
        <p className="mt-1 text-[11px] text-muted-foreground/70">{field.hint}</p>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
