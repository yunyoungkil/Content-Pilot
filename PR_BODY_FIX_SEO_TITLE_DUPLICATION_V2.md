# Fix: SEO Title Duplication and Initialization

## Description
This PR addresses the issue where the SEO Title was being duplicated (e.g., "Title - Title") and incorrectly initialized during idea creation.

The fix involves:
1.  **Refactoring:** Moved `normalizeSeoTitle` logic from `js/ui/workspaceMode.js` to `js/utils.js` to make it a shared utility.
2.  **Service-Side Fix (Draft Generation):** Applied `normalizeSeoTitle` within `js/services/aiService.js` (`generateDraftFromIdea`) to ensure the title is normalized *before* it is saved to the database. This ensures that even if the AI returns a duplicated title, it is corrected at the source.
3.  **Initialization Fix:** Updated `js/services/kanbanService.js` to **not** initialize `seoTitle` with the Idea Title during idea creation. The SEO Title field will now remain empty until the draft is generated (or manually entered), aligning with the requirement that "SEO Title is the title that should be entered during draft generation."
4.  **UI Update:** Updated `js/ui/workspaceMode.js` to import the shared utility.
5.  **Test Updates:** Updated tests to reflect the refactoring.

## Changes
-   `js/utils.js`: Added `normalizeSeoTitle` function.
-   `js/ui/workspaceMode.js`: Removed `normalizeSeoTitle` definition and added import.
-   `js/services/aiService.js`: Imported `normalizeSeoTitle` and applied it in `generateDraftFromIdea`.
-   `js/services/kanbanService.js`: Removed fallback to `title` in `seoTitle` initialization.
-   `test/repro_issue_30.test.js`: Updated imports.
-   `test/integration_issue_30.test.js`: Updated imports.

## Verification
-   Ran `npm test test/repro_issue_30.test.js` and `npm test test/integration_issue_30.test.js` to verify the fix and ensure no regressions.
-   Verified that `seoTitle` is not pre-filled upon idea creation.
-   Verified that `seoTitle` is correctly populated and normalized during draft generation.
