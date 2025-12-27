// js/services/firebaseService.js (Final REST API Version)
// Firebase Web SDK의 불안정성을 해결하기 위해 REST API로 완전히 대체된 버전입니다.

import { initializeApp } from 'firebase/app';
// [중요] firebase/database import를 제거하여 SDK 충돌을 원천 차단합니다.
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  onAuthStateChanged,
} from 'firebase/auth';
import { getValidToken } from './authService.js';
import { Logger } from '../utils.js';

// --- 상수 및 설정 ---
export const CONSTANTS = {
  USER_ID: 'default_user', // 로그인 후 authService 등에 의해 동적으로 변경됨
};

// Gallery config: how many images per scrap to include in unified gallery
export const GALLERY_IMAGES_PER_SCRAP = 6; // increased to include more images per scrap in unified gallery
// safety cap for unified gallery total items to avoid huge loads
export const MAX_UNIFIED_GALLERY_IMAGES = 600; // raised cap to allow more items in unified gallery

export const firebaseConfig = {
  apiKey: 'AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY',
  authDomain: 'content-pilot-7eb03.firebaseapp.com',
  databaseURL: 'https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'content-pilot-7eb03',
  storageBucket: 'content-pilot-7eb03.firebasestorage.app',
  messagingSenderId: '1062923832161',
  appId: '1:1062923832161:web:12dc37c0bfd2fb1ac05320',
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

    // 1) 우선적으로 저장된 googleUserId 반환
    if (storage.googleUserId) return storage.googleUserId;

    // 2) 이메일 기반 사용자 ID 생성 (기본 케이스)
    if (storage.googleUserEmail) {
      const safeEmail = storage.googleUserEmail
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_{2,}/g, '_');
      return safeEmail;
    }

    // 3) 그 외: 기본 상수 값 사용
    return CONSTANTS.USER_ID;
  } catch (e) {
    Logger.warn('[getCurrentUserId] chrome.storage.local.get failed:', e);
    return CONSTANTS.USER_ID;
  }
}

// --- [핵심] REST API 헬퍼 함수들 ---

