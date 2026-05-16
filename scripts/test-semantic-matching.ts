import assert from "node:assert/strict";
import { mapField } from "../src/lib/agent/field-mapper";
import { previewProfileAnswer } from "../src/lib/profile";
import {
  SEMANTIC_QUESTION_MATCH_THRESHOLD,
  findBestSemanticQuestionMatch,
  normalizeQuestion,
  semanticQuestionSimilarity,
  type UserProfile,
} from "../src/lib/agent/profile-types";
import type { Resume } from "../src/lib/agent/types";

const savedInterestKey = normalizeQuestion("Why are you interested in this role?");
const savedSponsorshipKey = normalizeQuestion("Will you now or in the future require sponsorship?");
const profile: UserProfile = {
  extras: {
    workAuthorization: "Yes, I am authorized to work in the United States.",
  },
  learnedAnswers: {
    [savedInterestKey]: {
      answer: "I am excited by the product, the role scope, and the chance to apply my experience.",
      fieldType: "textarea",
      lastLabel: "Why are you interested in this role?",
      timesUsed: 2,
      lastUsedAt: Date.now(),
    },
    [savedSponsorshipKey]: {
      answer: "No, I do not require sponsorship.",
      fieldType: "select",
      lastLabel: "Will you now or in the future require sponsorship?",
      timesUsed: 1,
      lastUsedAt: Date.now(),
    },
  },
  updatedAt: Date.now(),
};

const resume: Resume = {
  personal: {
    fullName: "Test Candidate",
    firstName: "Test",
    lastName: "Candidate",
    email: "test@example.com",
    phone: "555-0100",
    location: "San Francisco, CA",
    linkedin: "https://linkedin.com/in/test",
    github: "",
    website: "",
  },
  headline: "Software engineer",
  summary: "Builds useful things.",
  experience: [],
  education: [],
  skills: ["TypeScript"],
  projects: [],
  certifications: [],
};

async function main() {
  const variants = [
    "Why this job?",
    "What interests you?",
    "What interests you about this opportunity?",
    "Why do you want to work here?",
  ];

  for (const variant of variants) {
    const score = semanticQuestionSimilarity(variant, savedInterestKey);
    assert.ok(
      score >= SEMANTIC_QUESTION_MATCH_THRESHOLD,
      `${variant} should match saved interest answer; score=${score}`,
    );
    const match = findBestSemanticQuestionMatch(variant, [savedInterestKey]);
    assert.equal(match?.key, savedInterestKey, `${variant} should select saved interest key`);
  }

  const unrelated = findBestSemanticQuestionMatch("What is your favorite programming language?", [
    savedInterestKey,
  ]);
  assert.equal(unrelated, null, "unrelated technical preference should not match interest answer");

  const semanticFill = await mapField(
    {
      label: "What interests you about this opportunity?",
      type: "textarea",
      required: true,
    },
    resume,
    "https://jobs.lever.co/example/123",
    undefined,
    profile,
  );
  assert.equal(semanticFill.value, profile.learnedAnswers[savedInterestKey].answer);
  assert.match(semanticFill.reasoning, /semantic saved answer|saved answer/);

  const extrasFill = await mapField(
    {
      label: "Are you legally authorized to work in the United States?",
      type: "select",
      required: true,
      options: ["Yes", "No"],
    },
    resume,
    "https://jobs.lever.co/example/123",
    undefined,
    profile,
  );
  assert.equal(extrasFill.value, "Yes");
  assert.match(extrasFill.reasoning, /matched option "Yes"/);

  const extrasTextFill = await mapField(
    {
      label: "Are you legally authorized to work in the United States?",
      type: "text",
      required: true,
    },
    resume,
    "https://jobs.lever.co/example/123",
    undefined,
    profile,
  );
  assert.equal(extrasTextFill.value, profile.extras.workAuthorization);

  assert.deepEqual(previewProfileAnswer("What interests you?", profile), {
    value: profile.learnedAnswers[savedInterestKey].answer,
    source: "learned",
  });
  assert.deepEqual(previewProfileAnswer("Are you legally authorized to work?", profile), {
    value: profile.extras.workAuthorization,
    source: "extras",
  });

  const sponsorshipFill = await mapField(
    {
      label: "Do you need visa sponsorship?",
      type: "select",
      required: true,
      options: ["Yes", "No"],
    },
    resume,
    "https://jobs.lever.co/example/123",
    undefined,
    profile,
  );
  assert.equal(sponsorshipFill.value, "No");
  assert.match(sponsorshipFill.reasoning, /matched option "No"/);

  const eeoProfile: UserProfile = {
    extras: {},
    learnedAnswers: {
      [normalizeQuestion("What is your gender?")]: {
        answer: "Female",
        fieldType: "select",
        lastLabel: "What is your gender?",
        timesUsed: 1,
        lastUsedAt: Date.now(),
      },
    },
    updatedAt: Date.now(),
  };
  const eeoFill = await mapField(
    {
      label: "Gender",
      type: "select",
      required: true,
      options: ["Female", "Male", "Prefer not to say"],
    },
    resume,
    "https://jobs.lever.co/example/123",
    undefined,
    eeoProfile,
  );
  assert.equal(eeoFill.value, "Prefer not to say");
  assert.match(eeoFill.reasoning, /EEO/);

  console.log("semantic matching tests passed");
}

void main();
