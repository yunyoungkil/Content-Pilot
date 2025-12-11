**Bug:** Channel platformType lost on Save All after relogin

**Summary**
- When saving channel data after relogin (or when a subsequent change occurs), the first channel's `platformType` value may be lost when the incoming payload doesn't include `platformType`. The background `set()` call overwrites the DB entry and deletes the missing field.

**Reproduction**
1. Add a channel (ch1) and ensure its `platformType` is `tistory`.
2. Save via Save All (payload includes `platformType`).
3. Logout/relogin (background fetch returns a list that may lack `platformType`).
4. Add a second channel (ch2) and click Save All again.
5. Observe DB: `ch1.platformType` is missing (overwritten by `set()` with incoming payload).

**Expected**
- `ch1.platformType` should remain `tistory` after the second save.

**Actual**
- `ch1.platformType` becomes undefined: the server `set()` call replaced the record without preserving missing fields.

**Root cause**
- Frontend: When the server returns channel entries that omit `platformType` (or when UI state loses `platformType`), subsequent `save_channels_and_key` payloads might omit `platformType` for some entries.
- Backend: `channels/${userId}` was written using `set()` which overwrites the full node, causing missing properties to be removed.

**Fix applied**
- Frontend: Ensure `platformType` defaults or preserves local values before saving; `Apply` now updates UI locally and `Save All` triggers the backend save. Added defensive mapping in `processChannelDataResponse` and `saveChannelsToFirebase` to preserve `platformType`.
- Backend: Read existing DB data and merge missing fields (like `platformType`) from existing records before `set()`. Implemented `mergeBlogsPreservePlatform` helper (deterministic id matching) and used it in `save_channels_and_key` handler.

**Files changed**
- js/ui/channelMode.js — Ensure Apply local-only; Save All uses normalized payload and preserves `platformType` during payload generation.
- js/services/channelUtils.js — `genId()` and `mergeBlogsPreservePlatform` added/updated.
- background.cjs & background.js — Read existing DB and merge `platformType` before `set()`.
- test/channelMode.* — UI tests to assert Apply vs Save All behavior and `platformType` preservation.
- test/background.save_channels_and_key.test.js — Backend unit test that verifies merged `platformType` is preserved.

**Notes**
- The fix includes both defensive frontend and backend changes to avoid single-point failure.
- Added tests to prevent regressions.

**Suggested follow-ups**
- Replace `set()` with a more robust update/merge strategy in the backend if possible, and always preserve unknown fields.
- Clean up debug logs before merge.

<!-- You can add labels and assignees on GitHub -->
