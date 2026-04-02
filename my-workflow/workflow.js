/**
 * My Workflow: Code Review Pipeline
 *
 * A 4-step workflow that takes a code snippet and:
 *   Step 1: Identify issues (bugs, style, security)
 *   Step 2: Suggest specific fixes for each issue
 *   Step 3: Generate an improved version of the code
 *   Step 4: Output a structured JSON review report
 *
 * Demonstrates:
 *   - Sequential chain execution
 *   - Intermediate output validation
 *   - Retry with exponential backoff
 *   - Fallback chain
 *   - Structured JSON output parsing
 */

import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

// --- Configuration ---

if (!process.env.GROQ_API_KEY) {
  console.error("ERROR: GROQ_API_KEY is not set.");
  console.error("Get a free key at https://console.groq.com");
  console.error('Set it with: export GROQ_API_KEY="your-key-here"');
  process.exit(1);
}

const llm = new ChatGroq({
  model: "llama-3.3-70b-versatile",
  temperature: 0.3, // Lower temperature for more consistent code output
  apiKey: process.env.GROQ_API_KEY,
});
const outputParser = new StringOutputParser();

// --- Custom Error Classes ---

class RetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetryableError";
  }
}

class ValidationError extends Error {
  constructor(message, rawOutput) {
    super(message);
    this.name = "ValidationError";
    this.rawOutput = rawOutput;
  }
}

// --- Utility: Retry with Exponential Backoff ---

async function callWithRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const msg = error.message || String(error);
      const isRetryable =
        msg.includes("429") ||
        msg.includes("500") ||
        msg.toLowerCase().includes("timeout") ||
        msg.toLowerCase().includes("econnreset");

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`  Retry ${attempt}/${maxRetries} in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw new RetryableError(`Failed after ${attempt} attempt(s): ${msg}`);
      }
    }
  }
}

// --- Utility: Parse and Validate JSON from LLM ---

function parseJsonOutput(rawOutput, requiredKeys = []) {
  let text = rawOutput.trim();

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError(
      `Invalid JSON from LLM: ${text.slice(0, 120)}...`,
      rawOutput
    );
  }

  const missing = requiredKeys.filter((k) => !(k in parsed));
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required keys: ${missing.join(", ")}`,
      rawOutput
    );
  }

  return parsed;
}

// --- Utility: Fallback Wrapper ---

async function withFallback(primaryFn, fallbackFn, label = "step") {
  try {
    return await primaryFn();
  } catch (error) {
    console.warn(`  [${label}] Primary failed: ${error.message}`);
    console.warn(`  [${label}] Trying fallback...`);
    return await fallbackFn();
  }
}

// --- Step 1: Identify Issues ---

const identifyPrompt = ChatPromptTemplate.fromTemplate(
  `You are a senior software engineer reviewing the following code.
Identify all issues: bugs, security vulnerabilities, performance problems, and style violations.

Code:
\`\`\`
{code}
\`\`\`

List each issue on its own line in this format:
[CATEGORY] Description of the issue

Categories: BUG, SECURITY, PERFORMANCE, STYLE
List at least 2 issues. Be specific.`
);

const identifyChain = identifyPrompt.pipe(llm).pipe(outputParser);

// --- Step 2: Suggest Fixes ---

const fixPrompt = ChatPromptTemplate.fromTemplate(
  `You are a senior software engineer. Given these issues found in a code review:

{issues}

For each issue, provide a specific fix. Format your response as a numbered list where each item explains exactly what to change.`
);

const fixChain = fixPrompt.pipe(llm).pipe(outputParser);

// --- Step 3: Generate Improved Code ---

const improvePrompt = ChatPromptTemplate.fromTemplate(
  `Rewrite the following code applying all of these fixes:

Original code:
\`\`\`
{code}
\`\`\`

Fixes to apply:
{fixes}

Return ONLY the improved code, no explanation. Wrap it in a code block.`
);

const improveChain = improvePrompt.pipe(llm).pipe(outputParser);

// --- Step 4: Format Structured Report ---

