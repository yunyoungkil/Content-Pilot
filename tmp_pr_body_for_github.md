PR Title: fix(ui): parse errors & initializeFirebase; lint cleanup

Summary:

- Root cause: Parse error in `js/ui/affiliateModal.js` plus missing `initializeFirebase` export/implementation caused runtime errors.
- Fixes:
  - Implemented `initializeFirebase()` in `js/services/firebaseService.js` and exported it.
  - Added `globalThis.initializeFirebase = initializeFirebase` as a temporary alias for callers that still call `initializeFirebase()` as a global function.
  - Fixed parse/exception issues (`parseCoupangText`), undefined error references in `scrapService.js`, and reduced several lint warnings.
  - Removed/cleaned unused imports related to migrationService (migration feature removed)

Tests:

- `npm test` passes locally: 10 suites, 99 tests passed (8 skipped)
- `npm run build` compiles successfully

Lint:

- ESLint: 0 errors, ~29 warnings (mostly `no-unused-vars`)

Additional change (this push):

- `js/services/aiService.js`: switched the hard-coded `CONSTANTS.USER_ID` to the dynamic `getCurrentUserId()` when uploading AI-generated images so uploads go under the correct per-user path instead of `default_user`.

Notes & Follow-up:

- Remove `globalThis.initializeFirebase` alias and convert all callers to `import { initializeFirebase }`.
- Address remaining `no-unused-vars` warnings via small PRs grouped by file.
- Consider splitting large files (`workspaceMode.js`, `dashboardMode.js`) into smaller modules.

---

CI / Tests: 12 suites passed, 101 tests passed, 8 skipped

Files modified in this branch (high level):

- `js/services/aiService.js`
- `js/services/analyticsService.js`
