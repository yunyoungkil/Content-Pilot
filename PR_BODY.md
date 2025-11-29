PR Title: fix(ui): parse errors & initializeFirebase; lint cleanup

Summary:
- Root cause: Parse error in `js/ui/affiliateModal.js` plus missing `initializeFirebase` export/implementation caused runtime errors.
- Fixes:
  - Implemented `initializeFirebase()` in `js/services/firebaseService.js` and exported it.
  - Added `globalThis.initializeFirebase = initializeFirebase` as a temporary alias for callers that still call `initializeFirebase()` as a global function.
  - Fixed parse/exception issues (`parseCoupangText`), undefined error references in `scrapService.js`, and reduced several lint warnings.
  - Removed/cleaned unused imports in `migrationService.js`, `thumbnailService.js`, etc.

Tests:
- `npm test` passes locally: 10 suites, 99 tests passed (8 skipped)
- `npm run build` compiles successfully

Lint:
- ESLint: 0 errors, ~29 warnings (mostly `no-unused-vars`)

Notes & Follow-up:
- Remove `globalThis.initializeFirebase` alias and convert all callers to `import { initializeFirebase }`.
- Address remaining `no-unused-vars` warnings via small PRs grouped by file.
- Consider splitting large files (`workspaceMode.js`, `dashboardMode.js`) into smaller modules.

Usage:
- Create a draft PR from branch `feature/cascade-delete-improvements` to `Master` and reference this PR body.

PR created by Copilot (local tool) - please review details and CI results before merging.
