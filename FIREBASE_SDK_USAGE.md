# Firebase SDK 사용법 및 Service Worker 환경에서의 인증 상태 관리

## 1. Firebase SDK 메서드 사용법

### 1.1 올바른 Import 문법 (Firebase v9+ Modular SDK)

```javascript
// js/services/firebaseService.js
import { 
  getAuth, 
  signInWithCredential, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut,
  currentUser
} from 'firebase/auth';
```

### 1.2 GoogleAuthProvider.credential() 사용법

```javascript
// 올바른 사용법
import { GoogleAuthProvider } from 'firebase/auth';

// GoogleAuthProvider 인스턴스 생성 (선택사항, credential 생성 시에는 필요 없음)
const provider = new GoogleAuthProvider();

// Credential 생성
// GoogleAuthProvider.credential(idToken, accessToken)
// - 첫 번째 파라미터: ID Token (필수)
// - 두 번째 파라미터: Access Token (선택사항)
const credential = GoogleAuthProvider.credential(idToken, accessToken);

// 또는 ID Token만 사용
const credential = GoogleAuthProvider.credential(idToken);
```

**중요**: 
- `GoogleAuthProvider.credential(null, accessToken)`은 **작동하지 않습니다**.
- Firebase Auth는 **ID Token을 필수로 요구**합니다.
- Access Token만으로는 Firebase Auth에 로그인할 수 없습니다.

### 1.3 signInWithCredential() 사용법

```javascript
// 올바른 사용법
import { getAuth, signInWithCredential } from 'firebase/auth';

// Firebase Auth 인스턴스 가져오기
const auth = getAuth(firebaseApp);

// Credential로 로그인
const userCredential = await signInWithCredential(auth, credential);

// 사용자 정보 접근
const user = userCredential.user;
console.log('UID:', user.uid);
console.log('Email:', user.email);
console.log('Display Name:', user.displayName);
```

### 1.4 현재 구현의 문제점

```javascript
// ❌ 잘못된 사용법 (현재 코드)
const credential = GoogleAuthProvider.credential(null, accessToken);
// → ID Token이 null이므로 작동하지 않음

// ✅ 올바른 사용법
const credential = GoogleAuthProvider.credential(idToken, accessToken);
// 또는
const credential = GoogleAuthProvider.credential(idToken);
```

---

## 2. Service Worker 환경에서 Firebase Authentication 상태 관리

### 2.1 Service Worker 환경의 제약사항

- **DOM 접근 불가**: `window`, `document` 등 DOM API 사용 불가
- **팝업/리디렉션 제한**: OAuth 팝업이나 리디렉션 기반 인증 흐름 사용 불가
- **지속성**: Service Worker는 비활성화될 수 있으므로 상태를 영구 저장소에 보관해야 함
- **메시지 기반 통신**: Content Script나 UI와 메시지로 통신

### 2.2 권장 인증 상태 관리 방법

#### 방법 1: onAuthStateChanged 리스너 등록 (권장)

```javascript
// js/services/firebaseService.js

let firebaseAuth = null;
let authState = { authenticated: false, user: null };
let authStateUnsubscribe = null;

/**
 * Firebase Auth 상태 리스너 초기화
 * Service Worker 시작 시 한 번만 호출
 */
export function initializeAuthStateListener() {
  if (!firebaseAuth) {
    initializeFirebase();
    firebaseAuth = getAuth(firebaseApp);
  }
  
  // 기존 리스너가 있으면 해제
  if (authStateUnsubscribe) {
    authStateUnsubscribe();
  }
  
  // 인증 상태 변경 리스너 등록
  authStateUnsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
    authState = {
      authenticated: !!user,
      user: user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
      } : null
    };
    
    Logger.info('[Firebase Auth] 인증 상태 변경:', {
      authenticated: authState.authenticated,
      email: authState.user?.email
    });
    
    // 인증 상태를 chrome.storage.local에 저장 (Service Worker 재시작 시 복원)
    chrome.storage.local.set({
      firebaseAuthState: authState,
      firebaseAuthTimestamp: Date.now()
    });
  });
  
  Logger.info('[Firebase Auth] 인증 상태 리스너 등록 완료');
}

/**
 * 현재 인증 상태 가져오기
 * @returns {Promise<{authenticated: boolean, user: object|null}>}
 */
export async function getFirebaseAuthState() {
  // 메모리 캐시 확인
  if (authState.user) {
    return authState;
  }
  
  // chrome.storage.local에서 복원 시도
  const storage = await chrome.storage.local.get(['firebaseAuthState', 'firebaseAuthTimestamp']);
  if (storage.firebaseAuthState && storage.firebaseAuthTimestamp) {
    const age = Date.now() - storage.firebaseAuthTimestamp;
    // 1시간 이내의 상태면 사용
    if (age < 3600000) {
      authState = storage.firebaseAuthState;
      return authState;
    }
  }
  
  // Firebase Auth에서 직접 확인
  if (!firebaseAuth) {
    initializeFirebase();
    firebaseAuth = getAuth(firebaseApp);
  }
  
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      unsubscribe();
      const state = {
        authenticated: !!user,
        user: user ? {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName
        } : null
      };
      authState = state;
      resolve(state);
    });
  });
}

/**
 * 인증 상태 확인 (동기)
 * @returns {boolean}
 */
export function isFirebaseAuthenticated() {
  return authState.authenticated;
}

/**
 * 데이터베이스 작업 전 인증 확인
 * @throws {Error} 인증되지 않은 경우
 */
export async function ensureFirebaseAuthenticated() {
  const state = await getFirebaseAuthState();
  if (!state.authenticated) {
    throw new Error('Firebase 인증이 필요합니다. 먼저 로그인해주세요.');
  }
  return state.user;
}
```

