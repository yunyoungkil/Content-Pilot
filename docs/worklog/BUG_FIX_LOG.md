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
   - 기존 토스트가 있으면 제거하고 `return`으로 함수 조기 종료
   - 새로 표시하지 않도록 수정
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

## 🔗 관련 문서

- [프로그램 로직](./PROGRAM_LOGIC.md)
- [에러 패턴](./ERROR_PATTERNS.md)
- [리팩토링 가이드](./REFACTORING_GUIDE.md)

