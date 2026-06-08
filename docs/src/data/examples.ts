import dailyPrice from "../../../examples/daily-price.json";
import contentPipeline from "../../../examples/content-pipeline.json";
import basicReport from "../../../examples/basic-report.json";
import treatmentPage from "../../../examples/treatment-page.json";
import codeReview from "../../../examples/code-review.json";
import batchReview from "../../../examples/batch-review.json";

export interface Example {
  id: string;
  name: string;
  tagline: string;
  pattern: string;
  accent: "iris" | "cyan" | "mint";
  json: string;
}

const pretty = (doc: unknown) => JSON.stringify(doc, null, 2);

export const EXAMPLES: Example[] = [
  {
    id: "daily-price",
    name: "daily-price",
    tagline: "A real-world parallel loop: every clinic card is independently checked against its instruction.",
    pattern: "Parallel loop",
    accent: "mint",
    json: pretty(dailyPrice),
  },
  {
    id: "content-pipeline",
    name: "content-pipeline",
    tagline: "A polish loop where every sub-card is checked against its instruction.",
    pattern: "Loop",
    accent: "cyan",
    json: pretty(contentPipeline),
  },
  {
    id: "basic-report",
    name: "basic-report",
    tagline: "A linear pipeline: research, outline, write, review.",
    pattern: "Linear",
    accent: "iris",
    json: pretty(basicReport),
  },
  {
    id: "treatment-page",
    name: "treatment-page",
    tagline: "Situational insurance work lives inside checked card instructions.",
    pattern: "Situational",
    accent: "cyan",
    json: pretty(treatmentPage),
  },
  {
    id: "code-review",
    name: "code-review",
    tagline: "A security assessment card records whether deeper review is needed.",
    pattern: "Situational",
    accent: "mint",
    json: pretty(codeReview),
  },
  {
    id: "batch-review",
    name: "batch-review",
    tagline: "A loop over changed files with per-file review cards.",
    pattern: "Loop",
    accent: "iris",
    json: pretty(batchReview),
  },
];
