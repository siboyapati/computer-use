"use client";

import { motion } from "motion/react";
import { Briefcase, GraduationCap, Mail, MapPin, Phone, Globe, Link2 } from "lucide-react";
import type { Resume } from "@/lib/agent/types";

interface Props {
  resume: Resume;
}

export function ResumeCard({ resume }: Props) {
  const p = resume.personal;
  return (
    <motion.div
      layoutId="resume-card"
      className="glass relative overflow-hidden rounded-3xl p-6"
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="font-display text-3xl text-foreground">{p.fullName}</div>
          {resume.headline && (
            <div className="mt-1 text-sm text-muted-foreground">{resume.headline}</div>
          )}
        </div>
        <div className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
          Parsed
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        {p.email && <Row icon={<Mail className="size-3.5" />}>{p.email}</Row>}
        {p.phone && <Row icon={<Phone className="size-3.5" />}>{p.phone}</Row>}
        {p.location && <Row icon={<MapPin className="size-3.5" />}>{p.location}</Row>}
        {p.linkedin && <Row icon={<Link2 className="size-3.5" />}>{shortUrl(p.linkedin)}</Row>}
        {p.github && <Row icon={<Link2 className="size-3.5" />}>{shortUrl(p.github)}</Row>}
        {p.website && <Row icon={<Globe className="size-3.5" />}>{shortUrl(p.website)}</Row>}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Section icon={<Briefcase className="size-3.5" />} title="Experience">
          {resume.experience.slice(0, 3).map((exp, i) => (
            <div key={i} className="text-sm">
              <div className="text-foreground">{exp.title}</div>
              <div className="text-muted-foreground">
                {exp.company}
                {exp.endDate && ` · ${exp.startDate || ""} – ${exp.endDate}`}
              </div>
            </div>
          ))}
        </Section>
        <Section icon={<GraduationCap className="size-3.5" />} title="Education">
          {resume.education.slice(0, 2).map((ed, i) => (
            <div key={i} className="text-sm">
              <div className="text-foreground">{ed.school}</div>
              <div className="text-muted-foreground">
                {[ed.degree, ed.field].filter(Boolean).join(", ")}
              </div>
            </div>
          ))}
        </Section>
      </div>

      {resume.skills.length > 0 && (
        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Skills</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {resume.skills.slice(0, 12).map((s) => (
              <span
                key={s}
                className="rounded-full border border-border bg-card/40 px-2.5 py-0.5 text-xs text-foreground/80"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 truncate text-muted-foreground">
      <span className="text-foreground/50">{icon}</span>
      <span className="truncate text-foreground/85">{children}</span>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{icon}</span>
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function shortUrl(u: string): string {
  return u.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
