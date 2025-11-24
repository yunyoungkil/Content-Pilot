// js/services/firebaseService.js
// Firebase 초기화 및 헬퍼 함수 제공 (단일 진실 공급원)

// Firebase v9+ 모듈 API import
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, update, remove, onValue, get, serverTimestamp } from 'firebase/database';
import { getAuth, signInWithCredential, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';
import { getValidToken } from './authService.js';
import { Logger } from '../utils.js';

// 상수 정의
export const CONSTANTS = {
  USER_ID: 'default_user' // 기본값, 로그인 시 동적으로 업데이트됨
};

/**
 * 현재 사용자 ID 가져오기 (동적)
 * 로그인된 사용자의 이메일을 기반으로 USER_ID를 반환
 * @returns {Promise<string>} 사용자 ID
 */
export async function getCurrentUserId() {
  try {
    const storage = await chrome.storage.local.get(['googleUserEmail', 'googleUserId']);
    
    // 이메일이 있으면 이메일을 기반으로 안전한 사용자 ID 생성
    if (storage.googleUserEmail) {
      // 이메일을 안전한 Firebase 키로 변환 (특수문자 제거)
      const safeEmail = storage.googleUserEmail
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '');
      
      // USER_ID 업데이트 (동적)
      CONSTANTS.USER_ID = safeEmail;
      Logger.debug(`[Firebase] 사용자 ID 설정: ${safeEmail}`);
      return safeEmail;
    }
    
    // 사용자 ID가 있으면 사용
    if (storage.googleUserId) {
      const safeId = storage.googleUserId
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '');
      CONSTANTS.USER_ID = safeId;
      Logger.debug(`[Firebase] 사용자 ID 설정 (ID 기반): ${safeId}`);
      return safeId;
    }
    
    // 로그인 정보가 없으면 기본값 사용 (로그아웃 상태)
    CONSTANTS.USER_ID = 'default_user';
    Logger.debug('[Firebase] 사용자 정보 없음, 기본 USER_ID 사용');
    return CONSTANTS.USER_ID;
  } catch (error) {
    Logger.error('[getCurrentUserId] 오류:', error);
    CONSTANTS.USER_ID = 'default_user';
    return CONSTANTS.USER_ID;
  }
}

// Firebase 설정
export const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL:
    "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:12dc37c0bfd2fb1ac05320",
};

// Firebase 초기화 상태
let firebaseInitialized = false;
let firebaseApp = null;
let firebaseDatabase = null;
let firebaseAuth = null;
let authStateListener = null;

// Firebase Auth 상태 관리
let authState = { authenticated: false, user: null };
let authStateUnsubscribe = null;

/**
 * Firebase 초기화 함수 (단일 진실 공급원)
 * @returns {boolean} 초기화 성공 여부
 */
export function initializeFirebase() {
  if (firebaseInitialized) {
    return true;
  }
  
  try {
    if (!firebaseApp) {
      firebaseApp = initializeApp(firebaseConfig);
    }
    if (!firebaseDatabase) {
      firebaseDatabase = getDatabase(firebaseApp);
    }
    if (!firebaseAuth) {
      firebaseAuth = getAuth(firebaseApp);
    }
    firebaseInitialized = true;
    Logger.info('🔥 [firebaseService] Firebase 초기화 완료');
    
    // 인증 상태 리스너 초기화
    initializeAuthStateListener();
    
    // 하위 호환성을 위한 전역 firebase 객체 생성
    const createRefWrapper = (dbRef) => {
      return {
        once: (eventType) => get(dbRef).then(snapshot => ({ 
          val: () => snapshot.val(), 
          exists: () => snapshot.exists() 
        })),
        set: (value) => set(dbRef, value),
        update: (values) => update(dbRef, values),
        remove: () => remove(dbRef),
        push: (value) => {
          const newRef = push(dbRef);
          if (value) {
            set(newRef, value);
          }
          return {
            set: (val) => set(newRef, val),
            key: newRef.key
          };
        },
        child: (childPath) => {
          const childRef = ref(firebaseDatabase, `${dbRef.path}/${childPath}`);
          return createRefWrapper(childRef);
        },
        on: (eventType, callback) => {
          const unsubscribe = onValue(dbRef, (snapshot) => {
            callback({ 
              val: () => snapshot.val(), 
              exists: () => snapshot.exists() 
            });
          });
          return unsubscribe;
        }
      };
    };
    
    const firebaseCompat = {
      app: firebaseApp,
      apps: [firebaseApp],
      initializeApp: () => firebaseApp,
      database: () => ({
        ref: (path) => createRefWrapper(ref(firebaseDatabase, path)),
        ServerValue: {
          TIMESTAMP: serverTimestamp()
        }
      })
    };
    
    // 전역 변수로 설정 (하위 호환성)
    if (typeof self !== 'undefined') {
      self.firebase = firebaseCompat;
    }
    if (typeof globalThis !== 'undefined') {
      globalThis.firebase = firebaseCompat;
    }
    
    return true;
  } catch (error) {
    console.error('[firebaseService] Firebase 초기화 오류:', error);
    return false;
  }
}