const reportPrompt = ChatPromptTemplate.fromTemplate(
  `Create a JSON code review report from this information.

Original code:
{code}

Issues found:
{issues}

Fixes suggested:
{fixes}

Return a JSON object with exactly these keys:
- "summary": one sentence describing the overall quality (string)
- "issue_count": total number of issues found (number)
- "severity": overall severity — "low", "medium", or "high" (string)
- "top_issue": the single most important issue to fix (string)
- "improved_code_provided": true (boolean)

Return ONLY valid JSON, no markdown.`
);

const reportChain = reportPrompt.pipe(llm).pipe(outputParser);

// --- Main Workflow ---

async function codeReviewWorkflow(code) {
  console.log("=".repeat(60));
  console.log("Code Review Pipeline");
  console.log("=".repeat(60));
  console.log("\nCode under review:");
  console.log(code);

  // Step 1: Identify issues
  console.log("\n" + "-".repeat(60));
  console.log("STEP 1: Identifying issues...");
  let issues;
  try {
    issues = await callWithRetry(() => identifyChain.invoke({ code }));

    // Validate intermediate output — must have actual content
    if (issues.trim().length < 20) {
      throw new ValidationError(
        "Issue list too short — LLM may have returned incomplete output.",
        issues
      );
    }
    console.log(issues);
  } catch (error) {
    console.error(`FATAL: Issue identification failed: ${error.message}`);
    console.error("Cannot continue without a list of issues.");
    return;
  }

  // Step 2: Suggest fixes
  console.log("\n" + "-".repeat(60));
  console.log("STEP 2: Suggesting fixes...");
  let fixes;
  try {
    fixes = await withFallback(
      () => callWithRetry(() => fixChain.invoke({ issues })),
      async () => {
        // Fallback: simpler prompt if primary fails
        const fallbackPrompt = ChatPromptTemplate.fromTemplate(
          `List simple fixes for these code issues:\n{issues}`
        );
        const fallbackChain = fallbackPrompt.pipe(llm).pipe(outputParser);
        return callWithRetry(() => fallbackChain.invoke({ issues }));
      },
      "fixes"
    );
    console.log(fixes);
  } catch (error) {
    console.error(`FATAL: Fix generation failed: ${error.message}`);
    return;
  }

  // Step 3: Generate improved code
  console.log("\n" + "-".repeat(60));
  console.log("STEP 3: Generating improved code...");
  let improvedCode;
  try {
    improvedCode = await callWithRetry(() =>
      improveChain.invoke({ code, fixes })
    );
    console.log(improvedCode);
  } catch (error) {
    // Non-fatal — report can still be generated without improved code
    console.warn(
      `WARNING: Improved code generation failed (${error.message}). Continuing.`
    );
    improvedCode = "(Could not generate improved code)";
  }

  // Step 4: Structured JSON report
  console.log("\n" + "-".repeat(60));
  console.log("STEP 4: Generating structured report...");
  try {
    const rawReport = await callWithRetry(() =>
      reportChain.invoke({ code, issues, fixes })
    );

    const report = parseJsonOutput(rawReport, [
      "summary",
      "issue_count",
      "severity",
      "top_issue",
      "improved_code_provided",
    ]);

    console.log("\n" + "=".repeat(60));
    console.log("FINAL REPORT:");
    console.log("=".repeat(60));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    // Fallback: plain text summary
    console.warn(`WARNING: JSON report failed (${error.message}).`);
    console.log("\n" + "=".repeat(60));
    console.log("FINAL REPORT (fallback):");
    console.log("=".repeat(60));
    console.log({ issues, fixes });
  }

  console.log("\n" + "=".repeat(60));
  console.log("Workflow complete!");
}

// --- Sample Code to Review ---

const sampleCode = `
function getUser(id) {
  var query = "SELECT * FROM users WHERE id = " + id;
  var result = db.execute(query);
  var password = result.password;
  console.log("User password: " + password);
  return result;
}
`.trim();

const codeInput = process.argv[2] || sampleCode;

await codeReviewWorkflow(codeInput);