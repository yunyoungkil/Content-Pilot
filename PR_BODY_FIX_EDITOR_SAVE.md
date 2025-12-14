# Fix: Editor Save Not Persisting (#25)

## Description
This PR addresses the issue where editor content changes are not being saved. 
It adds comprehensive debug logging to the save flow and fixes potential message passing issues.

## Changes
1.  **Editor (editor.js)**:
    *   Added timestamp (`ts`) to `cp_save_draft` messages to track latency and ordering.
    *   Added `Logger.debug` calls when sending save messages.

2.  **Workspace (js/ui/workspaceMode.js)**:
    *   Added logging when `cp_save_draft` is received.
    *   Added logging for the "draft deletion block" logic to see if saves are being suppressed.
    *   Added timestamp (`ts`) to the `save_idea_draft` message sent to the background script.
    *   Added error handling around `chrome.runtime.sendMessage`.

3.  **Tests**:
    *   Added `test/workspaceMode.saveDraft.ui.test.js` to verify the save message flow.
    *   Verified that empty content is correctly filtered out.

## Verification
*   Run `npm test -- test/workspaceMode.saveDraft.ui.test.js` to verify the fix.
*   Check the browser console for `[Editor]` and `[Workspace]` logs to trace the save flow.
