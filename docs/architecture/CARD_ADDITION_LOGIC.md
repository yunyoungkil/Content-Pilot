# 각종 카드 추가 로직 문서

이 문서는 Content-Pilot 확장 프로그램에서 각종 카드(아이디어, 스크랩 등)를 추가하는 로직을 정리한 것입니다.

## 1. 칸반 보드 아이디어 카드 추가

### 1.1 직접 추가 (칸반 보드에서)
**위치**: `js/ui/kanbanMode.js`

**흐름**:
1. 사용자가 "+ 카드 추가" 버튼 클릭
2. `showAddCardInput()` 함수 호출 → 입력 필드 표시
3. 사용자가 제목 입력 후 제출
4. `submitCard()` 함수 호출
5. `chrome.runtime.sendMessage({ action: 'add_idea_to_kanban', ... })` 전송
6. `background.js`의 `add_idea_to_kanban` 핸들러 처리

**코드 위치**:
- 입력 필드 표시: `js/ui/kanbanMode.js:782` (`showAddCardInput`)
- 카드 제출: `js/ui/kanbanMode.js:886` (`submitCard`)
- 백엔드 처리: `background.js:379` (`add_idea_to_kanban`)

**데이터 구조**:
```javascript
{
  title: string,        // 제목 (필수)
  description: string,  // 설명
  tags: Array,          // 태그 배열
  createdAt: number,    // 생성 시간
  channelId: string|null // 활성 채널 ID (없으면 null = 공용)
}
```

**저장 경로**: `kanban/{userId}/{status}/{cardId}`
- `status`: 'ideas', 'in-progress', 'done' 중 하나

### 1.2 대시보드에서 추가
**위치**: `js/ui/dashboardMode.js`

**흐름**:
1. 사용자가 콘텐츠 카드의 "기획 보드에 추가" 버튼 클릭
2. `addDashboardEventListeners()` 내부의 클릭 핸들러 처리
3. 콘텐츠 데이터를 아이디어 형식으로 변환
4. `chrome.runtime.sendMessage({ action: 'add_idea_to_kanban', ... })` 전송
5. `background.js`의 `add_idea_to_kanban` 핸들러 처리

**코드 위치**:
- 이벤트 리스너: `js/ui/dashboardMode.js:1242` (클릭 이벤트)
- 아이디어 데이터 생성: `js/ui/dashboardMode.js:1415` (`ideaForKanban` 객체)
- 백엔드 처리: `background.js:379` (`add_idea_to_kanban`)

**데이터 구조**:
```javascript
{
  title: string,                    // 콘텐츠 제목 (접두사: [리뉴얼] 또는 [벤치마킹])
  description: string,               // 콘텐츠 설명 (우선순위: cleanText > description > "")
  tags: Array,                       // 태그 배열
  origin: {
    type: string,                    // "my_post" 또는 "competitor_post"
    channelName: string,             // 채널 이름
    postUrl: string                  // 원본 URL (fullLink 또는 link)
  },
  channelId: string|null            // 활성 채널 ID
}
```

**Description 필드 우선순위**:
콘텐츠의 내용은 아이디어 카드의 `description` 필드로 변환되며, 다음과 같은 우선순위로 데이터를 가져옵니다:

1. **1순위: `post.cleanText`**
   - 수집된 원본 본문 텍스트 (HTML 태그가 제거된 순수 텍스트)
   - 블로그 포스팅 등의 전체 내용을 담고 있을 가능성이 높음

2. **2순위: `post.description`**
   - RSS 피드나 메타데이터에서 제공하는 요약 설명
   - `cleanText`가 없을 경우 사용

3. **3순위: 빈 문자열 (`""`)**
   - 위의 두 정보가 모두 없을 경우 빈 내용으로 저장

**구현 코드** (`js/ui/dashboardMode.js:1417`):
```javascript
description: post.cleanText || post.description || "",
```

### 1.3 AI 아이디어 추가
**위치**: `js/ui/dashboardMode.js`

**흐름**:
1. 사용자가 "통합 분석 실행하기" 버튼 클릭
2. AI 분석 결과에서 아이디어 선택
3. `chrome.runtime.sendMessage({ action: 'add_idea_to_kanban', ... })` 전송
4. `background.js`의 `add_idea_to_kanban` 핸들러 처리

**코드 위치**:
- AI 아이디어 추가: `js/ui/dashboardMode.js:1527` (메시지 전송)
- 백엔드 처리: `background.js:379` (`add_idea_to_kanban`)

### 1.4 스크랩에서 변환
**위치**: `js/ui/scrapbookMode.js`

