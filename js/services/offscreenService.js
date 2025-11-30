// js/services/offscreenService.js
// Offscreen Document 관리 및 작업 위임 서비스

import { Logger } from '../utils.js';

let offscreenDocumentId = null;
let offscreenCreationPromise = null;

/**
 * Offscreen 문서 생성 및 관리 (싱글톤 패턴 + 동시성 제어)
 */
async function ensureOffscreenDocument() {
  // 이미 생성 중인 경우 대기
  if (offscreenCreationPromise) {
    Logger.debug('[OffscreenService] 문서 생성 중, 대기합니다.');
    return await offscreenCreationPromise;
  }

  // 이미 생성된 문서가 있는지 확인
  if (offscreenDocumentId) {
    try {
      const hasDocument = await chrome.offscreen.hasDocument();
      if (hasDocument) {
        Logger.debug('[OffscreenService] 문서가 이미 존재합니다.');
        return offscreenDocumentId;
      } else {
        Logger.warn(
          '[OffscreenService] 문서 ID는 있지만 실제 문서가 존재하지 않습니다. 재생성합니다.'
        );
        offscreenDocumentId = null;
      }
    } catch (e) {
      Logger.warn('[OffscreenService] 문서 존재 확인 중 오류:', e);
      offscreenDocumentId = null;
    }
  }

  // 문서 생성 시작
  offscreenCreationPromise = (async () => {
    try {
      Logger.info('[OffscreenService] 문서 생성 시작...');

      // 기존 문서가 있다면 먼저 닫기 시도
      try {
        await chrome.offscreen.closeDocument();
        Logger.debug('[OffscreenService] 기존 문서 닫기 완료');
      } catch (e) {
        // 기존 문서가 없어도 괜찮음
      }

      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_SCRAPING', 'WORKERS', 'DOM_PARSER'],
        justification: 'HTML Sanitization, Image Resizing, and Template Rendering',
      });

      // 생성 후 문서가 준비될 때까지 대기
      await waitForOffscreenReady();

      offscreenDocumentId = 'offscreen-doc';
      Logger.info('[OffscreenService] 문서 생성 및 확인 완료');
      return offscreenDocumentId;
    } catch (error) {
      Logger.error('[OffscreenService] 문서 생성 실패:', error);
      offscreenDocumentId = null;
      throw error;
    } finally {
      offscreenCreationPromise = null;
    }
  })();

  return await offscreenCreationPromise;
}

/**
 * Offscreen 문서가 준비될 때까지 대기 (핑퐁 방식)
 */
async function waitForOffscreenReady(maxRetries = 10, retryDelay = 500) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      Logger.debug(`[OffscreenService] 준비 확인 시도 ${i + 1}/${maxRetries}`);

      // 핑 메시지 전송
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('핑 타임아웃'));
        }, 2000);

        const listener = (msg) => {
          if (msg.action === 'offscreen_ping_response') {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);
            resolve(msg);
            return true;
          }
          return false;
        };

        chrome.runtime.onMessage.addListener(listener);

        chrome.runtime.sendMessage({ action: 'offscreen_ping' }).catch((err) => {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          reject(err);
        });
      });

      if (response.ready) {
        Logger.debug('[OffscreenService] Offscreen 문서 준비 완료');
        return;
      }
    } catch (error) {
      Logger.debug(`[OffscreenService] 준비 확인 실패 ${i + 1}/${maxRetries}:`, error.message);
    }

    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error('Offscreen 문서 준비 확인 실패');
}

/**
 * 일반적인 Offscreen 메시지 전송 헬퍼
 * @param {string} action - 액션 이름
 * @param {Object} data - 전송할 데이터
 * @param {number} timeout - 타임아웃 (ms, 기본값: 30000)
 * @returns {Promise<Object>} 응답 데이터
 */
