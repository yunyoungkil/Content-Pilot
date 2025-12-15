# Fix: Save Idea Title button stuck state

## Issue
The "Save Idea Title" button would sometimes get stuck in a "saving" state (disabled) if the save operation didn't complete successfully or if the UI didn't refresh as expected. This prevented users from saving subsequent changes.

## Changes
- Added a safety timeout (5 seconds) to `doSaveTitleImpl` in `js/ui/workspaceMode.js`.
- If the save callback doesn't run within 5 seconds, the `_isSaving` flag is forcibly reset.
- The save button is re-enabled if the current input value differs from the last known saved title.
- Added a regression test `test/workspaceMode.repeatedSave.test.js` to verify:
    - Repeated saves work normally.
    - The timeout mechanism correctly resets the state and re-enables the button.

## Verification
- Run `npm test test/workspaceMode.repeatedSave.test.js` to verify the fix.
