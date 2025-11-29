# Google 인증 흐름 및 Service Worker에서의 Firebase Database 작업

## 현재 구현 개요

현재 구현은 **Firebase Auth를 사용하지 않고**, Chrome Extension의 `chrome.identity.getAuthToken` API를 사용하여 Google OAuth Access Token을 직접 관리합니다.

---

## 1. Google 인증 흐름

### 1.1 인증 시작 (`startGoogleAuth`)

```javascript
// js/services/authService.js
export async function startGoogleAuth() {
  // 1. Chrome Extension Identity API로 Google OAuth 토큰 가져오기
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (authToken) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(authToken);
      }
    });
  });
  
  // 2. 토큰 만료 시간 저장
  await saveTokenExpiry(token);
  
  // 3. Google UserInfo API로 사용자 정보 가져오기
  const userInfo = await fetchUserInfo(token);
  
  // 4. 사용자 정보를 chrome.storage.local에 저장
  await chrome.storage.local.set({ 
    googleUserEmail: userInfo.email,
    googleUserId: userInfo.id,
    googleUserName: userInfo.name,
    // ...
  });
}
```

### 1.2 인증 흐름 다이어그램

```
[사용자] 
  ↓ 클릭 "Google 로그인"
[UI Layer (panel.js)]
  ↓ chrome.runtime.sendMessage({ action: "start_google_auth" })
[Service Worker (background.js)]
  ↓ startGoogleAuth() 호출
[authService.js]
  ↓ chrome.identity.getAuthToken({ interactive: true })
[Chrome Identity API]
  ↓ Google OAuth 인증 팝업 표시
[사용자] 
  ↓ Google 계정 선택 및 권한 승인
[Chrome Identity API]
  ↓ Access Token 반환
[authService.js]
  ↓ fetchUserInfo(token) - Google UserInfo API 호출
[Google UserInfo API]
  ↓ 사용자 정보 (email, id, name) 반환
[authService.js]
  ↓ chrome.storage.local에 저장
[Service Worker]
  ↓ 인증 완료
```

### 1.3 Service Worker의 역할

- **인증 요청 처리**: `background.js`의 메시지 라우터가 `start_google_auth` 액션을 받아 `startGoogleAuth()` 호출
- **토큰 관리**: `chrome.storage.local`에 토큰 및 사용자 정보 저장
- **토큰 갱신**: `refreshAuthToken()` 함수로 토큰 자동 갱신
- **세션 복원**: Service Worker 재시작 시 `restoreAuthSession()`으로 세션 복원

---

## 2. 인증 상태 감지 (`onAuthStateChanged` 사용 여부)

### 2.1 현재 구현: `onAuthStateChanged` 미사용 ❌

**현재는 `onAuthStateChanged`를 사용하지 않습니다.**

```javascript
// js/services/firebaseService.js
import { getAuth, signInWithCredential, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';

// Firebase Auth는 초기화되지만 실제로 사용되지 않음
let firebaseAuth = null;

export function initializeFirebase() {
  // ...
  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);  // 초기화만 하고 사용 안 함
  }
  // ...
}
```

### 2.2 대신 사용하는 방법: `chrome.storage.local` 확인

```javascript
// js/services/firebaseService.js
export async function getCurrentUserId() {
  // chrome.storage.local에서 사용자 정보 확인
  const storage = await chrome.storage.local.get(['googleUserEmail', 'googleUserId']);
  
  if (storage.googleUserEmail) {
    // 이메일을 기반으로 사용자 ID 생성
    const safeEmail = storage.googleUserEmail
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');
    CONSTANTS.USER_ID = safeEmail;
    return safeEmail;
  }
  
  // 로그인 정보가 없으면 기본값
  return 'default_user';
}
```

### 2.3 데이터베이스 작업 전 인증 확인

**현재는 명시적인 인증 상태 확인 없이 바로 작업을 수행합니다.**

```javascript
// background.js
if (msg.action === "save_channels_and_key") {
  return handleAsync((async () => {
    // 인증 상태 확인 없이 바로 실행
    const userId = await getCurrentUserId();  // chrome.storage.local에서 확인
    await set(ref(getDb(), `channels/${userId}`), cleanedChannels);
  })());
}
```