// 1. DB URL 생성기
const getDbUrl = (path) => {
  const baseUrl = firebaseConfig.databaseURL;

  // path가 문자열이 아니면 에러 처리
  if (typeof path !== 'string') {
    Logger.error('[getDbUrl] path가 문자열이 아닙니다:', typeof path, path);
    throw new Error(`getDbUrl: path는 문자열이어야 합니다. 받은 타입: ${typeof path}, 값: ${path}`);
  }

  if (path.startsWith('https://')) return path;

  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${baseUrl}/${cleanPath}.json`;
};

// 2. 공통 Fetch 래퍼
async function dbRequest(method, path, data = null) {
  try {
    let token = null;

    // Content script에서는 background에 토큰 요청
    if (typeof chrome !== 'undefined' && chrome.runtime && !chrome.action) {
      // Content script에서 실행 중
      try {
        token = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'getValidToken' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response.token);
            } else {
              resolve(null);
            }
          });
        });
      } catch (e) {
        Logger.warn('[Firebase REST] Content script 토큰 요청 실패:', e);
        token = null;
      }
    } else {
      // Background script에서 직접 가져오기
      token = await getValidToken(false);
    }

    let url = getDbUrl(path);
    if (token) {
      url += `?access_token=${encodeURIComponent(token)}`;
    }

    const options = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data !== null) {
      const cleanedData = cleanDataForFirebase(data);
      // 빈 객체 체크: Firebase REST API는 빈 객체를 거부함
      if (cleanedData !== null && typeof cleanedData === 'object' && !Array.isArray(cleanedData)) {
        const keys = Object.keys(cleanedData);
        if (keys.length === 0) {
          Logger.warn(`[Firebase REST] 빈 객체 감지 (${path}), 최소 데이터 보장`);
          // 빈 객체 대신 null 또는 최소 데이터 사용
          options.body = JSON.stringify(null);
        } else {
          options.body = JSON.stringify(cleanedData);
        }
      } else {
        options.body = JSON.stringify(cleanedData);
      }
    }

    const response = await fetch(url, options);

    // Log response status for diagnostics
    Logger.debug('[Firebase REST] response status:', { method, path, status: response.status });

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

    // On success, parse JSON and log a preview for debugging
    const jsonRes = await response.json();
    try {
      Logger.debug('[Firebase REST] success payload preview:', {
        method,
        path,
        preview:
          jsonRes && typeof jsonRes === 'object' ? Object.keys(jsonRes).slice(0, 6) : jsonRes,
      });
    } catch (e) {
      // ignore logging errors
    }
    return jsonRes;
  } catch (error) {
    Logger.error(`[Firebase REST] ${method} 요청 중 오류:`, error);
    throw error;
  }
}

// --- [복구됨] Auth Service 호환성 어댑터 ---

/**
 * REST 모드용 인증 어댑터
 * authService.js가 호출할 때 "성공" 응답을 주어 에러를 방지합니다.
 */
export async function signInToFirebaseWithGoogleToken(token) {
  try {
    Logger.info('[Firebase Auth] REST 모드: Google 토큰 정보 확인 중...');

    // 토큰으로 사용자 정보 가져오기 (검증 겸용)
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error('Google 토큰 검증 실패');
    }

    const user = await response.json();

    return {
      success: true,
      user: {
        uid: user.sub, // Google ID를 UID로 사용
        email: user.email,
        displayName: user.name,
      },
    };
  } catch (error) {
    Logger.warn('[Firebase Auth] REST 인증 어댑터 오류:', error);
    return { success: false, error: error.message };
  }
}

// --- [대체] SDK 호환 함수 구현 (REST 기반) ---

/**
 * ref: 단순히 경로 문자열을 반환합니다.
 * SDK의 Reference 객체를 반환하지 않으므로 _checkNotDeleted 오류가 발생하지 않습니다.
 */
export function ref(db, path) {
  return path || '';
}

export async function get(path) {
  const data = await dbRequest('GET', path);
  try {
    // Debug: log publishInfo presence when fetching kanban card paths
    if (typeof path === 'string' && path.startsWith('kanban/')) {
      const snap = data;
      if (!snap) {
        console.warn('[FirebaseService] GET returned null for path:', path);
      } else {
        const publishInfo = snap.publishInfo;
        console.debug('[FirebaseService] GET path:', path, 'publishInfo present:', !!publishInfo);
      }
    }
  } catch (e) {
    console.warn('[FirebaseService] GET debug probe failed for path:', path, e && e.message);
  }
  return {
    val: () => data,
    exists: () => data !== null && data !== undefined,
  };
}

export async function set(path, data) {
  console.debug(
    '[FirebaseService] SET called - path:',
    path,
    'data keys:',
    data && Object.keys(data)
  );
  await dbRequest('PUT', path, data);
  return true;
}

export async function update(path, data) {
  console.debug('[FirebaseService] UPDATE called - path:', path, 'payload:', data);
  await dbRequest('PATCH', path, data);
  return true;
}

export async function remove(path) {
  await dbRequest('DELETE', path);
  return true;
}

export async function push(path, data = null) {
  // REST API의 POST 메서드를 사용하여 새 자식 노드(Key)를 생성합니다.

  // path가 문자열인지 확인
  if (typeof path !== 'string') {
    Logger.error('[push] path가 문자열이 아닙니다:', typeof path, path);
    throw new Error(`push: path는 문자열이어야 합니다. 받은 타입: ${typeof path}, 값: ${path}`);
  }

  if (data !== null) {
    const response = await dbRequest('POST', path, data);
    const newKey = response.name; // Firebase REST는 생성된 키를 'name' 속성으로 반환
    Logger.debug(`[Firebase REST] push 성공: ${path}/${newKey}`);
    return {
      key: newKey,
      set: (val) => set(`${path}/${newKey}`, val),
    };
  } else {
    // 빈 push 호출 대응
    const response = await dbRequest('POST', path, {});
    const newKey = response.name;
    Logger.debug(`[Firebase REST] push 키 생성: ${path}/${newKey}`);
    return {
      key: newKey,
      set: (val) => set(`${path}/${newKey}`, val),
    };
  }
}

export function onValue(path, callback) {
  // REST 모드에서는 실시간 리스너가 제한되므로 1회성 get으로 대체
  Logger.warn('[Firebase REST] onValue는 REST 모드에서 실시간 지원이 안됩니다. 1회만 실행됩니다.');
  get(path).then((snapshot) => callback(snapshot));
  return () => {};
}

export function getDb() {
  return {};
}

export function serverTimestamp() {
  return Date.now();
}

export function getUserRef(path) {
  return `${path}/${CONSTANTS.USER_ID}`;
}

export function cleanDataForFirebase(data) {
  if (data === undefined) return null;
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(cleanDataForFirebase);
  const cleanedObj = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      if (value !== undefined) cleanedObj[key] = cleanDataForFirebase(value);
    }
  }
  return cleanedObj;
}

// Storage 업로드 함수 (REST API 기반)
// Test-only in-memory tombstone overrides (used by unit tests)
export const __TEST_tombstones = {};
export function __TEST_markTombstone(userId, path) {
  __TEST_tombstones[`${userId}:${path}`] = true;
}

export async function uploadImageToFirebaseStorage(dataUrl, path, userId, meta = {}) {
  try {
    // Check tombstone: avoid re-uploading a recently deleted path
    const uid = userId || (await getCurrentUserId());

    // perform tombstone check: call isThumbnailDeleted but handle errors separately
    let tomb = false;
    try {
      tomb = await isThumbnailDeleted(uid, path);
    } catch (e) {
      // If tombstone check fails, log and treat as non-tombstoned (allow upload)
      Logger.debug('[Firebase Storage] tombstone lookup failed (continuing):', e && e.message);
      tomb = false;
    }

    // Test hook: if a test set a tombstone in-memory, honor it synchronously
    if (__TEST_tombstones[`${uid}:${path}`] || tomb) {
      Logger.warn('[Firebase Storage] upload blocked by tombstone for path:', path);
      throw new Error('upload blocked: tombstoned path');
    }

    const blob = dataURLtoBlob(dataUrl);
    let token = await getValidToken(false);
    if (!token) {
      token = await getValidToken(true);
      if (!token) {
        throw new Error('인증 토큰을 가져올 수 없습니다. 로그인이 필요합니다.');
      }
    }

    const bucket = firebaseConfig.storageBucket;
    const encodedPath = encodeURIComponent(path);
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;

    Logger.debug('[Firebase Storage] 업로드 시작:', path);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': blob.type || 'image/png',
      },
      body: blob,
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
        size: blob.size,
        ...cleanDataForFirebase(meta),
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
 * Tombstone: mark a thumbnail path as deleted to prevent immediate re-uploads
 */
export async function markDeletedThumbnail(userId, path, ttlMs = 24 * 3600 * 1000) {
  try {
    const ts = Date.now();
    const encoded = encodeURIComponent(path);
    await set(`deleted_thumbnails/${userId}/${encoded}`, { deletedAt: ts, expireAt: ts + ttlMs });
    Logger.info('[Firebase] marked tombstone for deleted thumbnail:', userId, path);
    return true;
  } catch (e) {
    Logger.warn('[Firebase] failed to mark tombstone for deleted thumbnail:', e && e.message);
    return false;
  }
}

export async function isThumbnailDeleted(userId, path) {
  try {
    const encoded = encodeURIComponent(path);
    const snap = await get(`deleted_thumbnails/${userId}/${encoded}`);
    const val = snap && snap.val ? snap.val() : null;
    if (!val) return false;

    if (val.expireAt && Date.now() > val.expireAt) {
      // expired tombstone - clean up
      try {
        await remove(ref(getDb(), `deleted_thumbnails/${userId}/${encoded}`));
      } catch (e) {
        Logger.debug('[Firebase] failed to cleanup expired tombstone:', e && e.message);
      }
      return false;
    }

    return true;
  } catch (e) {
    Logger.warn('[Firebase] tombstone check failed:', e && e.message);
    return false;
  }
}

function dataURLtoBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

// Firebase Auth 관련 함수들 (호환성 유지)
/**
 * Firebase Auth 상태 리스너 초기화
 */
function _initializeAuthStateListener() {
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
      user: user
        ? {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
          }
        : null,
    };

    Logger.info('[Firebase Auth] 인증 상태 변경:', {
      authenticated: authState.authenticated,
      email: authState.user?.email,
    });

    // 인증 상태를 chrome.storage.local에 저장
    try {
      await chrome.storage.local.set({
        firebaseAuthState: authState,
        firebaseAuthTimestamp: Date.now(),
      });
    } catch (e) {
      Logger.warn('[Firebase Auth] 상태 저장 실패:', e);
    }
  });

  Logger.info('[Firebase Auth] 인증 상태 리스너 등록 완료');
}

/**
 * Firebase 초기화 함수(REST/호환 모드)
 * - initializeApp을 호출하여 firebaseApp을 설정하고
 * - Auth 상태 리스너를 등록합니다.
 * - 여러 번 호출되어도 안전하도록 동작합니다.
 */
export function initializeFirebase() {
  if (firebaseInitialized) return true;

  try {
    // SDK의 initializeApp을 호출하되, 이미 초기화된 경우에도 문제 없게 처리
    firebaseApp = initializeApp(firebaseConfig);
  } catch (e) {
    Logger.warn(
      '[initializeFirebase] initializeApp 호출 중 예외 발생(무시):',
      e && e.message ? e.message : e
    );
  }

  // Auth 초기화
  try {
    _initializeAuthStateListener();
  } catch (error) {
    Logger.warn('[initializeFirebase] _initializeAuthStateListener 예외:', error);
  }

  firebaseInitialized = true;
  return true;
}

// Make the function available on globalThis for code that expects a global function
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.initializeFirebase = initializeFirebase;
  }
} catch (e) {
  // no-op if environment doesn't allow attaching to globals
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
      user: user
        ? {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
          }
        : null,
    });
  });
}

// export
export { initializeApp, getAuth, signInWithCredential, GoogleAuthProvider };

/**
 * [New] 통합 갤러리 데이터 가져오기
 * 스크랩 이미지와 스토리지 이미지를 모두 가져와서 표준 포맷으로 병합합니다.
 */
export async function getUnifiedGalleryImages(filterTag = null) {
  const userId = await getCurrentUserId();

  // 1. 스크랩 데이터 가져오기
  const scrapsSnap = await get(`scraps/${userId}`);
  const scrapsVal = scrapsSnap.val() || {};

  // 2. 스토리지 로그 가져오기
  const storageSnap = await get(`thumbnail_images/${userId}`);
  const storageVal = storageSnap.val() || {};

  const unifiedList = [];

  // 3. 스크랩 데이터 정규화
  Object.entries(scrapsVal).forEach(([id, item]) => {
    // 스크랩의 모든 이미지를 수집
    const imagesArr = [];
    if (item.image) imagesArr.push(item.image);
    if (Array.isArray(item.allImages)) imagesArr.push(...item.allImages);
    if (Array.isArray(item.images)) imagesArr.push(...item.images);

    // 중복 제거 및 유효성(널/빈값 제거)
    const uniqueImages = [...new Set((imagesArr || []).filter(Boolean))];
    if (uniqueImages.length > 0) {
      // Push each image as its own gallery item (flatten groups)
      const selected = uniqueImages.slice(0, GALLERY_IMAGES_PER_SCRAP);
      selected.forEach((imgUrl, idx) => {
        unifiedList.push({
          id: `${id}::${idx}`,
          scrapId: id,
          source: 'SCRAP',
          url: imgUrl,
          thumbnail: imgUrl,
          originData: item,
          timestamp: item.timestamp || 0,
        });
      });
    }
  });

  // 4. 스토리지 데이터 정규화
  Object.entries(storageVal).forEach(([id, item]) => {
    unifiedList.push({
      id: id,
      source: 'STORAGE', // [수정] type -> source 로 변경 (workspaceMode.js와 통일)
      url: item.downloadURL,
      thumbnail: item.downloadURL,
      images: [item.downloadURL],
      tags: ['#Storage', '#Upload'], // #Storage 태그 자동 추가
      originData: item, // storagePath 등 포함
      timestamp: item.timestamp || 0,
      usedInDraft: !!item.usedInDraft,
      usedInDraftAt: item.usedInDraftAt || null,
      usedInDraftCardId: item.usedInDraftCardId || null,
    });
  });

  // 5. 최신순 정렬
  unifiedList.sort((a, b) => b.timestamp - a.timestamp);

  // safety cap to prevent sending too many images at once
  if (unifiedList.length > MAX_UNIFIED_GALLERY_IMAGES) {
    unifiedList.length = MAX_UNIFIED_GALLERY_IMAGES;
  }

  // 6. 태그 및 소스 필터링 [버그 수정 핵심]
  if (filterTag && filterTag !== 'ALL') {
    // [수정] UI(workspaceMode.js)에서 보내는 'STORAGE', 'SCRAP' 대문자 필터를 처리
    if (filterTag === 'STORAGE') {
      return unifiedList.filter((item) => item.source === 'STORAGE');
    }
    if (filterTag === 'SCRAP') {
      return unifiedList.filter((item) => item.source === 'SCRAP');
    }

    // 그 외(draftMode.js 등)에서 보내는 태그(예: #Storage) 처리
    return unifiedList.filter((item) => item.tags.includes(filterTag));
  }

  return unifiedList;
}

/**
 * [New] 스토리지 파일 삭제 (REST API)
 */
export async function deleteImageFromStorage(storageUrl) {
  try {
    if (!storageUrl || typeof storageUrl !== 'string' || storageUrl.trim() === '') {
      throw new Error('storageUrl is empty or invalid');
    }

    let path = storageUrl;
    const bucket = firebaseConfig.storageBucket;

    // gs:// 경로 파싱
    if (storageUrl.startsWith('gs://')) {
      path = storageUrl.replace(`gs://${bucket}/`, '');
    }

    const encodedPath = encodeURIComponent(path);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}`;

    // Try with existing token (silent), then interactive if needed
    let token = await getValidToken(false);
    if (!token) token = await getValidToken(true);

    Logger.info(`[Storage] 삭제 요청: ${path}`);

    const doDelete = async (useToken) => {
      try {
        const response = await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${useToken}` },
        });

        // read body for logging (if any)
        let bodyText = '';
        try {
          bodyText = await response.text();
        } catch (e) {
          bodyText = '';
        }

        if (!response.ok && response.status !== 404) {
          Logger.error(`[Storage] DELETE failed status=${response.status} body=${bodyText}`);
          const err = new Error(`Storage Delete Failed: ${response.status} - ${bodyText}`);
          err.status = response.status;
          err.body = bodyText;
          throw err;
        }

        Logger.debug('[Storage] DELETE succeeded or not found:', { status: response.status });
        return true;
      } catch (e) {
        throw e;
      }
    };

    try {
      return await doDelete(token);
    } catch (e) {
      // On auth errors, try an interactive token refresh once
      if (e && (e.status === 401 || e.status === 403)) {
        Logger.warn(
          '[Storage] DELETE failed with auth error, attempting interactive token refresh'
        );
        const interactiveToken = await getValidToken(true);
        if (interactiveToken && interactiveToken !== token) {
          try {
            return await doDelete(interactiveToken);
          } catch (e2) {
            Logger.error('[Storage] DELETE retry after interactive auth failed:', e2);
            throw e2;
          }
        }
      }
      Logger.error('[Storage] 삭제 오류:', e);
      throw e;
    }
  } catch (error) {
    Logger.error('[Storage] 삭제 오류 (입력/처리):', error);
    throw error;
  }
}

/**
 * [New] 업로드된 이미지 로그 조회
 */
export async function getUploadedImagesLog() {
  const userId = await getCurrentUserId();
  const snapshot = await get(`thumbnail_images/${userId}`);
  const data = snapshot.val() || {};

  return Object.entries(data)
    .map(([key, val]) => ({ id: key, ...val }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

// 즉시 초기화
initializeFirebase();

Logger.info('[System] firebaseService 모듈 로드 완료 (REST API 모드)');
