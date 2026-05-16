import { z } from "zod";
import type { V3 as Stagehand } from "@browserbasehq/stagehand";
import type { Resume } from "../types";
import type { FormField } from "../field-mapper";

const LeverFormSchema = z.object({
  company: z.string().describe("The company name displayed on this Lever application page"),
  fields: z.array(
    z.object({
      label: z.string().describe("The visible label of the form field"),
      type: z.enum(["text", "email", "phone", "url", "textarea", "select", "radio", "checkbox", "file", "other"]),
      required: z.boolean(),
      options: z.array(z.string()).optional().describe("For select/radio fields, the visible option labels"),
    }),
  ),
});

export interface ExtractedForm {
  company: string;
  fields: FormField[];
  resumeFieldLabel: string | null;
}

export async function extractLeverForm(stagehand: Stagehand): Promise<ExtractedForm> {
  const result = await stagehand.extract(
    "Extract the company name and every visible form field on this Lever job application page. Include text inputs, textareas, dropdowns, radio groups, checkboxes, and file uploads. For radio/select, include the option labels. Skip fields that are clearly section headers or links.",
    LeverFormSchema,
  );

  const resumeField = result.fields.find(
    (f) => f.type === "file" && /resume|cv/i.test(f.label),
  );

  return {
    company: result.company,
    fields: result.fields,
    resumeFieldLabel: resumeField?.label ?? null,
  };
}

export async function uploadResume(
  stagehand: Stagehand,
  resumePdfPath: string,
): Promise<boolean> {
  const page = stagehand.context.activePage();
  if (!page) return false;
  const candidates = [
    'input[type="file"][name="resume"]',
    'input[type="file"][name*="resume" i]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"][accept*="pdf" i]',
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
  const page = stagehand.context.activePage();
  if (page) {
    const candidates = [
      'button[type="submit"]',
      'xpath=//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "submit")]',
      'input[type="submit"]',
    ];
    for (const sel of candidates) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0) {
          await loc.click();
          return;
        }
      } catch {
        // try next
      }
    }
  }
  await stagehand.act("Click the Submit application button at the bottom of the form");
}