async function sendToOffscreen(action, data, timeout = 30000) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    const responseListener = (msg) => {
      if (msg.action === `${action}_response`) {
        chrome.runtime.onMessage.removeListener(responseListener);
        if (msg.success) {
          resolve(msg);
        } else {
          reject(new Error(msg.error || `${action} 실패`));
        }
        return true;
      }
      return false;
    };

    chrome.runtime.onMessage.addListener(responseListener);

    // Offscreen 문서로 메시지 전송 시도
    Logger.debug(`[OffscreenService] ${action} 메시지 전송 시도`);
    chrome.runtime.sendMessage({ action, ...data }).catch((err) => {
      chrome.runtime.onMessage.removeListener(responseListener);
      Logger.error(`[OffscreenService] ${action} 메시지 전송 실패:`, err);
      // "message port closed"는 정상적인 상황일 수 있음
      if (
        err?.message &&
        !err.message.includes('message port closed') &&
        !err.message.includes('Receiving end does not exist')
      ) {
        reject(err);
      } else {
        reject(
          new Error('Offscreen 문서 연결 실패 - 문서가 존재하지 않거나 초기화되지 않았습니다')
        );
      }
    });

    // 타임아웃 설정
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(responseListener);
      Logger.warn(`[OffscreenService] ${action} 타임아웃 (${timeout}ms)`);
      reject(new Error(`${action} 타임아웃 (${timeout}ms)`));
    }, timeout);
  });
}

/**
 * HTML 정제 및 포매팅 (DOMPurify 사용)
 * @param {string} rawText - 정제할 원본 HTML 텍스트
 * @returns {Promise<string>} 정제된 HTML
 */
