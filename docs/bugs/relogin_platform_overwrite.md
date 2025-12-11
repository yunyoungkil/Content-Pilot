# Bug: Channel platformType overwritten or reset after relogin/save

## 증상 (Observed)
- 사용자 A가 채널1(티스토리)를 추가하고 저장합니다.
- 로그아웃/재로그인 또는 새로고침으로 UI를 다시 로드한 뒤 채널2(네이버)를 추가하고 `설정 저장하기`를 클릭하면 채널1의 `platformType`이 사라지거나 `naver`로 잘못 덮어써집니다.

## 원인 (Root Cause)
- 프론트엔드가 서버에서 내려온 채널 목록을 `myChannelsData = blogs.map(...)`로 재매핑하는 과정에서 서버 응답에 `platformType` 값이 누락된 경우 기본값('naver')으로 세팅했습니다.
- 백엔드는 `save_channels_and_key` 액션에서 Firebase `set()`으로 전체 구조를 덮어써서, payload에 `platformType`이 빠져 있는 경우 DB에 영구적으로 반영되어 데이터가 삭제/변경됩니다.

## 재현 단계 (Repro)
1. 로그인 상태에서 채널 1(티스토리)을 추가하고 Save All 클릭.
2. 로그아웃/재로그인(또는 UI 재렌더)하여 서버의 채널 목록을 다시 불러옵니다.
3. 기존 채널 목록을 불러오는 중에 server response에서 `platformType`이 없거나 누락되는 경우를 가정.
4. 채널 2(네이버)를 추가하고 Save All을 클릭하면 채널1의 `platformType`이 사라지거나 `naver`로 변경됩니다.

## 기대 동작 (Expected)
- 서버 응답에 `platformType`이 누락되어도, 클라이언트가 이전에 알고 있던 `platformType` 값(로컬 상태 또는 기존값)을 유지해야 합니다.
- Save All이 전송하는 payload에 `platformType`이 항상 포함되어야 하며, 백엔드가 필드를 보호하거나 병합할 수 있도록 해야 합니다.

## 조치 (Fixes implemented)
- `js/ui/channelMode.js`
  - `processChannelDataResponse` / `loadChannelData` / `openDetailModal` 시 매핑 로직 변경: 서버 응답에 `platformType`이 없는 경우 이전 `myChannelsData`에서 값을 찾아 보존하도록 수정.
  - `saveChannelsToFirebase`에서 전송 직전 `platformType`이 없는 채널이 존재하면 기본값('naver')을 채워 전송하도록 방어 처리 추가.
  - 모달 `Apply`는 로컬 상태 갱신 전용으로 변경(즉시 저장 제거), `설정 저장하기` 버튼에서 일괄 저장 처리.
- 추가 회귀 테스트 추가 3건
  - `test/channelMode.relogin_platform_overwrite.test.js` (리로그인 후 덮어쓰기 방지)
  - `test/channelMode.save_platform_default.test.js` (서버 응답 누락 시 기본 platformType 포함 테스트)
  - `test/channelMode.preserve_platform_on_reload.test.js` (서버에 타입이 없을 때 로컬 보존 유지)

## 권장(후속) 작업
- 백엔드(Firebase 저장)에서 전체 overwrite(`set`)가 아닌 '병합' 또는 각 채널 객체 필드별 `update`를 사용해 누락 필드로 인한 데이터 손실을 방지하는 것을 권장합니다.
- CI/QA에서 다음 시나리오를 광범위하게 테스트하세요:
  - 여러 클라이언트 동시 수정
  - 서버 응답 일부 필드 누락(오래된 버전 데이터)
  - 로그인/로그아웃/다중 탭 시 동기화

## PR 내용 요약(제안)
- 본 변경 사항은 프런트엔드에서 `platformType`을 보존하도록 수정했고, Save All 전송 보정을 추가했습니다. 테스트와 문서를 포함한 PR을 별도로 생성합니다.

## 관련 테스트
- `test/channelMode.*` 수트에서 Platform 관련 테스트 그룹이 모두 통과해야 합니다.


---

*문서 자동 생성: 채널 플랫폼 덮어쓰기 버그 수정 브랜치*