#### 방법 2: Service Worker 시작 시 인증 상태 복원

```javascript
// background.js
import { initializeAuthStateListener, getFirebaseAuthState } from './js/services/firebaseService.js';

// Service Worker 시작 시
(async () => {
  try {
    // Firebase 초기화
    initializeFirebase();
    
    // 인증 상태 리스너 등록
    initializeAuthStateListener();
    
    // 기존 인증 상태 확인
    const authState = await getFirebaseAuthState();
    if (authState.authenticated) {
      Logger.info('[Service Worker] Firebase 인증 상태 복원:', authState.user.email);
    } else {
      Logger.info('[Service Worker] Firebase 인증되지 않음');
    }
  } catch (error) {
    Logger.error('[Service Worker] 초기화 오류:', error);
  }
})();
```

#### 방법 3: 데이터베이스 작업 전 인증 확인

```javascript
// background.js
import { ensureFirebaseAuthenticated } from './js/services/firebaseService.js';

if (msg.action === "save_channels_and_key") {
  return handleAsync((async () => {
    try {
      // Firebase 인증 확인
      const user = await ensureFirebaseAuthenticated();
      Logger.debug('[DB] Firebase 인증 확인:', user.email);
      
      // 데이터베이스 작업 수행
      const userId = await getCurrentUserId();
      const cleanedChannels = cleanDataForFirebase(channels);
      await set(ref(getDb(), `channels/${userId}`), cleanedChannels);
      
      return { success: true };
    } catch (error) {
      Logger.error('[DB] 인증 오류:', error);
      return { 
        success: false, 
        error: error.message,
        requiresAuth: true 
      };
    }
  })());
}
```

---

## 3. ID Token 획득 방법

### 3.1 문제: Access Token만으로는 부족

`chrome.identity.getAuthToken()`은 Access Token만 반환하지만, Firebase Auth는 ID Token을 필요로 합니다.

### 3.2 해결 방법

#### 옵션 1: Google OAuth2 Authorization Code Flow 사용

```javascript
// 1. Authorization Code 획득
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}&` +
  `redirect_uri=${chrome.identity.getRedirectURL()}&` +
  `response_type=code&` +
  `scope=openid email profile&` +
  `access_type=offline`;

chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
  // 2. Authorization Code 추출
  const code = new URL(redirectUrl).searchParams.get('code');
  
  // 3. Authorization Code를 ID Token으로 교환 (백엔드 서버 필요)
  fetch('https://your-backend.com/exchange-code', {
    method: 'POST',
    body: JSON.stringify({ code })
  }).then(r => r.json()).then(({ idToken }) => {
    // 4. ID Token으로 Firebase Auth 로그인
    const credential = GoogleAuthProvider.credential(idToken);
    signInWithCredential(firebaseAuth, credential);
  });
});
```

#### 옵션 2: Firebase Admin SDK로 Custom Token 생성 (백엔드 필요)

```javascript
// 백엔드 서버 (Node.js)
const admin = require('firebase-admin');

app.post('/create-custom-token', async (req, res) => {
  const { googleUserId, email } = req.body;
  
  // Custom Token 생성
  const customToken = await admin.auth().createCustomToken(googleUserId, {
    email: email
  });
  
  res.json({ customToken });
});

// 클라이언트 (Service Worker)
import { signInWithCustomToken } from 'firebase/auth';

const response = await fetch('https://your-backend.com/create-custom-token', {
  method: 'POST',
  body: JSON.stringify({ 
    googleUserId: userInfo.id,
    email: userInfo.email 
  })
});

