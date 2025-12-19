# Fix: Reference Images in Thumbnail Maker

## Issue

The "Reference Images" UI in the thumbnail maker was displaying "(None)" even when images were present in the editor. Additionally, the priority logic (Editor > Linked Materials > Affiliate Images) appeared to be broken.

## Root Causes

1.  **Data Synchronization**: The `formattedDraft` in `window.__cp_workspace_idea_data` was not being updated in real-time as the user edited the content. This meant the modal often received an empty or stale draft string.
2.  **Stale Closure in Event Handler**: The "Create Thumbnail" button's `onclick` handler was closing over the initial `ideaData` object passed when the workspace was first rendered. Even if `window.__cp_workspace_idea_data` was updated later (e.g., after a save or reload), the button handler still referred to the old object, which didn't have the latest draft content.
3.  **Aggressive Filtering**: The `selectBackgroundReferenceImages` function in `aiService.js` explicitly filtered out URLs containing `firebasestorage.googleapis.com`. Since user-uploaded images are stored in Firebase, they were being ignored, causing "Priority 1" (Editor images) to fail.

## Changes

1.  **`js/ui/workspaceMode.js`**:
    - Updated the `content-changed` event listener to immediately sync the latest editor content to `window.__cp_workspace_idea_data.formattedDraft`.
    - Modified `renderThumbnailButton` to use `window.__cp_workspace_idea_data` (the global reference) inside the `onclick` handler instead of the closed-over `ideaData` argument. This ensures the button always opens the modal with the freshest data.
    - Added debug logs to trace data flow.

2.  **`js/services/aiService.js`**:
    - Modified `selectBackgroundReferenceImages` to remove the exclusion of Firebase Storage URLs.
    - Now, all valid image URLs found in the editor (including uploaded ones) are candidates for reference images.
    - Added debug logs.

3.  **`test/aiService.test.js`**:
    - Updated the `selectBackgroundReferenceImages` test case to verify that Firebase URLs are correctly identified and returned in the prioritized list.

## Verification

- Ran `npm test -- -t 'selectBackgroundReferenceImages'` and confirmed it passes.
- The logic now correctly prioritizes:
  1.  Images in the Draft (including Firebase uploads)
  2.  Linked Scraps
  3.  Affiliate Links
