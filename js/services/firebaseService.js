// js/services/firebaseService.js (Final REST API Version)
// Firebase 초기화 및 헬퍼 함수 제공 (REST API 기반)

import { initializeApp } from 'firebase/app';
// [중요] firebase/database import를 제거합니다. 충돌 방지.
import { getAuth, GoogleAuthProvider, signInWithCredential, onAuthStateChanged } from 'firebase/auth';
import { getValidToken } from './authService.js';
import { Logger } from '../utils.js';

// --- 상수 및 설정 ---
export const CONSTANTS = {
  USER_ID: 'default_user' // 로그인 후 authService 등에 의해 동적으로 변경됨
};

export const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL: "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:12dc37c0bfd2fb1ac05320",
};

// --- 초기화 (Auth용) ---
let firebaseApp = null;
let firebaseAuth = null;
let firebaseInitialized = false;

// Firebase Auth 상태 관리
let authState = { authenticated: false, user: null };
let authStateUnsubscribe = null;

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

export function initializeFirebase() {
  if (firebaseInitialized) {
    return true;
  }
  
  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    Logger.info('🔥 [firebaseService] REST Mode 초기화 완료');
  }
  
  firebaseInitialized = true;
  return true;
}

// --- [핵심] REST API 헬퍼 함수들 ---

