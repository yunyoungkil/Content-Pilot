// js/services/thumbnailService.js
// 썸네일 템플릿 관리 서비스

import { getDb, cleanDataForFirebase } from './firebaseService.js';
import { ref, get, remove, push } from './firebaseService.js';
import { callGeminiAPI } from './aiService.js';
import { Logger } from '../utils.js';

/**
 * 템플릿 데이터 검증 (PRD v2.4 반응형 스키마 기준)
 * @param {Object} data - 검증할 템플릿 데이터
 * @throws {Error} 검증 실패 시
 */
export function validateTemplateData(data) {
  if (!data) {
    throw new Error('AI가 유효한 데이터를 반환하지 않았습니다.');
  }

  // PRD v2.4 반응형 스키마 기준 필수 필드 검증
  if (!data.name || typeof data.name !== 'string') {
    throw new Error("필수 필드 'name'이 누락되었거나 문자열이 아닙니다.");
  }

  if (!data.background || typeof data.background !== 'object') {
    throw new Error("필수 필드 'background'가 누락되었거나 객체가 아닙니다.");
  }

  if (!data.background.type || !data.background.value) {
    throw new Error("background 필드에 'type'과 'value'가 필요합니다.");
  }

  if (!Array.isArray(data.layers) || data.layers.length === 0) {
    throw new Error(
      "필수 필드 'layers'가 비어있거나 배열이 아닙니다. 최소 1개 이상의 레이어가 필요합니다."
    );
  }

  // 플레이스홀더 레이어 검증 (고충실도 복제 지원)
  const sloganLayer = data.layers.find(
    (l) =>
      l.type === 'text' &&
      (l.text === '{{SLOGAN}}' || (typeof l.text === 'string' && l.text.length > 0))
  );
  if (!sloganLayer) {
    throw new Error(
      "필수 텍스트 레이어가 없습니다. 메인 텍스트(실제 텍스트 또는 '{{SLOGAN}}')가 반드시 포함되어야 합니다."
    );
  }

  // PRD v3.2: 타입별 상대 좌표 검증 (0.0 ~ 1.0 범위)
  for (let i = 0; i < data.layers.length; i++) {
    const layer = data.layers[i];

    // 공통 검증: 타입 필수
    if (!layer.type || !['text', 'shape', 'svg', 'image'].includes(layer.type)) {
      throw new Error(
        `레이어 ${i}: type 필드가 누락되었거나 유효하지 않은 값입니다. (허용: text, shape, svg, image)`
      );
    }

    // 공통 검증: 좌표 범위
    if (typeof layer.x !== 'number' || typeof layer.y !== 'number') {
      throw new Error(`레이어 ${i}: x, y 좌표가 숫자가 아닙니다.`);
    }

    if (layer.x < 0 || layer.x > 1 || layer.y < 0 || layer.y > 1) {
      throw new Error(
        `레이어 ${i}: x, y 좌표는 0.0~1.0 사이의 비율 값이어야 합니다. (현재: x=${layer.x}, y=${layer.y})`
      );
    }

    // 타입별 검증
    if (layer.type === 'text') {
      if (!layer.styles || typeof layer.styles !== 'object') {
        throw new Error(`레이어 ${i}: styles 객체가 필요합니다.`);
      }

      if (typeof layer.styles.fontRatio !== 'number') {
        throw new Error(`레이어 ${i}: styles.fontRatio가 숫자가 아닙니다.`);
      }

      if (layer.styles.fontRatio <= 0 || layer.styles.fontRatio > 1) {
        throw new Error(
          `레이어 ${i}: fontRatio는 0.0~1.0 사이의 비율 값이어야 합니다. (현재: ${layer.styles.fontRatio})`
        );
      }
    } else if (layer.type === 'svg') {
      // SVG 레이어 검증 (pathData는 선택적, widthRatio/heightRatio 필수)
      if (layer.widthRatio && (layer.widthRatio <= 0 || layer.widthRatio > 1)) {
        throw new Error(`레이어 ${i}: widthRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`);
      }
      if (layer.heightRatio && (layer.heightRatio <= 0 || layer.heightRatio > 1)) {
        throw new Error(`레이어 ${i}: heightRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`);
      }
    } else if (layer.type === 'image') {
      // 이미지 레이어 검증 (widthRatio/heightRatio 필수)
      if (!layer.widthRatio || !layer.heightRatio) {
        throw new Error(`레이어 ${i}: 이미지 타입은 widthRatio와 heightRatio가 필수입니다.`);
      }
      if (
        layer.widthRatio <= 0 ||
        layer.widthRatio > 1 ||
        layer.heightRatio <= 0 ||
        layer.heightRatio > 1
      ) {
        throw new Error(
          `레이어 ${i}: widthRatio, heightRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`
        );
      }
    }
  }

  Logger.debug(`[Template Validator] ✅ 템플릿 "${data.name}" 검증 통과`);
  return true;
}

