# Fix: SEO Title Duplication in AI Service

## Description
This PR addresses the issue where the SEO Title was being duplicated (e.g., "Title - Title") during AI draft generation.
The fix involves:
1. Moving `normalizeSeoTitle` logic from `js/ui/workspaceMode.js` to `js/utils.js` to make it a shared utility.
2. Applying `normalizeSeoTitle` within `js/services/aiService.js` (specifically in `generateDraftFromIdea`) to ensure the title is normalized *before* it is saved to the database or returned to the UI.
3. Updating `js/ui/workspaceMode.js` to import the shared utility.
4. Updating tests to reflect the refactoring.

## Changes
- `js/utils.js`: Added `normalizeSeoTitle` function.
- `js/ui/workspaceMode.js`: Removed `normalizeSeoTitle` definition and added import.
- `js/services/aiService.js`: Imported `normalizeSeoTitle` and applied it in `generateDraftFromIdea`.
- `test/repro_issue_30.test.js`: Updated imports.
- `test/integration_issue_30.test.js`: Updated imports.

## Verification
- Ran `npm test test/repro_issue_30.test.js` and `npm test test/integration_issue_30.test.js` to verify the fix and ensure no regressions.
- Confirmed that `normalizeSeoTitle` correctly collapses "Title - Title" to "Title".
