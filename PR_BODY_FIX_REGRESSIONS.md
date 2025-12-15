# Fix UI Regressions: Cursor Blinking & Data Load

## Issues Addressed
1.  **Cursor Blinking**: The title input and other fields in the "Publish Info" panel were losing focus (causing cursor blinking) because the panel was being destroyed and recreated on every update (e.g., auto-save or partial render).
2.  **Data Load Failure**: When leaving the workspace to return to the Kanban board, the data loading process sometimes failed to update the UI, leaving the board in a "Loading..." state if the initial request callback was dropped.

## Changes
### `js/ui/workspaceMode.js`
- Modified `showPublishInfo` to check for an existing `publish-info-panel` before creating a new one.
- If the panel exists, it now updates the input values (title, SEO title, permalink, tags) in place, preserving focus and preventing DOM thrashing.
- Removed the unconditional removal of the existing panel at the start of the function.

### `js/ui/kanbanMode.js`
- Updated the fallback logic in `loadKanbanData`.
- If the initial `get_kanban_data` request times out (callback not fired), the retry request now includes a callback to ensure `updateKanbanUI` is called when the data arrives.

## Verification
- **Cursor Blinking**: Open a workspace, type in the title field. The cursor should remain stable, and focus should not be lost even if auto-save triggers.
- **Data Load**: Open a workspace, then click "Back to Dashboard". The Kanban board should load reliably every time.
