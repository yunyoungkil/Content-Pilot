// js/services/authService.js
// Google OAuth 인증 관련 서비스

/**
 * GA4 속성 목록을 가져오는 함수
 * @param {string} token - Google OAuth 토큰
 * @returns {Promise<Array>} GA4 속성 목록
 */
export async function fetchGaProperties(token) {
  const API_URL =
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("GA4 속성 목록을 가져오는데 실패했습니다.");

  const data = await response.json();
  const properties = [];
  data.accountSummaries?.forEach((account) => {
    account.propertySummaries?.forEach((prop) => {
      properties.push({
        id: prop.property.split("/")[1], // "properties/12345"에서 숫자만 추출
        name: prop.displayName,
      });
    });
  });
  return properties;
}

/**
 * AdSense 계정 ID를 가져오는 함수
 * @param {string} token - Google OAuth 토큰
 * @returns {Promise<string|null>} AdSense 계정 ID (없으면 null)
 */
export async function fetchAdSenseAccountId(token) {
  const API_URL = "https://adsense.googleapis.com/v2/accounts";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null; // 애드센스 계정이 없는 경우 오류 대신 null 반환

  const data = await response.json();
  if (data.accounts && data.accounts.length > 0) {
    return data.accounts[0].name.split("/")[1]; // "accounts/12345"에서 숫자만 추출
  }
  return null;
}

/**
 * Google OAuth 인증 시작
 * @returns {Promise<Object>} 인증 결과
 */
export async function startGoogleAuth() {
  try {
    const token = await chrome.identity.getAuthToken({ interactive: true });
    await chrome.storage.local.set({ googleAuthToken: token });
    
    // GA4 속성 및 AdSense 계정 ID 가져오기
    const [properties, adSenseId] = await Promise.all([
      fetchGaProperties(token).catch(() => []),
      fetchAdSenseAccountId(token).catch(() => null)
    ]);
    
    await chrome.storage.local.set({ 
      adSenseAccountId: adSenseId,
      gaProperties: properties 
    });
    
    return { success: true, token, properties, adSenseId };
  } catch (error) {
    console.error('[startGoogleAuth] 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Google OAuth 인증 해제
 * @returns {Promise<Object>} 해제 결과
 */
export async function revokeGoogleAuth() {
  try {
    const { googleAuthToken } = await chrome.storage.local.get('googleAuthToken');
    if (googleAuthToken) {
      await chrome.identity.removeCachedAuthToken({ token: googleAuthToken });
    }
    await chrome.storage.local.remove(['googleAuthToken', 'adSenseAccountId', 'gaProperties']);
    return { success: true };
  } catch (error) {
    console.error('[revokeGoogleAuth] 오류:', error);
    return { success: false, error: error.message };
  }
}

console.log('[System] authService 모듈 로드 완료');

