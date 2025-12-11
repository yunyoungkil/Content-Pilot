A set of UI and draft-detection fixes + hardening tests

Summary
- UI/layout: `css/affiliate-modal.css`, `css/workspace.css`, `js/ui/affiliateModal.js` — improvements for the affiliate modal and fixed a small DOM bug (missing closing container div).
- Tests: hardened background message handler tests (`test/background.test.js`) by adding more complete chrome mocks and directly invoking the registered runtime.onMessage handler for deterministic testing of `get_unified_gallery`, `ping`, and `get_user_id`.
- Risk-area coverage: added non-destructive unit tests for `js/services/firebaseService.js` and `js/services/collectorService.js` (see `test/firebaseService.unit.test.js`, `test/collectorService.risk.test.js`) to lock current behavior before any sensitive logic changes.

Why this change
- We prefer a test-first approach for risky, data-flow code paths. This PR increases confidence by adding tests and makes a small safe UI fix where HTML structure could cause rendering issues.

Validation
- Full test-suite run completed locally: tests passing (all suites) — please re-run CI to confirm in remote.
- Webpack build completed locally; there are asset-size warnings which are unrelated to these changes and can be addressed separately.

Notes / Next steps
- This PR focuses on two behavioral fixes and test hardening:
  1) Prevent AI-generated example-or-link-only outputs from being treated as real drafts (so the UI won't show '초안 완료' when there's no actual content).
  2) Ensure workspace.draft that contains only status metadata (object-only drafts) does not count as a textual draft.

If you'd like I can follow up with a smaller cleanup PR for formatting/lint warnings and an optional set of more aggressive LLM-output unit tests covering additional mixed HTML/markdown/link permutations.

Files changed (high-level)
- js/ui/affiliateModal.js (UI fix)  
- css/affiliate-modal.css, css/workspace.css (styles)  
- js/core/highlighter.js, js/core/scrapbook.js (minor improvements)  
- js/services/* (collectorService, firebaseService, scrapService, kanbanService) — small functional fixes in earlier commits
- tests added / updated: test/background.test.js, test/firebaseService.unit.test.js, test/collectorService.risk.test.js, test/highlighter.test.js, test/scrapbook.test.js, and related changes

Checklist (please verify before merge)
- [ ] CI passes on remote (run tests + lint)
- [ ] Review UI change in a dev build (manual quick smoke) — specifically affiliate modal rendering
- [ ] Decide whether to land the Prettier/CRLF cleanup in this PR (recommended: separate PR)
PR Title: fix(ui): parse errors & initializeFirebase; lint cleanup

Summary:

- Root cause: Parse error in `js/ui/affiliateModal.js` plus missing `initializeFirebase` export/implementation caused runtime errors.
- Fixes:
  - Implemented `initializeFirebase()` in `js/services/firebaseService.js` and exported it.
  - Added `globalThis.initializeFirebase = initializeFirebase` as a temporary alias for callers that still call `initializeFirebase()` as a global function.
  - Fixed parse/exception issues (`parseCoupangText`), undefined error references in `scrapService.js`, and reduced several lint warnings.
  - Removed/cleaned unused imports related to migrationService (migration feature removed)

Tests:

- Full test-suite run completed locally: all suites passed after the latest changes (including new draft-detection tests).
- `npm run build` compiles successfully

Lint:

- ESLint: 0 errors, ~29 warnings (mostly `no-unused-vars`)

Additional change (this push):

 - `js/services/aiService.js`: switched the hard-coded `CONSTANTS.USER_ID` to the dynamic `getCurrentUserId()` when uploading AI-generated images so uploads go under the correct per-user path instead of `default_user`.
  - `js/ui/workspaceMode.js` + `js/ui/kanbanMode.js`: added a centralized `isMeaningfulDraft` helper (improved heuristics) and updated UI logic so link-only/placeholder drafts and object-only draft metadata are not treated as meaningful. This includes new and updated tests that ensure Markdown-link-only or bare-URL-only outputs do not cause '초안 완료' badges, action-button flips, or thumbnail/button changes.
  Notes & Follow-up:
- Remove `globalThis.initializeFirebase` alias and convert all callers to `import { initializeFirebase }`.
- Address remaining `no-unused-vars` warnings via small PRs grouped by file.
- Consider splitting large files (`workspaceMode.js`, `dashboardMode.js`) into smaller modules.

Usage:

- Create a draft PR from branch `feature/cascade-delete-improvements` to `Master` and reference this PR body.

PR created by Copilot (local tool) - please review details and CI results before merging.