const { customToken } = await response.json();
await signInWithCustomToken(firebaseAuth, customToken);
```

---

## 4. 완전한 구현 예시

### 4.1 Firebase Service 초기화 및 인증 상태 관리

```javascript
// js/services/firebaseService.js

import { getAuth, signInWithCredential, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';

let firebaseAuth = null;
let authState = { authenticated: false, user: null };
let authStateUnsubscribe = null;

/**
 * Firebase 초기화 및 인증 상태 리스너 등록
 */
export function initializeFirebase() {
  // ... 기존 초기화 코드 ...
  
  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);
  }
  
  // 인증 상태 리스너 등록
  initializeAuthStateListener();
}

/**
 * 인증 상태 리스너 초기화
 */
function initializeAuthStateListener() {
  if (authStateUnsubscribe) {
    authStateUnsubscribe();
  }
  
  authStateUnsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
    authState = {
      authenticated: !!user,
      user: user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
      } : null
    };
    
    // 상태를 chrome.storage.local에 저장
    await chrome.storage.local.set({
      firebaseAuthState: authState,
      firebaseAuthTimestamp: Date.now()
    });
    
    Logger.info('[Firebase Auth] 인증 상태 변경:', {
      authenticated: authState.authenticated,
      email: authState.user?.email
    });
  });
}

/**
 * ID Token으로 Firebase Auth에 로그인
 * @param {string} idToken - Google OAuth ID Token
 * @returns {Promise<{success: boolean, user: object|null, error?: string}>}
 */
export async function signInToFirebaseWithIdToken(idToken) {
  try {
    if (!firebaseAuth) {
      initializeFirebase();
      firebaseAuth = getAuth(firebaseApp);
    }
    
    // ID Token으로 credential 생성
    const credential = GoogleAuthProvider.credential(idToken);
    
    // Firebase에 로그인
    const userCredential = await signInWithCredential(firebaseAuth, credential);
    
    Logger.biz(`[Firebase Auth] ✅ 인증 성공: ${userCredential.user.email}`);
    
    return {
      success: true,
      user: {
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        displayName: userCredential.user.displayName
      }
    };
  } catch (error) {
    Logger.error('[Firebase Auth] ❌ 인증 실패:', error);
    return {
      success: false,
      user: null,
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Firebase Auth 로그아웃
 */
export async function signOutFromFirebase() {
  try {
    if (firebaseAuth) {
      await signOut(firebaseAuth);
      Logger.info('[Firebase Auth] 로그아웃 완료');
    }
  } catch (error) {
    Logger.error('[Firebase Auth] 로그아웃 오류:', error);
  }
}
```

### 4.2 데이터베이스 작업 전 인증 확인

```javascript
// background.js
import { ensureFirebaseAuthenticated } from './js/services/firebaseService.js';

// 모든 데이터베이스 작업 전에 인증 확인
async function performDatabaseOperation(operation) {
  try {
    // Firebase 인증 확인
    const user = await ensureFirebaseAuthenticated();
    
    // 작업 수행
    return await operation();
  } catch (error) {
    if (error.message.includes('인증이 필요')) {
      Logger.warn('[DB] 인증되지 않음, 작업 취소');
      return { success: false, error: '인증이 필요합니다.', requiresAuth: true };
    }
    throw error;
  }
}

if (msg.action === "save_channels_and_key") {
  return handleAsync(performDatabaseOperation(async () => {
    const userId = await getCurrentUserId();
    const cleanedChannels = cleanDataForFirebase(channels);
    await set(ref(getDb(), `channels/${userId}`), cleanedChannels);
    return { success: true };
  }));
}
```

---

## 5. 요약

### Firebase SDK 메서드 사용법

1. **Import**: `import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'`
2. **Credential 생성**: `GoogleAuthProvider.credential(idToken, accessToken)` - **ID Token 필수**
3. **로그인**: `signInWithCredential(auth, credential)`

### Service Worker 환경에서의 인증 상태 관리

1. **onAuthStateChanged 리스너 등록**: Service Worker 시작 시 한 번 등록
2. **상태 영구 저장**: `chrome.storage.local`에 인증 상태 저장
3. **상태 복원**: Service Worker 재시작 시 저장된 상태 복원
4. **작업 전 확인**: 데이터베이스 작업 전 `ensureFirebaseAuthenticated()` 호출

### 현재 문제점

- ❌ Access Token만으로는 Firebase Auth 로그인 불가
- ✅ ID Token 획득 필요 (백엔드 서버 또는 Authorization Code Flow)

