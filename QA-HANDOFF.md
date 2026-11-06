# Nexora QA handoff for Claude

Tested November 6, 2026. Please fix the issues below in this repository, preserving existing user changes. Do not deploy or push as part of this request.

## Executed checks

- `npm run lint`: PASS (all TypeScript/TSX files).
- `npm run build`: PASS (client bundle, CSS, HTML, Vite configuration). Warning: vite.config.ts uses __dirname, unsupported by future native config loader.
- `node --import tsx --test src/utils/examEngine.test.ts src/qa.test.tsx`: 24 tests, 21 PASS, 3 FAIL. All 15 React render smoke tests pass, including App and every component, with overlays open.
- Production server startup on Node 24: PASS.
- HTTP checks without GEMINI_API_KEY: GET / and /api/health return 200; empty solve/extract POSTs return 400; valid-shaped solve/extract POSTs return 503. All six PASS.
- GET /api/nonexistent returns 200 and SPA HTML instead of 404 JSON: FAIL.

## Test-proven defects

1. src/utils/examEngine.ts:104-124: 16/23 (69.565%) is incorrectly marked passed after rounding to 70. Compare raw ratios for passing; round only display percentages.
2. Same function: 50/101 (49.505%) in one subject rounds to 50 and incorrectly satisfies the subject floor, even with an overall passing score. Compare raw subject ratio to 50.
3. src/data/seedData.ts: PDF metadata claims pdf-01 has 16 questions, but bank has 11. Reconcile all source question/verified/review/coverage counts with actual seed data. Do not add fabricated questions to satisfy counts.
4. server.ts production SPA fallback: return JSON 404 for unmatched /api routes before SPA fallback.

## Additional source-review findings to reproduce and fix

5. App.tsx:46-49: questions, sources, results and audit logs only live in React memory; refresh discards changes and publishing does not share them with other users. Implement appropriate persistence; distinguish single-browser storage from shared server persistence.
6. server.ts AI POST endpoints have no authentication/authorization or usage limits; Navbar exposes demo role switching. Secure paid API access for actual deployment; clearly scope demo behavior.
7. App.tsx:123: exam pool ignores PdfSource.isPublicToReviewees and allowedModes; ExamLauncherModal lists all sources. Enforce source visibility/mode eligibility in both selection and exam launch.
8. App.tsx:139: zero-match filters silently fall back to the entire bank. Show no-match validation instead; prevent empty exams.
9. App.tsx:208: history reconstructs question list using userAnswers, dropping skipped questions and consulting mutable current bank. Store question IDs/order/snapshots and config with results so review/retake is accurate after edits/deletes.
10. PdfImporterView.tsx:144: TXT content is truncated to 5000 characters before extraction; preserve full extraction text and truncate only preview.
11. PdfImporterView.tsx:123 versus 196: file selection accepts .pdf extension, but encoding requires exact PDF MIME. A PDF with empty/generic MIME is accepted then sent without content. Reuse consistent file classification.
12. App.tsx:227-230: reimport with same filename replaces source record with new ID while existing questions retain old ID. Preserve stable source IDs and aggregate counts during partial publishing rather than overwrite batch totals.
13. ActiveExamView.tsx:53-67: timer interval restarts whenever answers/flags change, losing fractional elapsed time; uses tick counts rather than deadline and calls parent state updates inside a state updater. Use deadline-based timing, stable effect, and exactly-once submission outside updater; test rapid answering and delayed/background timers.
14. PdfImporterView.tsx:361: publish action includes needs_verification and discrepancy_flagged items, selected by default, and makes source public. Require explicit review/override before uncertain answers enter scored exams.

## Coverage limits and completion criteria

Render smoke tests do not execute browser effects or event handlers and do not verify layout, keyboard interaction, uploads, or calculator button behavior. External Gemini calls were not executed because no real key was configured. node_modules, .git internals, generated dist files, and screenshot artifacts are not independent authored source tests; the dependency tree is exercised by compilation/build/runtime checks.

Keep regression assertions; do not delete or weaken failing tests. Add meaningful behavior tests for the fixes, rerun both test files, lint and build, and report remaining blockers. Use a test script in package.json so the suite is easy to run.
