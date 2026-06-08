/**
 * Artifact smoke test.
 *
 * These cases exercise the real CLI end to end:
 *   status-init -> step running -> check -> gate-result -> complete
 *
 * The invariant under test:
 *   Done requires a checker pass plus a durable markdown receipt at
 *   .conductor/artifacts/<card-index>-<slugified-card-title>.md. Non-text files such as images and PDFs are
 *   supporting artifacts referenced from the receipt.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const CLI = path.join(BOARD, "bin", "cli.js");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
function assert(cond, msg) {
  if (!cond) throw new AssertError(msg);
}

function cli(args, cwd) {
  const r = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-smoke-"));
  fs.mkdirSync(path.join(d, ".conductor", "artifacts"), { recursive: true });
  return d;
}

function writeFile(tmp, rel, body) {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

function status(tmp) {
  return JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "status.json"), "utf8"));
}

function conductorFor(testCase) {
  return {
    conductor: "3.0.0",
    name: `artifact-${testCase.name}`,
    description: "Artifact smoke case.",
    max_attempts: 5,
    steps: [
      {
        title: testCase.title || "Produce Output",
        instruction: testCase.instruction,
        requires: [],
      },
    ],
  };
}

function setupCase(testCase) {
  const tmp = tmpdir();
  writeFile(tmp, ".conductor/workflow.json", JSON.stringify(conductorFor(testCase), null, 2));
  const init = cli(["status-init", ".conductor/workflow.json"], tmp);
  assert(init.code === 0, `status-init failed:\n${init.out}`);
  const running = cli(["step", "0", "running", "--headless"], tmp);
  assert(running.code === 0, `step running failed:\n${running.out}`);
  return tmp;
}

function normalizeArtifactPath(artifactPath) {
  return artifactPath || null;
}

function slugTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "card";
}

function receiptName(testCase, id = "0") {
  return `${id}-${slugTitle(testCase.title || "Produce Output")}.md`;
}

function receiptPath(testCase) {
  return normalizeArtifactPath(testCase.artifactPath) || `.conductor/artifacts/${receiptName(testCase)}`;
}

function writeArtifactAndSupport(tmp, testCase) {
  if (testCase.artifact !== false) {
    writeFile(tmp, receiptPath(testCase), testCase.artifactBody || artifactBody(testCase));
  }
  for (const support of testCase.support || []) {
    writeFile(tmp, path.join(".conductor", "artifacts", support.path), support.body);
  }
}

function artifactBody(testCase) {
  const title = testCase.title || "Produce Output";
  if (testCase.kind === "action") {
    return [
      `# ${title}`,
      `Command: ${testCase.command || "node scripts/action.js --case smoke"}`,
      "Timestamp: 2026-06-07T12:00:00.000Z",
      `Inputs: ${testCase.inputs || "fixture input"}`,
      `Return: ${testCase.returnValue || "ok"}`,
      `Changed resource: ${testCase.changed || "resource smoke-123"}`,
      `Verification: ${testCase.verification || "query/curl/test returned expected result"}`,
    ].join("\n");
  }
  if (testCase.kind === "non-text") {
    return [
      `# ${title}`,
      `Produced: ${testCase.produced || "non-text output"}`,
      `Supporting files: ${(testCase.support || []).map((s) => `.conductor/artifacts/${s.path}`).join(", ")}`,
      `Verification: ${testCase.verification || "supporting file exists with expected metadata"}`,
    ].join("\n");
  }
  return [
    `# ${title}`,
    "",
    testCase.content || "Actual content, data, code, or decision produced for this card.",
  ].join("\n");
}

function runCase(testCase) {
  const tmp = setupCase(testCase);
  try {
    writeArtifactAndSupport(tmp, testCase);

    for (const beforeCheck of testCase.beforeCheck || []) beforeCheck(tmp);

    const checkArgs = ["check", "0"];
    if (testCase.outputFile !== false) {
      checkArgs.push("--output-file", testCase.outputFile || receiptPath(testCase));
    }
    const checked = cli(checkArgs, tmp);
    if (testCase.expectCheckFail) {
      assert(checked.code !== 0, `check should fail:\n${checked.out}`);
    } else {
      assert(checked.code === 0, `check should pass:\n${checked.out}`);
      for (const expected of testCase.promptIncludes || []) {
        assert(checked.out.includes(expected), `checker prompt missing "${expected}":\n${checked.out}`);
      }
      for (const forbidden of testCase.promptExcludes || []) {
        assert(!checked.out.includes(forbidden), `checker prompt included forbidden "${forbidden}":\n${checked.out}`);
      }
    }

    const verdict = testCase.verdict || "passed";
    const evidence = verdict === "passed"
      ? "PASS\nMADE: Smoke output was produced.\nCHECKED: Artifact satisfies the case.\nSUMMARY: Smoke output passed."
      : "FAIL\nSUMMARY: Smoke output failed.";
    const gate = cli(["gate-result", "0", verdict === "passed" ? "--passed" : "--failed", "--evidence", evidence], tmp);
    assert(gate.code === 0, `gate-result failed:\n${gate.out}`);

    const completed = cli(["complete", "0"], tmp);
    if (testCase.expectComplete === false || verdict === "failed") {
      assert(completed.code !== 0, `complete should fail:\n${completed.out}`);
      if (testCase.completeIncludes) {
        assert(completed.out.includes(testCase.completeIncludes), `complete output missing ${testCase.completeIncludes}:\n${completed.out}`);
      }
      return { tmp, completed: false };
    }

    assert(completed.code === 0, `complete should pass:\n${completed.out}`);
    const st = status(tmp);
    const step = st.steps["0"];
    assert(st.status === "done", `run should be done:\n${JSON.stringify(st, null, 2)}`);
    assert(step.status === "done", "step should be done");
    assert(step.artifact === (testCase.expectedArtifact || artifactRel(testCase)), `wrong artifact path: ${step.artifact}`);
    for (const artifact of testCase.expectedArtifacts || [step.artifact]) {
      assert(step.artifacts.includes(artifact), `missing artifact ${artifact}: ${JSON.stringify(step.artifacts)}`);
    }
    return { tmp, completed: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function artifactRel(testCase) {
  const p = receiptPath(testCase);
  return p.replace(/^\.conductor\/artifacts\//, "").replace(/^\.conductor\/outputs\//, "");
}

const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

const contentCases = [
  ["markdown-article", "Write Article", "Write the final article copy.", "## Article\n\nOwner-facing content."],
  ["json-data", "Export JSON", "Export structured JSON data.", "{\n  \"rows\": 3,\n  \"ok\": true\n}"],
  ["source-notes", "Source Notes", "Produce source notes.", "Source A: https://example.test"],
  ["log-report", "Command Log", "Produce a command log.", "npm test -> passed"],
  ["html-preview", "HTML Preview", "Produce an HTML preview.", "<main><h1>Preview</h1></main>"],
  ["csv-export", "CSV Export", "Produce a CSV export.", "id,name\n1,Ada\n"],
  ["tsv-export", "TSV Export", "Produce a TSV export.", "id\tname\n1,Ada\n"],
  ["decision-record", "Decision Record", "Make and record the decision.", "Decision: choose option B.\nReason: lower risk."],
  ["diff-output", "Patch Diff", "Produce a patch diff.", "diff --git a/a b/a\n+added line"],
  ["research-table", "Research Table", "Produce a research table.", "| Source | Finding |\n|---|---|\n| A | B |"],
  ["source-list", "Source List", "Produce a source list.", "- https://example.test/a — takeaway A\n- https://example.test/b — takeaway B"],
  ["config-file", "Config File", "Produce a config file.", "{\n  \"feature\": true,\n  \"limit\": 10\n}"],
].map(([name, title, instruction, content, artifactPath, expectedArtifact]) => ({
  name,
  title,
  instruction,
  kind: "content",
  artifactPath,
  expectedArtifact,
  artifactBody: content,
  promptIncludes: [String(content).split("\n")[0]],
}));

const actionCases = [
  ["db-insert", "Insert Row", "Insert a row and prove it exists.", "INSERT treatment", "row id 42", "SELECT returned row id 42"],
  ["db-update", "Update Row", "Update a row and prove the field changed.", "UPDATE treatment", "affected rows 1", "SELECT returned updated value"],
  ["deploy", "Deploy Build", "Deploy the build and verify URL.", "vercel deploy", "https://deploy.test", "curl returned 200"],
  ["revalidate", "Revalidate Page", "Revalidate the page and verify cache changed.", "curl /api/revalidate", "revalidated /x", "next request returned fresh timestamp"],
  ["index-submit", "Submit Indexing", "Submit URL for indexing and record response.", "node scripts/index.js", "submitted url", "API returned accepted"],
  ["upload", "Upload Asset", "Upload asset and verify remote URL.", "node upload.js", "storage url", "HEAD returned 200"],
  ["email-send", "Send Email", "Send test email and record provider id.", "node send.js", "message id msg_1", "provider status delivered"],
  ["webhook-create", "Create Webhook", "Create webhook and verify it exists.", "curl POST /webhooks", "webhook id wh_1", "GET returned wh_1"],
  ["migration", "Run Migration", "Run migration and verify schema.", "npm run migrate", "migration 003 applied", "schema table exists"],
  ["cache-purge", "Purge Cache", "Purge cache and verify miss.", "curl PURGE /cache", "purge id p1", "subsequent request cache MISS"],
  ["browser-qa", "Browser QA", "Run browser QA and record assertions.", "node scripts/browser-qa.js", "3 assertions passed", "screenshot and DOM assertions matched"],
  ["api-call", "API Call", "Call API and verify response.", "curl POST /api/task", "202 accepted task_1", "GET /api/task/task_1 returned done"],
].map(([name, title, instruction, command, returnValue, verification]) => ({
  name,
  title,
  instruction,
  kind: "action",
  command,
  returnValue,
  verification,
  promptIncludes: ["Command:", "Return:", "Changed resource:", "Verification:"],
}));

const nonTextCases = [
  ["png-screenshot", "Capture Screenshot", "Capture a screenshot and verify the page.", "screenshot.png", binary],
  ["webp-image", "Generate Image", "Generate a WebP image and record prompt metadata.", "hero.webp", binary],
  ["jpg-photo", "Export Photo", "Export a JPG photo and record dimensions.", "photo.jpg", binary],
  ["pdf-report", "Export PDF", "Export PDF and record page count.", "report.pdf", Buffer.from("%PDF-1.4\n")],
  ["nested-screenshot", "Capture Mobile", "Capture mobile screenshot and verify viewport.", "screens/mobile.png", binary],
  ["multiple-images", "Generate Gallery", "Generate image gallery and record all paths.", "gallery/one.webp", binary, [{ path: "gallery/two.webp", body: binary }]],
  ["csv-support", "Analyze Export", "Analyze CSV and record summary artifact.", "exports/data.csv", "id,value\n1,2\n"],
  ["json-support", "Call API", "Call API and record response artifact.", "api/response.json", "{ \"ok\": true }"],
  ["html-support", "Render Page", "Render page and record screenshot artifact.", "preview/page.html", "<html><body>ok</body></html>"],
  ["log-support", "Run Tool", "Run tool and record log artifact.", "logs/tool.log", "tool passed\n"],
].map(([name, title, instruction, supportPath, supportBody, extra = []]) => ({
  name,
  title,
  instruction,
  kind: "non-text",
  support: [{ path: supportPath, body: supportBody }, ...extra],
  outputFile: `.conductor/artifacts/${supportPath}`,
  expectedArtifacts: [receiptName({ title }), supportPath, ...extra.map((x) => x.path)],
  promptIncludes: ["Supporting files:"],
  promptExcludes: typeof supportBody === "string" ? [] : ["PNG"],
}));

const nestedArtifactCases = [
  ["nested-md-support", "Nested Artifact", "Produce nested artifact.", "cards/support.md"],
  ["nested-json-support", "Nested JSON Artifact", "Produce nested JSON artifact.", "artifacts/support.json"],
  ["safe-title-support", "Safe Artifact", "Produce sanitized support.", "card__zero.md"],
  ["explicit-html-support", "Explicit HTML", "Produce HTML support.", "artifact.html"],
  ["explicit-log-support", "Explicit Log", "Produce log support.", "artifact.log"],
].map(([name, title, instruction, supportPath]) => ({
  name,
  title,
  instruction,
  kind: "content",
  support: [{ path: supportPath, body: `# ${title}\n\nSupporting file.` }],
  expectedArtifact: receiptName({ title }),
  expectedArtifacts: [receiptName({ title }), supportPath],
  artifactBody: `# ${title}\n\nExplicit artifact path works.\n\nSupporting file: .conductor/artifacts/${supportPath}`,
  promptIncludes: ["Explicit artifact path works."],
}));

const rejectionCases = [
  {
    name: "binary-only-rejected",
    title: "Binary Only",
    instruction: "Produce a screenshot with artifact.",
    artifact: false,
    support: [{ path: "0.png", body: binary }],
    outputFile: ".conductor/artifacts/0.png",
    expectCheckFail: true,
    verdict: "failed",
    expectComplete: false,
  },
  {
    name: "outside-output-rejected",
    title: "Outside Output",
    instruction: "Produce an outside file.",
    artifact: false,
    beforeCheck: [(tmp) => writeFile(tmp, "outside.md", "# outside\n")],
    outputFile: "outside.md",
    expectComplete: false,
    completeIncludes: "no artifact found",
  },
  {
    name: "missing-output-check-fails",
    title: "Missing Output",
    instruction: "Produce output.",
    artifact: false,
    outputFile: false,
    expectCheckFail: true,
    verdict: "failed",
    expectComplete: false,
  },
  {
    name: "failed-verdict-retries",
    title: "Failed Verdict",
    instruction: "Produce artifact but checker fails.",
    verdict: "failed",
    expectComplete: false,
  },
  {
    name: "non-output-json-rejected",
    title: "Non Output JSON",
    instruction: "Produce JSON outside artifacts.",
    artifact: false,
    beforeCheck: [(tmp) => writeFile(tmp, "result.json", "{ \"ok\": true }")],
    outputFile: "result.json",
    expectComplete: false,
    completeIncludes: "no artifact found",
  },
  {
    name: "support-path-traversal-ignored",
    title: "Traversal Ignored",
    instruction: "Produce safe artifact.",
    support: [{ path: "safe.png", body: binary }],
    beforeCheck: [(tmp) => writeFile(tmp, ".conductor/artifacts/0-traversal-ignored.md", "# Safe\n")],
    outputFile: ".conductor/artifacts/../artifacts/safe.png",
    expectedArtifacts: ["0-traversal-ignored.md", "safe.png"],
  },
  {
    name: "recorded-status-artifact-rejected",
    title: "Status Artifact",
    instruction: "Use status artifact path.",
    artifact: false,
    beforeCheck: [
      (tmp) => {
        writeFile(tmp, ".conductor/artifacts/status-artifact.md", "# Status artifact\n");
        const p = path.join(tmp, ".conductor", "status.json");
        const st = JSON.parse(fs.readFileSync(p, "utf8"));
        st.steps["0"].artifacts = ["status-artifact.md"];
        fs.writeFileSync(p, JSON.stringify(st, null, 2));
      },
    ],
    outputFile: false,
    expectComplete: false,
    completeIncludes: "no artifact found",
    promptIncludes: ["Status artifact"],
  },
  {
    name: "gate-artifact-path-rejected",
    title: "Gate Artifact",
    instruction: "Use gate artifact path.",
    artifact: false,
    beforeCheck: [
      (tmp) => {
        writeFile(tmp, ".conductor/artifacts/gate-artifact.md", "# Gate artifact\n");
        const p = path.join(tmp, ".conductor", "status.json");
        const st = JSON.parse(fs.readFileSync(p, "utf8"));
        st.steps["0"].gate_detail = [{ artifact_paths: ["gate-artifact.md"] }];
        fs.writeFileSync(p, JSON.stringify(st, null, 2));
      },
    ],
    outputFile: false,
    expectComplete: false,
    completeIncludes: "no artifact found",
    promptIncludes: ["Gate artifact"],
  },
  {
    name: "default-md-preferred",
    title: "Default Preferred",
    instruction: "Prefer default artifact.",
    artifactPath: ".conductor/artifacts/0-default-preferred.md",
    support: [{ path: "other.md", body: "# other\n" }],
    expectedArtifact: "0-default-preferred.md",
    expectedArtifacts: ["0-default-preferred.md"],
  },
  {
    name: "sanitized-default",
    title: "Sanitized Default",
    instruction: "Use sanitized default path.",
    artifactPath: ".conductor/artifacts/0-sanitized-default.md",
    expectedArtifact: "0-sanitized-default.md",
  },
];

const cases = [
  ...contentCases,
  ...actionCases,
  ...nonTextCases,
  ...nestedArtifactCases,
  ...rejectionCases,
  {
    name: "full-three-card-e2e",
    title: "Full E2E",
    instruction: "Run full mini workflow.",
    custom: true,
  },
];

function runFullE2E() {
  const tmp = tmpdir();
  try {
    const workflow = {
      conductor: "3.0.0",
      name: "artifact-full-e2e",
      description: "Three-card artifact e2e.",
      max_attempts: 5,
      steps: [
        { title: "Write Copy", instruction: "Write page copy.", requires: [] },
        { title: "Deploy Preview", instruction: "Deploy preview and record artifact.", requires: [0] },
        { title: "Capture Screenshot", instruction: "Capture screenshot and artifact.", requires: [1] },
      ],
    };
    writeFile(tmp, ".conductor/workflow.json", JSON.stringify(workflow, null, 2));
    assert(cli(["validate", ".conductor/workflow.json"], tmp).code === 0, "validate failed");
    assert(cli(["status-init", ".conductor/workflow.json"], tmp).code === 0, "status-init failed");
    const artifacts = [
      "# Copy\n\nActual page copy.",
      "# Deploy artifact\nCommand: deploy\nReturn: https://preview.test\nChanged resource: preview\nVerification: curl 200",
      "# Screenshot artifact\nScreenshot: .conductor/artifacts/2.png\nVerification: PNG exists",
    ];
    for (let i = 0; i < 3; i++) {
      assert(cli(["step", String(i), "running", "--headless"], tmp).code === 0, `step ${i} failed`);
      writeFile(tmp, `.conductor/artifacts/${receiptName({ title: workflow.steps[i].title }, String(i))}`, artifacts[i]);
      if (i === 2) writeFile(tmp, ".conductor/artifacts/2.png", binary);
      const checkArgs = ["check", String(i)];
      if (i === 2) checkArgs.push("--output-file", ".conductor/artifacts/2.png");
      assert(cli(checkArgs, tmp).code === 0, `check ${i} failed`);
      assert(cli(["gate-result", String(i), "--passed", "--evidence", "PASS\nSUMMARY: passed"], tmp).code === 0, `gate-result ${i} failed`);
      const done = cli(["complete", String(i)], tmp);
      assert(done.code === 0, `complete ${i} failed:\n${done.out}`);
    }
    const st = status(tmp);
    assert(st.status === "done", `run not done:\n${JSON.stringify(st, null, 2)}`);
    assert(st.steps["2"].artifacts.includes("2.png"), "final supporting screenshot missing");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function run() {
  console.log(bold("\n  Artifact smoke — 50 artifact shapes through the live CLI\n"));
  let passed = 0;
  let failed = 0;
  for (const testCase of cases) {
    try {
      if (testCase.custom) runFullE2E();
      else runCase(testCase);
      passed++;
      console.log(`  ${green("PASS")} ${testCase.name.padEnd(32)} ${dim(testCase.title || "")}`);
    } catch (e) {
      failed++;
      console.log(`  ${red("FAIL")} ${testCase.name.padEnd(32)} ${e.message}`);
    }
  }
  console.log("");
  console.log(`  ${bold("Summary:")} ${green(`${passed} passed`)} / ${cases.length}`);
  console.log("");
  if (failed) process.exit(1);
}

assert(cases.length === 50, `expected exactly 50 cases, got ${cases.length}`);
run();
