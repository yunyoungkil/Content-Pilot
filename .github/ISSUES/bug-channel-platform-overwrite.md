**버그:** 재로그인/저장 후 채널의 `platformType`이 삭제/덮어써지는 문제

**요약**
- 재로그인 후 채널 데이터를 저장하거나 이후 변경을 적용할 때, 들어오는 페이로드에 `platformType`이 누락되면 백엔드의 `set()` 호출이 해당 노드를 전체 덮어써 기존 `platformType`이 사라지는 문제가 있었습니다.

**재현 방법**
1. 채널(ch1)을 추가하고 `platformType`이 `tistory`인지 확인합니다.
2. `Save All`로 저장합니다(이때 전송 페이로드는 `platformType`을 포함함).
3. 로그아웃/재로그인(또는 UI 재로딩)으로 서버 데이터를 다시 읽어옵니다(서버 응답에서 `platformType`이 누락될 수 있음).
4. 두 번째 채널(ch2)을 추가한 뒤 `Save All`을 다시 클릭합니다.
5. DB를 확인하면 `ch1.platformType`이 사라지거나 누락되어 있는 것을 확인할 수 있습니다(서버 `set()`으로 덮어쓰기 발생).

**기대 동작**
- 서버 응답에 `platformType`이 누락되어도, 클라이언트는 이전에 알고 있던 값(로컬 상태 혹은 기존 DB 값)을 보존해야 합니다.

**원인 분석**
- 프론트엔드: 서버 응답을 재매핑하는 과정(`blogs.map(...)`)에서 `platformType`이 없으면 기본값을 덮어쓰거나 누락된 상태로 전송하는 경우가 발생했습니다.
- 백엔드: `save_channels_and_key` 핸들러가 전체 노드를 `set()`으로 덮어써서, 페이로드에 누락된 필드가 있으면 원래 값을 잃게 됩니다.

**적용된 수정 사항**
- 프런트엔드: `processChannelDataResponse` 및 `saveChannelsToFirebase`에서 `platformType`이 누락된 항목이 있으면 기존 로컬값을 보존하거나 전송 전에 보정하도록 방어 로직을 추가했습니다. 또한 `Apply`는 로컬 변경만 수행하고, 실제 서버 저장은 `Save All`에서 처리하도록 동작을 명확히 분리했습니다.
- 백엔드: 기존 DB를 읽어 들어온 페이로드와 병합(누락 필드 보존)한 뒤 `set()`을 수행하도록 변경했습니다. 이를 위해 `mergeBlogsPreservePlatform` 유틸을 도입했고, `save_channels_and_key` 핸들러에서 사용합니다.

**변경된 파일(주요)**
- `js/ui/channelMode.js` — `Apply` 동작을 로컬 전용으로 변경, `Save All`에선 보정된 페이로드 전송
- `js/services/channelUtils.js` — `genId()` 및 `mergeBlogsPreservePlatform` 추가/수정
- `background.cjs`, `background.js` — DB에서 기존 데이터를 읽어 병합 후 `set()` 수행
- `test/channelMode.*` — Apply/Save 행위 및 `platformType` 보존 관련 테스트 추가/수정
- `test/background.save_channels_and_key.test.js` — 병합 동작 검증 유닛 테스트 추가

**비고**
- 프런트엔드와 백엔드 모두 방어 로직을 적용하여 회귀 가능성을 낮췄습니다.
- 관련 커밋: `e77c088` (Master에 병합 및 푸시 완료). 문서화: `docs/bugs/relogin_platform_overwrite.md`에 상세 기록되어 있습니다.

<!-- You can add labels and assignees on GitHub -->