// 1. DB URL 생성기
const getDbUrl = (path) => {
  const baseUrl = firebaseConfig.databaseURL;
  // 경로가 URL 형식이면 그대로 사용, 아니면 조합
  if (path.startsWith('https://')) return path;
  
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${baseUrl}/${cleanPath}.json`;
};

// 2. 공통 Fetch 래퍼
async function dbRequest(method, path, data = null) {
  try {
    const token = await getValidToken(false);
    
    let url = getDbUrl(path);
    if (token) {
      url += `?access_token=${encodeURIComponent(token)}`;
    }

    const options = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data !== null) {
      options.body = JSON.stringify(cleanDataForFirebase(data));
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errText = await response.text();
      Logger.error(`[Firebase REST] ${method} 실패 (${path}):`, errText);
      
      if (response.status === 401 || response.status === 403) {
        throw new Error(`권한이 거부되었습니다. 로그인이 필요하거나 규칙을 확인하세요.`);
      }
      throw new Error(`DB Error (${response.status}): ${errText}`);
    }

    // DELETE 요청은 응답 본문이 없을 수 있음
    if (method === 'DELETE') {
      return true;
    }

    return await response.json();
  } catch (error) {
    Logger.error(`[Firebase REST] ${method} 요청 중 오류:`, error);
    throw error;
  }
}

// --- [대체] SDK 호환 함수 구현 (REST 기반) ---

/**
 * ref: 단순히 경로 문자열을 반환하거나, URL을 그대로 통과시킵니다.
 */
export function ref(db, path) {
  // db 인자는 무시하고 path만 사용 (REST 방식)
  return path || '';
}

/**
 * get: 데이터 읽기 (GET)
 */
export async function get(path) {
  const data = await dbRequest('GET', path);
  // Snapshot 호환 객체 반환
  return {
    val: () => data,
    exists: () => data !== null && data !== undefined
  };
}

/**
 * set: 데이터 덮어쓰기 (PUT)
 */
export async function set(path, data) {
  await dbRequest('PUT', path, data);
  return true;
}

/**
 * update: 데이터 일부 수정 (PATCH)
 */
export async function update(path, data) {
  await dbRequest('PATCH', path, data);
  return true;
}

/**
 * remove: 데이터 삭제 (DELETE)
 */
export async function remove(path) {
  await dbRequest('DELETE', path);
  return true;
}

/**
 * push: 새 데이터 추가 및 ID 생성 (POST)
 * @returns {object} { key: string, set: function } (SDK 호환성 유지)
 */
export async function push(path, data = null) {
  // 1. 데이터가 있으면 바로 POST (생성 및 저장)
  if (data !== null) {
    const response = await dbRequest('POST', path, data);
    // REST API POST 응답은 { "name": "-Key..." } 형태
    const newKey = response.name;
    Logger.debug(`[Firebase REST] push 성공: ${path}/${newKey}`);
    return {
      key: newKey,
      set: (val) => set(`${path}/${newKey}`, val) // 체이닝 지원
    };
  } 
  // 2. 데이터 없이 키만 미리 생성해야 하는 경우 (SDK의 push() 동작)
  else {
    // REST에서는 빈 push가 불가능하므로, 빈 객체를 보내서 키를 받아옴
    const response = await dbRequest('POST', path, {}); 
    const newKey = response.name;
    Logger.debug(`[Firebase REST] push 키 생성: ${path}/${newKey}`);
    return {
      key: newKey,
      set: (val) => set(`${path}/${newKey}`, val)
    };
  }
}

/**
 * onValue: 실시간 리스너 (REST에서는 1회성 get으로 대체)
 */
export function onValue(path, callback) {
  Logger.warn('[Firebase REST] onValue는 REST 모드에서 실시간 지원이 안됩니다. 1회만 실행됩니다.');
  get(path).then(snapshot => callback(snapshot));
  return () => {}; // 구독 해제 함수
}

/**
 * getDb: 가짜 DB 인스턴스 반환 (ref 함수에서 첫 번째 인자로 사용됨)
 */
export function getDb() {
  return {}; // 빈 객체 (REST 모드에서는 사용 안 함)
}

/**
 * serverTimestamp: 서버 시간 (REST에서는 클라이언트 시간으로 대체)
 */
export function serverTimestamp() {
  return Date.now();
}

// 사용자별 레퍼런스 헬퍼
export function getUserRef(path) {
  return `${path}/${CONSTANTS.USER_ID}`;
}

/**
 * REST 모드용 인증 어댑터
 * authService.js가 호출할 때 "성공" 응답을 주어 에러를 방지합니다.
 * 실제 인증은 Google Access Token으로 대체되었으므로, 여기서는 정보만 확인합니다.
 */
export async function signInToFirebaseWithGoogleToken(token) {
  try {
    Logger.info('[Firebase Auth] REST 모드: Google 토큰 정보 확인 중...');
    
    // 토큰으로 사용자 정보 가져오기 (검증 겸용)
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) {
      throw new Error('Google 토큰 검증 실패');
    }

    const user = await response.json();
    
    // authService.js가 기대하는 데이터 구조 반환
    return {
      success: true,
      user: {
        uid: user.sub, // Google ID를 UID로 사용
        email: user.email,
        displayName: user.name
      }
    };
  } catch (error) {
    Logger.warn('[Firebase Auth] REST 인증 어댑터 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Firebase Auth 상태 리스너 초기화
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
 */
export async function getFirebaseAuthState() {
  try {
    // 메모리 캐시 확인
    if (authState.user) {
      return authState;
    }
    
    // chrome.storage.local에서 복원 시도
    const storage = await chrome.storage.local.get(['firebaseAuthState', 'firebaseAuthTimestamp']);
    if (storage.firebaseAuthState && storage.firebaseAuthTimestamp) {
      const age = Date.now() - storage.firebaseAuthTimestamp;
      if (age < 3600000) {
        authState = storage.firebaseAuthState;
        return authState;
      }
    }
    
    return { authenticated: false, user: null };
  } catch (error) {
    Logger.error('[Firebase Auth] 인증 상태 확인 실패:', error);
    return { authenticated: false, user: null };
  }
}

/**
 * 인증 상태 확인 (동기)
 */
export function isFirebaseAuthenticated() {
  return authState.authenticated;
}

/**
 * Firebase 인증 확인 (인증되지 않으면 에러 발생)
 */
export async function ensureFirebaseAuthenticated() {
  const state = await getFirebaseAuthState();
  if (!state.authenticated || !state.user) {
    throw new Error('Firebase 인증이 필요합니다. 로그인해주세요.');
  }
  return state.user;
}

/**
 * Firebase Auth 상태 변경 리스너 등록
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

// --- 기타 유틸리티 함수들 ---

/**
 * Base64 데이터 URL을 Blob으로 변환하는 헬퍼 함수
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
 */
export async function uploadImageToFirebaseStorage(dataUrl, path, userId) {
  try {
    // Base64 데이터 URL을 Blob으로 변환
    const blob = dataURLtoBlob(dataUrl);
    
    // Google OAuth 토큰 가져오기
    let token = await getValidToken(false);
    
    if (!token) {
      token = await getValidToken(true);
      if (!token) {
        throw new Error('인증 토큰을 가져올 수 없습니다. 로그인이 필요합니다.');
      }
    }
    
    // Firebase Storage REST API를 사용하여 업로드
    const bucket = firebaseConfig.storageBucket;
    const encodedPath = encodeURIComponent(path);
    
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;
    
    Logger.debug('[Firebase Storage] 업로드 시작:', path);
    
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
      
      if (uploadResponse.status === 403) {
        Logger.error('[Firebase Storage] 403 Permission denied 오류');
        Logger.error('[Firebase Storage] ⚠️ Firebase Storage 보안 규칙을 확인하세요.');
      }
      
      throw new Error(`Firebase Storage 업로드 실패 (${uploadResponse.status}): ${errorMessage}`);
    }
    
    const uploadResult = await uploadResponse.json();
    
    // 다운로드 URL 생성
    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${uploadResult.downloadTokens || token}`;
    
    // Firebase Realtime Database에 메타데이터 저장
    const storagePath = `gs://${bucket}/${path}`;
    try {
      const timestamp = Date.now();
      const imageDataPath = `thumbnail_images/${userId}/${timestamp}`;
      
      await set(imageDataPath, {
        path: path,
        storagePath: storagePath,
        downloadURL: downloadURL,
        timestamp: timestamp,
        size: blob.size
      });
    } catch (error) {
      Logger.warn('[Firebase Storage] 메타데이터 저장 실패:', error);
    }
    
    Logger.debug('[Firebase Storage] ✅ 이미지 업로드 및 메타데이터 저장 완료');
    
    return downloadURL;
  } catch (error) {
    Logger.error('[Firebase Storage] 업로드 실패:', error);
    throw error;
  }
}

/**
 * 객체 내의 모든 undefined 값을 재귀적으로 null로 변환하는 함수
 */
export function cleanDataForFirebase(data) {
  if (data === undefined) return null;
  if (data === null || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(cleanDataForFirebase);
  
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

// Firebase Auth 관련 export (호환성)
export { initializeApp, getAuth, signInWithCredential, GoogleAuthProvider };

// 즉시 초기화
initializeFirebase();

Logger.info('[System] firebaseService 모듈 로드 완료 (REST API 모드)');