**문제점**: 
- Firebase Database 보안 규칙이 `auth != null`을 요구하지만, Firebase Auth를 사용하지 않으므로 `auth`가 항상 `null`입니다.
- 이로 인해 `permission_denied` 오류가 발생합니다.

### 2.4 최근 변경: 백그라운드 핸들러에서 토큰 검증 추가

프로덕션에서 `channels` 경로는 `auth != null` 규칙을 적용하므로, 모든 읽기/쓰기 작업 전에 토큰 검증이 수행되도록 코드가 업데이트되었습니다. 구체적으로, 다음과 같은 변경을 적용했습니다:

- `background.js`: `get_channels_and_key`, `save_channels_and_key`, `get_my_channels`, `delete_channel`, `fix_active_channel_mismatch`, `fix_channel_structure` 핸들러에서 `authService.getValidToken(false)` 호출로 토큰 유효성을 확인합니다.
- `collectorService.js`, `aiService.js`, `migrationService.js` 등의 서비스 함수에서도 `getValidToken(false)`를 사용하여 비인증 상태에서는 채널 관련 DB 작업을 건너뛰거나 에러를 반환하도록 수정했습니다.

이 변경으로 보안 규칙과 코드가 일치하며, 비인증 상태에서 발생하는 `permission_denied` 오류를 사전에 방지할 수 있습니다.

---

## 3. Service Worker에서 Realtime Database `set` 작업 시작

### 3.1 현재 구현 방식

```javascript
// background.js
import { getDb, getCurrentUserId, cleanDataForFirebase } from './js/services/firebaseService.js';
import { ref, set } from 'firebase/database';

// 메시지 라우터
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "save_channels_and_key") {
    return handleAsync((async () => {
      // 1. 사용자 ID 가져오기 (chrome.storage.local에서)
      const userId = await getCurrentUserId();
      
      // 2. 데이터 정제 (undefined → null)
      const cleanedChannels = cleanDataForFirebase(channels);
      
      // 3. Firebase Database에 직접 저장
      await set(ref(getDb(), `channels/${userId}`), cleanedChannels);
      
      return { success: true };
    })());
  }
});
```

### 3.2 작업 흐름

```
[Content Script / UI]
  ↓ chrome.runtime.sendMessage({ action: "save_channels_and_key", data: {...} })
[Service Worker (background.js)]
  ↓ 메시지 라우터가 액션 처리
  ↓ getCurrentUserId() - chrome.storage.local에서 사용자 ID 확인
  ↓ cleanDataForFirebase() - 데이터 정제
  ↓ set(ref(getDb(), `channels/${userId}`), data)
[Firebase Realtime Database]
  ↓ 보안 규칙 검사 (auth != null) ← 현재 실패
  ↓ permission_denied 오류 발생
```

### 3.3 문제점

1. **Firebase Auth 미사용**: `auth`가 항상 `null`이므로 보안 규칙 검사 실패
2. **인증 상태 확인 없음**: 데이터베이스 작업 전에 로그인 여부를 확인하지 않음
3. **보안 규칙 불일치**: 보안 규칙은 `auth != null`을 요구하지만, 실제로는 Firebase Auth를 사용하지 않음

---

## 4. 권장 개선 사항

### 4.1 옵션 1: Firebase Auth 통합 (권장)

Service Worker 환경에서는 제한적이지만, 가능한 범위에서 Firebase Auth를 사용:

```javascript
// Firebase Auth로 Google OAuth 토큰 인증
import { signInWithCredential, GoogleAuthProvider } from 'firebase/auth';

// Access Token을 ID Token으로 변환하는 백엔드 서버 필요
// 또는 Firebase Admin SDK로 Custom Token 생성
```

**장점**: 
- Firebase 보안 규칙과 완벽하게 통합
- `onAuthStateChanged`로 인증 상태 감지 가능

**단점**: 
- Service Worker 환경에서 제한적
- 백엔드 서버 필요 (Access Token → ID Token 변환)

