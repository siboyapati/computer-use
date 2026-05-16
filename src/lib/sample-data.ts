import type { Resume } from "./agent/types";

/**
 * Pre-parsed résumé JSON matching `public/sample-resume.pdf`.
 *
 * Shipping both the PDF and the parsed JSON lets the "Try with sample"
 * button skip the Anthropic parse call entirely — saving ~3 sec and ~$0.001
 * per demo click, plus guaranteeing the JSON shape is exactly what the
 * agent expects.
 *
 * Regenerate the PDF with `node scripts/gen-sample-pdf.mjs`.
 */
export const SAMPLE_RESUME: Resume = {
  personal: {
    fullName: "Alex Chen",
    firstName: "Alex",
    lastName: "Chen",
    email: "alex.chen+autoapply@example.com",
    phone: "+1 415 555 0142",
    location: "San Francisco, CA",
    linkedin: "https://www.linkedin.com/in/alex-chen",
    github: "https://github.com/alexchen",
    website: "https://alexchen.dev",
  },
  headline: "Senior Software Engineer",
  summary:
    "Eight years building developer infrastructure, billing systems, and production LLM-serving stacks at high-scale companies.",
  experience: [
    {
      company: "Stripe",
      title: "Senior Engineer",
      startDate: "Jan 2022",
      endDate: "Present",
      location: "San Francisco, CA",
      description:
        "Lead engineer on billing pipelines processing $40B/yr in volume. Drove migration from monolith to event-driven services on Kubernetes.",
    },
    {
      company: "Anthropic",
      title: "Software Engineer",
      startDate: "Aug 2020",
      endDate: "Dec 2021",
      location: "San Francisco, CA",
      description:
        "Worked on production LLM serving infrastructure and the eval harness used to gate every model release.",
    },
  ],
  education: [
    {
      school: "Carnegie Mellon University",
      degree: "B.S.",
      field: "Computer Science",
      startDate: "Aug 2016",
      endDate: "May 2020",
    },
  ],
  skills: [
    "Go",
    "Python",
    "TypeScript",
    "Kubernetes",
    "gRPC",
    "React",
    "Postgres",
    "Terraform",
    "Distributed systems",
  ],
  projects: [],
  certifications: [],
};

export const SAMPLE_PDF_URL = "/sample-resume.pdf";
export const SAMPLE_FILE_NAME = "alex-chen-sample.pdf";

/**
 * Fetch the sample PDF and return it as base64. Done client-side so the
 * server stays stateless.
 */
export async function loadSamplePdfBase64(): Promise<string> {
  const res = await fetch(SAMPLE_PDF_URL);
  if (!res.ok) throw new Error(`Sample PDF unavailable (${res.status})`);
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // Use binary string + btoa — the chunking guards against argument-length
  // limits on `String.fromCharCode(...largeArray)` in some browsers.
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
