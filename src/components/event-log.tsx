"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Check,
  AlertTriangle,
  Upload,
  Eye,
  MousePointerClick,
  Globe2,
  Search,
  Sparkles,
  Pause,
  Square,
} from "lucide-react";
import type { AgentEvent, AgentEventKind } from "@/lib/agent/types";

interface Props {
  events: AgentEvent[];
}

export function EventLog({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events]);

  return (
    <div
      ref={scrollRef}
      className="scrollbar-thin h-full overflow-y-auto px-1 py-1"
    >
      <ul className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </AnimatePresence>
        {events.length === 0 && (
          <li className="px-3 py-6 font-mono text-xs text-muted-foreground/70">
            Awaiting agent…
          </li>
        )}
      </ul>
    </div>
  );
}

function EventRow({ event }: { event: AgentEvent }) {
  const cfg = STYLES[event.kind];
  const confidence = confidenceForEvent(event);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={`group flex items-start gap-2.5 rounded-md px-3 py-1.5 font-mono text-[12.5px] leading-relaxed hover:bg-accent/40 ${confidenceRowClass(confidence)}`}
    >
      <span className={`mt-[3px] shrink-0 ${cfg.color}`}>{cfg.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-foreground/95">
          <span className={`mr-2 text-[10px] uppercase tracking-[0.16em] ${cfg.color}`}>
            {cfg.label}
          </span>
          {event.message}
          {confidence === "low" && (
            <span className="ml-2 rounded-full border border-amber-400/40 bg-amber-100 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              review
            </span>
          )}
          {confidence === "medium" && (
            <span className="ml-2 rounded-full border border-sky-400/35 bg-sky-100 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
              check
            </span>
          )}
        </div>
        {typeof event.data?.value === "string" && event.data.value && (
          <div className="mt-0.5 truncate text-muted-foreground/70">
            ↳ {event.data.value as string}
          </div>
        )}
      </div>
      <span className="mt-1 shrink-0 text-[10px] text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100">
        {formatTime(event.ts)}
      </span>
    </motion.li>
  );
}

function confidenceForEvent(event: AgentEvent): "low" | "medium" | null {
  if (event.kind !== "field_filled") return null;
  const confidence = event.data?.confidence;
  if (confidence === "low" || confidence === "medium") return confidence;
  return null;
}

function confidenceRowClass(confidence: "low" | "medium" | null): string {
  if (confidence === "low") {
    return "border-l-2 border-amber-400 bg-amber-50/70 dark:bg-amber-500/[0.06]";
  }
  if (confidence === "medium") {
    return "border-l-2 border-sky-400 bg-sky-50/70 dark:bg-sky-500/[0.06]";
  }
  return "";
}

// Per-event-kind icon + label + colored chip. The color is split across
// light/dark themes via `dark:` variants so the labels stay readable on
// both white (light theme default) and the warm dark surface.
const STYLES: Record<AgentEventKind, { icon: React.ReactNode; label: string; color: string }> = {
  started:         { icon: <Sparkles className="size-3" />,         label: "init",   color: "text-primary" },
  navigated:       { icon: <Globe2 className="size-3" />,           label: "nav",    color: "text-sky-700 dark:text-sky-300" },
  form_extracted:  { icon: <Search className="size-3" />,           label: "read",   color: "text-violet-700 dark:text-violet-300" },
  field_filled:    { icon: <Check className="size-3" />,            label: "fill",   color: "text-emerald-700 dark:text-emerald-300" },
  file_uploaded:   { icon: <Upload className="size-3" />,           label: "upload", color: "text-emerald-700 dark:text-emerald-300" },
  awaiting_review: { icon: <Pause className="size-3" />,            label: "pause",  color: "text-amber-700 dark:text-amber-300" },
  submitting:      { icon: <MousePointerClick className="size-3" />, label: "submit", color: "text-primary" },
  submitted:       { icon: <Check className="size-3" />,            label: "done",   color: "text-primary" },
  screenshot:      { icon: <Eye className="size-3" />,              label: "shot",   color: "text-muted-foreground" },
  stopped:         { icon: <Square className="size-3" />,           label: "stop",   color: "text-muted-foreground" },
  error:           { icon: <AlertTriangle className="size-3" />,    label: "err",    color: "text-destructive" },
  completed:       { icon: <Check className="size-3" />,            label: "done",   color: "text-primary" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