**흐름**:
1. 사용자가 스크랩 상세 보기(Detail View)에서 "아이디어로 변환" 버튼 클릭
2. 스크랩 데이터를 아이디어 형식으로 변환
3. `chrome.runtime.sendMessage({ action: 'add_idea_to_kanban', ... })` 전송
4. `background.js`의 `add_idea_to_kanban` 핸들러 처리

**코드 위치**:
- 스크랩 변환: `js/ui/scrapbookMode.js:729` (이벤트 리스너)
- 아이디어 데이터 생성: `js/ui/scrapbookMode.js:743` (`ideaData` 객체)
- 백엔드 처리: `background.js:379` (`add_idea_to_kanban`)

**데이터 구조**:
```javascript
{
  title: string,                    // 스크랩 텍스트에서 추출한 제목 (최대 100자)
  description: string,               // 스크랩 텍스트 전체
  keywords: Array,                   // 스크랩 태그 (스크랩-전환 제외)
  origin: {
    postUrl: string,                // 원본 스크랩 URL (중복 검사용)
    sourceScrapId: string           // 원본 스크랩 ID
  },
  sourceScrapId: string             // 하위 호환성을 위해 유지
}
```

**콘텐츠 변환 로직** (`js/ui/scrapbookMode.js:738-752`):

1. **제목 (title)**:
   - 스크랩 텍스트에서 공백을 정규화하고 앞부분 100자를 추출
   - 제목이 없으면 "제목 없음" 사용
   ```javascript
   title: scrap.text ? scrap.text.replace(/\s+/g, ' ').trim().substring(0, 100) : '제목 없음'
   ```

2. **설명 (description)**:
   - 스크랩의 전체 텍스트 본문이 아이디어의 상세 설명으로 들어감
   - 사용자가 하이라이트한 핵심 내용이 그대로 기획의 바탕이 됨
   ```javascript
   description: scrap.text || ''
   ```

3. **태그 (tags/keywords)**:
   - `#스크랩-전환` 태그가 자동으로 추가되어 해당 아이디어가 스크랩에서 유래했음을 명시
   - 기존 스크랩 태그는 `keywords` 필드에 저장 (`#스크랩-전환` 제외)
   ```javascript
   keywords: ideaTags.filter(tag => tag !== '#스크랩-전환')
   ```

4. **출처 정보 (origin)**:
   - `origin.postUrl`: 스크랩했던 원본 웹페이지 URL이 메타데이터로 보존 (중복 검사용)
   - `origin.sourceScrapId`: 원본 스크랩의 ID가 연결되어 나중에 역으로 추적 가능
   - `sourceScrapId`: 하위 호환성을 위해 루트 레벨에도 저장

**구현 코드 예시**:
```javascript
const ideaTitle = scrap.text ? scrap.text.replace(/\s+/g, ' ').trim().substring(0, 100) : '제목 없음';
const ideaDescription = scrap.text || '';
const ideaTags = scrap.tags && Array.isArray(scrap.tags) ? [...scrap.tags, '#스크랩-전환'] : ['#스크랩-전환'];

const ideaData = {
  title: ideaTitle,
  description: ideaDescription,
  keywords: ideaTags.filter(tag => tag !== '#스크랩-전환'),
  origin: {
    postUrl: scrap.url || '',
    sourceScrapId: scrapId
  },
  sourceScrapId: scrapId
};
```

## 2. 백엔드 처리 (`background.js`)

### 2.1 `add_idea_to_kanban` 핸들러
**위치**: `background.js:379`

**처리 단계**:
1. 메시지 데이터 파싱 (`JSON.parse(msg.data)`)
2. 중복 검사 (URL 기반, `checkDuplicateUrl()`)
3. 설명 요약 (200자 이상인 경우, `summarizeText()`)
4. Firebase에 저장 (`push()`)
5. 성공 응답 반환

**중요 사항**:
- `channelId`는 `msg.channelId`에서 가져옴 (없으면 null)
- `status`는 `msg.status`에서 가져옴 (기본값: 'ideas')
- 중복 URL이 있으면 `DUPLICATE_FOUND` 에러 반환

**코드**:
```javascript
if (msg.action === "add_idea_to_kanban") {
  return handleAsync((async () => {
    const ideaData = JSON.parse(msg.data);
    
    // 중복 검사
    if (ideaData.origin?.postUrl) {
      const dupCheck = await checkDuplicateUrl(ideaData.origin.postUrl);
      if (dupCheck.exists) return { success: false, code: "DUPLICATE_FOUND", cardInfo: dupCheck };
    }
    
    // 요약
    if (ideaData.description?.length > 200) {
      ideaData.description = await summarizeText(ideaData.description);
    }
    
    // 저장
    const userId = await getCurrentUserId();
    const path = `kanban/${userId}/${msg.status || 'ideas'}`;
    const newKey = await push(path, { ...ideaData, createdAt: Date.now(), channelId: msg.channelId });
    
    return { success: true, firebaseKey: newKey };
  })());
}
```

