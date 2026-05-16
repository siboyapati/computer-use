import { z } from "zod";
import type { V3 as Stagehand } from "@browserbasehq/stagehand";
import type { ExtractedForm } from "./lever";

const GreenhouseFormSchema = z.object({
  company: z.string().describe("Company name displayed on this Greenhouse application page"),
  fields: z.array(
    z.object({
      label: z.string(),
      type: z.enum(["text", "email", "phone", "url", "textarea", "select", "radio", "checkbox", "file", "other"]),
      required: z.boolean(),
      options: z.array(z.string()).optional(),
    }),
  ),
});

export async function extractGreenhouseForm(stagehand: Stagehand): Promise<ExtractedForm> {
  const result = await stagehand.extract(
    "Extract the company and every visible form field on this Greenhouse application page. Be sure to include the international phone field (intl-tel-input) and any react-select dropdowns for custom questions. For demographic / EEO questions list the dropdown options. Skip section headers and informational text.",
    GreenhouseFormSchema,
  );
  const resumeField = result.fields.find((f) => f.type === "file" && /resume|cv/i.test(f.label));
  return { company: result.company, fields: result.fields, resumeFieldLabel: resumeField?.label ?? null };
}

export async function uploadResume(stagehand: Stagehand, resumePdfPath: string): Promise<boolean> {
  const page = stagehand.context.activePage();
  if (!page) return false;
  const candidates = [
    "#resume",
    'input[type="file"][id*="resume" i]',
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
  await stagehand.act("Click the Submit application button to send the application");
}
