# Code Review Pipeline — Workflow Summary

## What does this workflow do?
Takes a raw code snippet and automatically identifies bugs, security issues,
and style violations, suggests specific fixes, generates improved code,
and outputs a structured JSON review report.

---

## Workflow Steps

```
Code Snippet
     │
     ▼
[Step 1: Identify Issues]
 Finds bugs, security flaws,
 performance problems, style violations
     │
     ▼
[Step 2: Suggest Fixes]
 Numbered list of specific
 changes to make (with fallback chain)
     │
     ▼
[Step 3: Generate Improved Code]
 Rewrites the original code
 applying all suggested fixes
     │
     ▼
[Step 4: Structured JSON Report]
 Outputs: summary, issue_count,
 severity, top_issue, improved_code_provided
```

---

## How it fits into a broader application

This workflow is the core of a **code review web app** — a developer pastes
code into a textarea, clicks "Review", and gets back a structured report with
severity rating and a drop-in improved version. It could integrate into a
GitHub PR review tool, a coding education platform, or an IDE plugin where
AI-assisted review runs automatically before a commit.

---

## Errors that can occur and how they are handled

| Error | Handling Strategy |
|-------|------------------|
| API rate limit (429) / server error (500) | Retry with exponential backoff (up to 3 attempts) |
| Fix generation fails | Fallback chain uses a simpler prompt |
| Improved code generation fails | Non-fatal — workflow continues, report still generated |
| JSON report malformed | `parseJsonOutput()` strips markdown fences, validates required keys; falls back to plain text summary |
| Issue list too short / incomplete | Intermediate output validation throws `ValidationError` and aborts early with a clear message |