/**
 * Google Access Token으로 Firebase Auth에 로그인
 * @param {string} accessToken - Google OAuth Access Token
 * @returns {Promise<{success: boolean, user: object|null, error?: string}>}
 */
export async function signInToFirebaseWithGoogleToken(accessToken) {
  try {
    if (!firebaseAuth) {
      initializeFirebase();
      firebaseAuth = getAuth(firebaseApp);
    }
    
    Logger.info('[Firebase Auth] Google Access Token으로 Firebase 인증 시작');
    
    // 주의: GoogleAuthProvider.credential()은 ID Token을 첫 번째 파라미터로 받습니다.
    // Access Token만으로는 작동하지 않을 수 있습니다.
    // Firebase Auth는 일반적으로 ID Token을 필요로 합니다.
    
    // 방법 1: Access Token으로 ID Token 획득 시도
    // Google OAuth2 tokeninfo API로 토큰 정보 확인
    let idToken = null;
    try {
      // Access Token을 사용하여 사용자 정보 가져오기
      const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        Logger.debug('[Firebase Auth] 사용자 정보 확인:', userInfo.email);
        
        // 참고: Access Token으로는 직접 ID Token을 얻을 수 없습니다.
        // ID Token을 얻으려면 Google OAuth2의 authorization code flow를 사용하거나
        // 백엔드 서버를 통해 변환해야 합니다.
      }
    } catch (e) {
      Logger.warn('[Firebase Auth] 사용자 정보 조회 실패:', e);
    }
    
    // 방법 2: GoogleAuthProvider.credential() 사용
    // Access Token만으로는 작동하지 않을 수 있지만 시도
    const provider = new GoogleAuthProvider();
    
    // credential 생성: 첫 번째는 ID Token, 두 번째는 Access Token
    // ID Token이 없으므로 null 전달 (이 경우 작동하지 않을 수 있음)
    const credential = GoogleAuthProvider.credential(idToken, accessToken);
    
    // Firebase에 로그인 시도
    const userCredential = await signInWithCredential(firebaseAuth, credential);
    
    Logger.biz(`[Firebase Auth] ✅ 인증 성공: ${userCredential.user.email} (UID: ${userCredential.user.uid})`);
    
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
    Logger.error('[Firebase Auth] 오류 코드:', error.code);
    Logger.error('[Firebase Auth] 오류 메시지:', error.message);
    
    // configuration-not-found 오류 처리
    if (error.code === 'auth/configuration-not-found') {
      Logger.error('[Firebase Auth] 💡 해결 방법:');
      Logger.error('[Firebase Auth] 1. Firebase Console > Authentication > Sign-in method로 이동');
      Logger.error('[Firebase Auth] 2. "Google" Sign-in Provider 활성화');
      Logger.error('[Firebase Auth] 3. OAuth Client ID 입력: 670273757107-180d6ap7makb2ch4nttomglavsgmkmtq.apps.googleusercontent.com');
      Logger.error('[Firebase Auth] 4. OAuth Client Secret 입력 (Google Cloud Console에서 확인)');
      Logger.error('[Firebase Auth] 5. 저장 후 다시 시도');
    }
    
    // invalid-credential 오류 처리
    if (error.code === 'auth/invalid-credential' || error.message.includes('ID token')) {
      Logger.warn('[Firebase Auth] Access Token만으로는 인증할 수 없습니다.');
      Logger.warn('[Firebase Auth] 💡 해결 방법:');
      Logger.warn('[Firebase Auth] - Firebase Auth는 ID Token을 필요로 합니다.');
      Logger.warn('[Firebase Auth] - Access Token을 ID Token으로 변환하려면 백엔드 서버가 필요합니다.');
      Logger.warn('[Firebase Auth] - 또는 Firebase Admin SDK를 사용하여 Custom Token을 생성해야 합니다.');
    }
    
    return {
      success: false,
      user: null,
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Firebase Auth 상태 리스너 초기화
 * Service Worker 시작 시 한 번만 호출
 * 인증 상태 변경 시 chrome.storage.local에 저장하여 영구 보관
 */
function initializeAuthStateListener() {
  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);
  }
  
  // 기존 리스너가 있으면 해제
  if (authStateUnsubscribe) {
    authStateUnsubscribe();
  }
  
  // 인증 상태 변경 리스너 등록
  authStateUnsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
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
    try {
      await chrome.storage.local.set({
        firebaseAuthState: authState,
        firebaseAuthTimestamp: Date.now()
      });
    } catch (e) {
      Logger.warn('[Firebase Auth] 상태 저장 실패:', e);
    }
  });
  
  Logger.info('[Firebase Auth] 인증 상태 리스너 등록 완료');
}

