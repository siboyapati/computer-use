# Feature — Résumé Parser

## What

User drops a PDF résumé on the landing page. The server forwards the bytes to Anthropic's PDF input API, asks Claude Haiku 4.5 (via `tool_use` with a strict JSON tool) to extract the résumé, and returns a strongly-typed `Resume` object plus the original PDF base64.

## Why

The agent needs a **single source of truth** for the candidate's data. Without structured JSON:

- Every form field would require re-reading the résumé from scratch → slow, expensive, inconsistent.
- Deterministic mappings (name, email, phone, LinkedIn) would be impossible — we'd be at the mercy of Claude's vision for every fill.
- The user couldn't see what got extracted → no transparency.

With structured JSON:

- The agent has a stable schema it can look up O(1).
- We can show the user a **glassy parsed-résumé card** on the Confirm screen — the moment of trust.
- The same JSON can be persisted to `localStorage`, re-used across runs, and handed to the Chrome extension via the pairing handshake.

### Why Anthropic PDF input (not pypdf / pdf-parse / a local model)

- **One API call.** PDF goes in, JSON comes out. No multi-stage pipeline.
- **Strict JSON via `tool_use`.** No regex hacking, no LLM hallucinations of stray prose around the JSON. The tool's `input_schema` is the contract.
- **Quality.** Claude reads the PDF natively (including images, tables, multi-column layouts). A 7B local quantized model would regress significantly on structured extraction.
- **Cost.** ~$0.001 per résumé on Haiku 4.5. Negligible.
- **PII.** Anthropic offers zero-retention for paying customers. We don't store the PDF or the parsed JSON server-side at all — it round-trips back to the client.

## How

### Files

- [src/lib/agent/resume-parser.ts](../../src/lib/agent/resume-parser.ts) — the Anthropic call + Zod validation.
- [src/lib/agent/types.ts](../../src/lib/agent/types.ts) — the `ResumeSchema` Zod definition.
- [src/app/api/parse-resume/route.ts](../../src/app/api/parse-resume/route.ts) — the HTTP endpoint.
- [src/components/landing.tsx](../../src/components/landing.tsx) — the drop-zone UI that calls the endpoint.

### Data shape

`ResumeSchema` (Zod):

```ts
{
  personal: {
    fullName, firstName, lastName, email, phone,
    location, linkedin, github, website
  },
  headline: string,
  summary: string,
  experience: Array<{ company, title, startDate, endDate, location, description }>,
  education: Array<{ school, degree, field, startDate, endDate }>,
  skills: string[],
  projects: Array<{ name, description, url }>,
  certifications: string[],
}
```

All string fields default to `""`, arrays default to `[]`. The `personal.email` field uses `z.string().email().or(z.literal(""))` so blank-but-valid passes.

### The Claude tool definition

```ts
const TOOL = {
  name: "save_resume",
  description: "Save the structured representation of the candidate's resume...",
  input_schema: {
    type: "object",
    properties: { /* mirrors ResumeSchema */ },
    required: ["personal"],
  },
};

await anthropic.messages.create({
  model: "claude-haiku-4-5",
  max_tokens: 4096,
  tools: [TOOL],
  tool_choice: { type: "tool", name: "save_resume" },  // force tool use
  messages: [{
    role: "user",
    content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
      { type: "text", text: "Extract this résumé into the save_resume tool. Be faithful — don't invent fields. Use 'MMM YYYY' for dates, empty strings for unknowns." },
    ],
  }],
});
```

### Code path

```text
Landing.handleFile(file)
  → FormData with the PDF
  → POST /api/parse-resume (multipart)
      → parse-resume/route.ts
        → reject if size > 5 MB or type isn't PDF
        → parseResumeFromPdf(buf)
            → anthropic.messages.create(...) with PDF as document content block
            → response.content.find(b => b.type === "tool_use")
            → ResumeSchema.parse(toolUse.input)   // throws if structure off
        → return { resume, pdfBase64 } (PDF round-trips back)
  ← client: dispatch PARSED, write to localStorage via saveResume()
  ← phase = "confirm"
```

Time: 3–7 seconds for a typical 1–2 page résumé.

### Why we return the PDF base64 to the client

The agent needs to **re-upload the PDF** to the ATS later via `setInputFiles`. The server is stateless (no DB), so we can't store the file. Instead the client holds onto the base64 and sends it back with `/api/start`. This keeps the architecture single-process.

Cost: ~7 MB of network on a 5 MB PDF, twice (parse + start). Acceptable for one user.

## Gotchas

- **5 MB file limit** is enforced at the API route. Larger files trip Anthropic's PDF input limit anyway. We surface a clear 400 error.
- **Anthropic PDF input only works with Anthropic.** Even when the user toggles the agent to Gemini, résumé parsing still uses Claude. The toggle controls the *agent*, not the parser. See [model-toggle.md](./model-toggle.md).
- **Zod validation can fail** if the model returns weird shapes. We bubble the Zod error to the client with `toast.error("Couldn't parse résumé into our schema")`. In practice this is rare on Haiku 4.5 with `tool_choice` forcing the tool.
- **No retry on Anthropic errors.** Single attempt. The user re-drops the file.
- **No résumé editing UI.** The parsed JSON is what we run with. If the user wants to fix a field, they need to edit the PDF and re-upload. (A future "edit before applying" pass is in the deferred list.)
- **PDF base64 in `localStorage`.** ~7 MB encoded. Borderline for the 5 MB-ish realistic localStorage quota (the spec allows 5–10 MB depending on browser). [storage.ts](../../src/lib/storage.ts) silently skips persistence if the PDF exceeds 6 MB encoded — the session still works, just no refresh-survival.

## Verification

1. Start the web app (`npm run dev`).
2. Drop a real PDF résumé on the landing page.
3. Wait ~5 seconds.
4. The Confirm screen should appear with:
   - Your name in the parsed-résumé card.
   - Email + phone visible (if your résumé has them).
   - At least your most recent experience role listed.
   - Skills chips below the experience section.
5. Open the Network panel and inspect the `/api/parse-resume` response — it should be `{ resume: {...}, pdfBase64: "..." }`.

If the card is empty: check the dev server console for a Zod error or Anthropic API error.

## Cost (typical)

- ~$0.001 per résumé on Haiku 4.5.
- No other costs per call.

## Failure modes

| Failure | What happens | Mitigation |
|---|---|---|
| Anthropic API key missing | Server throws on first request | Set `ANTHROPIC_API_KEY` in `.env.local` |
| PDF > 5 MB | 400 returned immediately | Shrink the PDF |
| Non-PDF file | 400 returned | Use PDF only |
| Anthropic rate-limited | 500 returned | Retry manually |
| Tool didn't return JSON | 500 with "Anthropic did not return a tool_use block" | Re-upload; Haiku is usually deterministic on this path |
