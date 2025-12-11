Fixes and tests for: compose-thumbnail-text checkbox + scrap link drag/drop

What I changed

- js/ui/workspaceMode.js
  - Ensure the `compose-thumbnail-text` checkbox is inserted and persisted when present; placed the wrapper as the first child of the action-buttons container.
  - Attach `dragstart` listeners to non-linked scrap cards rendered in the "All scraps" list so they set an `application/json` payload when dragged.
  - Added diagnostic console.debug logs around the linked-scrap drop/link flow to make troubleshooting easier.

- Tests
  - Added test/workspaceMode.scrapLinking.ui.test.js — simulates dragstart on an unlinked scrap and dropping into the linked scraps list; asserts that `link_scrap_to_idea` is called and the DOM updates.
  - Updated test/workspaceMode.thumbnailPersistence.ui.test.js — verifies the compose-thumbnail-text checkbox presence, persisted state from storage, and placement.

Validation

- Ran full test suite: 41 test suites / 238 tests (all passing, 7 skipped in CI) — local run passed.
- Ran webpack build: bundles compiled successfully (warnings about large bundles and some image tooling; not related to the fix).

Why this fixes the user-reported problem

- The missing dragstart handler on non-linked scrap cards prevented the drop handler from receiving the JSON payload, so dropping never produced the expected `link_scrap_to_idea` message. Adding the listener ensures `dataTransfer` contains the necessary payload, enabling the existing drop-path to operate correctly.

Notes / follow-ups

- Recommended to test in an actual extension runtime because jsdom tests pass but the extension background/runtime environment differs slightly (message handlers, storage latency, etc.).
- Consider adding an E2E test or a browser test harness to cover the full front-to-back linking flow in a real environment.
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