/**
 * Firebase 인증 상태 확인
 * @returns {Promise<{authenticated: boolean, user: object|null}>}
 */
export async function getFirebaseAuthState() {
  try {
    // 메모리 캐시 확인 (가장 빠름)
    if (authState.user) {
      return authState;
    }
    
    // chrome.storage.local에서 복원 시도 (Service Worker 재시작 시)
    const storage = await chrome.storage.local.get(['firebaseAuthState', 'firebaseAuthTimestamp']);
    if (storage.firebaseAuthState && storage.firebaseAuthTimestamp) {
      const age = Date.now() - storage.firebaseAuthTimestamp;
      // 1시간 이내의 상태면 사용
      if (age < 3600000) {
        authState = storage.firebaseAuthState;
        Logger.debug('[Firebase Auth] 저장된 상태 복원:', authState.user?.email);
        return authState;
      }
    }
    
    // Firebase Auth에서 직접 확인 (최종 확인)
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
  } catch (error) {
    Logger.error('[Firebase Auth] 인증 상태 확인 실패:', error);
    return { authenticated: false, user: null };
  }
}

/**
 * 인증 상태 확인 (동기)
 * 메모리 캐시된 상태를 반환 (빠른 확인용)
 * @returns {boolean}
 */
export function isFirebaseAuthenticated() {
  return authState.authenticated;
}

/**
 * 데이터베이스 작업 전 인증 확인
 * @throws {Error} 인증되지 않은 경우
 * @returns {Promise<object>} 인증된 사용자 정보
 */
export async function ensureFirebaseAuthenticated() {
  const state = await getFirebaseAuthState();
  if (!state.authenticated) {
    throw new Error('Firebase 인증이 필요합니다. 먼저 로그인해주세요.');
  }
  return state.user;
}

/**
 * Firebase 인증 상태 리스너 등록
 * @param {Function} callback - 인증 상태 변경 시 호출될 콜백
 * @returns {Function} 리스너 해제 함수
 */
export function onFirebaseAuthStateChanged(callback) {
  if (!firebaseAuth) {
    initializeFirebase();
    firebaseAuth = getAuth(firebaseApp);
  }
  
  return onAuthStateChanged(firebaseAuth, (user) => {
    callback({
      authenticated: !!user,
      user: user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
      } : null
    });
  });
}

/**
 * Firebase Database 인스턴스 가져오기
 * @returns {object} Firebase Database 인스턴스
 */
export function getDb() {
  if (!firebaseInitialized) {
    initializeFirebase();
  }
  return firebaseDatabase;
}

/**
 * 사용자별 Firebase 참조 가져오기
 * @param {string} path - 경로 (예: "kanban", "channels")
 * @returns {object} Firebase 참조
 */
export function getUserRef(path) {
  if (!firebaseInitialized) {
    initializeFirebase();
  }
  return ref(firebaseDatabase, `${path}/${CONSTANTS.USER_ID}`);
}

/**
 * Firebase v9+ 모듈 API 직접 export
 */
export { ref, push, set, update, remove, onValue, get, serverTimestamp };

// 즉시 초기화
initializeFirebase();

/**
 * Base64 데이터 URL을 Blob으로 변환하는 헬퍼 함수
 * @param {string} dataUrl - Base64 데이터 URL (예: "data:image/png;base64,...")
 * @returns {Blob} Blob 객체
 */
export function dataURLtoBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Firebase Storage에 이미지를 업로드하고 다운로드 URL을 반환하는 함수
 * Firebase Storage REST API를 사용 (Service Worker 환경 호환)
 * @param {string} dataUrl - Base64 데이터 URL
 * @param {string} path - Storage 경로 (예: "thumbnails/userId/timestamp.png")
 * @param {string} userId - 사용자 ID
 * @returns {Promise<string>} 다운로드 URL
 */