/**
 * 썸네일 템플릿 목록 가져오기
 * @returns {Promise<{success: boolean, templates?: Array, error?: string}>}
 */
export async function getThumbnailTemplates() {
  try {
    const templatesRef = ref(getDb(), 'thumbnail_templates');
    const snapshot = await get(templatesRef);
    const val = snapshot?.val() || {};
    const templates = Object.entries(val).map(([id, data]) => ({
      id,
      ...data,
    }));

    Logger.debug(`[getThumbnailTemplates] 템플릿 ${templates.length}개 조회 완료`);
    return { success: true, templates };
  } catch (error) {
    Logger.error('[getThumbnailTemplates] 오류:', error);
    return { success: false, error: error.message, templates: [] };
  }
}

/**
 * 템플릿 삭제
 * @param {string} templateId - 삭제할 템플릿 ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteTemplate(templateId) {
  if (!templateId) {
    return { success: false, error: '템플릿 ID가 없습니다.' };
  }

  try {
    const templateRef = ref(getDb(), `thumbnail_templates/${templateId}`);
    await remove(templateRef);

    Logger.info(`[deleteTemplate] 템플릿 삭제 완료: ${templateId}`);
    return { success: true };
  } catch (error) {
    Logger.error('[deleteTemplate] 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Gemini를 사용하여 썸네일 텍스트 생성
 * @param {Array<string>} outlines - 목차 배열
 * @param {string} draft - 초안 내용 (선택적)
 * @returns {Promise<{success: boolean, slogans?: Array<string>, error?: string}>}
 */
export async function generateThumbnailTexts(outlines, draft = '') {
  if (!Array.isArray(outlines) || outlines.length === 0) {
    return { success: false, error: '목차 배열이 필요합니다.' };
  }

  try {
    const prompt = `아래는 콘텐츠 초안과 세션(아웃라인) 목록입니다.\n\n[초안]\n${draft}\n\n[세션 목록]\n${outlines
      .map((t, i) => `${i + 1}. ${t}`)
      .join(
        '\n'
      )}\n\n각 세션에 어울리는 썸네일용 짧은 슬로건 또는 키워드를 한글로 1개씩, 12자 이내로, 꾸밈말 없이 핵심만 배열로 추천해줘.\n예시: ["슬로건1", "슬로건2", ...]`;

    const raw = await callGeminiAPI(prompt);

    let slogans = [];
    try {
      const arrayMatch = raw.match(/\[.*\]/s);
      if (arrayMatch) {
        slogans = JSON.parse(arrayMatch[0]);
      } else {
        Logger.warn('[generateThumbnailTexts] 배열 형식 파싱 실패, 원본:', raw);
      }
    } catch (e) {
      Logger.error('[generateThumbnailTexts] 배열 파싱 예외:', e, raw);
    }

    // 개수 맞추기 (실패 시 빈값 채움)
    if (!Array.isArray(slogans) || slogans.length !== outlines.length) {
      slogans = Array(outlines.length).fill('');
    }

    Logger.debug(`[generateThumbnailTexts] 슬로건 ${slogans.length}개 생성 완료`);
    return { success: true, slogans };
  } catch (error) {
    Logger.error('[generateThumbnailTexts] 오류:', error);
    return { success: false, error: error.message, slogans: [] };
  }
}
