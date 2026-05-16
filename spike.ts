/**
 * W0 spike — verify Stagehand + Steel + form fill works end-to-end.
 *
 * Run:
 *   npm run spike -- "https://jobs.lever.co/<company>/<job-id>"
 *
 * Expected output: a Steel session viewer URL (open it in a browser tab to
 * watch the agent fill the form live), then a list of detected fields, then
 * a "DONE" line. The script does NOT submit — it stops just before the
 * Submit click so you can re-use the same posting safely.
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { createSession, releaseSession } from "./src/lib/agent/steel";
import { resolveAnthropic, resolveSteel } from "./src/lib/agent/keys";

const SAMPLE_RESUME = {
  fullName: "Alex Chen",
  firstName: "Alex",
  lastName: "Chen",
  email: "alex.chen+spike@example.com",
  phone: "+1 415 555 0142",
  location: "San Francisco, CA",
  linkedin: "https://www.linkedin.com/in/alex-chen",
};

async function main() {
  const jobUrl = process.argv[2];
  if (!jobUrl) {
    console.error("Usage: npm run spike -- <lever-job-url>");
    process.exit(1);
  }

  // Use the resolved keys to benefit from placeholder detection
  let anthropicKey: string;
  let steelKey: string;
  try {
    anthropicKey = resolveAnthropic();
    steelKey = resolveSteel();
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  console.log("→ Creating Steel session...");
  const session = await createSession(steelKey);
  console.log(`✓ Session ${session.id}`);
  console.log(`  Session Viewer: ${session.sessionViewerUrl}`);
  console.log(`  Debug URL (Public): ${session.debugUrl}`);
  console.log(`  ↑ Open the Debug URL in your browser to watch the agent work\n`);

  const model = process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5";

  // Small delay to let the cloud browser boot fully before CDP connection.
  await new Promise((r) => setTimeout(r, 2000));

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    disablePino: true,
    localBrowserLaunchOptions: { cdpUrl: session.websocketUrl },
    model: {
      modelName: `anthropic/${model}` as never,
      apiKey: anthropicKey,
    },
  });

  try {
    // Retry init once if it fails (handles transient 502s from Steel)
    try {
      await stagehand.init();
    } catch (err) {
      console.warn("→ Stagehand init failed, retrying once...");
      await new Promise((r) => setTimeout(r, 3000));
      await stagehand.init();
    }
    const page = stagehand.context.activePage();
    if (!page) throw new Error("No active page");

    console.log(`→ Navigating to ${jobUrl}`);
    await page.goto(jobUrl, { waitUntil: "load", timeoutMs: 30_000 });

    console.log(`→ Extracting form fields...`);
    const FieldsSchema = z.object({
      company: z.string(),
      fields: z.array(
        z.object({
          label: z.string(),
          type: z.string(),
          required: z.boolean().optional(),
        }),
      ),
    });
    const result = await stagehand.extract(
      "Extract the company name and every visible form field on this application page (text inputs, textareas, file uploads, dropdowns).",
      FieldsSchema,
    );
    console.log(`✓ ${result.company}: ${result.fields.length} fields detected`);
    for (const f of result.fields) {
      console.log(`  - ${f.label} (${f.type})${f.required ? " *required*" : ""}`);
    }

    console.log(`\n→ Filling a few sample fields (name, email)...`);
    await stagehand.act(`Fill the first name field with "${SAMPLE_RESUME.firstName}"`);
    await stagehand.act(`Fill the last name field with "${SAMPLE_RESUME.lastName}"`);
    await stagehand.act(`Fill the email field with "${SAMPLE_RESUME.email}"`);

    console.log(`\n✓ DONE. Form is partially filled — stopping before submit.`);
    console.log(`  Verify in the live view that fields are populated.`);
    console.log(`  Sleeping 60s before cleanup so you can inspect...`);
    await new Promise((r) => setTimeout(r, 60_000));
  } finally {
    console.log("→ Closing Stagehand + releasing Steel session...");
    try {
      await stagehand.close();
    } catch {
      // best-effort
    }
    await releaseSession(session.id);
    console.log("✓ Cleanup complete");
  }
}

main().catch((err) => {
  console.error("✗ Spike failed:", err);
  process.exit(1);
});