## 3. 스크랩 카드 추가

### 3.1 하이라이트에서 스크랩 저장
**위치**: `js/core/highlighter.js`

**흐름**:
1. 사용자가 웹 페이지에서 텍스트 선택 및 하이라이트
2. 스크랩 저장 모달 표시 (`showScrapSaveModalInline`)
3. 사용자가 채널 선택 및 저장 버튼 클릭
4. `chrome.runtime.sendMessage({ action: 'cp_save_scrap', ... })` 전송
5. `background.js`의 `cp_save_scrap` 핸들러 처리

**코드 위치**:
- 스크랩 저장 모달: `js/core/highlighter.js:90` (`showScrapSaveModalInline`)
- 메시지 전송: `js/core/highlighter.js:210` (`chrome.runtime.sendMessage`)
- 백엔드 처리: `background.js:786` (`scrap_element` 핸들러)

**데이터 구조**:
```javascript
{
  text: string,                      // 하이라이트된 텍스트
  html: string,                      // HTML 원본
  tag: string,                       // 태그 (기본값: 'UNKNOWN')
  url: string,                       // 현재 페이지 URL
  image: string|null,                // 대표 이미지
  images: Array,                     // 이미지 배열
  highlights: Array,                 // 하이라이트 메타데이터
  hasHighlights: boolean,            // 하이라이트 존재 여부
  timestamp: number,                // 저장 시간
  channelId: string|null            // 선택한 채널 ID (없으면 null = 공용)
}
```

**저장 경로**: `scraps/{userId}/{scrapId}`
- `channelId`는 스크랩 데이터 내부에 저장됨 (경로에 포함되지 않음)

### 3.2 백엔드 처리 (`scrap_element` 핸들러)
**위치**: `background.js:786`

**처리 단계**:
1. 메시지 데이터에서 `data`와 `channelId` 추출
2. 스크랩 페이로드 생성 (`scrapPayload`)
3. `cleanDataForFirebase()`로 undefined 값 제거
4. Firebase에 저장 (`push()`)
5. 성공 응답 반환 (`scrapId`, `scrapData`)

**코드**:
```javascript
if (msg.action === "scrap_element" && msg.data) {
  return handleAsync((async () => {
    try {
      const { data } = msg;
      const channelId = msg.channelId !== undefined ? msg.channelId : null;
      
      // 스크랩 데이터 준비
      const scrapPayload = {
        text: data.text || '',
        html: data.html || '',
        tag: data.tag || 'UNKNOWN',
        url: data.url || '',
        image: data.image || null,
        images: data.images || [],
        highlights: data.highlights || [],
        hasHighlights: data.hasHighlights || false,
        timestamp: Date.now(),
        channelId: channelId
      };
      
      // Firebase에 저장
      const userId = await getCurrentUserId();
      const path = `scraps/${userId}`;
      const newKey = await push(path, cleanDataForFirebase(scrapPayload));
      
      return { 
        success: true, 
        scrapId: newKey,
        scrapData: scrapPayload
      };
    } catch (error) {
      Logger.error('[scrap_element] 저장 실패:', error);
      return { success: false, error: error.message };
    }
  })());
}
```

## 4. 공통 사항

### 4.1 채널 ID 처리
- 모든 카드 추가 시 `activeChannelId`를 가져와서 전송
- `chrome.storage.local.get("activeChannelId")` 사용
- 없으면 `null`로 설정 (공용 카드)

### 4.2 에러 처리
- 중복 검사 실패 시 `DUPLICATE_FOUND` 에러 반환
- 저장 실패 시 에러 메시지와 함께 `success: false` 반환
- UI에서 `showToast()`로 사용자에게 알림

### 4.3 실시간 업데이트
- Firebase에 저장 후 실시간 리스너(`onValue`)가 자동으로 UI 업데이트
- REST API 모드에서는 1회성 `get()` 호출로 대체

## 5. 개선 사항

### 5.1 현재 문제점
1. **채널 ID 일관성**: 일부 코드에서 `channelId`, 일부에서 `activeChannelId` 사용
2. **에러 처리**: 일부 경로에서 에러 처리가 부족
3. **중복 검사**: URL 기반만 지원, 제목 기반 중복 검사 없음

### 5.2 권장 개선 사항
1. 채널 ID 변수명 통일 (`activeChannelId` → `channelId`)
2. 모든 카드 추가 경로에 에러 처리 추가
3. 제목 기반 중복 검사 추가
4. 로딩 상태 표시 개선

## 6. 칸반 카드 이동 로직

### 6.1 프론트엔드 처리 (드래그 앤 드롭)
**위치**: `js/ui/kanbanMode.js`