export async function sanitizeHtmlInOffscreen(rawText) {
  try {
    const startTime = performance.now();
    Logger.debug('[OffscreenService] HTML 정제 요청 시작');
    const response = await sendToOffscreen('sanitize_html_in_offscreen', { rawText }, 10000);
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] HTML 정제 완료 (${elapsed}ms)`);
    return response.cleanedHtml;
  } catch (error) {
    Logger.error('[OffscreenService] HTML 정제 실패:', error);
    // Offscreen 문서 문제인 경우 재시도
    if (
      error.message.includes('Offscreen 문서 연결 실패') ||
      error.message.includes('Receiving end does not exist')
    ) {
      Logger.warn('[OffscreenService] Offscreen 문서 문제로 인한 실패, 재시도합니다');
      // 문서 ID 리셋 후 재시도
      offscreenDocumentId = null;
      try {
        const response = await sendToOffscreen('sanitize_html_in_offscreen', { rawText }, 10000);
        return response.cleanedHtml;
      } catch (retryError) {
        Logger.error('[OffscreenService] 재시도 실패:', retryError);
        throw new Error(`HTML 정제 실패: ${retryError.message}`);
      }
    }
    throw error;
  }
}

/**
 * 이미지 리사이징
 * @param {string} imageDataUrl - 원본 이미지 DataURL
 * @param {number} maxWidth - 최대 너비
 * @param {number} maxHeight - 최대 높이
 * @param {number} quality - JPEG 품질 (0-1, 기본값: 0.9)
 * @returns {Promise<string>} 리사이즈된 이미지 DataURL
 */
export async function resizeImageInOffscreen(imageDataUrl, maxWidth, maxHeight, quality = 0.9) {
  try {
    const startTime = performance.now();
    const response = await sendToOffscreen(
      'resize_image_in_offscreen',
      {
        imageDataUrl,
        maxWidth,
        maxHeight,
        quality,
      },
      30000
    );
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 이미지 리사이징 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 이미지 리사이징 오류:', error);
    throw error;
  }
}

/**
 * 템플릿 렌더링
 * @param {Object} templateData - 템플릿 데이터
 * @param {number} canvasWidth - 캔버스 너비
 * @param {number} canvasHeight - 캔버스 높이
 * @param {Object} dynamicText - 동적 텍스트 (기본값: {})
 * @returns {Promise<string>} 렌더링된 이미지 DataURL
 */
export async function renderTemplateInOffscreen(
  templateData,
  canvasWidth,
  canvasHeight,
  dynamicText = {}
) {
  try {
    const startTime = performance.now();
    const response = await sendToOffscreen(
      'render_template_in_offscreen',
      {
        templateData,
        canvasWidth,
        canvasHeight,
        dynamicText,
      },
      60000
    );
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 템플릿 렌더링 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 템플릿 렌더링 오류:', error);
    throw error;
  }
}

/**
 * HTML 파싱 (기존 parse_html_in_offscreen 액션 지원)
 * @param {string} html - 파싱할 HTML 문자열
 * @param {string} baseUrl - 기본 URL
 * @returns {Promise<Object>} 파싱 결과 (thumbnail, description, metrics, cleanText)
 */
export async function parseHtmlInOffscreen(html, baseUrl) {
  try {
    const response = await sendToOffscreen('parse_html_in_offscreen', { html, baseUrl }, 30000);
    return {
      thumbnail: response.thumbnail || '',
      description: response.description || '',
      metrics: response.metrics || {},
      cleanText: response.cleanText || '',
      metaTags: response.metaTags || null,
    };
  } catch (error) {
    Logger.error('[OffscreenService] HTML 파싱 오류:', error);
    throw error;
  }
}

/**
 * 이미지 크롭 (중앙 기준 Center Crop)
 * @param {string} imageDataUrl - DataURL 형식의 이미지
 * @param {number} targetRatio - 목표 비율 (1 = 1:1, 1.33 = 4:3, 1.77 = 16:9)
 * @returns {Promise<string>} 크롭된 이미지의 DataURL
 */
export async function cropImageInOffscreen(imageDataUrl, targetRatio) {
  try {
    const startTime = performance.now();
    const response = await sendToOffscreen(
      'crop_image_in_offscreen',
      {
        imageDataUrl,
        targetRatio,
      },
      30000
    );
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 이미지 크롭 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 이미지 크롭 오류:', error);
    throw error;
  }
}

/**
 * 썸네일 합성 (배경 이미지 + 텍스트)
 * @param {string} imageUrl - AI가 만든 배경 이미지 URL
 * @param {string} text - 삽입할 한글 문구
 * @param {string} textPosition - 텍스트 위치 ("top", "center", "bottom", 기본값: "bottom")
 * @returns {Promise<string>} 합성된 이미지 DataURL
 */
export async function composeThumbnailInOffscreen(imageUrl, text, textPosition = 'bottom') {
  try {
    const startTime = performance.now();

    // Firebase Storage URL인 경우 CORS 문제를 피하기 위해 먼저 fetch로 가져와서 DataURL로 변환
    let imageDataUrl = imageUrl;
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      Logger.debug(
        '[OffscreenService] 이미지 URL을 DataURL로 변환 중:',
        imageUrl.substring(0, 50) + '...'
      );
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`이미지 로드 실패: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        imageDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        Logger.debug('[OffscreenService] ✅ 이미지 DataURL 변환 완료');
      } catch (fetchError) {
        Logger.warn('[OffscreenService] 이미지 fetch 실패, 원본 URL 사용:', fetchError);
        // fetch 실패 시 원본 URL 사용 (CORS 문제가 있을 수 있음)
      }
    }

    const response = await sendToOffscreen(
      'compose_thumbnail_in_offscreen',
      {
        imageUrl: imageDataUrl,
        text,
        textPosition,
      },
      60000
    ); // 타임아웃 60초로 증가
    const elapsed = Math.round(performance.now() - startTime);
    Logger.info(`⚡ [OffscreenService] 썸네일 합성 완료 (${elapsed}ms)`);
    return response.dataUrl;
  } catch (error) {
    Logger.error('[OffscreenService] 썸네일 합성 오류:', error);
    throw error;
  }
}
