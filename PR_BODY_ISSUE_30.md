# Fix: Normalize SEO Title to Prevent Duplication (Issue #30)

## Description
This PR fixes the bug where the Idea Title was being duplicated in the SEO Title field (e.g., "Idea Title - Idea Title" or "Idea Title : Idea Title").

## Changes
- **`js/ui/workspaceMode.js`**:
  - Added `normalizeSeoTitle` helper function to detect and collapse duplicated title patterns.
  - Updated `applyDraftResponseToIdea` to normalize `seoTitle` before applying it to the idea data.
  - Updated `showPublishInfo` to normalize `seoTitle` before rendering or saving.
  - Added support for various separators: ` - `, ` | `, `: `, ` : `, and space.

## Tests
- Added `test/repro_issue_30.test.js`: Unit tests for `normalizeSeoTitle` and `applyDraftResponseToIdea`.
- Added `test/integration_issue_30.test.js`: Integration tests simulating the full flow from Idea Creation -> AI Draft Generation -> Application.
- Verified that `normalizeSeoTitle` correctly handles:
  - "Title - Title" -> "Title"
  - "Title : Title" -> "Title"
  - "Title Title" -> "Title"
  - "Title" -> "Title" (no change)
  - "Title - Subtitle" -> "Title - Subtitle" (no change)

## Related Issue
- Closes #30