### 4.2 옵션 2: 보안 규칙 조정 (현실적)

Firebase Auth 없이도 작동하도록 보안 규칙 수정:

```json
{
  "rules": {
    "channels": {
      "$userId": {
        ".read": true,   // 임시: 개발용
        ".write": true   // 임시: 개발용
      }
    }
  }
}
```

**또는** 사용자 ID 기반 검증 (애플리케이션 레벨):

```javascript
// 데이터베이스 작업 전 명시적 검증
async function saveChannels(channels) {
  const userId = await getCurrentUserId();
  
  // 로그인 상태 확인
  const storage = await chrome.storage.local.get('googleUserEmail');
  if (!storage.googleUserEmail) {
    throw new Error('로그인이 필요합니다.');
  }
  
  // 사용자 ID 검증
  if (userId === 'default_user') {
    throw new Error('로그인이 필요합니다.');
  }
  
  // 저장
  await set(ref(getDb(), `channels/${userId}`), channels);
}
```

### 4.3 옵션 3: `onAuthStateChanged` 구현 (향후)

Firebase Auth를 통합한 후:

```javascript
// js/services/firebaseService.js
import { onAuthStateChanged } from 'firebase/auth';

let authState = { authenticated: false, user: null };

export function initializeAuthStateListener() {
  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);
  }
  
  onAuthStateChanged(firebaseAuth, (user) => {
    authState = {
      authenticated: !!user,
      user: user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
      } : null
    };
    
    Logger.info('[Firebase Auth] 인증 상태 변경:', authState);
  });
}

export function isAuthenticated() {
  return authState.authenticated;
}

// 데이터베이스 작업 전 확인
export async function ensureAuthenticated() {
  if (!isAuthenticated()) {
    throw new Error('로그인이 필요합니다. Firebase Auth로 로그인해주세요.');
  }
}
```

---

## 5. 현재 상태 요약

| 항목 | 현재 상태 | 문제점 |
|------|----------|--------|
| **Google 인증** | ✅ `chrome.identity.getAuthToken` 사용 | - |
| **Firebase Auth** | ❌ 사용 안 함 | 보안 규칙과 불일치 |
| **인증 상태 감지** | ❌ `onAuthStateChanged` 미사용 | 인증 상태를 실시간으로 감지하지 않음 |
| **DB 작업 전 검증** | ❌ 없음 | 로그인 여부 확인 없이 작업 수행 |
| **보안 규칙** | ⚠️ `auth != null` 요구 | Firebase Auth 미사용으로 항상 실패 |

---

## 6. 즉시 해결 방법

### 6.1 임시 보안 규칙 (개발용)

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

### 6.2 애플리케이션 레벨 검증 추가

```javascript
// background.js
async function ensureUserLoggedIn() {
  const storage = await chrome.storage.local.get('googleUserEmail');
  if (!storage.googleUserEmail) {
    throw new Error('로그인이 필요합니다. 먼저 Google 로그인을 해주세요.');
  }
}

if (msg.action === "save_channels_and_key") {
  return handleAsync((async () => {
    // 로그인 확인
    await ensureUserLoggedIn();
    
    const userId = await getCurrentUserId();
    if (userId === 'default_user') {
      throw new Error('로그인이 필요합니다.');
    }
    
    // 저장
    await set(ref(getDb(), `channels/${userId}`), cleanedChannels);
  })());
}
```

---

## 결론

현재 구현은 **Firebase Auth를 사용하지 않고** Chrome Extension의 Identity API만 사용합니다. 이로 인해:

1. ✅ Google OAuth 인증은 정상 작동
2. ❌ Firebase Database 보안 규칙과 불일치 (`auth != null` 요구)
3. ❌ `onAuthStateChanged` 미사용으로 인증 상태 실시간 감지 불가
4. ❌ 데이터베이스 작업 전 명시적 인증 확인 없음

**권장 사항**: 
- 단기: 보안 규칙을 임시로 완전히 열거나, 애플리케이션 레벨 검증 추가
- 장기: Firebase Auth 통합 또는 백엔드 서버 구축

