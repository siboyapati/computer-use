"use client";

import { motion } from "motion/react";
import { Check, X, Pause } from "lucide-react";
import Image from "next/image";
import type { HistoryItem } from "@/lib/storage";

interface Props {
  items: HistoryItem[];
}

export function RunHistoryStrip({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2 }}
      className="mx-auto mt-16 w-full max-w-3xl px-6"
    >
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Recent applications</span>
        <span className="text-muted-foreground/50">{items.length}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((item) => (
          <HistoryCard key={item.runId} item={item} />
        ))}
      </div>
    </motion.div>
  );
}

function HistoryCard({ item }: { item: HistoryItem }) {
  const tone =
    item.status === "submitted"
      ? "border-primary/30 hover:border-primary/60"
      : "border-border hover:border-muted-foreground/50";
  return (
    <a
      href={item.jobUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`glass group block flex-shrink-0 rounded-2xl border ${tone} transition`}
      style={{ width: 180 }}
    >
      <div className="relative h-20 overflow-hidden rounded-t-2xl bg-muted">
        {item.screenshotUrl ? (
          <Image
            src={item.screenshotUrl}
            alt="Submission preview"
            width={360}
            height={160}
            unoptimized
            className="h-full w-full object-cover object-top opacity-95 transition group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground/50">
            <span className="font-mono text-[10px] uppercase tracking-widest">no shot</span>
          </div>
        )}
        <StatusBadge status={item.status} />
      </div>
      <div className="px-3 py-2">
        <div className="truncate text-sm font-medium text-foreground">
          {item.company ?? hostnameOf(item.jobUrl)}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="uppercase tracking-[0.12em]">{item.ats}</span>
          <span>{relativeTime(item.finishedAt)}</span>
        </div>
      </div>
    </a>
  );
}

function StatusBadge({ status }: { status: HistoryItem["status"] }) {
  const icons = {
    submitted: <Check className="size-2.5" />,
    failed: <X className="size-2.5" />,
    stopped: <Pause className="size-2.5" />,
  };
  const tone = {
    submitted: "bg-primary text-primary-foreground",
    failed: "bg-destructive/80 text-white",
    stopped: "bg-muted text-foreground/70",
  };
  return (
    <span
      className={`absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full ${tone[status]}`}
    >
      {icons[status]}
    </span>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
