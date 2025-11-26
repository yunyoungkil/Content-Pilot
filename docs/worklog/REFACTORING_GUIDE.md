# 리팩토링 가이드 (Refactoring Guide)

이 문서는 Content Pilot 프로젝트의 리팩토링 가이드 및 베스트 프랙티스를 제공합니다.

## 📋 목차

1. [리팩토링 원칙](#리팩토링-원칙)
2. [코드 구조 가이드](#코드-구조-가이드)
3. [리팩토링 체크리스트](#리팩토링-체크리스트)
4. [일반적인 리팩토링 패턴](#일반적인-리팩토링-패턴)
5. [주의사항](#주의사항)

---

## 리팩토링 원칙

### 1. 기능 변경 없이 코드 개선
- 리팩토링은 기능을 변경하지 않고 코드만 개선합니다
- 기능 추가/변경은 별도의 작업으로 분리하세요

### 2. 작은 단위로 진행
- 한 번에 너무 많은 변경을 하지 마세요
- 작은 단위로 나누어 단계적으로 진행하세요

### 3. 테스트 후 진행
- 리팩토링 전에 현재 동작을 확인하세요
- 리팩토링 후에도 동일하게 동작하는지 확인하세요

### 4. 문서화
- 리팩토링 이유와 변경 사항을 문서화하세요
- [REFACTORING_HISTORY.md](./REFACTORING_HISTORY.md)에 기록하세요

---

## 코드 구조 가이드

### 파일 구조

```
js/
├── core/           # 핵심 비즈니스 로직
├── services/       # 외부 서비스 연동 (Firebase, AI, Analytics)
├── ui/             # UI 컴포넌트 (각 모드별)
└── utils/          # 유틸리티 함수
```

### 모듈 분리 원칙

#### 1. 단일 책임 원칙 (SRP)
- 각 모듈은 하나의 책임만 가져야 합니다
- 예: `aiService.js`는 AI 관련 기능만 담당

#### 2. 의존성 방향
```
ui/ → services/ → core/
```
- UI는 서비스를 사용하지만, 서비스는 UI를 모르도록
- 서비스는 코어를 사용하지만, 코어는 서비스를 모르도록

#### 3. 공통 기능은 utils로
- 여러 모듈에서 사용하는 기능은 `utils.js`로 분리
- 예: `showToast`, `formatDate` 등

---

## 리팩토링 체크리스트

### 리팩토링 전

- [ ] 현재 동작 상태 확인 (기능 테스트)
- [ ] 리팩토링 범위 및 목표 정의
- [ ] 관련 파일 목록 작성
- [ ] 예상 영향 범위 분석
- [ ] 백업 또는 브랜치 생성

### 리팩토링 중

- [ ] 작은 단위로 변경
- [ ] 각 변경 후 테스트
- [ ] 변경 사항 문서화
- [ ] 에러 처리 확인

### 리팩토링 후

- [ ] 전체 기능 테스트
- [ ] 성능 확인 (필요시)
- [ ] 코드 리뷰 (가능한 경우)
- [ ] 문서 업데이트
- [ ] 변경 사항 기록 ([REFACTORING_HISTORY.md](./REFACTORING_HISTORY.md))

---

## 일반적인 리팩토링 패턴

### 1. 함수 추출 (Extract Function)

**Before**:
```javascript
function renderCard(cardData) {
  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.innerHTML = `
    <h3>${cardData.title}</h3>
    <p>${cardData.description || ''}</p>
  `;
  // ... 복잡한 로직
}
```

**After**:
```javascript
function createCardElement(cardData) {
  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.innerHTML = `
    <h3>${cardData.title}</h3>
    <p>${cardData.description || ''}</p>
  `;
  return card;
}

function renderCard(cardData) {
  const card = createCardElement(cardData);
  // ... 나머지 로직
}
```

### 2. 중복 코드 제거

**Before**:
```javascript
// workspaceMode.js
function showToast(message) {
  // ... 토스트 표시 로직
}

// kanbanMode.js
function showToast(message) {
  // ... 동일한 토스트 표시 로직
}
```

**After**:
```javascript
// utils.js
export function showToast(message) {
  // ... 토스트 표시 로직
}

// workspaceMode.js
import { showToast } from '../utils.js';

// kanbanMode.js
import { showToast } from '../utils.js';
```

### 3. 매직 넘버/문자열 상수화

**Before**:
```javascript
if (status === 'idea') {
  // ...
} else if (status === 'in_progress') {
  // ...
}
```

**After**:
```javascript
// constants.js
export const IDEA_STATUS = {
  IDEA: 'idea',
  IN_PROGRESS: 'in_progress',
  DONE: 'done'
};

if (status === IDEA_STATUS.IDEA) {
  // ...
} else if (status === IDEA_STATUS.IN_PROGRESS) {
  // ...
}
```

### 4. 방어 코드 추가

**Before**:
```javascript
function renderWorkspace(ideaData) {
  const keywords = ideaData.workspace.keywords;
  // ...
}
```

**After**:
```javascript
function renderWorkspace(ideaData) {
  // workspace 객체 보장
  if (!ideaData.workspace) {
    ideaData.workspace = {
      keywords: [],
      outline: [],
      draft: '',
      linkedScraps: []
    };
  }
  
  const keywords = ideaData.workspace.keywords || [];
  // ...
}
```

### 5. 비동기 처리 개선

**Before**:
```javascript
async function loadData() {
  const data1 = await fetchData1();
  const data2 = await fetchData2();
  const data3 = await fetchData3();
  // 순차 처리 (느림)
}
```

**After**:
```javascript
async function loadData() {
  const [data1, data2, data3] = await Promise.all([
    fetchData1(),
    fetchData2(),
    fetchData3()
  ]);
  // 병렬 처리 (빠름)
}
```

---

## 주의사항

### 1. Chrome Extension 특성

#### Service Worker 생명주기
- Background script는 Service Worker로 동작
- 비활성 상태에서 종료될 수 있음
- 상태 저장 시 `chrome.storage` 사용

#### Content Script 격리
- Content script는 웹페이지와 격리된 환경
- `window` 객체 공유 불가
- `postMessage`로 통신

#### Offscreen Document
- DOM API 사용 가능
- Service Worker와 통신 필요
- 메모리 관리 중요

### 2. Firebase REST API

#### 실시간 리스너 제한
- REST API는 실시간 리스너 미지원
- 주기적 폴링 또는 이벤트 기반 업데이트 사용

#### 인증 토큰 관리
- Firebase Auth 토큰 수동 관리
- 토큰 만료 시 갱신 필요

### 3. Webpack 빌드

#### 빌드 후 테스트
- 코드 변경 후 반드시 빌드 필요
- `npm run build` 또는 `npm run watch`

#### 확장 프로그램 새로고침
- 빌드 후 확장 프로그램 새로고침 필요
- `chrome://extensions/` → 새로고침 버튼

### 4. 데이터 구조 변경

#### 하위 호환성
- 기존 데이터 구조 변경 시 하위 호환성 고려
- 마이그레이션 스크립트 작성

#### 채널 ID 부여
- 모든 새 데이터에 `channelId` 자동 부여
- 기존 데이터는 마이그레이션 필요

---

## 🔗 관련 문서

- [프로그램 로직](./PROGRAM_LOGIC.md)
- [리팩토링 이력](./REFACTORING_HISTORY.md)
- [버그 해결 로그](./BUG_FIX_LOG.md)
- [개발 가이드](../guides/DEVELOPMENT_GUIDE.md)