**흐름**:
1. 사용자가 카드를 드래그하여 다른 컬럼에 놓을 때 `drop` 이벤트 발생
2. 이동 가능 여부를 검증 (Validation)
3. 검증 통과 시 `chrome.runtime.sendMessage({ action: 'move_kanban_card', ... })` 전송
4. `background.js`의 `move_kanban_card` 핸들러 처리

**코드 위치**:
- 드래그 시작: `js/ui/kanbanMode.js:650` (`dragstart` 이벤트)
- 드롭 처리: `js/ui/kanbanMode.js:772` (`drop` 이벤트)
- 백엔드 처리: `background.js:602` (`move_kanban_card`)

**이동 제한 규칙 (Validation)**:
1. **아이디어 → 진행 중** (`ideas` → `in-progress`/`done`):
   - 조건: 초안(`draftContent`)이 없거나 연결된 자료가 없으면 이동 불가
   - 메시지: "⚠️ 기획을 시작하려면 카드를 클릭하여 워크스페이스에서 초안을 생성하거나, 자료를 연결해야 합니다."
   - 코드: `js/ui/kanbanMode.js:780-786`

2. **진행 중 → 아이디어** (`in-progress` → `ideas`):
   - 조건: 이미 초안(`draftContent`)이 작성된 카드는 '아이디어' 단계로 되돌릴 수 없음
   - 메시지: "⚠️ 초안이 작성된 아이디어는 '아이디어' 단계로 되돌릴 수 없습니다. (초안 삭제 후 복귀 가능)"
   - 코드: `js/ui/kanbanMode.js:787-793`

**데이터 구조**:
```javascript
{
  cardId: string,           // 이동할 카드 ID
  originalStatus: string,   // 출발지 상태 ('ideas', 'in-progress', 'done')
  newStatus: string         // 도착지 상태 ('ideas', 'in-progress', 'done')
}
```

### 6.2 백엔드 처리 (`move_kanban_card` 핸들러)
**위치**: `background.js:602`

**처리 단계**:
1. 메시지 데이터에서 `cardId`, `originalStatus`, `newStatus` 추출
2. 원래 위치의 카드 데이터 읽기 (`get(originalRef)`)
3. 새 위치에 카드 데이터 저장 (`set(newRef, cardData)`)
4. 원래 위치에서 카드 삭제 (`remove(originalRef)`)
5. UI 갱신 메시지 전송 (`kanban_data_updated`)

**중요 사항**:
- Firebase Realtime Database는 "이동" 명령어가 없으므로 "복사(Copy) → 삭제(Delete)" 패턴 사용
- 카드 데이터는 그대로 복사되므로 `publishInfo`, `draftContent` 등 모든 필드가 보존됨
- `status` 필드는 경로에 포함되므로 별도로 업데이트할 필요 없음

**코드**:
```javascript
if (msg.action === "move_kanban_card") {
  return handleAsync((async () => {
    const { cardId, originalStatus, newStatus } = msg.data;
    const userId = await getCurrentUserId();
    const originalRef = ref(getDb(), `kanban/${userId}/${originalStatus}/${cardId}`);
    const newRef = ref(getDb(), `kanban/${userId}/${newStatus}/${cardId}`);

    // 원래 위치의 카드 데이터 읽기
    const cardSnap = await get(originalRef);
    const cardData = cardSnap?.val();
    if (!cardData) {
      return { success: false, error: "이동할 카드를 찾을 수 없습니다." };
    }
    
    // 새 위치에 카드 데이터 저장
    await set(newRef, cardData);
    
    // 원래 위치에서 카드 삭제
    await remove(originalRef);
    
    // UI 갱신 메시지 전송
    // ...
    
    return { success: true };
  })());
}
```

### 6.3 실시간 UI 동기화
**위치**: `js/ui/kanbanMode.js`

**동작**:
1. `background.js`에서 `move_kanban_card` 핸들러가 완료되면 `kanban_data_updated` 메시지 전송
2. `kanbanMode.js`의 `addRealtimeUpdateListener()`가 이 메시지를 감지
3. `updateKanbanUI()` 함수를 호출하여 보드 전체를 최신 상태로 다시 렌더링

**코드 위치**:
- 실시간 리스너: `js/ui/kanbanMode.js:93` (`addRealtimeUpdateListener`)
- UI 업데이트: `js/ui/kanbanMode.js:151` (`updateKanbanUI`)

**데이터 흐름도**:
```
User Action: 드래그 앤 드롭 (kanbanMode.js)
    ↓
Validation: 초안 유무 등에 따른 이동 규칙 검사
    ↓
Request: move_kanban_card 메시지 전송
    ↓
Backend: get (Old Path) → set (New Path) → remove (Old Path) (background.js)
    ↓
Sync: Firebase 변경 감지 → kanban_data_updated 메시지 → UI 자동 업데이트
```

