// js/services/firebaseService.js
// Firebase 초기화 및 헬퍼 함수 제공 (단일 진실 공급원)

// Firebase v9+ 모듈 API import
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, update, remove, onValue, get, serverTimestamp } from 'firebase/database';
import { getValidToken } from './authService.js';

// 상수 정의
export const CONSTANTS = {
  USER_ID: 'default_user'
};

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
    firebaseInitialized = true;
    console.log('🔥 [firebaseService] Firebase 초기화 완료');
    
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
    try {
      const timestamp = Date.now();
      const db = getDb();
      const imageDataRef = ref(db, `thumbnail_images/${userId}/${timestamp}`);
      const storagePath = `gs://${bucket}/${path}`;
      
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

