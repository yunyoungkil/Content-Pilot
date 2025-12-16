# Fix: Briefing status tag not updating in real-time (#33)

## Description
This PR fixes the issue where the "Briefing" status tag on Kanban cards would not update immediately after generating a briefing or clicking retry. Previously, the user had to wait for a full Kanban board refresh or manually reload to see the status change.

## Changes
- **`js/ui/kanbanMode.js`**:
    - Implemented `updateCardBadgesInPlace(cardId, newBadges)` to update the card's badge DOM directly without a full re-render.
    - Exported `updateCardBadgesInPlace`.
    - Added `updateCardBadgesInPlace` call in the retry button handler to provide immediate feedback.
- **`js/ui/workspaceMode.js`**:
    - Imported `updateCardBadgesInPlace`.
    - Called `updateCardBadgesInPlace` immediately when "Generate Briefing" is triggered (optimistic update).
    - Called `updateCardBadgesInPlace` immediately when "Retry" is clicked (optimistic update).
- **Tests**:
    - Added `test/kanbanMode.briefingBadge.ui.test.js` to verify `updateCardBadgesInPlace` logic.
    - Hardened `test/workspaceMode.repeatedSave.test.js` and others to reduce flakiness by replacing fixed waits with polling loops and adding proper DOM cleanup.

## Verification
- Ran `npm test test/kanbanMode.briefingBadge.ui.test.js` -> **Passed**.
- Ran full test suite -> **Passed** (82 passed, 1 skipped).
