# 에러 패턴 (Error Patterns)

이 문서는 Content Pilot 프로젝트에서 자주 발생하는 에러 패턴과 해결 방법을 정리합니다.

## 📋 목차

1. [런타임 에러](#런타임-에러)
2. [비동기 처리 에러](#비동기-처리-에러)
3. [Firebase 에러](#firebase-에러)
4. [API 에러](#api-에러)
5. [UI 에러](#ui-에러)

---

## 런타임 에러

### 1. Cannot read properties of undefined

**에러 메시지**:
```
Cannot read properties of undefined (reading 'property')
```

**원인**:
- 객체가 `undefined`인 상태에서 속성 접근
- 중첩된 객체의 중간 경로가 `undefined`

**해결 방법**:

#### Optional Chaining 사용
```javascript
// ❌ 잘못된 코드
const value = obj.property.subproperty;

// ✅ 올바른 코드
const value = obj?.property?.subproperty;
```

#### 방어 코드 추가
```javascript
// ❌ 잘못된 코드
function processData(data) {
  const value = data.workspace.keywords;
  // ...
}

// ✅ 올바른 코드
function processData(data) {
  if (!data?.workspace) {
    data.workspace = {
      keywords: [],
      outline: [],
      draft: '',
      linkedScraps: []
    };
  }
  const value = data.workspace.keywords || [];
  // ...
}
```

**관련 버그**:
- [workspace 객체 누락 버그](./BUG_FIX_LOG.md#workspace-객체-누락-버그)

---

### 2. Cannot read properties of null

**에러 메시지**:
```
Cannot read properties of null (reading 'querySelector')
```

**원인**:
- DOM 요소가 존재하지 않음
- 요소가 렌더링되기 전에 접근

**해결 방법**:

#### 요소 존재 확인
```javascript
// ❌ 잘못된 코드
const element = document.querySelector('.container');
element.querySelector('.child');

// ✅ 올바른 코드
const element = document.querySelector('.container');
if (element) {
  element.querySelector('.child');
}
```

#### 렌더링 후 접근
```javascript
// ❌ 잘못된 코드
function render() {
  createProgressIndicator(); // HTML 렌더링 전
  renderHTML();
}

// ✅ 올바른 코드
function render() {
  renderHTML();
  createProgressIndicator(); // HTML 렌더링 후
}
```

**관련 버그**:
- [createProgressIndicator 오류](./BUG_FIX_LOG.md#createprogressindicator-오류)

---

## 비동기 처리 에러

### 1. Unhandled Promise Rejection

**에러 메시지**:
```
Unhandled Promise Rejection: Error: ...
```

**원인**:
- `async/await` 또는 `Promise`에서 에러 처리 누락
- `catch` 블록 없이 `await` 사용

**해결 방법**:

#### try-catch 사용
```javascript
// ❌ 잘못된 코드
async function loadData() {
  const data = await fetchData();
  processData(data);
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
    // 에러 처리
  }
}
```

#### Promise.catch 사용
```javascript
// ❌ 잘못된 코드
fetchData()
  .then(data => processData(data));

// ✅ 올바른 코드
fetchData()
  .then(data => processData(data))
  .catch(error => {
    console.error('데이터 로드 실패:', error);
    // 에러 처리
  });
```

---

### 2. Race Condition

**에러 메시지**:
```
데이터가 예상과 다름
```

**원인**:
- 여러 비동기 작업이 동시에 실행되어 순서 보장 안 됨
- 이전 요청의 응답이 나중에 도착

**해결 방법**:

#### 요청 취소
```javascript
// ✅ 올바른 코드
let currentRequest = null;

async function loadData() {
  // 이전 요청 취소
  if (currentRequest) {
    currentRequest.abort();
  }
  
  currentRequest = fetchData();
  const data = await currentRequest;
  processData(data);
}
```

#### 플래그 사용
```javascript
// ✅ 올바른 코드
let isLoading = false;

async function loadData() {
  if (isLoading) return;
  
  isLoading = true;
  try {
    const data = await fetchData();
    processData(data);
  } finally {
    isLoading = false;
  }
}
```

---

## Firebase 에러

### 1. Permission Denied

**에러 메시지**:
```
Firebase: Permission denied
```

**원인**:
- Firebase Security Rules 위반
- 인증되지 않은 사용자 접근
- 잘못된 경로 접근

**해결 방법**:

#### Security Rules 확인
```javascript
// Firebase Security Rules 예시
{
  "rules": {
    "ideas": {
      "$ideaId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

#### 인증 상태 확인
```javascript
// ✅ 올바른 코드
async function saveData(data) {
  const userId = await getCurrentUserId();
  if (!userId) {
    console.error('인증되지 않은 사용자');
    return;
  }
  
  // Firebase 저장
}
```

---

### 2. Network Error

**에러 메시지**:
```
Firebase: Network error
```

**원인**:
- 네트워크 연결 문제
- Firebase 서비스 다운
- CORS 문제

**해결 방법**:

#### 재시도 로직
```javascript
// ✅ 올바른 코드
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}
```

---

## API 에러

### 1. 401 Unauthorized

**에러 메시지**:
```
401 Unauthorized
```

**원인**:
- OAuth 토큰 만료
- API 키 누락 또는 잘못됨
- 인증 헤더 누락

**해결 방법**:

#### 토큰 갱신
```javascript
// ✅ 올바른 코드
async function callAPI() {
  let token = await getAccessToken();
  
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.status === 401) {
      // 토큰 갱신
      token = await refreshAccessToken();
      // 재시도
      return await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    }
    
    return response;
  } catch (error) {
    console.error('API 호출 실패:', error);
    throw error;
  }
}
```

---

### 2. 404 Not Found

**에러 메시지**:
```
404 Not Found
```

**원인**:
- 리소스가 존재하지 않음
- 잘못된 URL
- 데이터가 아직 생성되지 않음

**해결 방법**:

#### 데이터 없음과 오류 구분
```javascript
// ✅ 올바른 코드
async function fetchPerformanceData(url) {
  try {
    const response = await fetch(apiUrl);
    
    if (response.status === 404) {
      // 데이터 없음 (오류 아님)
      return {
        revenue: 0,
        pageViews: 0,
        // ...
      };
    }
    
    if (!response.ok) {
      throw new Error(`API 오류: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('성과 데이터 수집 실패:', error);
    throw error;
  }
}
```

**관련 버그**:
- [AdSense 404 오류 처리](./BUG_FIX_LOG.md#adsense-404-오류-처리)

---

### 3. 429 Too Many Requests

**에러 메시지**:
```
429 Too Many Requests
```

**원인**:
- API 할당량 초과
- Rate limit 초과

**해결 방법**:

#### 지수 백오프 재시도
```javascript
// ✅ 올바른 코드
async function callAPIWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // 지수 백오프
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

---

## UI 에러

### 1. 이벤트 리스너 중복 등록

**에러 메시지**:
```
이벤트가 여러 번 발생함
```

**원인**:
- `render()` 함수가 여러 번 호출되어 리스너 중복 등록
- 이전 리스너 제거 없이 새 리스너 추가

**해결 방법**:

#### 기존 리스너 제거
```javascript
// ✅ 올바른 코드
let handler = null;

function render() {
  // 기존 리스너 제거
  if (handler) {
    button.removeEventListener('click', handler);
  }
  
  // 새 리스너 등록
  handler = () => {
    // 처리 로직
  };
  button.addEventListener('click', handler);
}
```

#### 이벤트 위임 사용
```javascript
// ✅ 올바른 코드
// 한 번만 리스너 등록
document.addEventListener('click', (e) => {
  if (e.target.matches('.button')) {
    // 처리 로직
  }
});
```

---

### 2. 메모리 누수

**에러 메시지**:
```
메모리 사용량 지속 증가
```

**원인**:
- 이벤트 리스너 정리 누락
- 타이머 정리 누락
- DOM 참조 유지

**해결 방법**:

#### 리스너 정리
```javascript
// ✅ 올바른 코드
class Component {
  constructor() {
    this.handlers = [];
  }
  
  addEventListener(element, event, handler) {
    element.addEventListener(event, handler);
    this.handlers.push({ element, event, handler });
  }
  
  destroy() {
    // 모든 리스너 정리
    this.handlers.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    this.handlers = [];
  }
}
```

---

## 🔗 관련 문서

- [버그 해결 로그](./BUG_FIX_LOG.md)
- [프로그램 로직](./PROGRAM_LOGIC.md)
- [리팩토링 가이드](./REFACTORING_GUIDE.md)