export async function uploadImageToFirebaseStorage(dataUrl, path, userId) {
  try {
    // Base64 데이터 URL을 Blob으로 변환
    const blob = dataURLtoBlob(dataUrl);
    
    // Google OAuth 토큰 가져오기 (Firebase Storage 인증용)
    // 토큰 검증 및 자동 갱신
    let token = await getValidToken(false);
    
    // 토큰이 없으면 interactive 모드로 재시도
    if (!token) {
      token = await getValidToken(true);
      if (!token) {
        throw new Error('인증 토큰을 가져올 수 없습니다. 로그인이 필요합니다.');
      }
    }
    
    // Firebase Storage REST API를 사용하여 업로드
    const bucket = firebaseConfig.storageBucket;
    const encodedPath = encodeURIComponent(path);
    
    // 업로드 엔드포인트
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;
    
    console.log('[Firebase Storage] 업로드 시작:', path);
    console.log('[Firebase Storage] 파일 크기:', blob.size, 'bytes');
    console.log('[Firebase Storage] 버킷:', bucket);
    
    // Blob을 Firebase Storage에 업로드
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': blob.type || 'image/png'
      },
      body: blob
    });
    
    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || uploadResponse.statusText;
      
      // 403 오류인 경우 상세한 오류 정보 로깅
      if (uploadResponse.status === 403) {
        console.error('[Firebase Storage] 403 Permission denied 오류 상세:');
        console.error('[Firebase Storage] - 오류 메시지:', errorMessage);
        console.error('[Firebase Storage] - 전체 오류 응답:', errorData);
        console.error('[Firebase Storage] - 업로드 경로:', path);
        console.error('[Firebase Storage] - 버킷:', bucket);
        console.error('[Firebase Storage] ⚠️ Firebase Storage 보안 규칙을 확인하세요.');
        console.error('[Firebase Storage] ⚠️ Google OAuth 토큰이 Firebase Storage에 접근할 수 있는 권한이 있는지 확인하세요.');
        console.error('[Firebase Storage] 💡 해결 방법:');
        console.error('[Firebase Storage]    1. Firebase Console > Storage > Rules에서 업로드 권한 확인');
        console.error('[Firebase Storage]    2. 또는 Firebase Authentication을 사용하여 Firebase ID 토큰 발급');
        console.error('[Firebase Storage]    3. 현재는 Base64 fallback으로 동작합니다.');
      }
      
      throw new Error(`Firebase Storage 업로드 실패 (${uploadResponse.status}): ${errorMessage}`);
    }
    
    const uploadResult = await uploadResponse.json();
    console.log('[Firebase Storage] 업로드 완료:', uploadResult);
    
    // 다운로드 URL 생성
    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${uploadResult.downloadTokens || token}`;
    
    // Firebase Realtime Database에 메타데이터 저장 (참고용)
    // firebaseService의 getDb() 사용
    const storagePath = `gs://${bucket}/${path}`;
    try {
      const timestamp = Date.now();
      const db = getDb();
      const imageDataRef = ref(db, `thumbnail_images/${userId}/${timestamp}`);
      
      await set(imageDataRef, {
        path: path,
        storagePath: storagePath,
        downloadURL: downloadURL,
        timestamp: timestamp,
        size: blob.size
      });
    } catch (error) {
      console.warn('[Firebase Storage] 메타데이터 저장 실패:', error);
    }
    
    console.log('[Firebase Storage] ✅ 이미지 업로드 및 메타데이터 저장 완료');
    console.log('[Firebase Storage] 다운로드 URL:', downloadURL);
    console.log('[Firebase Storage] Storage 경로:', storagePath);
    
    return downloadURL;
  } catch (error) {
    console.error('[Firebase Storage] 업로드 실패:', error);
    // 403 오류인 경우 추가 정보 제공
    if (error.message.includes('403') || error.message.includes('Permission denied')) {
      console.error('[Firebase Storage] 💡 403 오류 해결 방법:');
      console.error('[Firebase Storage]    - Firebase Console에서 Storage 보안 규칙 확인');
      console.error('[Firebase Storage]    - 현재는 Base64 데이터로 fallback하여 동작합니다.');
    }
    throw error;
  }
}

/**
 * 객체 내의 모든 undefined 값을 재귀적으로 null로 변환하는 함수.
 * Firebase에 저장하기 전 데이터를 정제하는 데 사용됩니다.
 * @param {any} data - 정제할 데이터
 * @returns {any} 정제된 데이터
 */
export function cleanDataForFirebase(data) {
  if (data === undefined) return null;
  if (data === null || typeof data !== "object") return data;
  if (Array.isArray(data))
    return data.map((item) => cleanDataForFirebase(item));

  const cleanedObj = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      if (value !== undefined) {
        cleanedObj[key] = cleanDataForFirebase(value);
      }
    }
  }
  return cleanedObj;
}

// firebaseConfig는 이미 7번째 줄에서 export const로 선언됨
// firebase는 importScripts로 전역 변수로 로드되므로 export 불가
// background.js에서 manifest.json의 importScripts로 로드됨

console.log('[System] firebaseService 모듈 로드 완료');

