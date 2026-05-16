// Generate a tiny but valid sample-résumé PDF for the "Try with sample"
// button. No deps — writes raw PDF bytes with computed xref offsets.
// Run once: `node scripts/gen-sample-pdf.mjs`. Output: public/sample-resume.pdf.

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// PDF content stream — a few lines of text using built-in Helvetica.
// Coordinates: origin is bottom-left of the page. 612×792 = US Letter.
const lines = [
  ["Alex Chen", 28, 720],
  ["Senior Software Engineer · San Francisco, CA", 14, 696],
  ["alex.chen@example.com  |  +1 415 555 0142", 11, 676],
  ["", 11, 660],
  ["Experience", 14, 644],
  ["Senior Engineer, Stripe (2022 - Present)", 11, 624],
  ["  · Built billing pipelines processing $40B/yr in volume.", 11, 608],
  ["  · Led migration from monolith to event-driven services.", 11, 592],
  ["Software Engineer, Anthropic (2020 - 2022)", 11, 572],
  ["  · Worked on production LLM serving + eval harness.", 11, 556],
  ["", 11, 540],
  ["Education", 14, 524],
  ["B.S. Computer Science, Carnegie Mellon University, 2020", 11, 504],
  ["", 11, 488],
  ["Skills", 14, 472],
  ["Go · Python · TypeScript · Kubernetes · gRPC · React · Postgres", 11, 452],
];

function escapePdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const tj = lines
  .map(([text, size, y]) =>
    `BT /F1 ${size} Tf 72 ${y} Td (${escapePdf(text)}) Tj ET`,
  )
  .join("\n");

const stream = tj + "\n";
const contentStream = `<< /Length ${stream.length} >>\nstream\n${stream}endstream\n`;

// Object table — each object string followed by its byte length.
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  contentStream.trim(),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];

// Assemble PDF and track byte offsets for xref.
const header = "%PDF-1.4\n%\xff\xff\xff\xff\n";
const buf = [Buffer.from(header, "binary")];
const offsets = [];
let pos = Buffer.byteLength(header, "binary");

for (let i = 0; i < objects.length; i++) {
  offsets.push(pos);
  const obj = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  buf.push(Buffer.from(obj, "binary"));
  pos += Buffer.byteLength(obj, "binary");
}

const xrefStart = pos;
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) xref += `${off.toString().padStart(10, "0")} 00000 n \n`;
xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
buf.push(Buffer.from(xref, "binary"));

const pdf = Buffer.concat(buf);

await mkdir(join(ROOT, "public"), { recursive: true });
const outPath = join(ROOT, "public", "sample-resume.pdf");
await writeFile(outPath, pdf);

console.log(`✓ Wrote ${outPath} (${pdf.length} bytes)`);
