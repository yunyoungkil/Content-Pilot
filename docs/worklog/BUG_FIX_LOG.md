# 버그 해결 로그 (Bug Fix Log)

이 문서는 Content Pilot 프로젝트에서 발생한 버그와 해결 방법을 기록합니다.

## 📋 목차

1. [버그 기록 형식](#버그-기록-형식)
2. [해결된 버그](#해결된-버그)
3. [알려진 이슈](#알려진-이슈)
4. [에러 패턴](#에러-패턴)

---

## 버그 기록 형식

각 버그는 다음 형식으로 기록합니다:

```markdown
### 버그 제목

**발견 일자**: YYYY-MM-DD
**심각도**: Critical / High / Medium / Low
**상태**: 해결됨 / 진행 중 / 알려진 이슈

**증상**:
- 버그 증상 설명

**원인**:
- 버그 원인 분석

**해결 방법**:
- 해결 방법 설명
- 관련 파일 및 코드

**관련 파일**:
- `파일 경로`

**참고**:
- 추가 참고 사항
```

---

## 해결된 버그

### 대시보드 포스팅 리스트 태그 생성 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 대시보드 포스팅 리스트에서 태그가 제대로 표시되지 않음
- RSS 피드에 태그가 없으면 "관련 태그 없음" 또는 "태그 분석 예정..."만 표시됨
- HTML 메타 태그에 태그 정보가 있어도 활용하지 않음
- 본문에서 키워드를 추출하지 못함

**원인**:
- `extractKeywords` 함수는 이미 구현되어 있었지만, HTML 메타 태그에서 태그를 추출하지 않음
- 태그 추출 우선순위가 명확하지 않음
- RSS 피드에 태그가 없으면 다른 소스를 확인하지 않음

**해결 방법**:
1. HTML 메타 태그에서 태그 추출 기능 추가
   - `<meta name="keywords">` 태그에서 추출
   - `<meta property="article:tag">` 태그에서 추출 (Open Graph)
   - 카테고리/태그 링크에서 추출 (`/category/`, `/tag/` 등)
   - 위치: `offscreen.js:459-483`

2. 태그 추출 우선순위 개선
   - 1순위: RSS 피드 태그 (`<category>`, `<dc:subject>`, `<tag>`)
   - 2순위: HTML 메타 태그 (`<meta name="keywords">`, `<meta property="article:tag">`, 카테고리/태그 링크)
   - 3순위: 본문 키워드 추출 (`extractKeywords` 함수)
   - 위치: `js/services/collectorService.js:187-199, 537-540`

3. `parseHtmlInOffscreen` 함수 반환값 확장
   - `metaTags` 필드 추가
   - 위치: `js/services/offscreenService.js:157-170`

**관련 파일**:
- `offscreen.js` (459-483번 라인: HTML 메타 태그 추출)
- `js/services/offscreenService.js` (157-170번 라인: parseHtmlInOffscreen 함수)
- `js/services/collectorService.js` (187-199, 537-540번 라인: 태그 추출 우선순위)

**기술적 세부사항**:
- HTML 메타 태그 추출은 오프스크린 서비스에서 수행
- 카테고리/태그 링크는 정규식으로 URL 패턴 매칭
- 중복 태그는 `Set`을 사용하여 제거
- 태그 추출 실패 시 다음 우선순위로 자동 전환

**참고**:
- `extractKeywords` 함수는 이미 구현되어 있었음 (한글 단어 추출, 불용어 제거, 빈도 기반)
- 이제 RSS 피드에 태그가 없어도 HTML 메타 태그나 본문에서 태그를 추출할 수 있음
- 태그 추출 성공률이 크게 향상됨

**테스트 방법**:
1. RSS 피드에 태그가 없는 블로그 포스트 수집
2. HTML 메타 태그에 태그가 있는지 확인
3. 대시보드에서 태그가 표시되는지 확인
4. 태그 클릭 필터링이 작동하는지 확인

---

### HTML 복사 기능 (JSON-LD 포함) 1회성 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- HTML 복사 버튼을 클릭할 때 JSON-LD 스키마가 처음 한 번만 포함되고, 이후 업데이트가 반영되지 않음
- 발행 정보가 업데이트되어도 HTML 복사 시 이전 JSON-LD 스키마가 포함됨
- `seoTitle`이나 `draftContent`도 최신 값이 반영되지 않음

**원인**:
- HTML 복사 버튼의 이벤트 리스너가 클로저로 `ideaData`와 `seoTitle`을 캡처하여 `showPublishInfo` 함수가 호출될 때의 값만 사용
- 이벤트 리스너가 등록된 시점의 데이터만 참조하여, 나중에 데이터가 업데이트되어도 이전 값을 사용
- `window.__cp_workspace_idea_data`를 확인하지만 우선순위가 낮아서 최신 데이터를 제대로 반영하지 못함

**해결 방법**:
1. 이벤트 리스너 내부에서 항상 최신 데이터 참조
   - `window.__cp_workspace_idea_data`를 우선적으로 참조하도록 수정
   - `seoTitle`도 최신 `publishInfo`나 `ideaData`에서 가져오도록 수정
   - `draftContent`도 최신 `workspace.draft`에서 가져오도록 수정
   - 관련 파일: `js/ui/workspaceMode.js` (969-1030번 라인)

2. 데이터 참조 순서 개선
   - `currentIdeaData = window.__cp_workspace_idea_data || ideaData`로 최신 데이터 우선 참조
   - `currentPublishInfo`를 통해 최신 발행 정보 참조
   - `currentSeoTitle`을 통해 최신 SEO 제목 참조

**관련 파일**:
- `js/ui/workspaceMode.js` (969-1030번 라인: HTML 복사 버튼 이벤트 리스너)

**기술적 세부사항**:
- 클로저로 캡처된 변수는 이벤트 리스너가 등록된 시점의 값만 참조
- 런타임에 최신 데이터를 참조하도록 수정하여 항상 최신 값 사용
- `window.__cp_workspace_idea_data`는 워크스페이스가 열릴 때마다 업데이트되므로 최신 데이터 보장

**참고**:
- 이전에는 `ideaData`와 `seoTitle`을 클로저로 캡처하여 이전 값을 사용했음
- 이제는 이벤트 리스너 내부에서 항상 최신 데이터를 참조하도록 수정
- JSON-LD 스키마, SEO 제목, 초안 내용 모두 최신 값이 반영됨

**테스트 방법**:
1. 워크스페이스에서 발행 정보 업데이트 (JSON-LD 스키마 포함)
2. HTML 복사 버튼 클릭
3. 복사된 HTML에 최신 JSON-LD 스키마가 포함되어 있는지 확인
4. 발행 정보를 다시 업데이트하고 HTML 복사 버튼을 다시 클릭
5. 최신 JSON-LD 스키마가 반영되는지 확인

---

### 발행 정보 퍼머링크 태그 1회성 적용 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 발행 정보의 퍼머링크와 태그가 처음 한 번만 적용되고, 이후 업데이트가 되지 않음
- 워크스페이스를 다시 열거나 발행 정보를 수정해도 퍼머링크와 태그가 업데이트되지 않음
- `showPublishInfo` 함수가 호출되어도 Firebase에 업데이트가 반영되지 않음

**원인**:
- `showPublishInfo` 함수에서 Firebase 업데이트를 할 때, 기존 `publishInfo`의 다른 필드들이 유지되지 않음
- `permalink`나 `tags`가 제공되었을 때만 업데이트하고, 기존 값이 있으면 업데이트하지 않음
- `publishInfoUpdates` 객체에 기존 필드들을 병합하지 않아서 일부 필드가 손실됨

**해결 방법**:
1. `showPublishInfo` 함수에서 기존 `publishInfo` 필드 유지 로직 추가
   - `publishInfoUpdates`에 기존 `publishInfo`의 다른 필드들도 병합
   - `permalink`나 `tags`가 제공되었을 때 항상 업데이트하도록 수정
   - 빈 문자열이 제공되었지만 기존 값이 있으면 유지하도록 처리
   - 관련 파일: `js/ui/workspaceMode.js` (808-849번 라인)

2. 로깅 개선
   - Firebase 업데이트 성공 시 로그 추가
   - 디버깅을 위한 상세 로그 추가

**관련 파일**:
- `js/ui/workspaceMode.js` (808-849번 라인: showPublishInfo 함수)

**기술적 세부사항**:
- `publishInfoUpdates` 객체에 기존 `publishInfo`의 모든 필드를 병합하여 필드 손실 방지
- `Object.keys(ideaData.publishInfo).forEach`를 사용하여 기존 필드들을 순회하며 병합
- `hasOwnProperty`를 사용하여 중복 필드 방지

**참고**:
- 이전에는 `publishInfoUpdates`에 새로운 필드만 추가하여 기존 필드가 손실되었음
- 이제는 기존 필드를 유지하면서 새로운 필드만 업데이트하도록 수정
- `thumbnailInfo`, `jsonLdSchema` 등 다른 필드들도 유지됨

---

### 스크랩 삭제 기능이 작동하지 않는 문제

**발견 일자**: 2024-12-XX
**심각도**: High
**상태**: 해결됨

**증상**:
- 스크랩북에서 스크랩 삭제 버튼을 클릭해도 삭제가 되지 않음
- 삭제 확인 메시지가 표시되지만 실제로는 삭제되지 않음
- 에러 메시지가 표시되지 않아 사용자가 문제를 인지하기 어려움

**원인**:
- `chrome.runtime.sendMessage` 호출 시 `chrome.runtime.lastError`를 확인하지 않음
- 삭제 실패 시 에러 메시지가 표시되지 않음
- 스크랩 ID가 없을 때의 예외 처리가 없음
- 삭제 성공/실패에 대한 사용자 피드백이 없음

**해결 방법**:
1. 에러 처리 강화
   - `chrome.runtime.lastError` 확인 로직 추가
   - 스크랩 ID 유효성 검사 추가
   - 삭제 실패 시 에러 메시지 표시
   - 관련 파일: `js/ui/scrapbookMode.js` (376-391번 라인)

2. 사용자 피드백 개선
   - 삭제 성공 시 성공 메시지 표시
   - 삭제 실패 시 실패 메시지와 에러 내용 표시
   - 콘솔에 상세 에러 로그 출력

**관련 파일**:
- `js/ui/scrapbookMode.js` (376-391번 라인: 스크랩 삭제 이벤트 리스너)
- `js/services/scrapService.js` (235-251번 라인: deleteScrap 함수)
- `background.js` (1336-1340번 라인: delete_scrap 액션 처리)

**기술적 세부사항**:
- `chrome.runtime.lastError`는 확장 프로그램이 비활성화되었거나 메시지 전송에 실패했을 때 발생
- `showToast` 함수를 사용하여 사용자에게 피드백 제공
- `console.error`를 사용하여 개발자 도구에 상세 에러 로그 출력

**참고**:
- `background.js`에서 `deleteScrap` 함수가 제대로 import되어 있고 호출되고 있음
- `scrapService.js`의 `deleteScrap` 함수는 정상적으로 작동함
- 문제는 UI 레벨에서 에러 처리가 부족했던 것

**테스트 방법**:
1. 스크랩북에서 스크랩 삭제 버튼 클릭
2. 확인 메시지에서 "확인" 클릭
3. 삭제 성공 시 성공 메시지 확인
4. 삭제 실패 시 에러 메시지 확인
5. 개발자 도구 콘솔에서 에러 로그 확인

---

### Shadow DOM 스타일 격리 문제 (외부 페이지 스타일 침투)

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 프로그램 UI에 접속해 있는 페이지의 스타일이 적용되는 것 같음
- Shadow DOM을 사용하고 있음에도 불구하고 외부 페이지의 일부 스타일(폰트, 색상 등)이 UI에 영향을 미침
- 다른 웹사이트에서 확장 프로그램을 열 때마다 UI 스타일이 달라 보일 수 있음

**원인**:
- Shadow DOM은 기본적으로 스타일을 격리하지만, 일부 CSS 속성은 상속될 수 있음
  - `font-family`, `color`, `line-height` 등 상속 가능한 속성
  - CSS 변수(`--variable-name`)는 Shadow DOM 경계를 넘어 전파될 수 있음
  - `all: initial` 같은 강력한 리셋이 없어서 외부 페이지의 전역 스타일이 영향을 미칠 수 있음
- `css/style.css`에 Shadow DOM용 명시적인 리셋 스타일이 없었음
- Shadow DOM 내부 요소들에 대한 기본 스타일 리셋이 부족함

**해결 방법**:
1. Shadow DOM 루트 요소(`:host`)에 최소한의 리셋 스타일 추가
   - `font-family`, `font-size`, `line-height`, `color` 등 상속 가능한 속성만 명시적 설정
   - `!important` 플래그 사용하지 않음 (기존 스타일과의 충돌 방지)
   - `text-align`, `direction` 등 레이아웃 관련 속성만 명시적 설정
   - 관련 파일: `css/style.css` (1-30번 라인)

2. Shadow DOM 내부 모든 요소에 `box-sizing`만 강제 적용
   - `:host *` 선택자를 사용하여 모든 자식 요소에 `box-sizing: border-box`만 적용
   - 기존 컴포넌트 스타일(margin, padding, background 등)은 유지
   - 관련 파일: `css/style.css` (25-30번 라인)

3. Shadow DOM 생성 로직 확인
   - `js/ui/panel.js`의 `createAndShowPanel()` 함수에서 Shadow DOM 생성 및 스타일 링크 추가 로직 확인
   - `style.css`가 Shadow DOM 내부에 올바르게 로드되는지 확인
   - 관련 파일: `js/ui/panel.js` (38-61번 라인)

**주의사항**:
- 기존 컴포넌트 스타일을 유지하기 위해 최소한의 리셋만 적용
- `margin`, `padding`, `background` 등은 기존 스타일이 우선 적용되도록 함
- 외부 페이지의 전역 스타일은 Shadow DOM의 기본 격리 메커니즘으로 대부분 차단됨

**관련 파일**:
- `css/style.css` (1-100번 라인: Shadow DOM 리셋 스타일)
- `js/ui/panel.js` (38-61번 라인: Shadow DOM 생성 로직)

**기술적 세부사항**:
- `:host` 선택자는 Shadow DOM의 호스트 요소를 대상으로 함
- `:host *` 선택자는 Shadow DOM 내부의 모든 자식 요소를 대상으로 함
- `!important` 플래그는 사용하지 않음 (기존 스타일과의 충돌 방지)
- `box-sizing: border-box`만 강제 적용하여 레이아웃 안정성 확보
- Shadow DOM의 기본 격리 메커니즘이 대부분의 외부 스타일을 차단하므로 최소한의 리셋만 필요

**참고**:
- Shadow DOM은 기본적으로 스타일을 격리하므로, 대부분의 외부 스타일은 자동으로 차단됨
- 상속 가능한 속성(`font-family`, `color` 등)만 최소한으로 리셋
- 기존 컴포넌트 스타일을 유지하기 위해 `margin`, `padding`, `background` 등은 리셋하지 않음
- 외부 페이지의 CSS 변수는 Shadow DOM 경계를 넘어 전파될 수 있으나, 현재는 문제가 되지 않음
- 만약 특정 페이지에서 스타일 침투가 발생한다면, 해당 페이지에 맞는 선택적 리셋을 추가할 수 있음

**테스트 방법**:
1. 다양한 웹사이트(예: 구글, 네이버, 유튜브 등)에서 확장 프로그램 UI 열기
2. 각 사이트에서 UI의 폰트, 색상, 레이아웃이 일관되게 표시되는지 확인
3. 개발자 도구에서 Shadow DOM 내부 요소의 계산된 스타일 확인
4. 외부 페이지의 전역 스타일이 Shadow DOM 내부에 영향을 미치지 않는지 확인

---

### 프로그램 업데이트 메시지가 표시되지 않는 버그

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 확장 프로그램이 업데이트되었을 때 사용자에게 알림 메시지가 표시되지 않음
- `extension_updated` 플래그가 설정되어 있어도 메시지가 나타나지 않음
- 사용자가 업데이트를 인지하지 못하여 새로고침을 하지 않음

**원인**:
- `showConfirmationToast` 함수에서 기존 토스트가 있으면 제거한 후 바로 `return`하여 새 메시지를 표시하지 않음
- 기존 토스트가 제대로 제거되지 않았거나, 다른 이유로 토스트가 남아있는 경우 새 메시지가 표시되지 않음
- 로깅이 부족하여 디버깅이 어려움

**해결 방법**:
1. `showConfirmationToast` 함수 수정
   - 기존 토스트를 제거한 후에도 계속 진행하여 새 메시지를 표시하도록 수정
   - `return` 문을 제거하여 기존 토스트 제거 후에도 함수가 계속 실행되도록 함
   - 관련 파일: `js/utils.js` (189-196번 라인)

2. 로깅 개선
   - 업데이트 메시지 표시 과정에 상세한 로깅 추가
   - `extension_updated_time`도 함께 확인하여 업데이트 시간 추적
   - `showConfirmationToast` 함수 호출 여부 확인 로그 추가
   - 관련 파일: `content.js` (103-160번 라인)

**관련 파일**:
- `js/utils.js` (189-196번 라인: showConfirmationToast 함수)
- `content.js` (103-160번 라인: 업데이트 메시지 표시 로직)

**기술적 세부사항**:
- 기존 토스트 제거 로직은 중복 방지를 위한 것이었지만, 새 메시지 표시를 막는 부작용이 있었음
- 기존 토스트를 제거한 후에도 계속 진행하여 새 메시지를 표시하도록 수정
- 로깅을 통해 업데이트 메시지 표시 과정을 추적할 수 있도록 개선

**참고**:
- 이전에 "서비스 워커 업데이트 알림 중복 표시 버그"를 해결하면서 `showConfirmationToast` 함수에 중복 방지 로직을 추가했지만, 이로 인해 새 메시지가 표시되지 않는 문제가 발생함
- 기존 토스트를 제거하는 것은 유지하되, 새 메시지를 표시하는 것은 계속 진행하도록 수정하여 두 문제를 모두 해결

**테스트 방법**:
1. 확장 프로그램을 업데이트 (manifest.json 버전 변경 후 재로드)
2. `background.js`에서 `extension_updated` 플래그가 설정되는지 확인
3. 웹페이지에서 확장 프로그램 UI를 열고 업데이트 메시지가 표시되는지 확인
4. 개발자 도구 콘솔에서 로그 메시지 확인

---

### 서비스 워커 업데이트 알림 중복 표시 버그

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 서비스 워커가 업데이트될 때 "Content Pilot이 업데이트되었습니다. 원활한 사용을 위해 페이지를 새로고침해주세요." 메시지가 새로고침을 하지 않았는데도 계속 표시됨
- 페이지를 새로고침하지 않으면 알림이 반복적으로 나타남

**원인**:
- `reloadPromptShown` 전역 변수만으로는 서비스 워커가 여러 번 업데이트되거나 연결이 여러 번 끊어질 때 중복 방지가 제대로 작동하지 않음
- `showConfirmationToast` 함수에서 기존 토스트를 제거하지만, 제거 후 바로 새로 생성하여 중복 표시 가능
- 페이지 새로고침 없이 서비스 워커가 업데이트될 때마다 알림이 표시됨

**해결 방법**:
1. sessionStorage를 사용하여 시간 기반 중복 방지 로직 추가
   - `RELOAD_PROMPT_KEY`와 `RELOAD_PROMPT_TIMEOUT` (5분) 상수 정의
   - 마지막 표시 시간을 sessionStorage에 저장
   - 5분 이내에 다시 표시되지 않도록 체크
   - 관련 파일: `content.js`

2. `showConfirmationToast` 함수에서 중복 방지 강화
   - 기존 토스트가 있으면 제거 (하지만 새 메시지는 계속 표시)
   - 주의: 이후 "프로그램 업데이트 메시지가 표시되지 않는 버그"에서 이 로직이 문제가 되어 수정됨
   - 관련 파일: `js/utils.js`

3. 연결 실패 시에도 중복 방지 적용
   - 초기 연결 실패 시에도 sessionStorage 체크 적용
   - 관련 파일: `content.js`

**관련 파일**:
- `content.js` (68-130번 라인)
- `js/utils.js` (189-256번 라인)

**참고**:
- sessionStorage는 페이지 세션 동안만 유지되므로, 탭을 닫으면 초기화됩니다.
- 5분 타임아웃은 사용자가 알림을 무시한 후에도 일정 시간 동안 다시 표시되지 않도록 합니다.
- 새로고침 시 sessionStorage가 초기화되므로 정상적으로 작동합니다.

---

### workspace 객체 누락 버그

**발견 일자**: 2024-12-XX
**심각도**: High
**상태**: 해결됨

**증상**:
- 워크스페이스 진입 시 `Cannot read properties of undefined (reading 'keywords')` 오류 발생
- 기존 아이디어 중 `workspace` 객체가 없는 경우 발생

**원인**:
- `createAndSaveNewIdea` 함수에서 `workspace` 객체를 생성하지 않음
- 기존 데이터에 `workspace` 객체가 없어도 방어 코드 부족

**해결 방법**:
1. `workspaceMode.js`의 `renderWorkspace` 함수에 방어 코드 추가
   ```javascript
   if (!ideaData.workspace) {
     ideaData.workspace = {
       keywords: [],
       outline: [],
       draft: '',
       linkedScraps: []
     };
   }
   ```
2. `kanbanMode.js`에 2차 안전 장치 추가 (카드 클릭 전 workspace 객체 보장)
3. `background.js`의 `createAndSaveNewIdea` 함수에서 workspace 객체 항상 생성

**관련 파일**:
- `js/ui/workspaceMode.js`
- `js/ui/kanbanMode.js`
- `background.js`

**참고**:
- 하위 호환성을 위해 기존 필드(`ideaData.outline`, `ideaData.draftContent` 등)와 workspace 객체 동기화

---

### createProgressIndicator 오류

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- `Cannot read properties of undefined (reading 'querySelector')` 오류 발생
- 브리핑 생성 중 진행률 표시 실패

**원인**:
- `workspaceEl`이 정의되기 전에 `querySelector` 호출
- HTML 렌더링 전에 `createProgressIndicator` 호출

**해결 방법**:
1. `createProgressIndicator`가 `container`에서 직접 요소를 찾도록 수정
2. 브리핑 생성 요청은 즉시 보내되, 진행률 표시는 HTML 렌더링 후에 표시

**관련 파일**:
- `js/ui/workspaceMode.js`

---

### AI 브리핑 자동 생성 조건 오류

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 일부 아이디어에서 브리핑이 자동 생성되지 않음
- 대시보드에서 AI 아이디어 추가 시 브리핑 미생성

**원인**:
- `createAndSaveNewIdea` 함수에서 브리핑 생성 조건이 너무 제한적
- `origin` 필드가 없으면 브리핑 생성 안 됨

**해결 방법**:
1. `manual_entry`를 제외한 모든 아이디어 타입에 대해 브리핑 자동 생성
2. `origin` 필드가 없으면 `ai_generated`로 설정
3. 모든 아이디어 추가 경로 확인 및 검증

**관련 파일**:
- `background.js`
- `js/ui/dashboardMode.js`
- `js/ui/scrapbookMode.js`
- `js/ui/kanbanMode.js`
- `js/ui/workspaceMode.js`

---

### AdSense 404 오류 처리

**발견 일자**: 2024-12-XX
**심각도**: Low
**상태**: 해결됨

**증상**:
- AdSense API 호출 시 404 오류 발생
- 데이터가 없는 경우에도 오류로 표시됨

**원인**:
- 404 오류를 실제 API 오류로 처리
- 데이터 없음과 실제 오류 구분 부족

**해결 방법**:
1. 리포트 생성 실패 시 데이터 없음으로 처리 (오류 아님)
2. 실제 API 오류(401, 403 등)와 데이터 없음 구분
3. 계정 정보 조회 성공 시 404는 데이터 없음으로 처리

**관련 파일**:
- `js/services/analyticsService.js`
- `background.js`

---

### GA4 데이터 NULL 표시 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- GA4 데이터 수집 시 NULL 값 표시
- 페이지 경로 매칭 실패

**원인**:
- 필터 전략이 너무 제한적
- 페이지 경로 매칭 유연성 부족

**해결 방법**:
1. 필터 없이 전체 페이지 데이터 먼저 확인
2. 여러 필터 전략 시도 (정확한 경로, trailing slash 제거/추가)
3. 페이지 경로 매칭 유연성 향상
4. 데이터 없을 때 0 값 반환 (오류 아님)

**관련 파일**:
- `js/services/analyticsService.js`
- `background.js`

---

### 에디터 및 메시지 핸들러 오류

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- `Cannot read properties of undefined` 오류 발생
- 에디터에 텍스트 삽입 실패

**원인**:
- `editor.js`의 `insert-text` 핸들러에 `data` 방어 코드 부족
- `workspaceMode.js`의 `postMessage` 메시지 형식 불일치

**해결 방법**:
1. `editor.js`의 `insert-text` 핸들러에 `data` 방어 코드 추가
2. `workspaceMode.js`의 `postMessage` 메시지 형식 수정 (`data` 객체로 감싸기)
3. `editor-error` 핸들러에 `data` 방어 코드 추가
4. `response.error` 직접 접근을 `response?.error`로 수정

**관련 파일**:
- `editor.js`
- `js/ui/workspaceMode.js`

---

## 알려진 이슈

### 브리핑 데이터 생성 실패 시 에러 처리

**심각도**: Low
**상태**: 알려진 이슈

**증상**:
- 브리핑 데이터 생성이 실패해도 사용자에게 명확한 피드백이 부족할 수 있음

**예상 해결 방법**:
- 생성 실패 시 재시도 로직 추가
- 생성 중 로딩 상태 표시 개선
- 부분 생성 실패 시 에러 처리 강화

---

### 워크스페이스 갱신 시 이벤트 리스너 중복

**심각도**: Low
**상태**: 알려진 이슈

**증상**:
- 워크스페이스 갱신 시 일부 이벤트 리스너가 중복 등록될 수 있음

**예상 해결 방법**:
- 이벤트 리스너 등록 전 기존 리스너 제거
- 이벤트 위임 패턴 사용

---

## 에러 패턴

### 1. undefined 접근 오류

**패턴**:
```javascript
// ❌ 잘못된 코드
const value = obj.property.subproperty;

// ✅ 올바른 코드
const value = obj?.property?.subproperty;
// 또는
if (obj?.property) {
  const value = obj.property.subproperty;
}
```

**해결 방법**:
- Optional chaining (`?.`) 사용
- 방어 코드 추가

---

### 2. 비동기 처리 오류

**패턴**:
```javascript
// ❌ 잘못된 코드
async function loadData() {
  const data = await fetchData();
  processData(data); // data가 undefined일 수 있음
}

// ✅ 올바른 코드
async function loadData() {
  try {
    const data = await fetchData();
    if (data) {
      processData(data);
    }
  } catch (error) {
    console.error('데이터 로드 실패:', error);
  }
}
```

**해결 방법**:
- try-catch 블록 사용
- 데이터 존재 확인

---

### 3. 이벤트 리스너 중복 등록

**패턴**:
```javascript
// ❌ 잘못된 코드
function render() {
  button.addEventListener('click', handler);
  // render()가 여러 번 호출되면 리스너 중복 등록
}

// ✅ 올바른 코드
function render() {
  button.removeEventListener('click', handler); // 기존 리스너 제거
  button.addEventListener('click', handler);
}
// 또는
function render() {
  button.onclick = handler; // 기존 리스너 덮어쓰기
}
```

**해결 방법**:
- 이벤트 리스너 등록 전 제거
- 이벤트 위임 패턴 사용

---

### 워크스페이스 스크랩 삭제 버튼 동작 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 워크스페이스의 "모든 스크랩" 리스트에서 스크랩 삭제 버튼 클릭 시 동작하지 않음
- 삭제 버튼에 이벤트 리스너가 등록되지 않음

**원인**:
- `all-scraps-list`에 삭제 버튼 이벤트 리스너가 없음
- `__cp_updateScrapList` 함수에서 동적으로 생성된 스크랩 카드에 이벤트 리스너가 등록되지 않음
- 이벤트 위임 패턴이 적용되지 않음

**해결 방법**:
1. `all-scraps-list`에 이벤트 위임 패턴으로 삭제 버튼 클릭 이벤트 리스너 추가
   - 위치: `js/ui/workspaceMode.js:2656-2730`
   - `scrap-card-delete-btn` 클릭 시 `delete_scrap` 액션 호출
   - 삭제 성공 시 스크랩 리스트 새로고침

2. `__cp_updateScrapList` 함수에서 동적 요소에 이벤트 리스너 등록
   - 위치: `js/ui/workspaceMode.js:3268-3331`
   - 각 삭제 버튼에 개별 이벤트 리스너 등록
   - 중복 등록 방지를 위한 `listenerAttached` 플래그 사용

**관련 파일**:
- `js/ui/workspaceMode.js` (2656-2730, 3268-3331번 라인)

**기술적 세부사항**:
- 이벤트 위임 패턴과 개별 리스너 등록을 병행하여 사용
- 삭제 성공 시 `get_all_scraps` 액션으로 리스트 새로고침
- 연결된 스크랩은 필터링하여 표시

---

### 채널 이름 파싱 및 출력 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 내 채널, 경쟁 채널의 이름이 파싱되지 않음
- 데이터 로드 시 채널 이름이 출력되지 않음
- 아이디어 카드 추가 시 채널 이름이 제대로 표시되지 않음

**원인**:
1. RSS 피드에서 채널 이름을 추출하지 않음
   - `fetchRssFeed` 함수에서 채널 제목을 파싱하지 않음
   - `channel_meta`에 `title` 필드가 저장되지 않음

2. 채널 이름 추출 로직이 불완전함
   - 메타데이터에 채널 이름이 없을 때 대체 로직이 없음
   - 도메인 추출 로직이 일부 케이스에서 누락됨

**해결 방법**:
1. RSS 피드에서 채널 이름 추출 및 저장
   - 위치: `js/services/collectorService.js:243-290`
   - RSS 2.0 방식: `<channel>` 태그 내 `<title>` 추출
   - Atom 방식: 첫 `<item>` 이전의 `<title>` 추출
   - Atom Feed 방식: `<feed>` 태그 내 `<title>` 추출
   - 추출한 채널 이름을 `channel_meta`의 `title` 필드에 저장

2. 채널 이름 추출 로직 개선
   - 위치: `js/ui/dashboardMode.js:1062-1067, 1144-1157, 1600-1613, 1705-1720`
   - 우선순위: `cachedData.metas[sourceId].title` → URL 도메인 → 기본값
   - 메타데이터에 없을 때 URL에서 도메인 추출
   - 콘솔 로그 추가로 디버깅 용이성 향상

3. 아이디어 카드 추가 시 채널 이름 출력
   - 성과 추적 버튼: `js/ui/dashboardMode.js:1600-1613`
   - 기획 보드 추가 버튼: `js/ui/dashboardMode.js:1705-1720`
   - 두 경우 모두 동일한 채널 이름 추출 로직 적용

**관련 파일**:
- `js/services/collectorService.js` (243-290번 라인: RSS 피드 채널 이름 추출)
- `js/ui/dashboardMode.js` (1062-1067, 1144-1157, 1600-1613, 1705-1720번 라인: 채널 이름 추출 및 출력)

**기술적 세부사항**:
- RSS 피드 파싱 시 채널 제목을 3단계로 추출 시도
- 채널 이름이 없으면 URL의 호스트명을 대체로 사용
- 콘솔 로그로 채널 이름 추출 과정 추적 가능

**테스트 방법**:
1. RSS 피드 수집 후 `channel_meta`에 `title` 필드 확인
2. 대시보드에서 내 채널 이름이 제대로 표시되는지 확인
3. 경쟁 채널 이름이 제대로 표시되는지 확인
4. 아이디어 카드 추가 시 채널 이름이 제대로 전달되는지 확인

---

### 대시보드 새로고침 버튼 동작 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 대시보드의 "새로고침" 버튼 클릭 시 동작하지 않음
- 버튼을 클릭해도 아무 반응이 없음

**원인**:
1. 버튼 내부의 `<span>` 요소 클릭 시 이벤트가 버튼까지 전파되지 않음
   - 버튼 구조: `<button><span>🔄</span><span>새로고침</span></button>`
   - `<span>` 클릭 시 `e.target`이 `<span>`이 되어 버튼 이벤트가 발생하지 않음

2. `chrome.runtime.sendMessage`의 에러 처리 부족
   - `chrome.runtime.lastError` 체크 없음
   - 응답 처리 로직이 불완전함

**해결 방법**:
1. 이벤트 위임 패턴 추가
   - 위치: `js/ui/dashboardMode.js:1419-1444`
   - `container.addEventListener('click')`에서 버튼 클릭 처리
   - `target.closest('#refresh-my-channels-btn')`로 버튼 요소 찾기
   - 내부 `<span>` 클릭도 버튼 클릭으로 처리

2. 에러 처리 개선
   - 위치: `js/ui/dashboardMode.js:1368-1374`
   - `chrome.runtime.lastError` 체크 추가
   - 응답 처리 로직 개선
   - 사용자에게 명확한 에러 메시지 표시

**관련 파일**:
- `js/ui/dashboardMode.js` (1357-1444번 라인)

**기술적 세부사항**:
- 이벤트 위임 패턴으로 동적 요소와 내부 요소 클릭 모두 처리
- `chrome.runtime.sendMessage`는 콜백 방식으로 변경하여 에러 처리 개선
- 버튼 상태 관리 (disabled, 텍스트 변경) 유지

**테스트 방법**:
1. 대시보드에서 새로고침 버튼 클릭
2. 버튼 텍스트가 "수집 중..."으로 변경되는지 확인
3. 토스트 메시지가 표시되는지 확인
4. 데이터 수집이 시작되는지 확인

---

### 초안 생성 시 배경색이 문단 전체에 적용되는 문제

**발견 일자**: 2024-12-XX
**심각도**: Low
**상태**: 해결됨

**증상**:
- 초안 생성 시 `background-color: rgba(255, 255, 204, 0.5);`가 문단 전체에 적용됨
- 중요한 부분만 하이라이팅되어야 하는데 문단 전체가 하이라이트됨

**원인**:
- `offscreen.js`의 104번 라인에서 `<p>` 태그 전체에 배경색을 적용
- `p.style.backgroundColor = 'rgba(255, 255, 204, 0.5);'`로 인해 문단 전체가 하이라이트됨

**해결 방법**:
1. 문장 단위 하이라이팅으로 변경
   - 위치: `offscreen.js:87-166`
   - 문단 전체가 아닌 키워드가 포함된 문장만 하이라이팅
   - 문장 경계를 찾아 해당 문장만 `<mark>` 태그로 감싸기

2. 하이라이팅 로직 개선
   - 키워드가 포함된 문장만 추출 (마침표, 느낌표, 물음표로 구분)
   - 문장 길이 제한 (10자 이상 200자 이하)
   - 최대 2개 문장만 하이라이팅
   - HTML 구조 유지하면서 문장만 교체

**관련 파일**:
- `offscreen.js` (87-166번 라인)

**기술적 세부사항**:
- 문장 경계 탐지: 키워드 앞뒤의 마침표/느낌표/물음표로 문장 범위 결정
- innerHTML 교체: 정규식으로 문장만 찾아 `<mark>` 태그로 감싸기
- HTML 안전성: 기존 HTML 태그는 유지하고 텍스트만 교체

**테스트 방법**:
1. 초안 생성 시 중요한 키워드가 포함된 문장만 하이라이팅되는지 확인
2. 문단 전체가 아닌 문장만 하이라이팅되는지 확인
3. 여러 문단이 있어도 최대 2개 문장만 하이라이팅되는지 확인

---

### 과도한 디버깅 로그 출력 문제

**발견 일자**: 2024-12-XX
**심각도**: Low
**상태**: 해결됨

**증상**:
- 콘솔에 과도한 디버깅 로그가 출력됨
- 각 프레임마다 반복적인 로그가 출력되어 성능 저하 및 가독성 저하

**원인**:
- `console.log`를 직접 사용하여 디버그 모드 여부와 관계없이 항상 출력
- 여러 iframe에서 각각 로그가 출력되어 중복 발생
- 불필요한 상세 디버깅 정보가 항상 출력됨

**해결 방법**:
1. `Logger.debug`로 변경
   - 위치: `js/ui/workspaceMode.js`, `content.js`, `js/core/scrapbook.js`
   - `console.log`를 `Logger.debug`로 변경
   - `Logger.isDebugMode()` 체크로 디버그 모드에서만 출력

2. 조건부 로그 출력
   - 디버그 모드가 활성화된 경우에만 상세 로그 출력
   - 프로덕션 환경에서는 불필요한 로그 출력 방지

**관련 파일**:
- `js/ui/workspaceMode.js` (3448-3457, 3710-3717번 라인)
- `content.js` (271-278, 290-295, 483-489, 505-520, 722-724번 라인)
- `js/core/scrapbook.js` (328번 라인)

**기술적 세부사항**:
- `Logger.isDebugMode()`: localStorage 또는 URL 파라미터로 디버그 모드 체크
- 디버그 모드가 아닌 경우 로그 출력 생략
- 성능 개선 및 콘솔 가독성 향상

**테스트 방법**:
1. 디버그 모드가 비활성화된 상태에서 콘솔 로그가 출력되지 않는지 확인
2. 디버그 모드가 활성화된 상태에서만 상세 로그가 출력되는지 확인
3. 여러 iframe이 있어도 불필요한 로그가 출력되지 않는지 확인

---

### 썸네일 합성 함수 import 누락 문제

**발견 일자**: 2024-12-XX
**심각도**: High
**상태**: 해결됨

**증상**:
- 썸네일 자동 생성 시 `ReferenceError: composeThumbnailInOffscreen is not defined` 에러 발생
- 썸네일 합성이 실패하여 썸네일 이미지가 생성되지 않음

**원인**:
- `js/services/aiService.js`에서 `composeThumbnailInOffscreen` 함수를 사용하지만 import하지 않음
- `offscreenService.js`에서는 함수가 export되어 있었지만, `aiService.js`에서 import 목록에 누락

**해결 방법**:
1. `js/services/aiService.js`의 import 문에 `composeThumbnailInOffscreen` 추가
   - 위치: 9번 라인
   - 변경: `import { sanitizeHtmlInOffscreen, cropImageInOffscreen } from './offscreenService.js';`
   - 수정: `import { sanitizeHtmlInOffscreen, cropImageInOffscreen, composeThumbnailInOffscreen } from './offscreenService.js';`

**관련 파일**:
- `js/services/aiService.js` (9번 라인)
- `js/services/offscreenService.js` (200번 라인)

**기술적 세부사항**:
- `composeThumbnailInOffscreen` 함수는 `offscreenService.js`에서 export되어 있었음
- `aiService.js`에서 사용하지만 import하지 않아 런타임 에러 발생
- 번들 파일 업데이트 필요 (webpack 빌드 재실행)

**테스트 방법**:
1. 확장 프로그램 재로드
2. AI 초안 생성 시 썸네일 합성이 정상적으로 작동하는지 확인
3. 콘솔에 에러가 없는지 확인

---

### AI 초안 생성 타임아웃 문제

**발견 일자**: 2024-12-XX
**심각도**: Medium
**상태**: 해결됨

**증상**:
- AI 초안 생성 시 30초 타임아웃 발생
- 썸네일 생성까지 포함하여 시간이 더 오래 걸리는데 타임아웃이 너무 짧음

**원인**:
- `js/ui/workspaceMode.js`에서 타임아웃이 30초로 설정되어 있음
- 썸네일 생성(이미지 생성 + 합성 + 크롭 + 업로드)까지 포함하면 시간이 더 필요함

**해결 방법**:
1. 타임아웃 시간 증가
   - 위치: `js/ui/workspaceMode.js` 2296번 라인
   - 변경: `const TIMEOUT_MS = 30000; // 30초`
   - 수정: `const TIMEOUT_MS = 120000; // 120초 (2분) - 썸네일 생성 포함`
2. 타임아웃 메시지 업데이트
   - 변경: "30초를 초과했습니다" → "2분을 초과했습니다"

**관련 파일**:
- `js/ui/workspaceMode.js` (2295-2304번 라인)

**기술적 세부사항**:
- 썸네일 생성 프로세스: AI 이미지 생성 → 텍스트 합성 → 크롭 (1:1, 4:3) → 업로드 (3개)
- 각 단계마다 네트워크 요청이 필요하여 시간이 오래 걸림
- 타임아웃을 2분으로 늘려 충분한 시간 확보

**테스트 방법**:
1. AI 초안 생성 시 썸네일까지 포함하여 정상적으로 완료되는지 확인
2. 타임아웃이 발생하지 않는지 확인

---

### 썸네일 텍스트 위치 1:1 가이드라인 적용 및 이미지 눌림 문제 해결

**발견 일자**: 2025-01-27
**심각도**: Medium
**상태**: 해결됨

**증상**:
- 썸네일 이미지가 에디터에서 눌려서 보이는 문제
- 검색 노출 시 1:1 비율로 표시되는데, 텍스트가 16:9 전체 영역 기준으로 배치되어 1:1 영역 밖에 위치할 수 있음

**원인**:
- 이미지 태그에 `display: block` 스타일이 없어 인라인 요소로 렌더링되면서 하단 여백이 생김
- 텍스트 위치가 16:9 전체 이미지 기준으로 계산되어, 검색 결과에서 1:1로 표시될 때 텍스트가 잘릴 수 있음

**해결 방법**:
1. **이미지 눌림 문제 해결**:
   - HTML 본문에 삽입되는 이미지 태그에 `display: block` 스타일 추가
   - 인라인 요소로 인한 하단 여백 제거

2. **1:1 가이드라인 적용**:
   - 16:9 이미지(1920x1080)에서 중앙 1:1 영역(1080x1080) 계산
   - 텍스트 위치를 1:1 영역 안에 배치하도록 수정:
     - `top`: 전체 높이의 22% (1:1 영역 상단 20%)
     - `center`: 전체 높이의 50% (1:1 영역 정중앙)
     - `bottom`: 전체 높이의 78% (1:1 영역 하단 20%, 검색 노출 시 잘릴 수 있으므로 약간 위로 조정)
   - 1:1 영역 밖으로 나가지 않도록 상하 10% 여유 공간 확보

3. **AI 프롬프트 업데이트**:
   - 텍스트 위치 결정 시 검색 노출에서 1:1 비율로 표시됨을 고려하도록 지시 추가

**수정된 파일**:
- `offscreen.js`: 텍스트 위치 계산 로직 수정 (1:1 가이드라인 적용)
- `js/services/aiService.js`: 이미지 태그에 `display: block` 추가, AI 프롬프트 업데이트

**테스트 방법**:
1. AI 초안 생성 시 썸네일 이미지가 눌려 보이지 않는지 확인
2. 생성된 썸네일의 텍스트가 중앙 정사각형 영역 안에 위치하는지 확인
3. 검색 결과에서 1:1로 표시될 때 텍스트가 잘 보이는지 확인

---

### 마크다운 링크 미처리 및 하이라이팅이 썸네일 정보에 적용되는 문제 해결

**발견 일자**: 2025-01-27
**심각도**: Medium
**상태**: 해결됨

**증상**:
1. 마크다운 링크가 처리되지 않고 그대로 출력되는 경우 발생
   - 예: `[완벽 가이드] 쿠진아트 에어프라이어 그릴 오븐 청소 꿀팁 총정리!](https://...)` 형태의 마크다운 링크가 HTML로 변환되지 않음
2. 텍스트 백그라운드 컬러(하이라이팅)가 포스팅 내용에만 적용되어야 하는데, 썸네일 정보에도 적용됨

**원인**:
1. **마크다운 링크 미처리**:
   - `offscreen.js`의 마크다운 감지 정규식이 일부 마크다운 링크를 놓칠 수 있음
   - 마크다운 후보가 아니어도 마크다운 링크만 있는 경우 처리가 안 됨
2. **하이라이팅이 썸네일 정보에 적용**:
   - `offscreen.js`의 `sanitizeAndFormatHtml()` 함수에서 썸네일 정보를 제거하기 전에 하이라이팅이 적용됨
   - 썸네일 정보 내부의 "중요", "핵심" 등의 키워드가 하이라이팅 대상이 됨

**해결 방법**:
1. **마크다운 링크 처리 개선**:
   - 마크다운 감지 정규식 개선: `\[.*\]\(.*\)` → `\[[^\]]+\]\([^)]+\)` (더 정확한 패턴)
   - 마크다운 후보가 아니어도 마크다운 링크만 있는 경우에도 `marked.parse()` 호출
2. **하이라이팅 적용 범위 제한**:
   - `offscreen.js`에서 썸네일 정보를 먼저 제거한 후 하이라이팅 적용 (이미 구현되어 있음)
   - 하지만 `aiService.js`에서 썸네일 정보를 제거한 후 `sanitizeAndFormatHtml()`을 호출하므로, `offscreen.js`에서 다시 제거하는 것은 안전장치
   - 하이라이팅 로직에서 `<p>` 태그 내부에 이미 링크나 이미지가 있는 경우 건너뛰도록 이미 구현되어 있음

**수정된 파일**:
- `offscreen.js`: 마크다운 링크 감지 및 처리 로직 개선

**기술적 세부사항**:
- 마크다운 링크 패턴: `\[[^\]]+\]\([^)]+\)` (대괄호 안에 닫는 대괄호가 없고, 소괄호 안에 닫는 소괄호가 없는 패턴)
- 마크다운 후보가 아니어도 마크다운 링크만 있는 경우 `marked.parse()` 호출하여 링크 변환 보장
- 썸네일 정보는 `aiService.js`에서 먼저 제거되고, `offscreen.js`에서도 안전장치로 제거됨

**테스트 방법**:
1. 마크다운 링크가 포함된 초안 생성 시 링크가 정상적으로 HTML로 변환되는지 확인
2. 썸네일 정보에 "중요", "핵심" 등의 키워드가 포함되어도 하이라이팅이 적용되지 않는지 확인
3. 포스팅 본문의 중요 문장에는 하이라이팅이 정상적으로 적용되는지 확인

---

## 🔗 관련 문서

- [프로그램 로직](./PROGRAM_LOGIC.md)
- [에러 패턴](./ERROR_PATTERNS.md)
- [리팩토링 가이드](./REFACTORING_GUIDE.md)

