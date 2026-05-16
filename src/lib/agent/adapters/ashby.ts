import { z } from "zod";
import type { V3 as Stagehand } from "@browserbasehq/stagehand";
import type { ExtractedForm } from "./lever";

const AshbyFormSchema = z.object({
  company: z.string().describe("Company name displayed on this Ashby application page"),
  fields: z.array(
    z.object({
      label: z.string(),
      type: z.enum(["text", "email", "phone", "url", "textarea", "select", "radio", "checkbox", "file", "other"]),
      required: z.boolean(),
      options: z.array(z.string()).optional(),
    }),
  ),
});

export async function extractAshbyForm(stagehand: Stagehand): Promise<ExtractedForm> {
  const result = await stagehand.extract(
    "Extract the company name and every visible form field on this Ashby application page. Ashby is a single-page React app — target fields by their labels and ARIA roles, not class names. Include any role='combobox' dropdowns and role='radiogroup' radios with their option labels.",
    AshbyFormSchema,
  );
  const resumeField = result.fields.find((f) => f.type === "file" && /resume|cv/i.test(f.label));
  return { company: result.company, fields: result.fields, resumeFieldLabel: resumeField?.label ?? null };
}

export async function uploadResume(stagehand: Stagehand, resumePdfPath: string): Promise<boolean> {
  const page = stagehand.context.activePage();
  if (!page) return false;
  const candidates = [
    'input[type="file"][accept*="pdf" i]',
    'input[type="file"][name*="resume" i]',
    'input[type="file"]',
  ];
  for (const sel of candidates) {
    try {
      const locator = page.locator(sel).first();
      if ((await locator.count()) > 0) {
        await locator.setInputFiles(resumePdfPath);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

export async function clickSubmit(stagehand: Stagehand): Promise<void> {
  await stagehand.act("Click the Submit Application button at the bottom of the form");
}
