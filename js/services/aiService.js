// js/services/aiService.js

import {
  getDb,
  CONSTANTS,
  uploadImageToFirebaseStorage,
  cleanDataForFirebase,
  getCurrentUserId,
} from './firebaseService.js';
// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
import { ref, update, get, serverTimestamp } from './firebaseService.js';
// 순수 데이터 분석 함수만 import (순환 참조 방지)
// analyzePerformanceData previously used to fetch performance data for prompts, no longer needed
import { Logger, normalizeSeoTitle } from '../utils.js';
import {
  sanitizeHtmlInOffscreen,
  cropImageInOffscreen,
  composeThumbnailInOffscreen,
} from './offscreenService.js'; // [추가]
// [추가] PromptService 임포트
import { PromptBuilder, detectPersona, PROMPT_CONFIG } from './promptService.js';
import { generateThumbnailTexts } from './thumbnailService.js';
// [추가] 상수 임포트
import { AI_MODELS } from '../constants.js';

// [신규] 제목에서 중복 년도를 제거하는 헬퍼 함수 (강화)
function removeDuplicateYears(title) {
  if (!title) return title;

  // Find all year matches (e.g., '2024년', '2024') with positions
  // Use alternation to prefer matching '년' suffix when present
  const matches = Array.from(title.matchAll(/(\d{4}년|\d{4})/g));
  if (matches.length <= 1) {
    // 기본 정리만 수행
    let s = title
      .replace(/\s{2,}/g, ' ') // 연속 공백 축소
      .replace(/\s*\/\s*/g, '/') // 슬래시 주변 정리
      .trim();
    // Punctuation normalization (commas no leading space, single trailing space)
    s = s
      .replace(/\s*([,;:])\s*/g, '$1 ')
      .replace(/\s*([–—-])\s*/g, ' - ')
      .replace(/\s+([.?!])/g, '$1');
    s = s
      .replace(/\s+,/g, ',')
      .replace(/,\s*,/g, ',')
      .replace(/\s{2,}/g, ' ');
    return s.trim();
  }

  let result = '';
  let lastIndex = 0;
  const seen = new Set();

  for (const m of matches) {
    // m[0] is entire match, m.index is its position
    const token = m[0];
    const yearOnly = token.replace(/년$/, '');
    const start = m.index;
    const end = start + token.length;

    if (!seen.has(yearOnly)) {
      // keep first occurrence: append everything from lastIndex to end
      result += title.slice(lastIndex, end);
      seen.add(yearOnly);
      lastIndex = end;
    } else {
      // remove duplicate occurrence: append text before match but trim trailing spaces and commas
      result += title.slice(lastIndex, start).replace(/[\s,]+$/g, '');
      lastIndex = end;
    }
  }
  // append tail
  result += title.slice(lastIndex);

  // Special: remove commas that immediately follow a year (leftover formatting)
  result = result.replace(/(\b\d{4}(년)?\b)\s*,\s*/g, '$1 ');

  // Normalize punctuation and whitespace
  let cleaned = result
    .replace(/\s{2,}/g, ' ') // collapse multiple spaces
    .replace(/\s*\/\s*/g, '/') // normalize slashes
    .replace(/\s*([,;:])\s*/g, '$1 ') // no leading space, single trailing space
    .replace(/\s*([–—-])\s*/g, ' - ') // dashes with spaces
    .replace(/\s+([.?!])/g, '$1') // remove space before sentence end
    .trim();

  // remove any duplicated punctuation spacing issues
  cleaned = cleaned
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ');

  return cleaned;

  // remove any duplicated punctuation spacing issues
  cleaned = cleaned
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ');

  return cleaned;
}

// [신규] 이미지 alt 텍스트 유효성 검사 및 정리
function sanitizeAltText(candidate, fallback) {
  try {
    const s = candidate ? String(candidate).trim() : '';
    // Accept alt text only if it contains at least one letter or number (Unicode-aware)
    if (s && /[\p{L}\p{N}]/u.test(s)) return s;
  } catch (e) {
    // ignore and fall back
  }
  return String(fallback || 'Thumbnail image');
}

// sanitize thumbnail overlay text: ensure it's not punctuation-only and is reasonably short
function sanitizeThumbnailText(candidate, fallback) {
  try {
    const s = candidate ? String(candidate).trim() : '';
    if (s && /[\p{L}\p{N}]/u.test(s)) {
      // strip leading/trailing punctuation and collapse whitespace
      const cleaned = s.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '').trim();
      if (cleaned && /[\p{L}\p{N}]/u.test(cleaned)) {
        return cleaned.length > 12 ? cleaned.substring(0, 12).trim() : cleaned;
      }
    }
  } catch (e) {}
  try {
    const fb = String(fallback || '')
      .replace(/[\p{P}\p{S}]+/gu, '')
      .trim();
    return fb ? (fb.length > 12 ? fb.substring(0, 12).trim() : fb) : '썸네일';
  } catch (e) {
    return '썸네일';
  }
}

// [신규] Detect meta-template style candidates and exclude them from use
function looksLikeMetaTemplateCandidate(cand) {
  try {
    const text = (
      (cand && (cand.thumbnailPromptKo || cand.thumbnailPromptEn || cand.thumbnailText)) ||
      ''
    )
      .toString()
      .toLowerCase();
    // Korean heuristic phrases and a small English heuristic
    return /다음\s*메타\s*요약|메타\s*요약|메타\s*요약을\s*바탕|바탕으로\s*한|based on meta summary|meta\s*summary/.test(
      text
    );
  } catch (e) {
    return false;
  }
}

// Compute thumbnail text for overlay composition (testable helper)
function computeThumbnailTextForCompose(selectedThumbnail = {}, seoTitle = '', ideaData = {}) {
  const fallback = (seoTitle || ideaData.title || '')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .trim()
    .substring(0, 12);
  return sanitizeThumbnailText(selectedThumbnail.thumbnailText || '', fallback);
}

// Link rules builder (returns a plain string to embed into prompts)
function buildLinkRules(myPastPostsText, affiliateLinks = [], linkedScrapsText) {
  if (!myPastPostsText) return '';
  const affiliateCount = (affiliateLinks || []).length;
  const hasScraps = !!linkedScrapsText;
  return [
    '[INTERNAL LINKS - REQUIRED]',
    '- Select 4–5 internal posts only from the provided "내 과거 포스팅 목록 (내부 링크 추천용)" block below.',
    '- Use Markdown link format [Text](FullURL). Do not repeat the same URL.',
    '- Distribute internal links across H2 sections (avoid placing all links in the conclusion).',
    affiliateCount > 0 ? '- If affiliate links are provided, insert 2 (minimum) and up to 3 affiliate links naturally in the body.' : '',
    hasScraps ? '- If connected scraps exist, insert 2–3 natural external reference links.' : '',
    'After writing, add a short checklist line: "CHECK: Internal:N / Affiliate:M / External:K"'
  ].filter(Boolean).join('\n');
}

// Try to replace title-like fallback with an AI generated slogan (async helper)
async function selectSloganIfTitleFallback(
  selectedThumbnail = {},
  thumbnailCandidates = [],
  seoTitle = '',
  ideaData = {},
  formattedDraft = ''
) {
  try {
    const currentText = String(selectedThumbnail.thumbnailText || '').trim();
    const titleFallback = (seoTitle || ideaData.title || '')
      .replace(/[^\p{L}\p{N}\s]+/gu, '')
      .trim()
      .substring(0, 12);
    const normalizedTitle = (ideaData.title || '').replace(/[^\p{L}\p{N}\s]+/gu, '').trim();
    const looksLikeTitleFallback =
      !currentText ||
      currentText === titleFallback ||
      (currentText && currentText === sanitizeThumbnailText('', titleFallback)) ||
      currentText === (ideaData.title || '') ||
      (ideaData.title && ideaData.title.includes(currentText)) ||
      (currentText &&
        currentText.includes(normalizedTitle.substring(0, Math.min(12, normalizedTitle.length))));
    if (!looksLikeTitleFallback) return selectedThumbnail;

    const { slogans } = await generateThumbnailTexts(ideaData.outline || [], formattedDraft || '');
    if (Array.isArray(slogans) && slogans.length > 0) {
      const suggested = slogans[0] || '';
      const newText = sanitizeThumbnailText(suggested, titleFallback);
      selectedThumbnail.thumbnailText = newText;
      if (Array.isArray(thumbnailCandidates) && thumbnailCandidates.length > 0)
        thumbnailCandidates[0] = selectedThumbnail;
      Logger.info(
        '[selectSloganIfTitleFallback] Using generated slogan for overlay:',
        selectedThumbnail.thumbnailText
      );
    }
  } catch (e) {
    Logger.debug('[selectSloganIfTitleFallback] error:', e && e.message);
  }
  return selectedThumbnail;
}

// [신규] 이미지 URL을 Base64 문자열로 변환하는 헬퍼 함수
async function fetchImageAsBase64(url) {
  try {
    // First try background fetch via runtime message (helps bypass page CSP)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        // (no-op) default schema will be populated below
        const BG_FETCH_TIMEOUT_MS = 5000;
        void 0;
        const bgMsgPromise = new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: 'fetch_image_as_base64', url }, (resp) => {
              resolve(resp);
            });
          } catch (e) {
            resolve(null);
          }
        });
        const responseMsg = await Promise.race([
          bgMsgPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('bg fetch timeout')), BG_FETCH_TIMEOUT_MS)
          ),
        ]);
        // Expected response: { success: true, dataUrl: 'data:image/png;base64,...' } or { success: true, mimeType, data }
        if (responseMsg && responseMsg.success) {
          try {
            console.log('%c[AI 썸네일 메이커 디버깅][fetchImage success]', 'color:#9E9E9E', {
              url,
            });
          } catch (e) {
            void 0;
          }
          if (responseMsg.dataUrl) {
            const m = responseMsg.dataUrl.match(/^data:(.+);base64,(.*)$/);
            if (m) return { mimeType: m[1], data: m[2] };
            return null;
          }
          if (responseMsg.data && responseMsg.mimeType) {
            return { mimeType: responseMsg.mimeType, data: responseMsg.data };
          }
        }
      } catch (e) {
        Logger.debug('[fetchImageAsBase64] chrome.runtime.fetch failed, falling back', e);
        try {
          console.log('%c[AI 썸네일 메이커 디버깅][fetchImage bg-failed]', 'color:#9E9E9E', {
            url,
          });
        } catch (e) {
          void 0;
        }
      }
    }

    Logger.debug('[fetchImageAsBase64] Falling back to fetch for URL:', url);
    try {
      console.log('%c[AI 썸네일 메이커 디버깅][fetchImage fetch]', 'color:#9E9E9E', { url });
    } catch (e) {
      void 0;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`이미지 다운로드 실패: ${response.status}`);
    try {
      console.log('%c[AI 썸네일 메이커 디버깅][fetchImage fetch-success]', 'color:#9E9E9E', {
        url,
      });
    } catch (e) {
      void 0;
    }
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          // "data:image/jpeg;base64,..." 형식에서 MIME 타입과 데이터 분리
          const dataUrl = reader.result || '';
          const matches = dataUrl.match(/^data:(.+);base64,(.*)$/);
          if (matches) {
            resolve({ mimeType: matches[1], data: matches[2] });
          } else {
            resolve(null);
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    Logger.warn('[fetchImageAsBase64] 이미지 변환 실패:', e);
    return null;
  }
}

// [신규] 스크랩 이미지 분석 함수
async function analyzeScrapImage(imageUrl) {
  try {
    const imageData = await fetchImageAsBase64(imageUrl);
    if (!imageData) return null;

    const prompt =
      '이 이미지를 상세히 분석해줘. 1. 이미지에 포함된 모든 텍스트를 추출해줘. 2. 이미지의 주요 객체와 요소들을 자세히 설명해줘. 3. 이미지의 전체적인 분위기와 스타일을 분석해줘. 4. 이 이미지가 어떤 맥락에서 사용될 수 있을지 제안해줘.';
    // VISION 모델(gemini-2.0-flash) 사용
    const analysis = await callGeminiAPI(prompt, AI_MODELS.VISION, [imageData]);
    return analysis;
  } catch (e) {
    Logger.warn('[analyzeScrapImage] 분석 실패:', e);
    return null;
  }
}

// Select multiple reference images for background generation (prioritized)
// Returns array of URLs (maxCount default 3)
export function selectBackgroundReferenceImages(
  { formattedDraft, ideaData = {}, affiliateLinks = [] },
  maxCount = 3
) {
  const urls = [];

  console.log('[DEBUG_REF] selectBackgroundReferenceImages input:', {
    draftLength: (formattedDraft || '').length,
    linkedScrapsCount: ideaData.linkedScrapsContent?.length || 0,
    affiliateLinksCount: affiliateLinks?.length || 0,
  });

  // 1) images from formattedDraft (editor), exclude firebase thumbnail paths
  if (formattedDraft) {
    try {
      const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = imgTagRegex.exec(formattedDraft)) !== null) {
        const url = match[1];
        // [변경] 에디터에 있는 이미지는 출처(Firebase 등)와 상관없이 모두 참고 이미지 후보로 허용
        // 사용자가 에디터에 포함시킨 이미지는 의도적인 콘텐츠로 간주함
        if (url) {
          if (!urls.includes(url)) {
            urls.push(url);
            console.log('[DEBUG_REF] Found editor image:', url);
          }
          if (urls.length >= maxCount) return urls;
        }
      }
    } catch (e) {
      console.error('[DEBUG_REF] editor image extraction failed:', e);
    }
  }

  // 2) linked scraps images
  if (ideaData.linkedScrapsContent && Array.isArray(ideaData.linkedScrapsContent)) {
    console.log('[DEBUG_REF] Checking linked scraps:', ideaData.linkedScrapsContent.length);
    for (const scrap of ideaData.linkedScrapsContent) {
      // scrap.image might be in scrap.originData.image or scrap.imageUrl or scrap.image
      // Normalize scrap image access
      const candidate =
        scrap.image || scrap.imageUrl || scrap.originData?.image || scrap.originData?.thumbnail;

      if (candidate) {
        if (!urls.includes(candidate)) {
          urls.push(candidate);
          console.log('[DEBUG_REF] Found linked scrap image:', candidate);
        }
        if (urls.length >= maxCount) return urls;
      } else {
        console.log('[DEBUG_REF] Scrap has no image:', scrap.id || 'unknown');
      }
    }
  }

  // 3) affiliate links
  if (Array.isArray(affiliateLinks)) {
    for (const l of affiliateLinks) {
      const img = l?.cardData?.imageUrl;
      if (img && !urls.includes(img)) {
        urls.push(img);
        if (urls.length >= maxCount) return urls;
      }
    }
  }

  return urls;
}

// [삭제] PERSONA_TEMPLATES 상수 삭제 (PromptService로 이관됨)
// [삭제] selectPersona 함수 삭제 (detectPersona로 대체 및 generateDraftFromIdea 내부로 통합)
// [삭제] logPersona 함수 삭제 (PromptBuilder의 getPersonaName/getToneName으로 대체)

// 썸네일 프롬프트 생성 시스템 메시지
// [수정] 텍스트 금지 명령을 최상단에 영문/한글로 강력하게 추가
const THUMBNAIL_SYSTEM_PROMPT = `
// [수정] 텍스트 금지 명령 제거 -> 텍스트 렌더링 최적화 명령으로 변경
You are an expert at creating prompts for blog thumbnails.
Your goal is to generate a DALL-E 3 or Imagen 3 prompt that creates a high-quality, click-inducing thumbnail.

[Text Rendering Rules - CRITICAL]
1. If the user provides a specific text/title, you MUST instruct the model to render it explicitly using the format: "Render the text: 'TEXT_CONTENT'".
2. For Korean text, emphasize strict typography to prevent typos (e.g., "Bold, clear Korean typography", "Legible text").
3. Do NOT allow misspelled or gibberish text. If the text is too long (over 10 chars), summarize it into a short keyword for the image.

[Design Style Guide]
- Style: Modern, High-quality 3D render or Premium Flat Illustration
- Composition: Center the main object/text with ample whitespace.
- Lighting: Studio lighting, bright and vibrant.
- Color: Use brand colors (Blue, Red, Yellow, Green) as accents on a neutral background.

Output ONLY the English prompt for the image generation model.
`;

// 3. 키워드 갭 분석 (AI 분석)
export async function analyzeKeywordGap(myContent, competitorContent) {
  // (단순화를 위해 Set 연산만 수행, 필요시 AI 필터링 추가)
  const myTags = new Set();
  myContent.forEach((c) => (c.tags || []).forEach((t) => myTags.add(t.replace(/^#/, ''))));

  const compTags = new Set();
  competitorContent.forEach((c) =>
    (c.tags || []).forEach((t) => compTags.add(t.replace(/^#/, '')))
  );

  const gapKeywords = [...compTags].filter((t) => !myTags.has(t)).slice(0, 10);
  return { gapKeywords, gapCount: gapKeywords.length };
}

// 프롬프트 빌드 헬퍼: 작은 테스트 가능한 조각으로 분리
export function buildDraftPrompt(context = {}, ideaData = {}) {
  const parts = [];
  if (context.systemPrompt) parts.push(context.systemPrompt);
  parts.push(`Title: ${ideaData.title || context.title || ''}`);
  if (ideaData.description) parts.push(`Description: ${ideaData.description}`);
  if (context.keywords && context.keywords.length)
    parts.push(`Keywords: ${context.keywords.join(', ')}`);
  // Add a short instruction asking for a full draft in markdown
  parts.push(
    'Please write a complete draft in markdown format. Include clear headings and an SEO-friendly title.'
  );
  // Return simple concatenated prompt — detailed template lives elsewhere (keeps file small & testable)
  return parts.join('\n\n');
}

// 4. 트렌드 분석 (AI 추론)
export async function getEmergingTopics(channelContext) {
  if (!channelContext) return null;
  const prompt = `다음 채널 맥락을 바탕으로 최신 트렌드 주제 5개를 제안해줘:\n${channelContext}`;
  return await callGeminiAPI(prompt);
}

// Gemini 텍스트 모델 호출 유틸
// Gemini 텍스트 모델 호출 유틸
export async function callGeminiAPI(prompt, model = AI_MODELS.TEXT, images = []) {
  // 검사: API 키가 반드시 있어야 함
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (!geminiApiKey || !String(geminiApiKey).trim()) {
    throw new Error('Gemini API 키가 없습니다');
  }

  // [수정] Gemini 모델 엔드포인트 (v1beta:generateContent)
  // API 키는 Query Parameter로 전달해야 함
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  try {
    // Debug: log the incoming prompt (short) for test visibility
    try {
      Logger.debug(
        '[callGeminiAPI] prompt preview:',
        typeof prompt === 'string'
          ? prompt.substring(0, 200)
          : Object.prototype.toString.call(prompt)
      );
      
      // 내부 링크 디버깅: 프롬프트에 내부 링크 섹션이 포함되어 있는지 확인
      if (typeof prompt === 'string') {
        const hasInternalLinkSection = prompt.includes('절대 규칙 1순위') || prompt.includes('내 과거 포스팅 목록');
        const hasMyPastPosts = prompt.includes('[내 과거 포스팅 목록');
        
        console.log('[INTERNAL LINK DEBUG] 프롬프트 내부 링크 포함 여부:', {
          hasInternalLinkSection,
          hasMyPastPosts,
          promptLength: prompt.length,
        });
        
        // 내부 링크 섹션만 추출해서 로깅
        if (hasMyPastPosts) {
          const startIdx = prompt.indexOf('[내 과거 포스팅 목록');
          const endIdx = prompt.indexOf('설명:', startIdx) + 200; // 첫 번째 포스팅 샘플까지만
          if (startIdx >= 0 && endIdx > startIdx) {
            console.log('[INTERNAL LINK DEBUG] 내 과거 포스팅 목록 샘플:', prompt.substring(startIdx, endIdx));
          }
        } else {
          console.warn('[INTERNAL LINK DEBUG] ⚠️ 내부 링크 섹션이 프롬프트에 없습니다!');
        }
      }
    } catch (e) {}
    // [수정] 멀티모달 입력을 위한 parts 구성
    const parts = [];

    // 텍스트 프롬프트 추가
    if (prompt && typeof prompt === 'string') {
      parts.push({ text: prompt });
    }

    // 이미지 데이터 추가 (Base64 형식)
    if (Array.isArray(images)) {
      for (const img of images) {
        if (img && img.mimeType && img.data) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data,
            },
          });
        }
      }
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Referer 제한 우회를 위한 헤더 (Chrome 확장에서는 제한적)
        Origin: 'chrome-extension://' + chrome.runtime.id,
      },
      // [수정] Gemini 요청 본문 구조 ({ contents: [{ parts: [{ text }, { inlineData }] }] })
      body: JSON.stringify({
        contents: [{ parts }],
      }),
    });

    if (!resp.ok) {
      // 가능한한 유의미한 오류 메시지 추출
      const body = await resp.json().catch(() => ({}));
      const msg = body?.error?.message || `HTTP ${resp.status}`;

      // 403 오류 시 사용자 친화적인 메시지 제공
      if (resp.status === 403) {
        throw new Error(
          'Gemini API 키가 유효하지 않거나 권한이 없습니다. Google AI Studio(https://aistudio.google.com/app/apikey)에서 새 API 키를 발급받아 채널 설정에 입력해주세요.'
        );
      }

      throw new Error(msg);
    }

    const json = await resp.json().catch(() => ({}));

    // [수정] Gemini 응답 파싱
    const candidate = Array.isArray(json?.candidates) && json.candidates[0];
    if (!candidate) return '';

    const responseParts = candidate?.content?.parts || [];
    // parts는 배열, 각 항목에 text가 있을 수 있음
    for (const p of responseParts) {
      if (p && typeof p.text === 'string') return p.text;
    }

    return '';
  } catch (err) {
    // 네트워크 에러는 그대로 전파
    throw err;
  }
}

// Higher-level helper wrapping callGeminiAPI with retry/backoff and prompt optimization
export async function callDraftAPI(prompt, opts = {}) {
  const {
    maxRetries = 3,
    initialBackoffMs = 1000,
    backoffMultiplier = 2,
    model = AI_MODELS.TEXT,
  } = opts || {};

  // 프롬프트 길이 보호 / 최적화
  let optimizedPrompt = prompt;
  if (typeof prompt === 'string' && prompt.length > 300000) {
    Logger.warn(
      `[callDraftAPI] 프롬프트가 너무 깁니다 (${prompt.length}자). 압축된 버전으로 시도합니다.`
    );
    optimizedPrompt =
      prompt.substring(0, 150000) + '\n\n[프롬프트가 길어 축소되었습니다. 핵심 내용만 포함합니다.]';
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      Logger.info(`[callDraftAPI] API 호출 시도 ${attempt + 1}/${maxRetries}`);
      const result = await callGeminiAPI(optimizedPrompt, model);

      if (result && String(result).trim().length > 0) {
        Logger.info(`[callDraftAPI] 응답 수신 - 길이 ${String(result).length}`);
        return result;
      }

      // 빈 응답일 경우 재시도 준비
      Logger.warn(`[callDraftAPI] 빈 응답 (시도 ${attempt + 1}/${maxRetries})`);
      if (attempt < maxRetries - 1) {
        const wait = initialBackoffMs * Math.pow(backoffMultiplier, attempt);
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }
    } catch (err) {
      Logger.error(`[callDraftAPI] 호출 중 오류 (시도 ${attempt + 1}/${maxRetries}):`, err);
      if (attempt < maxRetries - 1) {
        const wait = initialBackoffMs * 2 * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }
      // 마지막 시도에서 실패하면 에러를 전파
      throw err;
    }

    attempt++;
  }

  // 모든 시도 후에도 응답이 없으면 빈 문자열 반환 (상위 로직에서 기본 템플릿 처리)
  return '';
}

// Process a raw draft text from the model into cleanedDraft, parsed JSON-LD and thumbnailCandidates
export function processDraftResponse(rawDraft = '', ideaData = {}) {
  let cleanedDraft = String(rawDraft || '');
  // Remove common fenced code wrappers added by models
  cleanedDraft = cleanedDraft.replace(/^```markdown\s*\n?/i, '');
  cleanedDraft = cleanedDraft.replace(/^```md\s*\n?/i, '');
  cleanedDraft = cleanedDraft.replace(/^```\s*\n?/i, '');
  cleanedDraft = cleanedDraft.replace(/\n?```\s*$/i, '');
  cleanedDraft = cleanedDraft.replace(/\n?```markdown\s*$/i, '');
  cleanedDraft = cleanedDraft.replace(/\n?```md\s*$/i, '');
  cleanedDraft = cleanedDraft.trim();

  if (!cleanedDraft || cleanedDraft.trim().length === 0) {
    // fallback to raw value (trimmed)
    cleanedDraft = String(rawDraft || '').trim();
  }

  // Heuristic: remove trailing/standalone example-only links that sometimes come from LLMs
  // Example problematic outputs look like:
  //   [완벽 가이드] ...](https://some-site/entry/long-url)
  // or a file containing only a raw URL. These are not useful as the draft body
  // and should be filtered out so the app can treat them as a failed generation.
  try {
    const lines = cleanedDraft.split(/\r?\n/).map((l) => l.trim());
    const isLinkOnly = (ln) => {
      if (!ln) return false;
      try {
        // direct URL only
        if (/^https?:\/\/[\S]+$/i.test(ln)) return true;
        // angled url: <https://...>
        if (/^<https?:\/\/[^>]+>$/i.test(ln)) return true;

        // markdown link: [text](https://...)
        if (/^\[[^\]]+\]\(https?:\/\/[^)]+\)$/i.test(ln)) return true;

        // More robust heuristic: if the line contains one or more URLs and
        // after stripping URLs and simple markdown tokens the remaining text is small,
        // treat it as a link-only example line.
        const urls = ln.match(/https?:\/\/[\S]+/gi) || [];
        if (urls.length > 0) {
          const withoutUrls = ln
            .replace(/https?:\/\/[\S]+/gi, '')
            .replace(/\[.*?\]|\(.*?\)|<.*?>/g, '')
            .trim();
          if (withoutUrls.length < 15) return true;
        }
      } catch (e) {
        return false;
      }
      return false;
    };

    let filtered = lines.filter((l) => !isLinkOnly(l));
    // If the draft is a single line containing a URL, treat it as example-only
    // (many LLM outputs can be a single-line example link). Force fallback.
    if (lines.length === 1 && /https?:\/\//i.test(lines[0])) {
      filtered = [];
    }
    if (filtered.length > 0 && filtered.join('\n').trim().length >= 40) {
      // Replace cleanedDraft with filtered text when filtering likely removed only noise
      cleanedDraft = filtered.join('\n').trim();
    } else if (
      filtered.length === 0 &&
      (lines.some((l) => isLinkOnly(l)) || lines.some((l) => /https?:\/\//i.test(l)))
    ) {
      // The whole draft was link/example-only — treat as failure and use fallback
      cleanedDraft = `# ${ideaData.title || '제목 없음'}\n\n내용을 생성하는 중 오류가 발생했습니다. 다시 시도해주세요.`;
    }
  } catch (e) {
    Logger.debug('[processDraftResponse] example link filter failed', e);
  }

  if (!cleanedDraft || cleanedDraft.trim().length === 0) {
    // last fallback - minimal placeholder
    cleanedDraft = `# ${ideaData.title || '제목 없음'}\n\n내용을 생성하는 중 오류가 발생했습니다. 다시 시도해주세요.`;
  }

  // JSON-LD parsing (prefer cleanedDraft, fall back to rawDraft)
  let jsonLdSchema = null;
  try {
    const jsonLdMatch =
      cleanedDraft.match(/<JSON-LD>([\s\S]*?)<\/JSON-LD>/i) ||
      String(rawDraft || '').match(/<JSON-LD>([\s\S]*?)<\/JSON-LD>/i);

    if (jsonLdMatch && jsonLdMatch[1]) {
      try {
        jsonLdSchema = JSON.parse(jsonLdMatch[1].trim());
      } catch (e) {
        Logger.warn('[processDraftResponse] JSON-LD 파싱 실패:', e);
        jsonLdSchema = null;
      }

      // Remove tag from cleanedDraft regardless
      cleanedDraft = cleanedDraft.replace(/<JSON-LD>[\s\S]*?<\/JSON-LD>/gi, '').trim();
    }
  } catch (e) {
    Logger.warn('[processDraftResponse] JSON-LD 탐색 시 예외:', e);
  }

  // Thumbnail candidates extraction
  let thumbnailCandidates = [];
  try {
    const thumbnailMatch = cleanedDraft.match(/<썸네일정보>([\s\S]*?)<\/썸네일정보>/);
    if (thumbnailMatch && thumbnailMatch[1]) {
      try {
        const parsed = JSON.parse(thumbnailMatch[1].trim());
        thumbnailCandidates = Array.isArray(parsed) ? parsed : [parsed];

        // Filter out any persisted meta-template style candidates so they are never used
        thumbnailCandidates = (thumbnailCandidates || []).filter(
          (c) => !looksLikeMetaTemplateCandidate(c)
        );
      } catch (e) {
        Logger.warn('[processDraftResponse] 썸네일정보 파싱 실패:', e);
        thumbnailCandidates = [];
      }

      // Remove the thumbnail tag from the draft
      cleanedDraft = cleanedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '').trim();
    }

    // If no explicit <썸네일정보> was provided, try to extract image prompts
    // that the draft may have included per the '이미지 생성 프롬프트' guideline.
    // Accept patterns like:
    // [이미지 생성 프롬프트 (영어): High-quality photo of ...]
    // [이미지 생성 프롬프트 (한글): ...]
    if (thumbnailCandidates.length === 0) {
      try {
        const promptPairs = [];
        const lines = cleanedDraft.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const enMatch = lines[i].match(/\[이미지 생성 프롬프트 \(영어\):\s*(.+?)\s*\]$/i);
          if (enMatch) {
            const en = enMatch[1].trim();
            // find following korean prompt line if present
            let ko = '';
            for (let j = i + 1; j < lines.length; j++) {
              const koMatch = lines[j].match(/\[이미지 생성 프롬프트 \(한글\):\s*(.+?)\s*\]$/i);
              if (koMatch) {
                ko = koMatch[1].trim();
                break;
              }
              // allow a plain next line if it looks like a Korean prompt (not bracketed)
              if (lines[j].trim() && !/^\[.*\]$/.test(lines[j].trim())) {
                ko = lines[j].trim();
                break;
              }
            }
            promptPairs.push({ en, ko });
          }
        }

        if (promptPairs.length > 0) {
          thumbnailCandidates = promptPairs.map((p) => ({
            type: 'generated',
            thumbnailPromptEn: p.en,
            thumbnailPromptKo: p.ko || '',
            thumbnailText: '',
          }));
        }
      } catch (e) {
        Logger.warn('[processDraftResponse] 이미지 프롬프트 추출 실패:', e);
      }
    }
  } catch (e) {
    Logger.warn('[processDraftResponse] 썸네일정보 탐색 중 예외:', e);
  }

  return { cleanedDraft, jsonLdSchema, thumbnailCandidates };
}

// Enhance a draft with visual features: auto-generate thumbnails, crop, upload and insert to HTML
export async function enhanceDraftWithFeatures({
  thumbnailCandidates = [],
  affiliateLinks = [],
  permalink = '',
  composeThumbnailText = false,
  seoTitle = '',
  ideaData = {},
  jsonLdSchema = null,
  formattedDraft = '',
  onProgress = null,
} = {}) {
  let thumbnailUrls = ideaData.publishInfo?.thumbnailUrls || null;
  let thumbnailGenerationPartialFailure = false;

  if (!thumbnailCandidates || thumbnailCandidates.length === 0 || !permalink) {
    return { formattedDraft, thumbnailUrls, thumbnailGenerationPartialFailure, jsonLdSchema };
  }

  try {
    const selectedThumbnail = thumbnailCandidates[0];
    Logger.info('[enhanceDraftWithFeatures] 썸네일 자동 생성 시작', {
      type: selectedThumbnail.type,
      permalink: permalink.substring(0, 30),
    });
    // Emit progress: thumbnail generation started
    try {
      if (typeof onProgress === 'function')
        onProgress({ step: 'thumbnail_generation', progress: 50, message: '썸네일 생성 중...' });
    } catch (e) {
      void 0;
    }

    // === 이미지 소스 선택 (우선순위) ===
    // 1순위: 에디터 내 이미지
    // 2순위: 연결 자료(스크랩) 이미지
    // 3순위: 제휴 링크 이미지
    let selectedImageUrl = null;
    let imageSourceType = null;

    Logger.debug('[enhanceDraftWithFeatures] 이미지 소스 선택 디버깅:', {
      hasFormattedDraft: !!formattedDraft,
      formattedDraftLength: formattedDraft?.length || 0,
      hasLinkedScrapsContent: !!ideaData.linkedScrapsContent,
      linkedScrapsContentLength: ideaData.linkedScrapsContent?.length || 0,
      hasAffiliateLinks: !!affiliateLinks,
      affiliateLinksLength: affiliateLinks?.length || 0,
    });

    // 1순위: 에디터 내 이미지 추출 (단, Firebase Storage 썸네일은 제외)
    if (formattedDraft) {
      try {
        const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = imgTagRegex.exec(formattedDraft)) !== null) {
          const url = match[1];
          // Firebase Storage의 thumbnails 폴더 이미지는 제외 (재생성 시 순환 참조 방지)
          if (
            url &&
            !url.includes('firebasestorage.googleapis.com') &&
            !url.includes('/thumbnails/')
          ) {
            selectedImageUrl = url;
            imageSourceType = 'editor';
            Logger.info('[enhanceDraftWithFeatures] ✅ 1순위 이미지 선택: 에디터 내 이미지', {
              url: selectedImageUrl.substring(0, 80),
            });
            break;
          }
        }

        if (!selectedImageUrl) {
          Logger.debug('[enhanceDraftWithFeatures] 에디터에 사용 가능한 이미지 없음 (썸네일 제외)');
        }
      } catch (e) {
        Logger.warn('[enhanceDraftWithFeatures] 에디터 이미지 추출 실패:', e);
      }
    }

    // 2순위: 연결 자료(스크랩) 이미지
    if (
      !selectedImageUrl &&
      ideaData.linkedScrapsContent &&
      Array.isArray(ideaData.linkedScrapsContent)
    ) {
      Logger.debug('[enhanceDraftWithFeatures] 연결 자료 확인:', {
        count: ideaData.linkedScrapsContent.length,
        scraps: ideaData.linkedScrapsContent.map((s) => ({
          title: s.title,
          hasImage: !!s.image,
          imageUrl: s.image?.substring(0, 50),
        })),
      });

      for (const scrap of ideaData.linkedScrapsContent) {
        if (scrap.image) {
          selectedImageUrl = scrap.image;
          imageSourceType = 'scrap';
          Logger.info('[enhanceDraftWithFeatures] ✅ 2순위 이미지 선택: 연결 자료 이미지', {
            scrapTitle: scrap.title,
            url: selectedImageUrl.substring(0, 80),
          });
          break;
        }
      }

      if (!selectedImageUrl) {
        Logger.debug('[enhanceDraftWithFeatures] 연결 자료에 이미지 없음');
      }
    }

    // 3순위: 제휴 링크 이미지 (기존 로직 유지)
    let productLink = null;
    if (!selectedImageUrl && Array.isArray(affiliateLinks) && affiliateLinks.length > 0) {
      Logger.debug('[enhanceDraftWithFeatures] 제휴 링크 확인:', {
        count: affiliateLinks.length,
        links: affiliateLinks.map((l) => ({
          id: l.id,
          hasCardData: !!l.cardData,
          hasImage: !!(l.cardData && l.cardData.imageUrl),
          imageUrl: l.cardData?.imageUrl?.substring(0, 50),
        })),
      });

      // Prefer exact affiliate link if provided in ideaData.origin
      productLink =
        (ideaData?.origin?.affiliateLinkId
          ? affiliateLinks.find(
              (l) => l.id === ideaData.origin.affiliateLinkId && l.cardData && l.cardData.imageUrl
            )
          : null) || affiliateLinks.find((link) => link.cardData && link.cardData.imageUrl);

      if (productLink && productLink.cardData && productLink.cardData.imageUrl) {
        selectedImageUrl = productLink.cardData.imageUrl;
        imageSourceType = 'affiliate';
        const reason =
          ideaData?.origin?.affiliateLinkId && productLink.id === ideaData.origin.affiliateLinkId
            ? 'origin_match'
            : 'best_candidate';
        Logger.info('[enhanceDraftWithFeatures] ✅ 3순위 이미지 선택: 제휴 링크 이미지', {
          id: productLink.id,
          url: selectedImageUrl.substring(0, 80),
          reason,
        });
      } else {
        Logger.debug('[enhanceDraftWithFeatures] 제휴 링크에 이미지 없음');
      }
    }

    // 선택된 이미지로 썸네일 생성
    let generatedImages = [];
    let isProductSynthesis = false;

    if (selectedImageUrl) {
      Logger.info(
        '[enhanceDraftWithFeatures] 선택된 이미지 소스:',
        imageSourceType,
        selectedImageUrl.substring(0, 50)
      );

      // 이미지 기반 합성 시도
      try {
        if (typeof onProgress === 'function')
          onProgress({
            step: 'image_synthesis',
            progress: 55,
            message: `${imageSourceType === 'editor' ? '에디터' : imageSourceType === 'scrap' ? '연결 자료' : '제휴 링크'} 이미지 합성 시작...`,
          });
      } catch (e) {
        void 0;
      }

      const imageBase64 = await fetchImageAsBase64(selectedImageUrl);
      if (imageBase64) {
        const synthesisPrompt = `Create a professional photograph featuring the subject from the provided reference image. Place it into: "${selectedThumbnail.thumbnailPromptEn}". Use photorealistic style.`;
        try {
          generatedImages = await generateAiImage(synthesisPrompt, 1, imageBase64);
          Logger.info('[enhanceDraftWithFeatures] 이미지 합성 완료:', generatedImages.length);
          try {
            if (typeof onProgress === 'function')
              onProgress({
                step: 'image_synthesis_complete',
                progress: 70,
                message: '이미지 합성 완료',
              });
          } catch (e) {
            void 0;
          }
          isProductSynthesis = true;
        } catch (err) {
          Logger.warn('[enhanceDraftWithFeatures] 이미지 합성 실패, AI 생성으로 전환', err);
        }
      }
    } else {
      Logger.info('[enhanceDraftWithFeatures] 참고 이미지 없음, AI 생성 모드로 진행');
    }

    if (!generatedImages || generatedImages.length === 0) {
      // [수정] 이중 안전장치: 오버레이 모드일 경우 프롬프트 강제 보정
      let finalImagePrompt = selectedThumbnail.thumbnailPromptEn;

      if (composeThumbnailText) {
        // 1. 기존 프롬프트에서 텍스트 렌더링 관련 지시어가 있다면 무력화 (선택적)
        // finalImagePrompt = finalImagePrompt.replace(/render text|typography|write/gi, '');

        // 2. [핵심] 강력한 텍스트 금지 명령을 프롬프트 끝에 강제로 추가
        finalImagePrompt +=
          ' . CRITICAL: Do NOT render any text, letters, words, or typography in this image. Keep the background clean and clutter-free.';

        Logger.debug(
          '[enhanceDraftWithFeatures] 텍스트 오버레이 모드: 텍스트 금지 프롬프트 강제 주입됨'
        );
      }

      // 수정된 프롬프트로 이미지 생성 요청
      try {
        // DEV: broadcast final image prompt for debug in workspace UI
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'debug_show_prompt',
              promptType: 'imageGeneration.final',
              prompt: finalImagePrompt,
            });
          }
        } catch (e) {}

        console.log(
          '[enhanceDraftWithFeatures DEBUG] calling generateAiImage with prompt',
          finalImagePrompt
        );
      } catch (e) {
        void 0;
      }
      generatedImages = await generateAiImage(finalImagePrompt, 1);
      try {
        console.log(
          '[enhanceDraftWithFeatures DEBUG] generateAiImage returned:',
          Array.isArray(generatedImages) ? generatedImages.length : typeof generatedImages
        );
      } catch (e) {
        void 0;
      }
      Logger.info('[enhanceDraftWithFeatures] AI generate images count:', generatedImages.length);
    }

    // 선택된 생성 이미지 중 첫 번째를 기본 소스 이미지로 사용
    const sourceImageUrl = generatedImages[0];
    Logger.info('[enhanceDraftWithFeatures] sourceImageUrl chosen:', sourceImageUrl);

    // --- Background generation using multiple reference images (EXPANDED MODE) ---
    let backgroundImageUrl = null;
    try {
      const referenceUrls = selectBackgroundReferenceImages(
        { formattedDraft, ideaData, affiliateLinks },
        3
      );
      if (referenceUrls && referenceUrls.length > 0) {
        Logger.info(
          '[enhanceDraftWithFeatures] background reference URLs:',
          referenceUrls.map((u) => u.substring(0, 80))
        );
        const refBase64s = await Promise.all(
          referenceUrls.map((u) => fetchImageAsBase64(u).catch(() => null))
        );
        const refImages = refBase64s.filter(Boolean);
        if (refImages.length > 0) {
          const bgPrompt =
            selectedThumbnail.thumbnailPromptEn +
            ` . Use the provided reference images as the background inspiration: prioritize texture, color palette, and atmosphere. CRITICAL: Do NOT render any text, letters, or typography in this image. Keep composition clean for overlaying text. ${selectedThumbnail.ratio || '16:9'} aspect ratio`;
          try {
            const bgRes = await generateAiImage(bgPrompt, 1, refImages);
            if (Array.isArray(bgRes) && bgRes[0]) {
              backgroundImageUrl = bgRes[0];
              Logger.info('[enhanceDraftWithFeatures] background generated:', backgroundImageUrl);
            }
          } catch (bgErr) {
            Logger.warn(
              '[enhanceDraftWithFeatures] background generation failed:',
              bgErr && bgErr.message ? bgErr.message : bgErr
            );
          }
        }
      }
    } catch (err) {
      Logger.warn(
        '[enhanceDraftWithFeatures] background reference processing failed:',
        err && err.message ? err.message : err
      );
    }

    // Compose text overlay if requested
    let composedDataUrl = backgroundImageUrl || sourceImageUrl;
    if (composeThumbnailText) {
      // Try to prefer a generated slogan when current thumbnailText looks like title fallback
      await selectSloganIfTitleFallback(
        selectedThumbnail,
        thumbnailCandidates,
        seoTitle,
        ideaData,
        formattedDraft
      );

      // Prefer user-provided or AI-generated thumbnail text; otherwise use a cleaned, truncated title as fallback.
      const thumbnailText = computeThumbnailTextForCompose(selectedThumbnail, seoTitle, ideaData);
      const textPosition = selectedThumbnail.textPosition || 'bottom';
      // safety: protect offscreen operations with a timeout to avoid indefinite hangs in tests or runtime
      try {
        try {
          console.log(
            '[enhanceDraftWithFeatures DEBUG] calling composeThumbnailInOffscreen for',
            sourceImageUrl
          );
        } catch (e) {
          void 0;
        }
        const COMPOSE_TIMEOUT_MS = 15000; // Increased timeout to avoid premature compose timeouts
        const composePromise = composeThumbnailInOffscreen(
          composedDataUrl,
          thumbnailText,
          textPosition
        );
        // Promise.race to ensure the operation doesn't hang forever
        composedDataUrl = await Promise.race([
          composePromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('compose timeout')), COMPOSE_TIMEOUT_MS)
          ),
        ]);
        try {
          console.log('[enhanceDraftWithFeatures DEBUG] composeThumbnailInOffscreen succeeded');
        } catch (e) {
          void 0;
        }
        Logger.info(
          '[enhanceDraftWithFeatures] composeThumbnailInOffscreen succeeded for:',
          sourceImageUrl
        );
      } catch (composeErr) {
        Logger.debug(
          '[enhanceDraftWithFeatures] composeThumbnailInOffscreen error:',
          composeErr && composeErr.message
        );
        Logger.warn(
          '[enhanceDraftWithFeatures] compose failed, will try fallback to source image dataUrl',
          composeErr && composeErr.message
        );
        try {
          const sourceBase64 = await fetchImageAsBase64(sourceImageUrl);
          try {
            console.log(
              '[enhanceDraftWithFeatures DEBUG] fetchImageAsBase64 result:',
              !!(sourceBase64 && sourceBase64.data)
            );
          } catch (e) {
            void 0;
          }
          Logger.debug(
            '[enhanceDraftWithFeatures] fetchImageAsBase64 fallback result:',
            sourceBase64 && !!sourceBase64.data
          );
          if (sourceBase64) {
            // fetchImageAsBase64 returns {mimeType, data} object; construct a data URL as a safe fallback (assume png)
            const candidateDataUrl = `data:image/png;base64,${sourceBase64.data}`;
            composedDataUrl = candidateDataUrl;
            Logger.info(
              '[enhanceDraftWithFeatures] compose fallback: source image converted to dataURL'
            );
          }
        } catch (fbErr) {
          Logger.warn(
            '[enhanceDraftWithFeatures] compose fallback failed:',
            fbErr && fbErr.message
          );
        }
        thumbnailGenerationPartialFailure = true;
      }
    }

    // [핵심 수정] 16:9 이미지 업로드 준비 (URL -> Base64 변환 시도)
    let final16x9Data = null; // 업로드용 데이터 (Base64)
    let final16x9Url = null; // 최종 URL

    if (
      composedDataUrl &&
      (composedDataUrl.startsWith('http') || composedDataUrl.startsWith('https'))
    ) {
      try {
        Logger.debug('[enhanceDraftWithFeatures] 16:9 이미지 업로드를 위해 Base64 변환 시도');
        const base64Result = await fetchImageAsBase64(composedDataUrl);
        if (base64Result && base64Result.data) {
          final16x9Data = `data:${base64Result.mimeType || 'image/png'};base64,${base64Result.data}`;
        } else {
          // 변환 실패 시 원본 URL 그대로 사용 (재업로드 건너뜀)
          Logger.warn('[enhanceDraftWithFeatures] Base64 변환 실패, 원본 URL 사용');
          final16x9Url = composedDataUrl;
        }
      } catch (e) {
        Logger.warn('[enhanceDraftWithFeatures] Base64 변환 중 오류, 원본 URL 사용:', e);
        final16x9Url = composedDataUrl;
      }
    } else {
      // 이미 Base64인 경우
      final16x9Data = composedDataUrl;
    }

    // Cropping (1x1, 4x3)
    const userId = await getCurrentUserId();
    // composedDataUrl이 http URL이어도 cropImageInOffscreen이 처리할 수 있도록 시도 (CORS 주의)
    // 안전을 위해 final16x9Data(Base64)가 있을 때만 크롭 시도
    const sourceForCrop = final16x9Data || composedDataUrl;
    // crop operations should have timeouts to avoid long-running tasks
    const CROP_TIMEOUT_MS = 6000;
    const cropPromises = [
      Promise.race([
        cropImageInOffscreen(sourceForCrop, 1),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('crop timeout')), CROP_TIMEOUT_MS)
        ),
      ]).then((dataUrl) => ({ ratio: '1x1', dataUrl })),
      Promise.race([
        cropImageInOffscreen(sourceForCrop, 4 / 3),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('crop timeout')), CROP_TIMEOUT_MS)
        ),
      ]).then((dataUrl) => ({ ratio: '4x3', dataUrl })),
    ];

    let croppedResults;
    try {
      croppedResults = await Promise.all(cropPromises);
    } catch (cropErr) {
      Logger.warn(
        '[enhanceDraftWithFeatures] one or more crop tasks failed, using fallback composed image',
        cropErr && cropErr.message
      );
      croppedResults = [
        { ratio: '1x1', dataUrl: composedDataUrl },
        { ratio: '4x3', dataUrl: composedDataUrl },
      ];
      thumbnailGenerationPartialFailure = true;
    }

    // Upload
    try {
      if (typeof onProgress === 'function')
        onProgress({
          step: 'thumbnail_upload_start',
          progress: 85,
          message: '썸네일 업로드 시작...',
        });
    } catch (e) {
      void 0;
    }
    const uploadPromises = [
      uploadImageToFirebaseStorage(
        croppedResults[0].dataUrl,
        `thumbnails/${userId}/${permalink}-1x1.png`,
        userId
      ),
      uploadImageToFirebaseStorage(
        croppedResults[1].dataUrl,
        `thumbnails/${userId}/${permalink}-4x3.png`,
        userId
      ),
    ];

    // 16:9 이미지 업로드 (Base64 데이터가 있으면 업로드, 없으면 원본 URL 사용)
    let url_16x9 = null;
    if (final16x9Data) {
      // Base64 데이터가 있으면 Firebase에 업로드
      url_16x9 = await uploadImageToFirebaseStorage(
        final16x9Data,
        `thumbnails/${userId}/${permalink}-16x9.png`,
        userId
      );
    } else if (final16x9Url) {
      // Base64 변환 실패 시 원본 URL 그대로 사용 (업로드 건너뜀)
      Logger.info('[enhanceDraftWithFeatures] 16:9 이미지 Base64 변환 실패로 원본 URL 사용');
      url_16x9 = final16x9Url;
    }

    const [url_1x1, url_4x3] = await Promise.all(uploadPromises);

    thumbnailUrls = {
      url_1x1,
      url_4x3,
      url_16x9,
      altText: sanitizeAltText(
        selectedThumbnail.altText,
        `${seoTitle || ideaData.title} 썸네일 이미지`
      ),
    };
    try {
      if (typeof onProgress === 'function')
        onProgress({
          step: 'thumbnail_upload_complete',
          progress: 95,
          message: '썸네일 업로드 완료',
        });
    } catch (e) {
      void 0;
    }

    // Update jsonLdSchema if present
    if (jsonLdSchema) {
      jsonLdSchema.image = [url_1x1, url_4x3, url_16x9];
    } else {
      // If the model did not provide JSON-LD, synthesize a minimal schema so
      // downstream consumers (publishers / export) have a reliable structured
      // representation for SEO.
      try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // Create a description candidate: prefer ideaData.description, fall back
        // to the first ~160 chars of the cleaned/formatted draft text (stripped of tags)
        let rawTextForDesc = (ideaData.description || '').toString().trim();

        if (!rawTextForDesc && formattedDraft) {
          // Strip HTML tags and take first paragraph
          const stripped = formattedDraft.replace(/<[^>]+>/g, '\n');
          const firstPara = (stripped || '').split(/\n\s*\n/)[0] || stripped;
          rawTextForDesc = (firstPara || '').trim();
        }

        let desc = (rawTextForDesc || '').substring(0, 200).trim();
        if (desc.length > 197) desc = desc.substring(0, 197) + '...';

        const authorName = channelInfo?.inputUrl
          ? new URL(channelInfo.inputUrl).hostname.replace('www.', '')
          : 'Content Pilot';

        const defaultSchema = {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: seoTitle || ideaData.title || '',
          description: desc || (seoTitle || ideaData.title || '').slice(0, 160),
          author: { '@type': 'Person', name: authorName },
          datePublished: today,
          dateModified: today,
        };

        // attach images when thumbnailUrls are available
        if (thumbnailUrls) {
          const imgs = [];
          if (thumbnailUrls.url_1x1) imgs.push(thumbnailUrls.url_1x1);
          if (thumbnailUrls.url_4x3) imgs.push(thumbnailUrls.url_4x3);
          if (thumbnailUrls.url_16x9) imgs.push(thumbnailUrls.url_16x9);
          if (imgs.length > 0) defaultSchema.image = imgs;
        }

        jsonLdSchema = defaultSchema;
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] 기본 JSON-LD 생성 실패:', e);
      }
    }

    // Insert into formattedDraft (first image or after h1)
    try {
      if (thumbnailUrls && thumbnailUrls.url_16x9) {
        if (typeof formattedDraft !== 'string' || !formattedDraft) formattedDraft = '';
        const imgTagRegex = /<img[^>]*>/i;
        const firstImgMatch = formattedDraft.match(imgTagRegex);
        const newImgTag = `<img src="${thumbnailUrls.url_16x9}" alt="${thumbnailUrls.altText || seoTitle || ideaData.title}" style="max-width: 100%; height: auto; display: block;">`;

        if (firstImgMatch) {
          formattedDraft = formattedDraft.replace(imgTagRegex, newImgTag);
        } else {
          const h1Match = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i);
          if (h1Match) {
            const h1EndIndex = formattedDraft.indexOf('</h1>') + 5;
            formattedDraft =
              formattedDraft.slice(0, h1EndIndex) +
              '\n' +
              newImgTag +
              '\n' +
              formattedDraft.slice(h1EndIndex);
          }
        }
      }
    } catch (insertErr) {
      Logger.warn('[enhanceDraftWithFeatures] HTML insertion failed:', insertErr);
    }

    try {
      if (typeof onProgress === 'function')
        onProgress({ step: 'done', progress: 100, message: '썸네일 생성 완료' });
    } catch (e) {
      void 0;
    }
    Logger.info('[enhanceDraftWithFeatures] 썸네일 생성 및 업로드 완료');
    return { formattedDraft, thumbnailUrls, thumbnailGenerationPartialFailure, jsonLdSchema };
  } catch (e) {
    Logger.error('[enhanceDraftWithFeatures] 썸네일 자동 생성 실패:', e);
    // Return best-effort values and mark partial failure
    return { formattedDraft, thumbnailUrls, thumbnailGenerationPartialFailure: true, jsonLdSchema };
  }
}

// [최적화] 제휴 링크 캐시 (메모리 기반, 5분 TTL)
const affiliateLinkCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5분

// [신규] 제휴 링크 조회 및 필터링 헬퍼 함수 (최적화 버전)
async function getRelevantAffiliateLinks(userId, contextText, options = {}) {
  try {
    // 캐시 확인
    const cacheKey = `${userId}`;
    const cached = affiliateLinkCache.get(cacheKey);
    const now = Date.now();

    let linksMap;
    if (cached && now - cached.timestamp < CACHE_TTL) {
      Logger.debug('[getRelevantAffiliateLinks] 캐시에서 링크 로드');
      linksMap = cached.data;
    } else {
      const snap = await get(ref(getDb(), `affiliate_links/${userId}`));
      linksMap = snap?.val();
      if (linksMap) {
        affiliateLinkCache.set(cacheKey, { data: linksMap, timestamp: now });
      }
    }

    if (!linksMap) {
      Logger.debug('[getRelevantAffiliateLinks] 제휴 링크 없음');
      return [];
    }

    const links = Object.values(linksMap);
    if (links.length === 0) {
      Logger.debug('[getRelevantAffiliateLinks] 제휴 링크 배열이 비어있음');
      return [];
    }

    // contextText 전처리: 제목, 태그, 설명을 개별 토큰으로 분리
    const contextLower = (contextText || '').toLowerCase();
    const contextTokens = contextLower
      .split(/[\s,]+/)
      .filter((t) => t.length > 1)
      .map((t) => t.trim());
    const preferredId = options.preferredAffiliateId || null;

    // 고급 스코어링 알고리즘
    const scored = links
      .map((link) => {
        const keywords = Array.isArray(link.keywords) ? link.keywords : [];
        let score = 0;
        let matchDetails = { exact: 0, partial: 0, position: 0 };

        // 1. 키워드 매칭 (정교화)
        keywords.forEach((keyword) => {
          try {
            const keywordLower = String(keyword).toLowerCase().trim();
            if (!keywordLower) return;

            // 완전 일치 (최고 점수)
            if (contextLower === keywordLower) {
              score += 10;
              matchDetails.exact += 1;
            }
            // 단어 단위 완전 일치
            else if (contextTokens.includes(keywordLower)) {
              score += 8;
              matchDetails.exact += 1;
            }
            // 부분 일치 (포함)
            else if (contextLower.includes(keywordLower)) {
              score += 3;
              matchDetails.partial += 1;

              // 앞쪽에 위치할수록 더 관련성이 높음
              const position = contextLower.indexOf(keywordLower);
              if (position === 0)
                score += 2; // 시작 위치
              else if (position < contextLower.length / 3) score += 1; // 앞 1/3 구간
            }
            // 역방향 매칭: context 토큰이 키워드에 포함되는 경우
            else {
              for (const token of contextTokens) {
                if (token.length > 2 && keywordLower.includes(token)) {
                  score += 1;
                  matchDetails.partial += 1;
                  break;
                }
              }
            }
          } catch (e) {
            /* ignore */
          }
        });

        // 2. 상품명 매칭 (더 높은 가중치)
        const productNameLower = (link.productName || '').toLowerCase().trim();
        if (productNameLower) {
          // 완전 일치
          if (contextLower === productNameLower) {
            score += 20;
            matchDetails.exact += 1;
          }
          // 포함
          else if (contextLower.includes(productNameLower)) {
            score += 12;
            matchDetails.partial += 1;
          }
          // 역방향: context 토큰이 상품명에 포함
          else {
            for (const token of contextTokens) {
              if (token.length > 2 && productNameLower.includes(token)) {
                score += 4;
                matchDetails.partial += 1;
                break;
              }
            }
          }
        }

        // 3. 설명(description) 매칭 (보조적)
        const descLower = (link.description || '').toLowerCase();
        if (descLower) {
          let descMatch = 0;
          for (const token of contextTokens) {
            if (token.length > 2 && descLower.includes(token)) {
              descMatch += 1;
            }
          }
          if (descMatch > 0) {
            score += Math.min(descMatch * 0.5, 3); // 최대 3점까지만
          }
        }

        // 4. 선호 ID 보너스
        if (preferredId && link.id === preferredId) {
          score += 1000;
        }

        // 5. 이미지 존재 시 약간의 보너스 (시각적 소구력)
        if (link.cardData?.imageUrl) {
          score += 0.5;
        }

        return { link, score, matchDetails };
      })
      // 유효성 검증 및 필터링
      .filter(({ link, score }) => {
        if (
          !link.keywords ||
          !Array.isArray(link.keywords) ||
          link.keywords.length === 0 ||
          !link.url
        ) {
          Logger.debug(`[getRelevantAffiliateLinks] 링크 필터링 제외 (키워드/URL 없음):`, link);
          return false;
        }
        // 최소 스코어 임계값 (0.5 이상만 허용)
        return score >= 0.5;
      });

    // 정렬: 점수 내림차순, 동점 시 최신순
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.link.createdAt || 0) - (a.link.createdAt || 0);
    });

    const relevantLinks = scored.map((s) => s.link);

    // 상세 로깅
    try {
      Logger.debug(
        '[getRelevantAffiliateLinks] 매칭 결과:',
        scored.slice(0, 10).map((s) => ({
          id: s.link.id,
          score: s.score.toFixed(2),
          exact: s.matchDetails.exact,
          partial: s.matchDetails.partial,
          hasImage: !!s.link.cardData?.imageUrl,
          productName: s.link.productName,
        }))
      );
    } catch (e) {
      Logger.debug('[getRelevantAffiliateLinks] score logging failed', e);
    }

    try {
      console.log(
        '[getRelevantAffiliateLinks DEBUG] link scores',
        scored.slice(0, 10).map((s) => ({
          id: s.link.id,
          score: s.score.toFixed(2),
          matchDetails: s.matchDetails,
          hasImage: !!s.link.cardData?.imageUrl,
        }))
      );
    } catch (e) {
      void 0;
    }

    // 최대 10개까지만 반환 (프롬프트 과부하 방지)
    // 단, 점수 차이가 너무 크면 상위 5개만 (품질 우선)
    let result = relevantLinks.slice(0, 10);
    if (scored.length > 5 && scored[0].score > scored[4].score * 2) {
      result = relevantLinks.slice(0, 5);
      Logger.info('[getRelevantAffiliateLinks] 고품질 매칭 감지: 상위 5개만 선택');
    }

    Logger.info(
      `[getRelevantAffiliateLinks] 관련 링크 ${result.length}개 선택됨 (전체 ${links.length}개 중, 스코어 범위: ${scored[0]?.score.toFixed(2)} ~ ${scored[result.length - 1]?.score.toFixed(2)})`
    );
    return result;
  } catch (error) {
    Logger.warn('[getRelevantAffiliateLinks] 제휴 링크 조회 실패:', error);
    return [];
  }
}

// [최적화] 캐시 무효화 함수 (제휴 링크 추가/수정/삭제 시 호출)
function invalidateAffiliateLinkCache(userId = null) {
  if (userId) {
    affiliateLinkCache.delete(`${userId}`);
    Logger.debug(`[invalidateAffiliateLinkCache] 사용자 ${userId}의 캐시 삭제됨`);
  } else {
    affiliateLinkCache.clear();
    Logger.debug('[invalidateAffiliateLinkCache] 전체 캐시 삭제됨');
  }
}

export { getRelevantAffiliateLinks, invalidateAffiliateLinkCache };
export { sanitizeThumbnailText, computeThumbnailTextForCompose, selectSloganIfTitleFallback };

// Export helper for testing
export { removeDuplicateYears };

/**
 * Post-process draft HTML to validate affiliate anchors and optionally insert affiliate links.
 * - Ensures anchor tags matching known affiliate URLs are marked/styled consistently
 * - Optionally inserts affiliate links (max limit) by finding keyword/productName matches
 * @param {string} html - sanitized HTML
 * @param {Array<Object>} affiliateLinks - array of affiliate link objects (must include url, keywords[], productName)
 * @param {Object} options - { maxLinks: number }
 * @returns {string} modified HTML
 */
export function postProcessAffiliateHtml(html = '', affiliateLinks = [], options = {}) {
  const { maxLinks = 3, internalLinks = [], referenceLinks = [], internalMin = 4 } = options || {};
  if (!html) return html;

  // If no links at all, return early
  if (!Array.isArray(affiliateLinks)) affiliateLinks = [];
  if (!Array.isArray(internalLinks)) internalLinks = [];
  if (!Array.isArray(referenceLinks)) referenceLinks = [];

  // [신규] 모든 링크가 비어있으면 조기 반환
  const totalLinks = affiliateLinks.length + internalLinks.length + referenceLinks.length;
  if (totalLinks === 0) {
    Logger.debug('[postProcessAffiliateHtml] 삽입할 링크가 없어 원본 HTML 반환');
    return html;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Normalize affiliate urls for quick lookup
    const normalizedAffiliates = (affiliateLinks || []).map((l) => ({
      url: (l.url || '').trim(),
      productName: l.productName || '',
      keywords: Array.isArray(l.keywords) ? l.keywords : [],
      platform: l.platform || '',
    }));

    // Normalize internal links (posts)
    const normalizedInternals = (internalLinks || []).map((p) => ({
      url: (p.url || p.fullLink || '').trim(),
      title: p.title || '',
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
    }));

    // Normalize reference links (scraps)
    const normalizedRefs = (referenceLinks || []).map((r) => ({
      url: (r.url || '').trim(),
      title: r.title || '',
    }));

    // Helper: check if href matches any affiliate URL (startsWith or exact)
    const findAffiliateByHref = (href) => {
      if (!href) return null;
      const hrefNorm = href.trim();
      return normalizedAffiliates.find((a) => hrefNorm === a.url || hrefNorm.startsWith(a.url));
    };

    // 1) Ensure existing anchors that match affiliate links are wrapped/styled
    const anchors = Array.from(doc.querySelectorAll('a[href]') || []);
    let insertedCount = 0;
    anchors.forEach((a) => {
      const match = findAffiliateByHref(a.getAttribute('href'));
      if (match && insertedCount < maxLinks) {
        // Wrap with span color style if not already
        const parent = a.parentElement;
        // 제휴 링크도 일반 링크와 동일하게 처리 (녹색 span 제거)
        // ensure target and rel are safe
        try {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        } catch (e) {
          // Ignore DOM attribute setting errors (fallback behavior)
          if (typeof Logger !== 'undefined') {
            Logger.warn('[postProcessAffiliateHtml] attribute set ignored', e);
          }
        }
        insertedCount += 1;
      }
    });

    // 2) If we need more, attempt deterministic insertion: internalLinks -> referenceLinks -> affiliateLinks
    if (insertedCount < maxLinks) {
      const usedUrls = new Set(
        Array.from(doc.querySelectorAll('a[href]'))
          .filter((el) => {
            const href = el.getAttribute('href') || '';
            return affiliateUrls.some((affUrl) => href.includes(affUrl));
          })
          .map((el) => el.getAttribute('href'))
      );

      const textNodes = [];
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        const parentTag = node.parentElement?.tagName?.toLowerCase();
        // skip inside code/pre/a/script/style
        if (['a', 'code', 'pre', 'script', 'style'].includes(parentTag)) continue;
        if (node.textContent && node.textContent.trim()) textNodes.push(node);
      }

      // H2-first text nodes (prefer inserting internal links near H2 headings)
      const h2TextNodes = [];
      const h2s = Array.from(doc.querySelectorAll('h2')) || [];
      for (const h2 of h2s) {
        const h2Walker = doc.createTreeWalker(h2, NodeFilter.SHOW_TEXT, null, false);
        let hn;
        while ((hn = h2Walker.nextNode())) {
          if (hn.textContent && hn.textContent.trim()) h2TextNodes.push(hn);
        }
      }

      // Helper to escape regex
      const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // [개선] 링크 삽입 함수 - 더 유연한 매칭 전략
      const tryInsertLinks = (links, makeAnchorText, linkType = 'general', textNodesParam = null) => {
        Logger.debug(`[postProcessAffiliateHtml] ${linkType} 링크 삽입 시도: ${links.length}개`);
        
        const nodesToUse = Array.isArray(textNodesParam) && textNodesParam.length > 0 ? textNodesParam : textNodes;
        for (const link of links) {
          if (insertedCount >= maxLinks) {
            Logger.debug(`[postProcessAffiliateHtml] 최대 링크 개수(${maxLinks}) 도달`);
            return;
          }
          const targetUrl = link.url;
          if (!targetUrl || usedUrls.has(targetUrl)) continue;

          // [개선] 더 많은 매칭 후보 생성
          const candidates = [
            ...(link.keywords || []),
            link.productName || link.title || '',
            link.platform || '',
          ].filter(Boolean);
          
          // [신규] 제품명을 단어로 분리하여 부분 매칭도 시도
          if (link.productName) {
            const words = link.productName.split(/\s+/).filter(w => w.length >= 2);
            candidates.push(...words);
          }
          
          if (candidates.length === 0) {
            Logger.debug(`[postProcessAffiliateHtml] ${linkType} 링크 매칭 후보 없음:`, targetUrl);
            continue;
          }

          // Sort candidates by length desc to prefer longer, more specific phrases
          candidates.sort((a, b) => b.length - a.length);
          const patterns = candidates.map((c) => new RegExp(escapeReg(c), 'i'));

          let matched = false;
          for (const tnode of nodesToUse) {
            const txt = tnode.textContent;
            for (let i = 0; i < patterns.length; i++) {
              const pattern = patterns[i];
              const m = txt.match(pattern);
              if (m) {
                const matchedPhrase = m[0];
                Logger.debug(`[postProcessAffiliateHtml] 매칭 성공: "${matchedPhrase}" -> ${targetUrl}`);
                
                // Use matched phrase as anchor text to preserve context
                const anchorText = makeAnchorText ? makeAnchorText(matchedPhrase, link) : matchedPhrase;

                const a = doc.createElement('a');
                a.setAttribute('href', targetUrl);
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
                a.textContent = anchorText;

                // Replace only the first match occurrence inside this text node
                const before = txt.slice(0, m.index);
                const after = txt.slice(m.index + matchedPhrase.length);
                const frag = doc.createDocumentFragment();
                if (before) frag.appendChild(doc.createTextNode(before));
                frag.appendChild(a);
                if (after) frag.appendChild(doc.createTextNode(after));

                if (tnode.parentNode) {
                  tnode.parentNode.replaceChild(frag, tnode);
                  insertedCount += 1;
                  usedUrls.add(targetUrl);
                  Logger.info(`[postProcessAffiliateHtml] ✅ ${linkType} 링크 삽입 성공 (${insertedCount}/${maxLinks}): "${anchorText}"`);
                  matched = true;
                  break;
                } else {
                  Logger.warn(
                    '[postProcessAffiliateHtml] 텍스트 노드의 parentNode가 존재하지 않아 대체 작업을 건너뜁니다.',
                    tnode
                  );
                }
              }
            }
            if (matched) break;
          }
          
          if (!matched) {
            Logger.debug(`[postProcessAffiliateHtml] ${linkType} 링크 매칭 실패:`, {
              url: targetUrl,
              candidates: candidates.slice(0, 3),
            });
          }
        }
      };

      // internalLinks: prefer using post title as anchor text if it fits; otherwise use matched phrase
      tryInsertLinks(normalizedInternals, (matchedText, link) => {
        // prefer full title if it contains matchedText or is short
        if (link.title && link.title.toLowerCase().includes(matchedText.toLowerCase()))
          return link.title;
        if (link.title && link.title.split(' ').length <= 4) return link.title; // short title
        return matchedText;
      }, 'internal');

      // If internal links remain insufficient, attempt targeted insertion into H2 sections first
      const existingInternalAnchors = (Array.from(doc.querySelectorAll('a[href]')) || []).filter((el) => {
        const href = el.getAttribute('href') || '';
        return normalizedInternals.some((il) => href.includes(il.url));
      }).length;

      if (existingInternalAnchors < internalMin) {
        const missing = internalMin - existingInternalAnchors;
        Logger.info('[postProcessAffiliateHtml] 내부 링크 부족 감지, 자동 보완 시도:', { existingInternalAnchors, missing });
        tryInsertLinks(normalizedInternals, (matchedText, link) => {
          if (link.title && link.title.toLowerCase().includes(matchedText.toLowerCase())) return link.title;
          if (link.title && link.title.split(' ').length <= 4) return link.title;
          return matchedText;
        }, 'internal', h2TextNodes);
      }

      // reference links: use matched phrase
      if (insertedCount < maxLinks) {
        tryInsertLinks(normalizedRefs, (m) => m, 'reference');
      }

      // affiliate links: use matched phrase; fallback to productName + CTA if matched phrase is too generic
      if (insertedCount < maxLinks) {
        tryInsertLinks(normalizedAffiliates, (matchedText, link) => {
          const genericWords = ['제품', '상품', '구매', '자세히'];
          const isGeneric = genericWords.some((w) => matchedText.toLowerCase().includes(w));
          if (isGeneric && link.productName) return `${link.productName} 최저가 확인하기`;
          return matchedText;
        }, 'affiliate');
      }
      
      // [신규] 삽입 결과 로깅 및 최소 개수 검증
      const minRequiredLinks = 2;
      Logger.info(`[postProcessAffiliateHtml] 링크 삽입 완료: ${insertedCount}/${maxLinks}개`);

      // Update any CHECK: Internal/ Affiliate/ External lines in the document
      try {
        const recalcTotals = () => {
          const totalAnchors = (doc.querySelectorAll('a[href]') || []).length;
          const affiliateAnchorCount = Array.from(doc.querySelectorAll('a[href]')).filter(tag => normalizedAffiliates.some(link => (tag.getAttribute('href') || '').includes(link.url))).length;
          const internalAnchorCount = Array.from(doc.querySelectorAll('a[href]')).filter(tag => normalizedInternals.some(link => (tag.getAttribute('href') || '').includes(link.url))).length;
          const referenceAnchorCount = Array.from(doc.querySelectorAll('a[href]')).filter(tag => normalizedRefs.some(link => (tag.getAttribute('href') || '').includes(link.url))).length;
          return { totalAnchors, affiliateAnchorCount, internalAnchorCount, referenceAnchorCount };
        };

        const totals = recalcTotals();
        const checkRegex = /CHECK:\s*Internal:\s*\d+\s*\/\s*Affiliate:\s*\d+\s*\/\s*External:\s*\d+/i;
        const walker2 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
        let tn2;
        while ((tn2 = walker2.nextNode())) {
          if (tn2.textContent && tn2.textContent.match(checkRegex)) {
            tn2.textContent = `CHECK: Internal:${totals.internalAnchorCount} / Affiliate:${totals.affiliateAnchorCount} / External:${totals.referenceAnchorCount}`;
            Logger.info('[postProcessAffiliateHtml] CHECK 라인 자동 갱신:', tn2.textContent);
          }
        }
      } catch (e) {
        Logger.debug('[postProcessAffiliateHtml] CHECK 라인 갱신 실패:', e);
      }

      if (totalLinks > 0 && insertedCount < minRequiredLinks) {
        Logger.warn(
          `[postProcessAffiliateHtml] ⚠️ 제휴 링크 최소 개수 미달: ${insertedCount}개 (최소 ${minRequiredLinks}개 필요)`,
          {
            affiliateLinksAvailable: affiliateLinks.length,
            internalLinksAvailable: internalLinks.length,
            referenceLinksAvailable: referenceLinks.length,
          }
        );
        
        // [선택] 사용자에게 경고 알림
        try {
          chrome.runtime.sendMessage({
            action: 'show_notification',
            title: '제휴 링크 삽입 부족',
            message: `제휴 링크가 ${insertedCount}개만 삽입되었습니다. 최소 ${minRequiredLinks}개 이상 필요합니다.`,
          }).catch(() => {});
        } catch (e) {
          // 알림 실패 무시
        }
      }
    }

    return doc.body.innerHTML || html;
  } catch (e) {
    // If anything fails, return original HTML and log
    Logger.warn('[postProcessAffiliateHtml] 처리 실패, 원본 HTML 반환:', e);
    return html;
  }
}

// 5. 초안 생성 (메인 로직)
// [삭제] function formatDraftForReadability(draftText) { ... }
// 더 이상 이 함수는 사용되지 않으며 OffscreenService로 대체됨

/**
 * 키워드 주변의 컨텍스트를 포함하여 텍스트에서 검색합니다.
 * @param {string} text - 검색할 텍스트
 * @param {string} keyword - 검색 키워드
 * @param {number} contextChars - 앞뒤로 포함할 문자 수 (기본 100자)
 * @returns {Array<string>} 매칭된 텍스트 조각 배열
 */
function findContextAroundKeyword(text, keyword, contextChars = 100) {
  const results = [];
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  let index = 0;
  while ((index = lowerText.indexOf(lowerKeyword, index)) !== -1) {
    const start = Math.max(0, index - contextChars);
    const end = Math.min(text.length, index + keyword.length + contextChars);
    const snippet = text.substring(start, end).trim();

    // 중복 제거
    if (!results.some((r) => r.includes(snippet) || snippet.includes(r))) {
      results.push(snippet);
    }

    index += keyword.length;
  }

  return results;
}

/**
 * 키워드를 의미 있는 단어로 분리합니다 (부분 매칭용)
 * @param {string} keyword - 분리할 키워드
 * @returns {Array<string>} 분리된 단어 배열
 */
function splitKeywordIntoWords(keyword) {
  // 특수문자 제거하고 공백으로 분리
  const cleaned = keyword.replace(/[^\w\sㄱ-ㅎ가-힣0-9]/g, ' ');
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2); // 2글자 이상만
  return words;
}

/**
 * 연결 자료에서 키워드 기반으로 관련 내용을 검색합니다.
 * @param {Array} scrapsContent - 연결된 자료 배열
 * @param {Object} searchTerms - 검색 키워드 객체 {keywords, longTail, searchQueries}
 * @returns {Array} 키워드별 매칭된 내용 배열
 */
function searchRelevantContent(scrapsContent, searchTerms) {
  const allTerms = [
    ...(searchTerms.keywords || []),
    ...(searchTerms.longTail || []),
    ...(searchTerms.searchQueries || []),
  ].filter((t) => t && t.trim());

  if (allTerms.length === 0) {
    Logger.debug('[searchRelevantContent] 검색 키워드가 없습니다.');
    return [];
  }

  // [CRITICAL DEBUG] 모든 키워드 출력
  console.log('🔍 [searchRelevantContent] 원본 키워드:', allTerms);

  // [개선] 키워드를 단어로 분리하여 부분 매칭
  const expandedTerms = [];
  const termOrigins = new Map(); // 각 단어가 어떤 원본 키워드에서 왔는지 추적

  allTerms.forEach((term) => {
    const words = splitKeywordIntoWords(term);
    console.log(`📝 "${term}" → [${words.join(', ')}]`);

    words.forEach((word) => {
      if (!expandedTerms.includes(word)) {
        expandedTerms.push(word);
        termOrigins.set(word, term);
      }
    });
  });

  console.log('🔍 [searchRelevantContent] 확장된 검색어 (중복 제거):', expandedTerms);

  const relevantSections = [];
  const fullText = scrapsContent.map((s) => s.text || '').join('\n\n');

  // [CRITICAL DEBUG] 연결 자료 샘플 출력
  console.log('📄 [searchRelevantContent] 연결 자료 텍스트 길이:', fullText.length);
  console.log('📄 [searchRelevantContent] 연결 자료 샘플 (첫 500자):', fullText.substring(0, 500));

  expandedTerms.forEach((word, index) => {
    const matches = findContextAroundKeyword(fullText, word, 150);
    if (matches.length > 0) {
      const originKeyword = termOrigins.get(word);
      const selectedMatches = matches.slice(0, 3);
      relevantSections.push({
        keyword: originKeyword, // 원본 키워드 유지
        searchWord: word, // 실제 검색된 단어
        content: selectedMatches, // 각 단어당 최대 3개 매칭
      });
      console.log(
        `✅ [${index + 1}/${expandedTerms.length}] "${word}" (from "${originKeyword}") → 매칭 ${matches.length}개`
      );
      // [NEW] 실제 매칭된 텍스트 샘플 출력
      selectedMatches.forEach((match, i) => {
        console.log(`   📌 샘플 ${i + 1}: "${match.substring(0, 100)}..."`);
      });
    } else {
      console.warn(`❌ [${index + 1}/${expandedTerms.length}] "${word}" → 매칭 없음`);
    }
  });

  Logger.info(
    `[searchRelevantContent] 키워드 ${allTerms.length}개 → 검색어 ${expandedTerms.length}개로 확장하여 ${relevantSections.length}개 섹션 추출`
  );
  return relevantSections;
}

/**
 * 목차에서 키워드를 추출합니다.
 * @param {string} sectionTitle - 섹션 제목
 * @returns {Array<string>} 추출된 키워드 배열
 */
function extractKeywordsFromSection(sectionTitle) {
  // 숫자, 특수문자 제거하고 의미 있는 단어만 추출
  const cleaned = sectionTitle.replace(/^\d+\.\s*/, '').replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ');
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  return words;
}

/**
 * 목차별로 관련 내용을 구조화합니다.
 * @param {Array} relevantSections - 키워드별 매칭된 내용
 * @param {Array} outline - 목차 배열
 * @returns {Object} 목차별 구조화된 내용
 */
function structureByOutline(relevantSections, outline) {
  if (!outline || outline.length === 0) {
    Logger.debug('[structureByOutline] 목차가 없습니다.');
    return {};
  }

  Logger.info('[structureByOutline] 목차:', outline);
  Logger.info('[structureByOutline] 매칭할 섹션 수:', relevantSections.length);

  const structured = {};

  outline.forEach((section, index) => {
    const sectionNumber = index + 1;
    const sectionKeywords = extractKeywordsFromSection(section);

    Logger.debug(`[structureByOutline] 섹션${sectionNumber} "${section}" 키워드:`, sectionKeywords);

    // 이 섹션과 관련된 내용 필터링
    const relatedContent = relevantSections.filter((item) =>
      sectionKeywords.some(
        (kw) =>
          item.keyword.toLowerCase().includes(kw.toLowerCase()) ||
          kw.toLowerCase().includes(item.keyword.toLowerCase())
      )
    );

    Logger.debug(`[structureByOutline] 섹션${sectionNumber} 매칭된 내용:`, relatedContent.length);

    if (relatedContent.length > 0) {
      structured[`섹션${sectionNumber}`] = {
        title: section,
        keywords: sectionKeywords,
        relatedContent: relatedContent,
      };
    }
  });

  Logger.info(
    `[structureByOutline] ${outline.length}개 목차 중 ${Object.keys(structured).length}개 섹션에 내용 매칭`
  );
  return structured;
}

/**
 * [내부 헬퍼] 초안 중간 저장 함수
 * AI 생성 과정 중 데이터 유실 방지를 위해 중간 결과를 Firebase에 저장합니다.
 */
async function saveIntermediateDraft(ideaId, draftContent) {
  if (!ideaId || !draftContent) return;
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;

    const snap = await get(ref(getDb(), `kanban/${userId}`));
    const allCards = snap?.val() || {};
    let foundStatus = null;
    let cardData = null;

    // 카드 위치 찾기
    for (const status in allCards) {
      if (allCards[status] && allCards[status][ideaId]) {
        foundStatus = status;
        cardData = allCards[status][ideaId];
        break;
      }
    }

    if (foundStatus && cardData) {
      await update(ref(getDb(), `kanban/${userId}/${foundStatus}/${ideaId}`), {
        draftContent: draftContent,
        workspace: {
          ...(cardData.workspace || {}),
          draft: draftContent,
        },
        updatedAt: serverTimestamp(),
      });
      Logger.info(`[saveIntermediateDraft] 초안 중간 저장 완료 (${foundStatus})`);
    }
  } catch (e) {
    Logger.warn('[saveIntermediateDraft] 저장 실패:', e);
  }
}

/**
 * 아이디어 데이터를 기반으로 AI 초안을 생성합니다.
 * @param {Object} ideaData - 초안 생성에 필요한 데이터
 * @param {string} ideaData.title - 콘텐츠 제목
 * @param {string} ideaData.description - 콘텐츠 설명
 * @param {string} ideaData.keywords - 키워드
 * @param {string} ideaData.persona - 페르소나 키
 * @param {string} ideaData.tone - 톤앤매너
 * @returns {Promise<Object>} 생성된 초안 데이터
 */
export async function generateDraftFromIdea(ideaData, options = {}) {
  try {
    // 1. 옵션 및 체크박스 상태 확인 [수정]
    // options에서 composeThumbnailText 값을 명확히 가져옵니다.
    const { generateDraft = true, generateThumbnail = true } = options;
    Logger.debug('[generateDraftFromIdea] received options:', options);
    // Debug: show ideaData basics
    try {
      console.log('[generateDraftFromIdea] DBG: ideaData summary:', {
        id: ideaData?.id,
        title: ideaData?.title,
        status: ideaData?.status,
      });
    } catch (e) {}

    // 사용자 설정 로드 (options에 값이 없으면 저장소에서 확인)
    let composeThumbnailText = options.composeThumbnailText;

    // Early safety: if caller explicitly requested thumbnail prompts and we have an idea id,
    // create an initial placeholder publishInfo.thumbnailPrompts so that DB update is recorded
    // quickly (helps UI show an intent and ensures tests can detect the update).
    if (
      options &&
      (options.generateThumbnailPrompts || options.generateThumbnail) &&
      ideaData &&
      ideaData.id
    ) {
      try {
        const earlyUid = await getCurrentUserId();
        const earlyStatus = ideaData.status || 'ideas';
        const earlyPath = `kanban/${earlyUid}/${earlyStatus}/${ideaData.id}`;
        const placeholder = { curiosity: [], info: [], empathy: [] };
        console.log(
          '[generateDraftFromIdea] Early placeholder persist for thumbnailPrompts:',
          earlyPath,
          placeholder
        );
        await update(
          ref(getDb(), earlyPath),
          cleanDataForFirebase({ publishInfo: { thumbnailPrompts: placeholder } })
        );
        try {
          await update(
            ref(getDb(), `${earlyPath}/workspace/draft/publishInfo`),
            cleanDataForFirebase({ thumbnailPrompts: placeholder })
          );
        } catch (nestedErr) {
          Logger.debug(
            '[generateDraftFromIdea] early nested persist failed:',
            nestedErr?.message || String(nestedErr)
          );
        }
        // If caller explicitly asked to only signal intent (generateDraft === false),
        // return early with the placeholder shape so callers get immediate feedback.
        if (options && options.generateDraft === false) {
          try {
            return {
              success: true,
              draft: ideaData.currentDraft || ideaData.draftContent || '',
              permalink: ideaData.permalink || null,
              tags: ideaData.tags || [],
              seoTitle: ideaData.seoTitle || ideaData.title || '',
              thumbnailInfo: ideaData.publishInfo?.thumbnailInfo || [],
              thumbnailUrls: null,
              thumbnailPartialFailure: false,
              jsonLdSchema: ideaData.publishInfo?.jsonLdSchema || null,
              metaDescription: ideaData.description || '',
              thumbnailPrompts: placeholder,
            };
          } catch (retErr) {
            Logger.debug('[generateDraftFromIdea] early return failed:', retErr);
          }
        }
      } catch (earlyErr) {
        Logger.debug(
          '[generateDraftFromIdea] early placeholder persist failed:',
          earlyErr?.message || String(earlyErr)
        );
      }
    }
    if (composeThumbnailText === undefined) {
      // 비동기 함수 내부이므로 await 사용 가능
      try {
        const storage = await chrome.storage.local.get('composeThumbnailText');
        composeThumbnailText = !!storage.composeThumbnailText;
      } catch (e) {
        composeThumbnailText = false;
      }
    }

    Logger.info('[generateDraftFromIdea] 실행 옵션:', {
      generateDraft,
      generateThumbnail,
      composeThumbnailText,
    });

    // 1. 기본 제목 및 페르소나 결정 (사용자 설정 > 자동 감지)
    // title 변수를 함수 최상단에서 선언하여 generateDraft 옵션에 상관없이 사용 가능하게 함
    const title = ideaData.title || '';
    let personaKey = ideaData.persona;

    // 사용자 설정이 없으면 자동 감지
    if (!personaKey || !PROMPT_CONFIG.personas[personaKey]) {
      // 사용자 설정에서 기본 톤앤매너 확인
      try {
        const storage = await chrome.storage.local.get(['defaultPersona', 'defaultTone']);
        personaKey = storage.defaultPersona || storage.defaultTone;
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] 사용자 설정 읽기 실패:', e);
      }

      // 여전히 없으면 자동 감지
      if (!personaKey || !PROMPT_CONFIG.personas[personaKey]) {
        const textToAnalyze = `${ideaData.title} ${ideaData.description} ${(
          ideaData.tags || []
        ).join(' ')}`;
        personaKey = detectPersona(textToAnalyze);
        Logger.debug(`[generateDraftFromIdea] 페르소나 자동 감지: ${personaKey}`);
      }
    }

    // 2. PromptBuilder 초기화
    const builder = new PromptBuilder(personaKey);

    // 3. 톤앤매너 오버라이드 (ideaData.tone이 있다면)
    if (ideaData.tone && PROMPT_CONFIG.tones[ideaData.tone]) {
      builder.setTone(ideaData.tone);
    }

    // 4. 트렌드 데이터 주입 (SEO 강화)
    const keywords = (ideaData.tags || []).filter((t) => t !== '#AI-추천');
    const trends = ideaData.recommendedSearches || []; // 연관 검색어 활용
    builder.setTrendContext(keywords, trends);

    // [핵심 수정] 3-1. 채널 정보 미리 가져오기 (내부 링크 매칭을 위해 위로 이동)
    let channelInfo = null;
    let targetSourceId = null;

    try {
      const userId = await getCurrentUserId();
      const channelsSnap = await get(ref(getDb(), `channels/${userId}`));
      const channelsData = channelsSnap?.val() || {};
      const myBlogs = channelsData.myChannels?.blogs || [];
      const myYoutubes = channelsData.myChannels?.youtubes || [];
      const allChannels = [...myBlogs, ...myYoutubes];

      // 카드의 channelId와 일치하는 채널 찾기 (UUID 비교)
      let currentChannelId = ideaData.channelId;
      if (!currentChannelId) {
        const storage = await chrome.storage.local.get('activeChannelId');
        currentChannelId = storage.activeChannelId;
      }

      if (currentChannelId) {
        channelInfo = allChannels.find((ch) => {
          // 1. UUID로 비교 (신규 방식)
          if (ch.id === currentChannelId) return true;
          // 2. apiUrl로 생성된 ID로 비교 (구버전 호환)
          const generatedId = ch.apiUrl ? btoa(ch.apiUrl).replace(/=/g, '') : null;
          return generatedId === currentChannelId;
        });

        // [중요] DB 매칭용 Source ID 계산 (RSS URL을 Base64로 변환)
        // 이렇게 해야 DB에 저장된 'aHR0cHM...' 형식과 일치하게 됩니다.
        if (channelInfo && channelInfo.apiUrl) {
          targetSourceId = btoa(channelInfo.apiUrl).replace(/=/g, '');
          Logger.debug(`[AI Service] 매칭용 Source ID 변환 완료: ${targetSourceId}`);
        }
      }
    } catch (error) {
      Logger.warn('[generateDraftFromIdea] 채널 정보 조회 실패:', error);
    }

    // 4-A. 제휴 마케팅 링크 데이터 준비
    const userId = await getCurrentUserId();
    const contextForLinks = `${ideaData.title} ${(ideaData.tags || []).join(
      ' '
    )} ${ideaData.description || ''}`;
    const affiliateLinks = await getRelevantAffiliateLinks(userId, contextForLinks, {
      preferredAffiliateId: ideaData?.origin?.affiliateLinkId,
    });
    try {
      Logger.info('[generateDraftFromIdea] affiliateLinks candidates:', {
        preferredAffiliateId: ideaData?.origin?.affiliateLinkId || null,
        candidates: (affiliateLinks || []).map((l) => ({
          id: l.id,
          imageUrl: l.cardData?.imageUrl || null,
        })),
      });
    } catch (e) {
      Logger.debug('[generateDraftFromIdea] affiliate candidate logging failed');
    }
    try {
      console.log('[generateDraftFromIdea DEBUG] affiliateLinks candidates', {
        preferredAffiliateId: ideaData?.origin?.affiliateLinkId || null,
        candidates: (affiliateLinks || []).map((l) => ({
          id: l.id,
          imageUrl: l.cardData?.imageUrl || null,
        })),
      });
    } catch (e) {
      void 0;
    }

    // 5. 글쓰기 스킬 주입 (동적 옵션)
    if (ideaData.skills && Array.isArray(ideaData.skills)) {
      ideaData.skills.forEach((skill) => builder.addSkill(skill));
    } else {
      // 기본 스킬 매핑
      if (personaKey === 'viral') {
        builder.addSkill('cliffhanger');
      }
      if (personaKey === 'professional') {
        builder.addSkill('statistics').addSkill('comparison');
      }
      if (personaKey === 'friendly') {
        builder.addSkill('questioning').addSkill('storytelling');
      }
    }

    // 6. 시스템 프롬프트 생성
    let systemPrompt = builder.buildSystemPrompt();
    
    // [신규] 현재 날짜와 시즌 컨텍스트 추가
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();
    
    // 시즌 판단
    let currentSeason = '';
    if (currentMonth >= 3 && currentMonth <= 5) currentSeason = '봄';
    else if (currentMonth >= 6 && currentMonth <= 8) currentSeason = '여름';
    else if (currentMonth >= 9 && currentMonth <= 11) currentSeason = '가을';
    else currentSeason = '겨울';
    
    // 시즌별 주의사항
    const seasonWarnings = {
      '봄': '크리스마스, 연말연시, 겨울 관련 콘텐츠는 부적절합니다.',
      '여름': '크리스마스, 연말연시, 겨울 관련 콘텐츠는 부적절합니다.',
      '가을': '크리스마스는 너무 이르며, 여름 관련 콘텐츠는 부적절합니다.',
      '겨울': '여름휴가, 휴가철 관련 콘텐츠는 부적절합니다. (단, 12월은 크리스마스 시즌으로 적절)'
    };
    
    const dateContext = `

📅 **[중요] 현재 날짜 및 시즌 정보**:
- 작성 일자: ${currentYear}년 ${currentMonth}월 (${currentDate})
- 현재 시즌: ${currentSeason}
- ⚠️ **시즌 부적합 콘텐츠 주의**: ${seasonWarnings[currentSeason]}
- **절대 규칙**: 현재 시즌과 맞지 않는 이벤트, 상품, 트렌드를 언급하지 마세요.
  * 예: 1월에 "크리스마스 시즌을 맞아..." 같은 표현 금지
  * 예: 여름에 "겨울 난방 팁" 같은 주제 금지
- 연도를 언급할 때는 반드시 ${currentYear}년을 사용하세요.
`;
    
    systemPrompt += dateContext;

    // 로깅
    Logger.biz(
      `🎭 [Persona Build]`,
      `Type: ${builder.getPersonaName()}, Custom Tone: ${ideaData.tone || builder.getToneName()}, Date: ${currentDate} (${currentSeason})`
    );

    // 데이터 준비: 필요 시 analytics data를 불러올 수 있지만 현재는 사용하지 않습니다.
    // const performanceData = await analyzePerformanceData(ideaData.channelId);

    // 1. 모든 키워드를 수집하고 중복을 제거합니다.
    // keywords (not directly used yet)
    // Keywords prepared but not used directly in prompt at this time

    // 2. 연결된 자료 텍스트를 프롬프트 형식으로 만듭니다.

    // [디버깅 코드 시작] -------------------------------------------------------
    const scraps = ideaData.linkedScrapsContent || [];
    Logger.debug(`[External Link Debug] 전달받은 연결 자료 개수: ${scraps.length}`);

    if (scraps.length > 0) {
      scraps.forEach((s, i) => {
        Logger.debug(`[External Link Debug] 자료 #${i + 1}:`, {
          title: s.title,
          url_exists: !!s.url, // URL 존재 여부 (true/false)
          url: s.url ? s.url.substring(0, 30) + '...' : '(URL 없음)',
          text_len: s.text ? s.text.length : 0,
        });
      });
    } else {
      Logger.warn(
        `[External Link Debug] 연결된 자료가 없습니다. (ideaData.linkedScrapsContent 비어있음)`
      );
    }
    // [디버깅 코드 끝] ---------------------------------------------------------

    // [스마트 정제 함수] 불필요한 공백/줄바꿈 제거 및 압축
    const compressText = (text) => {
      if (!text) return '';
      return text
        .replace(/\n+/g, ' ') // 모든 줄바꿈을 공백으로 변환
        .replace(/[ \t]+/g, ' ') // 연속된 스페이스/탭을 하나로 축소
        .replace(/URL 복사 이웃추가 본문 기타 기능/g, '') // 네이버 블로그 상단 노이즈 제거
        .trim();
    };

    // 2. 연결된 자료 텍스트 처리 (이미지 분석 추가)
    const linkedScrapsContent = ideaData.linkedScrapsContent || [];
    const processedScraps = [];

    // [추가] 이미지 분석 병렬 처리
    await Promise.all(
      linkedScrapsContent.map(async (scrap, index) => {
        let content = compressText(scrap.text || '');

        // 이미지 분석을 먼저 수행
        let imageAnalysis = '';
        if (scrap.image) {
          Logger.info(`[generateDraft] 스크랩 #${index + 1} 이미지 분석 시작...`);
          const analysisResult = await analyzeScrapImage(scrap.image);
          if (analysisResult) {
            imageAnalysis = `[이미지 분석 (Vision AI)]:\n${analysisResult}\n\n`;
          }
        }

        // 스마트 텍스트 압축: 중요 키워드 주변 컨텍스트 유지
        // ✅ 외부 비교 사이트 컨텐츠 제거 (노써치, 다나와 등)
        if (
          content.includes('노써치') ||
          content.includes('nosearch') ||
          content.includes('다나와')
        ) {
          console.log('[aiService] 외부 비교 사이트 컨텐츠 감지, 필터링 수행');

          // 1. 비교표 섹션 제거 (예: "추천 & 리뷰 : 인기 TOP 8")
          content = content.replace(
            /[^\n]*추천\s*&\s*리뷰\s*[:：]\s*인기\s*TOP\s*\d+[^\n]*[\s\S]*?(?=상품\s*리뷰|$)/gi,
            ''
          );

          // 2. 파워링크 광고 섹션 제거
          content = content.replace(/파워링크[\s\S]*?(?=상품\s*리뷰|$)/gi, '');

          // 3. 베스트픽/가성비픽 섹션 제거
          content = content.replace(
            /[①②③\d]+\s*\n[^\n]*베스트픽[①②③\d]*[^\n]*\n[\s\S]*?(?=\n\n|\d+\s*\n|$)/gi,
            ''
          );
          content = content.replace(
            /[①②③\d]+\s*\n[^\n]*가성비픽[①②③\d]*[^\n]*\n[\s\S]*?(?=\n\n|\d+\s*\n|$)/gi,
            ''
          );

          console.log('[aiService] 외부 비교 사이트 필터링 완료');
        }

        // 스마트 텍스트 압축
        if (content.length > 3500) {
          // 제품 관련 키워드 찾기
          const productKeywords = [
            '리뷰',
            '평점',
            '만족도',
            '사용자',
            '후기',
            '장점',
            '단점',
            '가격',
            '품질',
            '디자인',
            '기능',
            '성능',
            '추천',
          ];
          const keywordPositions = [];

          productKeywords.forEach((keyword) => {
            let pos = content.indexOf(keyword);
            while (pos !== -1) {
              keywordPositions.push(pos);
              pos = content.indexOf(keyword, pos + 1);
            }
          });

          if (keywordPositions.length > 0) {
            // 키워드 주변 컨텍스트 추출 (각 키워드 전후 300자)
            keywordPositions.sort((a, b) => a - b);
            const chunks = [];
            let lastEnd = 0;

            keywordPositions.forEach((pos) => {
              if (pos - lastEnd > 100) {
                // 겹치지 않는 경우만
                const start = Math.max(0, pos - 300);
                const end = Math.min(content.length, pos + 300);
                chunks.push(content.substring(start, end));
                lastEnd = end;
              }
            });

            // 앞부분 1000자 + 키워드 주변 컨텍스트
            content =
              content.substring(0, 1000) +
              '\n\n' +
              chunks.join('\n...\n') +
              '\n\n' +
              content.substring(content.length - 500);
          } else {
            // 키워드가 없으면 기존 방식
            content =
              content.substring(0, 2500) +
              '\n...(중략)...\n' +
              content.substring(content.length - 500);
          }
        }

        processedScraps[index] =
          `[참고 자료 ${index + 1}]\n제목: ${scrap.title || ''}\nURL: ${scrap.url || ''}\n\n${imageAnalysis}내용:\n${content}\n`;
      })
    );

    const linkedScrapsText = processedScraps.join('\n\n');

    // [신규] 참고 자료에서 제품명/브랜드 추출
    const extractedProducts = [];
    const extractedBrands = [];

    linkedScrapsContent.forEach((scrap, index) => {
      const text = scrap.title + ' ' + (scrap.text || '');

      // 1. 브랜드명 먼저 추출
      const brandPatterns = [
        /누아트/g,
        /SUMMIT/g,
        /신지모루/g,
        /ESR/g,
        /링케|슈피겐|UAG|토르|엘라고|벨킨|다이소|아이패치|모모트/g,
      ];

      brandPatterns.forEach((pattern) => {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          const brand = match[0].trim();
          if (!extractedBrands.includes(brand)) {
            extractedBrands.push(brand);
          }
        }
      });

      // 2. 제품명 전체 추출 (긴 제품명도 인식)
      // 패턴 1: 브랜드명 + 여러 단어 + 제품 종류
      const longProductPattern =
        /([가-힣A-Za-z]+)\s+([가-힣A-Za-z0-9\s]+?)\s*(케이스|카드\s*케이스|충전기|거치대|필름|액세서리)/g;
      const longMatches = text.matchAll(longProductPattern);
      for (const match of longMatches) {
        const fullProduct = match[0].trim();
        // 10자 이상 80자 이하의 제품명만 추출
        if (
          fullProduct.length >= 10 &&
          fullProduct.length <= 80 &&
          !extractedProducts.includes(fullProduct)
        ) {
          extractedProducts.push(fullProduct);
        }
      }

      // 3. 제목에서 직접 추출 (가장 정확한 제품명)
      if (scrap.title) {
        // 제목 전체가 제품명인 경우
        const titleCleaned = scrap.title.replace(/^(상품 리뷰|리뷰|후기)[\s:：]+/, '').trim();
        if (
          titleCleaned.length >= 10 &&
          titleCleaned.length <= 80 &&
          !extractedProducts.includes(titleCleaned)
        ) {
          extractedProducts.push(titleCleaned);
        }

        // 콜론 앞부분이 제품명인 경우
        const titleMatch = scrap.title.match(/^([가-힣A-Za-z0-9\s]+)[:：]/);
        if (titleMatch && titleMatch[1].trim().length >= 10) {
          const productName = titleMatch[1].trim();
          if (!extractedProducts.includes(productName)) {
            extractedProducts.push(productName);
          }
        }
      }
    });

    Logger.info('[generateDraft] 추출된 제품명:', extractedProducts);
    Logger.info('[generateDraft] 추출된 브랜드:', extractedBrands);

    // [신규] 리뷰 통계 추출 및 구조화
    const productReviewStats = [];
    linkedScrapsContent.forEach((scrap) => {
      const text = scrap.text || '';

      // 리뷰 통계 패턴 매칭
      const reviewCountMatch = text.match(/상품\s*리뷰\s*\n\s*(\d{1,5})/);
      const satisfactionMatch = text.match(/최고\s*\n\s*(\d{1,3})%/);
      const robustnessMatch = text.match(/견고함\s*\n\s*아주\s*견고해요\s*\n\s*(\d{1,3})%/);
      const designMatch = text.match(/디자인\s*\n\s*아주만족해요\s*\n\s*(\d{1,3})%/);

      // 제품명 추출 (타이틀에서)
      let productName = null;
      for (const product of extractedProducts) {
        if (scrap.title && scrap.title.includes(product.split(' ')[0])) {
          productName = product;
          break;
        }
      }

      if (reviewCountMatch && satisfactionMatch && productName) {
        const stats = {
          productName: productName,
          reviewCount: parseInt(reviewCountMatch[1]),
          satisfaction: parseInt(satisfactionMatch[1]),
          robustness: robustnessMatch ? parseInt(robustnessMatch[1]) : null,
          design: designMatch ? parseInt(designMatch[1]) : null,
        };

        // 중복 체크
        const exists = productReviewStats.find((s) => s.productName === productName);
        if (!exists) {
          productReviewStats.push(stats);
          Logger.info('[generateDraft] 리뷰 통계 추출:', stats);
        }
      }
    });

    // 구조화된 제품 정보 생성
    let structuredProductInfo = '';
    if (productReviewStats.length > 0) {
      structuredProductInfo =
        '\n\n📊 **[중요] 참고 자료의 주요 제품 정보 (이 정보를 초안 전체에 반드시 활용하세요)**\n\n';
      productReviewStats.forEach((stat, idx) => {
        structuredProductInfo += `제품 ${idx + 1}: ${stat.productName}\n`;
        structuredProductInfo += `  - 리뷰 개수: ${stat.reviewCount.toLocaleString()}개\n`;
        structuredProductInfo += `  - 최고 평점: ${stat.satisfaction}%\n`;
        if (stat.robustness) structuredProductInfo += `  - 견고함 만족도: ${stat.robustness}%\n`;
        if (stat.design) structuredProductInfo += `  - 디자인 만족도: ${stat.design}%\n`;
        structuredProductInfo += '\n';
      });
      structuredProductInfo +=
        '⚠️ 초안 작성 시 위 제품들의 리뷰 통계를 본문 전체에 걸쳐 반복적으로 언급하세요.\n';
      structuredProductInfo +=
        '예시: "누아트 케이스는 1,656개의 리뷰에서 75%가 최고 평점을 주었습니다."\n\n';
    }

    // [신규] 키워드 기반 검색 및 목차별 구조화
    let structuredByOutlineText = '';
    try {
      Logger.info('[RAG] 연결 자료 개수:', linkedScrapsContent.length);

      // 브리핑 메타데이터 추출 (키워드가 배열일 수도 있고 문자열일 수도 있음)
      let keywordsArray = [];
      if (ideaData.keywords) {
        if (Array.isArray(ideaData.keywords)) {
          keywordsArray = ideaData.keywords.map((k) => String(k).trim());
        } else if (typeof ideaData.keywords === 'string') {
          keywordsArray = ideaData.keywords.split(',').map((k) => k.trim());
        }
      }

      const searchTerms = {
        keywords: keywordsArray,
        longTail: Array.isArray(ideaData.longTailKeywords) ? ideaData.longTailKeywords : [],
        searchQueries: Array.isArray(ideaData.searchQueries) ? ideaData.searchQueries : [],
        outline: Array.isArray(ideaData.outline) ? ideaData.outline : [],
      };

      Logger.info('[RAG] 브리핑 메타데이터:', {
        keywords: searchTerms.keywords.length,
        keywordsSample: searchTerms.keywords.slice(0, 3),
        longTail: searchTerms.longTail.length,
        searchQueries: searchTerms.searchQueries.length,
        outline: searchTerms.outline.length,
      });

      // 키워드가 있고 연결 자료가 있을 때만 실행
      if (
        (searchTerms.keywords.length > 0 || searchTerms.longTail.length > 0) &&
        linkedScrapsContent.length > 0
      ) {
        Logger.info('[RAG] 조건 통과 - 키워드 기반 검색 시작');
        
        // [FIX] 압축된 텍스트를 담은 객체 배열로 변환 (compressText 적용됨)
        const compressedScraps = linkedScrapsContent.map((scrap, index) => ({
          ...scrap,
          text: compressText(scrap.text || ''),
        }));
        
        // 1. 키워드 기반 검색 (압축된 텍스트 사용)
        const relevantSections = searchRelevantContent(compressedScraps, searchTerms);

        // 2. 목차별 구조화 (목차가 있는 경우)
        if (searchTerms.outline.length > 0 && relevantSections.length > 0) {
          const structured = structureByOutline(relevantSections, searchTerms.outline);

          if (Object.keys(structured).length > 0) {
            structuredByOutlineText =
              '\n\n📚 **섹션별 참고 자료 (각 섹션 작성 시 반드시 활용하세요)**\n\n';

            Object.entries(structured).forEach(([sectionKey, data]) => {
              structuredByOutlineText += `### ${sectionKey}: ${data.title}\n`;
              structuredByOutlineText += `관련 키워드: ${data.keywords.join(', ')}\n\n`;
              structuredByOutlineText += `참고할 내용:\n`;

              data.relatedContent.forEach((item) => {
                structuredByOutlineText += `▪ [${item.keyword}]\n`;
                item.content.forEach((snippet) => {
                  structuredByOutlineText += `  "${snippet.substring(0, 200)}..."\n`;
                });
                structuredByOutlineText += '\n';
              });

              structuredByOutlineText += '\n';
            });

            Logger.info('[RAG] 목차별 구조화 완료:', Object.keys(structured).length + '개 섹션');
          } else {
            Logger.debug('[RAG] 구조화 결과 없음');
          }
        } else {
          Logger.debug('[RAG] 목차가 없거나 관련 섹션이 없음');
        }
      } else {
        Logger.warn(
          '[RAG] 조건 미충족 - keywords:',
          searchTerms.keywords.length,
          'linkedScraps:',
          linkedScrapsContent.length
        );
      }
    } catch (ragError) {
      Logger.error('[RAG] 키워드 기반 검색 실패:', ragError);
      console.error('[RAG] Error details:', ragError);
    }

    // 3. 원본 본문 참조: origin.fullContent가 있으면 참고 자료에 추가
    let originalContentText = '';
    if (ideaData.origin?.fullContent && ideaData.origin.fullContent.length > 0) {
      originalContentText = `[원본 본문 (리뉴얼 참고용)]\n${ideaData.origin.fullContent.substring(
        0,
        5000
      )}\n\n`;
    }

    // 4. [스마트 내부 링크] 내 과거 포스팅 목록 조회 (수정됨 - 발행된 포스팅 포함)
    let myPastPostsText = '';
    try {
      const userId = await getCurrentUserId();
      
      // [개선] 두 곳에서 포스팅 수집: channel_content (외부 수집) + published (직접 발행)
      const contentSnap = await get(ref(getDb(), `channel_content/${userId}/blogs`));
      const publishedSnap = await get(ref(getDb(), `kanban/${userId}/published`));
      
      const allBlogs = contentSnap?.val() || {};
      const publishedPosts = publishedSnap?.val() || {};
      
      // 디버깅: 원본 데이터 확인
      console.log('[Internal Link DEBUG] channel_content 원본 키 개수:', Object.keys(allBlogs).length);
      console.log('[Internal Link DEBUG] channel_content 샘플 데이터:', Object.keys(allBlogs).slice(0, 3));
      console.log('[Internal Link DEBUG] published 원본 키 개수:', Object.keys(publishedPosts).length);
      console.log('[Internal Link DEBUG] ideaData.channelId:', ideaData.channelId);
      console.log('[Internal Link DEBUG] targetSourceId:', targetSourceId);
      
      // 외부 수집 콘텐츠
      const externalPosts = Object.values(allBlogs)
        .filter((item) => item !== null && item.title && item.fullLink)
        .map(item => ({
          title: item.title,
          url: item.fullLink || item.link,
          description: item.description || item.cleanText?.substring(0, 100) || '',
          publishedAt: item.publishedAt || item.createdAt || 0,
          sourceId: item.sourceId, // 채널 필터링용
          source: 'external'
        }));
      
      console.log('[Internal Link DEBUG] externalPosts 필터 후:', externalPosts.length);
      if (externalPosts.length > 0) {
        console.log('[Internal Link DEBUG] externalPosts 첫 번째 sourceId:', externalPosts[0].sourceId);
      }
      
      // 직접 발행한 포스팅 (publishedUrl이 있는 것만)
      const myPublishedPosts = Object.values(publishedPosts)
        .filter((item) => item !== null && item.title && item.publishedUrl)
        .map(item => ({
          title: item.title,
          url: item.publishedUrl,
          description: item.description || item.seoDescription || '',
          publishedAt: item.publishedAt || item.updatedAt || item.createdAt || 0,
          source: 'published'
        }));
      
      // 두 목록 합치기
      const allPosts = [...externalPosts, ...myPublishedPosts];
      
      // 아이디어 키워드 추출 (제목 + 설명에서)
      const ideaKeywords = [];
      if (ideaData.title) {
        ideaKeywords.push(...ideaData.title.toLowerCase().split(/\s+/).filter(w => w.length > 1));
      }
      if (ideaData.description) {
        ideaKeywords.push(...ideaData.description.toLowerCase().split(/\s+/).filter(w => w.length > 1));
      }
      
      console.log('[Internal Link DEBUG] 아이디어 키워드:', ideaKeywords.slice(0, 10));
      
      // 채널 필터링 + 관련성 점수 계산
      const myPosts = allPosts
        .filter((item) => {
          // 직접 발행한 포스팅은 모두 포함
          if (item.source === 'published') return true;
          
          // 외부 콘텐츠는 채널 필터링
          if (!ideaData.channelId) return true;
          if (targetSourceId && item.sourceId === targetSourceId) return true;
          if (item.sourceId === ideaData.channelId) return true;
          
          return false;
        })
        .map(item => {
          // 관련성 점수 계산
          const postText = `${item.title} ${item.description}`.toLowerCase();
          let relevanceScore = 0;
          
          for (const keyword of ideaKeywords.slice(0, 20)) { // 상위 20개 키워드만 사용
            if (postText.includes(keyword)) {
              relevanceScore++;
            }
          }
          
          return { ...item, relevanceScore };
        })
        .filter(item => item.relevanceScore > 0) // 관련성 0인 글 제외
        .sort((a, b) => {
          // 관련성 우선, 그 다음 최신순
          if (b.relevanceScore !== a.relevanceScore) {
            return b.relevanceScore - a.relevanceScore;
          }
          return b.publishedAt - a.publishedAt;
        })
        .slice(0, 15); // 관련성 높은 상위 15개 (다양한 링크 선택 위해 증가)

      Logger.debug(`[Internal Link] 외부 수집: ${externalPosts.length}개, 직접 발행: ${myPublishedPosts.length}개, 최종 매칭: ${myPosts.length}개`);
      console.log('[Internal Link DEBUG] 관련성 점수:', myPosts.map(p => `${p.title.substring(0, 30)}... (${p.relevanceScore}점)`));

      if (myPosts.length > 0) {
        myPastPostsText = `[내 과거 포스팅 목록 (내부 링크 추천용)]\n`;
        myPastPostsText += myPosts
          .map((post, idx) => {
            const title = post.title || '제목 없음';
            const url = post.url || post.fullLink || post.link || '';
            const description = post.description || post.cleanText?.substring(0, 100) || '';
            return `${idx + 1}. 제목: ${title}\n   URL: ${url}\n   설명: ${description}\n`;
          })
          .join('\n');
        myPastPostsText += '\n';
        
        console.log('[Internal Link DEBUG] myPastPostsText 생성 완료:', myPastPostsText.substring(0, 500));
      } else {
        console.log('[Internal Link DEBUG] myPosts.length === 0, 내부 링크 목록 생성 안 됨');
      }
    } catch (error) {
      Logger.warn('[generateDraftFromIdea] 내 과거 포스팅 조회 실패:', error);
      // 오류가 발생해도 계속 진행
    }
    const recommendedSearches = ideaData.recommendedSearches || [];
    const longTailKeywords = ideaData.longTailKeywords || [];
    const tags = (ideaData.tags || []).filter((t) => t !== '#AI-추천');

    // 6. 프롬프트 구성
    // performanceInfo prepared but not used directly in prompt at this time

    // [추가] 현재 날짜 문자열 생성 (currentYear는 이미 위에서 선언됨)
    const today = new Date();
    const currentDateString = today.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Determine whether thumbnail prompts were requested (capture early to avoid mutation of options)
    const shouldGenerateThumbnailPrompts = !!(
      options &&
      (options.generateThumbnailPrompts || options.generateThumbnail)
    );
    Logger.debug(
      '[generateDraftFromIdea] shouldGenerateThumbnailPrompts:',
      shouldGenerateThumbnailPrompts
    );
    // Ensure visibility in tests (console) as well
    console.log(
      '[generateDraftFromIdea] shouldGenerateThumbnailPrompts (console):',
      shouldGenerateThumbnailPrompts,
      'options:',
      options
    );

    // Holder for generated thumbnail prompts so we can persist reliably at the end
    let generatedThumbUpdates = null;

    // 백업 파일의 상세한 프롬프트 구성
    // [신규] 썸네일 프롬프트 가이드 동적 생성 (체크박스 상태에 따라 분기)
    const thumbnailPromptGuide = composeThumbnailText
      ? `
        - **IMPORTANT**: The generated image MUST NOT contain any text, letters, or characters. 
        - Keep the background clean and simple because text will be overlaid programmatically later.
        - Focus on the visual elements and composition.
      `
      : `
        - **Text Rendering Rules (CRITICAL)**:
          1. You MUST instruct the model to render the title text explicitly using the format: "Render the text: 'TEXT_CONTENT'".
          2. For Korean text, emphasize strict typography to prevent typos (e.g., "Bold, clear Korean typography", "Legible text").
          3. If the text is too long (over 8 chars), summarize it into a short keyword.
      `;

    // Optional: generate thumbnail prompt concepts early when requested in options
    if (shouldGenerateThumbnailPrompts) {
      Logger.debug(
        '[generateDraftFromIdea] generate-thumbnail flag present - generating thumbnail prompts',
        {
          generateThumbnail: options.generateThumbnail,
          generateThumbnailPrompts: options.generateThumbnailPrompts,
        }
      );
      try {
        const contextText = `${title}${ideaData.description ? ' - ' + ideaData.description : ''}`;

        const prompts = {
          curiosity: `Generate a JSON array of 4 short curiosity-stimulating thumbnail phrases (Korean), for the topic: "${contextText}". Return JSON array only, e.g. ["...","..."]`,
          info: `Generate a JSON array of 4 concise informational thumbnail phrases (Korean) that summarize the topic: "${contextText}". Return JSON array only.`,
          empathy: `Generate a JSON array of 4 emotional/empathetic thumbnail phrases (Korean) for the topic: "${contextText}". Return JSON array only.`,
        };

        const thumbUpdates = { curiosity: [], info: [], empathy: [] };

        for (const [key, p] of Object.entries(prompts)) {
          try {
            const res = await callGeminiAPI(p);
            console.log(
              '[generateDraftFromIdea] DBG: callGeminiAPI returned for key',
              key,
              '->',
              String(res).slice(0, 200)
            );
            let arr = tryParseArray(String(res || ''));
            console.log(
              '[generateDraftFromIdea] DBG: tryParseArray result for key',
              key,
              '->',
              Array.isArray(arr) ? JSON.stringify(arr).slice(0, 200) : String(arr).slice(0, 200)
            );
            if (!Array.isArray(arr)) {
              arr = String(res || '')
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);
              console.log(
                '[generateDraftFromIdea] DBG: fallback split result for key',
                key,
                '->',
                JSON.stringify(arr).slice(0, 200)
              );
            }
            if (Array.isArray(arr)) {
              thumbUpdates[key] = arr.map((s) => String(s).replace(/\s+/g, ' ').trim()).slice(0, 6);
            }
          } catch (e) {
            Logger.warn(
              '[generateDraftFromIdea] thumbnail prompt generation failed for ' + key + ':',
              e
            );
          }
        }

        // fallback: if AI didn't produce any thumbnail prompts, try to extract from existing thumbnailCandidates
        if (
          (!thumbUpdates.curiosity || thumbUpdates.curiosity.length === 0) &&
          (!thumbUpdates.info || thumbUpdates.info.length === 0) &&
          (!thumbUpdates.empathy || thumbUpdates.empathy.length === 0)
        ) {
          try {
            if (Array.isArray(thumbnailCandidates) && thumbnailCandidates.length > 0) {
              // use only candidates that are not meta-templates
              const cleanCandidates = (thumbnailCandidates || []).filter(
                (c) => !looksLikeMetaTemplateCandidate(c)
              );
              const findByType = (keys) => {
                const found = cleanCandidates.find((t) =>
                  keys.some((k) =>
                    String(t.type || '')
                      .toLowerCase()
                      .includes(k)
                  )
                );
                if (!found) return [];
                const src =
                  found.thumbnailPromptKo || found.thumbnailPromptEn || found.thumbnailText || '';
                return src ? [String(src).trim()] : [];
              };
              thumbUpdates.curiosity = findByType(['curiosity', 'curio']);
              thumbUpdates.info = findByType(['inform', 'info', 'informative']);
              thumbUpdates.empathy = findByType(['emot', 'empath', '감성', 'emotional']);
              console.log(
                '[generateDraftFromIdea] DBG: fallback thumbUpdates (early) from thumbnailCandidates:',
                thumbUpdates
              );
            }
          } catch (fallbackErr) {
            Logger.warn(
              '[generateDraftFromIdea] fallback thumbnailCandidates extraction failed:',
              fallbackErr
            );
          }
        }

        // persist when present (or when generateDraft explicitly disabled)
        // If generateDraft was explicitly disabled, we want to persist early even if ideaData.id is not present (caller may be using intent only)
        if (options.generateDraft === false && !generatedThumbUpdates) {
          // no-op: generatedThumbUpdates should be handled at finalization
        }

        if (
          (thumbUpdates.curiosity && thumbUpdates.curiosity.length > 0) ||
          (thumbUpdates.info && thumbUpdates.info.length > 0) ||
          (thumbUpdates.empathy && thumbUpdates.empathy.length > 0)
        ) {
          try {
            const status = ideaData.status || 'ideas';
            const cardId = ideaData.id;
            console.log(
              '[generateDraftFromIdea] DBG: persist early block - cardId/status:',
              cardId,
              status
            );
            if (!cardId) throw new Error('ideaData.id is required to persist thumbnail prompts');
            const updatePath = `kanban/${await getCurrentUserId()}/${status}/${cardId}`;
            Logger.debug('[generateDraftFromIdea] Persisting thumbnailPrompts to:', updatePath);
            console.log(
              '[generateDraftFromIdea] DBG: about to call update(top-level) with publishInfo.thumbnailPrompts:',
              updatePath,
              thumbUpdates
            );
            await update(
              ref(getDb(), updatePath),
              cleanDataForFirebase({ publishInfo: { thumbnailPrompts: thumbUpdates } })
            );
            // also persist to nested workspace/draft/publishInfo
            try {
              await update(
                ref(getDb(), `${updatePath}/workspace/draft/publishInfo`),
                cleanDataForFirebase({ thumbnailPrompts: thumbUpdates })
              );
            } catch (nestedErr) {
              Logger.debug(
                '[generateDraftFromIdea] nested thumbnailPrompts update failed:',
                nestedErr?.message || String(nestedErr)
              );
            }
            // assign early generated updates to holder so finalResponse includes them
            generatedThumbUpdates = thumbUpdates;
          } catch (e) {
            Logger.warn('[generateDraftFromIdea] thumbnailPrompts persistence failed:', e);
          }
        }
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] thumbnail prompts generation overall failed:', e);
      }
    }

    const prompt = `
            ${systemPrompt}
            
            ${
              myPastPostsText
                ? `
${buildLinkRules(myPastPostsText, affiliateLinks, linkedScrapsText)}

${myPastPostsText}`
                : ''
            }
            
            ${
              linkedScrapsText || originalContentText
                ? `
            ═══════════════════════════════════════════════════════════════
            🚨 **[최우선 참고 자료 - 반드시 활용하세요]** 🚨
            ═══════════════════════════════════════════════════════════════
            
            아래 참고 자료는 이번 초안 작성의 **핵심 근거**입니다.
            
            ${structuredProductInfo}
            
            ${structuredByOutlineText}
            
            ⚠️⚠️⚠️ **초안 작성 후 반드시 자가 점검** ⚠️⚠️⚠️
            
            초안을 모두 작성한 뒤, 아래 체크리스트로 스스로 확인하세요:
            
            ${
              productReviewStats.length > 0
                ? `
            ${productReviewStats
              .map(
                (stat, i) => `
            [ ] ${stat.productName}이 본문에 최소 2번 이상 등장했나?
            [ ] ${stat.productName} 언급할 때 리뷰 숫자(${stat.reviewCount.toLocaleString()}개, ${stat.satisfaction}%)를 함께 썼나?`
              )
              .join('\n            ')}
            `
                : ''
            }
            
            [ ] 초반/중반/후반 섹션 모두에 위 제품이 골고루 등장했나?
            [ ] 일반론만 나열하고 제품을 마지막에만 짧게 언급하지 않았나?
            [ ] 외부 비교 사이트(노써치, 다나와, ESR, 신지모루, 다이소)를 추천하지 않았나?
            
            ❌ 위 체크리스트 중 하나라도 X라면 → 해당 부분을 다시 작성하세요
            
            ${
              extractedProducts.length > 0
                ? `
            📌 **참고 자료에서 추출된 제품/브랜드 목록** (이 제품들만 추천하세요):
            ${extractedProducts.map((p, i) => `   ${i + 1}. ${p}`).join('\n')}
            ${
              extractedBrands.length > 0
                ? `
            🏷️ **추출된 브랜드**: ${extractedBrands.join(', ')}
            `
                : ''
            }
            
            ⛔ **절대 금지**:
            - 리뷰 통계 없이 제품명만 언급 금지
            - 외부 비교 사이트(노써치, 다나와) 제품 추천 금지
            - 참고 자료에 없는 제품(ESR, 신지모루, 다이소) 메인 추천 금지
            `
                : ''
            }
            
            ❌ **절대 금지 사항** (다음 중 하나라도 위반 시 초안 전체 거부):
            - 참고 자료에 **리뷰 통계가 없는 제품**을 메인 추천으로 사용 금지
            - 외부 비교 사이트(노써치, 다나와 등)의 제품 비교표를 그대로 복사 금지
            - "TPU는 탄성이 뛰어나" 같은 일반론만 나열 금지
            - 참고 자료 제품을 마지막 섹션에만 짧게 언급하고 넘어가는 것 금지
            - "노써치", "nosearch.com", "다나와" 같은 외부 사이트 이름/링크 언급 금지
            
            ${originalContentText}
            ${linkedScrapsText}
            
            ═══════════════════════════════════════════════════════════════
            `
                : ''
            }
            
            [현재 시점 정보]
            - 오늘 날짜: ${currentDateString}
            - **현재 연도: ${currentYear}년**
            - **중요**: 년도는 꼭 필요한 경우에만 사용하세요. 
              * 시간에 민감한 트렌드/최신 정보가 아니라면 년도를 생략하세요.
              * 년도를 사용할 때는 반드시 **${currentYear}년**을 사용하세요. (과거 연도 사용 금지)

            [작성 요청]
            아래 정보를 바탕으로 블로그 포스트 초안을 작성해주세요.
            
            SEO에 최적화되고 독자의 흥미를 끄는 완성도 높은 블로그 포스트 초안을 작성해주세요.

            ### 1. 아이디어 제목 (참고용)
            - ${ideaData.title}

            ### 1-1. SEO 최적화된 실제 초안 제목 생성
            위 아이디어 제목을 참고하여, 검색 노출에 최적화되고 독자의 체류시간을 늘릴 수 있는 실제 초안 제목을 생성해주세요.
            
            **[년도 사용 규칙 - CRITICAL - 엄격히 준수]**
            - **기본 원칙 (최우선)**: 년도는 꼭 필요한 경우에만 사용하세요. 불필요하게 년도를 추가하지 마세요.
            - **절대 규칙**: 아이디어 제목에 년도가 **명시적으로 포함되지 않았다면**, 초안 제목과 본문에도 년도를 절대 사용하지 마세요.
            - **기본 가정**: 아이디어 제목 = "${ideaData.title}"에 년도가 없다면, 이 글은 시간에 민감하지 않은 주제입니다. 년도를 생략하세요.
            
            - **년도를 사용해야 하는 경우** (다음 조건을 **모두** 만족해야 함):
              1. 아이디어 제목이나 핵심 요약에 **명시적으로 년도가 포함**되어 있거나
              2. 글의 주제가 **명백히 시간에 민감한 정보**를 다루는 경우 (예: "2025년 트렌드", "2026년 전망", "올해의 신제품")
              
              **구체적인 허용 예시**:
              - 아이디어 제목: "2025년 스마트폰 추천" → ✅ 제목에 년도 명시 → 사용 가능
              - 아이디어 제목: "2026년 부동산 전망" → ✅ 제목에 년도 명시 → 사용 가능
              - 아이디어 제목: "최신 갤럭시 S25 출시" → ✅ 최신 신제품 출시 정보 → 사용 가능
            
            - **년도를 사용하지 말아야 하는 경우** (대부분의 경우):
              1. 아이디어 제목에 년도가 **없는** 경우 → ❌ 년도 사용 금지
              2. 시간과 무관한 영구적인 가이드/방법 (예: "블로그 시작하는 법", "커피 내리는 방법") → ❌ 년도 사용 금지
              3. 제품 리뷰 (제품명에 년도가 없는 경우) (예: "아이폰 사용 후기") → ❌ 년도 사용 금지
              4. 개념/이론 설명 (예: "SEO란 무엇인가") → ❌ 년도 사용 금지
              5. 설정 방법, 사용법, 튜토리얼 등 (예: "스마트싱스 설정 방법") → ❌ 년도 사용 금지
              
              **구체적인 금지 예시**:
              - 아이디어 제목: "갤럭시 탭 사용법" → ❌ 제목에 년도 없음 → 년도 사용 금지
              - 아이디어 제목: "스마트홈 구축 가이드" → ❌ 영구적 가이드 → 년도 사용 금지
              - 아이디어 제목: "블로그 수익화 방법" → ❌ 시간 무관 방법론 → 년도 사용 금지
            
            - **년도를 사용할 때**: 반드시 **${currentYear}년**을 사용하세요. (과거 연도 사용 절대 금지)
            - **판단 기준**: 이 글이 1년 후에도 유효한 정보인가? 그렇다면 년도를 사용하지 마세요.
            
            **[제목 생성 규칙]**
            - 검색 키워드를 자연스럽게 포함
            - 클릭을 유도하는 제목
            - 독자의 문제를 해결하거나 유용한 정보를 제공한다는 것을 명확히 표현
            - 50자 이내로 간결하게
            - 이 제목을 h1 태그로 문서의 맨 처음에 포함해주세요
            - **중요**: 아래 목차의 첫 번째 항목은 제목이 아닙니다. 목차는 본문 구조를 위한 것이며, 제목은 별도로 생성해야 합니다.

            ### 2. 핵심 요약
            - ${ideaData.description || '주제에 대한 상세 설명'}

            ### 3. 현재까지 작성된 초안 (이 내용을 바탕으로 발전시켜주세요)
            ${ideaData.currentDraft || '(비어 있음)'}

            ### 4. 본문 구조 (목차 - 이 목차는 본문 섹션 제목으로만 사용하세요)
            ${
              (ideaData.outline || []).length > 0
                ? ideaData.outline.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
                : '목차가 제공되지 않았습니다. 논리적이고 체계적인 구조로 작성해주세요.'
            }
            
            [문서 구조 규칙 - 매우 중요]
            1. **제목 (h1)**: SEO 최적화된 독립적인 제목을 생성하고, h1 태그(# 제목)로 문서의 맨 처음에 포함해주세요.
               - 목차의 첫 번째 항목을 제목으로 사용하지 마세요.
               - 제목은 아이디어 제목을 참고하되, SEO와 클릭률을 고려하여 새로 생성하세요.
            
            2. **서론**: 제목 다음에 서론을 작성해주세요.
               - 독자의 관심을 끄는 도입부
               - 글의 목적과 핵심 내용을 간략히 소개
            
            3. **본문**: 서론 다음에 목차를 h2(## 제목) 섹션으로 작성해주세요.
               - 목차의 각 항목을 h2 태그로 사용하세요.
               - **각 문단 제목(h2, h3)은 반드시 굵게(볼드) 표시하세요**: 마크다운 헤더 문법과 함께 **굵게** 처리를 병행하세요. 예: ## **섹션 제목**, ### **하위 제목**
               - 각 섹션에 충실한 내용을 작성하세요.
               - 하위 섹션이 필요하면 h3(### 제목)를 사용하세요.
            
            4. **결론**: 본문 마지막에 결론 섹션을 h2(## 결론)로 추가해주세요.
               - 결론 제목도 반드시 굵게 표시하세요: ## **결론**
               - 글의 핵심 내용 요약
               - 독자에게 도움이 되는 마무리
            
            [작성 순서]
            h1 제목 → 서론(일반 텍스트) → 본문(h2 섹션들) → 결론(h2)

            ### 5. 주요 키워드 (본문에 자연스럽게 포함해주세요)
            ${tags.length > 0 ? tags.map((t) => `- ${t.replace(/^#/, '')}`).join('\n') : '없음'}

            ### 6. 롱테일 키워드 (🚨 SEO Critical - 본문에 자연스럽게 2-3회 반복 필수)
            ${
              longTailKeywords.length > 0
                ? longTailKeywords.map((k) => `- ${k}`).join('\n')
                : '없음'
            }
            
            **[롱테일 키워드 사용 규칙 - 필수]**:
            - 각 롱테일 키워드를 본문에 **최소 2회 이상** 자연스럽게 반복해서 사용하세요
            - 단순 나열이 아닌, 문장 안에 자연스럽게 녹여서 사용
            - ✅ 예: "카드 수납 케이스 스티커 꼭 필요한가"라는 키워드를
              * 서론: "카드 수납 케이스 스티커 꼭 필요한가요? 이 질문에 답하기 전에..."
              * 본문: "많은 분들이 카드 수납 케이스 스티커 꼭 필요한가 고민하시는데..."
              * 결론: "결론적으로, 카드 수납 케이스 스티커 꼭 필요한가는 개인의 사용 패턴에 달려있습니다"
            - 롱테일 키워드가 본문에 1회만 등장하거나 아예 없으면 SEO 점수 크게 하락
            
            ### 7. 추천 검색어 (자료 수집용 - 초안 작성에 필요한 추가 정보를 찾기 위한 검색어)
            ${
              recommendedSearches.length > 0
                ? recommendedSearches.map((s, idx) => `${idx + 1}. ${s}`).join('\n')
                : '없음'
            }
            
            [추천 검색어 활용 규칙 - 매우 중요]
            - 이 검색어들은 **초안 작성에 필요한 추가 자료를 수집하기 위한 목적**으로 생성되었습니다.
            - 각 검색어는 통계, 사례, 비교 데이터, 최신 트렌드 등 특정 유형의 정보를 찾기 위해 최적화되어 있습니다.
            - **활용 방법**:
              1. 통계/데이터 검색어 → 본문에 신뢰성 있는 수치와 데이터를 포함할 때 활용
              2. 가이드/방법 검색어 → 실용적인 팁이나 단계별 설명을 작성할 때 참고
              3. 비교/분석 검색어 → 제품이나 서비스를 비교 분석하는 섹션에서 활용
              4. 사례/후기 검색어 → 실제 사용 경험이나 사례 연구를 소개할 때 활용
              5. 최신 트렌드 검색어 → 최신 동향이나 전망을 다루는 섹션에서 활용
            - **중요**: 검색어를 단순히 본문에 나열하지 말고, 해당 검색어로 찾을 수 있는 정보의 '유형'을 이해하고 그에 맞는 콘텐츠를 작성하세요.
            - 예시:
              * 검색어: "스마트홈 시장 규모 2024" → 본문에 "2024년 글로벌 스마트홈 시장은 X조원 규모로 성장할 것으로 전망됩니다" 같은 통계 정보 포함
              * 검색어: "스마트홈 설치 가이드" → 본문에 실제 설치 단계와 주의사항을 단계별로 설명
            
            ${
              myPastPostsText
                ? `### 9. 내 과거 포스팅 목록 (스마트 내부 링크 추천)
            ${myPastPostsText}
            `
                : ''
            }
            
            [참고 자료 활용 규칙 - 절대 준수, 위반 시 초안 거부]
            
            ⚠️ **[최우선 규칙] 섹션별 참고 자료 강제 활용 - 절대 엄수 필수**
            
            **🚨 경고: 각 섹션을 작성할 때 해당 섹션의 참고 자료를 반드시 활용해야 합니다! 일반론만 작성하면 초안이 거부됩니다!**
            
            위의 "섹션별 참고 자료"에 섹션1, 섹션2, 섹션3 등이 제공되었다면:
            - **섹션1 본문 작성 시**: 위의 "섹션1" 참고 자료에서 **최소 3개 이상**의 구체적 정보(제품명, 통계, 후기 등) 필수
            - **섹션2 본문 작성 시**: 위의 "섹션2" 참고 자료에서 **최소 3개 이상**의 구체적 정보 필수
            - **섹션3 본문 작성 시**: 위의 "섹션3" 참고 자료에서 **최소 3개 이상**의 구체적 정보 필수
            - **섹션4 본문 작성 시**: 위의 "섹션4" 참고 자료에서 **최소 3개 이상**의 구체적 정보 필수
            - **섹션5 본문 작성 시**: 위의 "섹션5" 참고 자료에서 **최소 3개 이상**의 구체적 정보 필수
            
            **엄격한 검증 기준 (절대 엄수)**:
            - 각 섹션에서 해당 섹션 참고 자료의 **제품명, 브랜드명, 구체적 수치, 사용자 후기** 중 **최소 3개**를 명시적으로 언급해야 합니다
            - "일반적으로", "보통", "다양한 제품", "이런 케이스" 같은 모호한 표현만으로는 **절대 부족**합니다
            - 해당 섹션의 참고 자료에 없는 내용을 창작하지 마세요
            - **절대 금지**: 섹션5에서만 제품명을 언급하고 섹션1~4에서는 일반론만 쓰는 것
            - **절대 금지**: "얇은 두께로 생폰 느낌을 살리는..." 같은 일반적 설명만 나열
            
            🔥 **[섹션별 구체적 예시 - 반드시 이 패턴을 따르세요]**
            
            **❌ 나쁜 예시 - 섹션1 "왜 고민될까?" (참고 자료 무시)**:
            "아이폰 케이스를 고르는 일은 생각보다 복잡합니다. 디자인과 보호력 사이에서 고민하게 되죠..."
            
            **✅ 좋은 예시 - 섹션1 "왜 고민될까?" (참고 자료 활용, 3개 이상)**:
            "실제로 누아트 맥세이프 컬러 엣지 케이스 구매자 1,656명 중(1) '디자인은 예쁜데 내구성이 걱정된다'는 의견과 'SUMMIT 맥세이프 카드 케이스 2,504명 리뷰에서 87% 만족했지만(2), 일부는 카드 수납 때문에 두께가 부담스럽다'는 평가가 공존합니다(3). 김정 님은 '얇고 가벼운 케이스를 샀지만 떨어뜨리니 모서리에 찍힘이 생겼다'고 후회했습니다(4)."
            
            **❌ 나쁜 예시 - 섹션2 "예쁜 케이스" (참고 자료 무시)**:
            "얇고 가벼운 케이스는 아이폰의 슬림한 디자인을 살려줍니다. TPU 소재의 젤리 케이스나 PC 소재의 하드 케이스가 있습니다..."
            
            **✅ 좋은 예시 - 섹션2 "예쁜 케이스" (참고 자료 활용, 3개 이상)**:
            "누아트 맥세이프 컬러 엣지 케이스는 투명 바디에 컬러 엣지 포인트가 들어가 '심플하면서도 밋밋하지 않고, 기기 색상을 살리면서 포인트까지 준다'는 평가를 받았습니다(1). 디자인 만족도는 70%로 높은 편이며(2), 이라 님은 '빛을 받았을 때 가장자리 부분이 은은하게 반짝이는 듯한 효과가 있어 손에 쥐고 있을 때마다 만족감이 높다'고 극찬했습니다(3). 다만 김정 님은 '얇고 가벼운 풀커버 케이스라 부담이 없지만, 떨어뜨려 보니 모서리 부분에 바로 찍힘이 생겨 내구성은 다소 아쉽다'고 지적했습니다(4)."
            
            **❌ 나쁜 예시 - 섹션3 "튼튼한 케이스" (참고 자료 무시)**:
            "튼튼한 케이스는 범퍼 타입이나 PC+TPU 이중 구조가 효과적입니다. 모서리 에어 포켓 디자인으로 충격을 흡수합니다..."
            
            **✅ 좋은 예시 - 섹션3 "튼튼한 케이스" (참고 자료 활용, 3개 이상)**:
            "SUMMIT 맥세이프 카드 케이스는 2,504개 리뷰에서 견고함 78%의 높은 평가를 받았습니다(1). 레몬트리 님은 '5만건의 판매 경험 동안 3번의 자력 업그레이드를 거쳐 더 강력하고 안정적인 부착력을 완성했다'고 강조했습니다(2). 누아트 케이스의 경우 박진 님이 '변색 없는 소재로 오래 사용해도 깨끗하다'고 평가했지만(3), 김정 님은 '떨어뜨리니 모서리에 찍힘이 생겼다'며 내구성에 아쉬움을 표했습니다(4)."
            
            **❌ 나쁜 예시 - 섹션4 "선택 가이드" (참고 자료 무시)**:
            "용도에 맞는 케이스를 고르는 것이 중요합니다. 디자인 중시면 투명 케이스, 보호력 중시면 범퍼 케이스를 추천합니다..."
            
            **✅ 좋은 예시 - 섹션4 "선택 가이드" (참고 자료 활용, 3개 이상)**:
            "실용성을 중시한다면 SUMMIT 맥세이프 카드 케이스 세트를 추천합니다(1). 카드 2~3장을 수납할 수 있으며, 카드 1장만 넣어도 내부 고정 클립으로 안전하게 카드를 잡아줍니다(2). 2,504개 리뷰에서 87%가 최고 평점을 주었고, 견고함 78%의 높은 만족도를 기록했습니다(3). 레몬트리 님은 '5만건의 판매 경험 동안 3번의 자력 업그레이드로 더 강력하고 안정적인 부착력으로 완성했다'며 자력에 만족했습니다(4)."
            
            **❌ 나쁜 예시 - 섹션5 "추천 케이스" (참고 자료 무시)**:
            "종합적으로 디자인과 내구성을 모두 갖춘 제품을 선택하는 것이 좋습니다. 예산과 용도에 맞게 고르세요..."
            
            **✅ 좋은 예시 - 섹션5 "추천 케이스" (참고 자료 활용, 3개 이상)**:
            "디자인을 최우선으로 한다면 누아트 맥세이프 컬러 엣지 케이스(1,656개 리뷰, 디자인 만족도 70%)를 추천합니다(1). 이라 님은 '은은하게 반짝이는 효과가 손에 쥘 때마다 만족감을 준다'고 극찬했습니다(2). 실용성이 중요하다면 SUMMIT 맥세이프 카드 케이스(2,504개 리뷰, 87% 최고 평점, 견고함 78%)가 최선의 선택입니다(3). 레몬트리 님은 '5만건 판매 경험에서 3번의 자력 업그레이드로 완성했다'며 품질을 보증했습니다(4)."
            
            🚨 **[최종 경고]**: 모든 섹션(특히 섹션1, 3, 5)에서 참고 자료가 제공되었는데도 일반론만 작성하면 초안이 거부됩니다! 위의 "✅ 좋은 예시"처럼 각 섹션마다 반드시 제품명, 통계, 사용자 후기를 포함하세요!
            
            🎯 **[독자 흥미 유발 규칙 - 몰입도 극대화 필수]**
            
            독자가 글을 끝까지 읽고 싶어지도록 다음 요소들을 적극 활용하세요:
            
            1. **공감 스토리 & 구체적 상황 묘사**:
               - 추상적 설명 대신 독자가 공감할 수 있는 구체적 경험 제시
               - ❌ 나쁜 예: "케이스 선택은 고민입니다"
               - ✅ 좋은 예: "커피숍에서 아이폰을 꺼냈는데 케이스가 너무 투박해서 민망했던 경험, 있으시죠? 그렇다고 예쁜 케이스를 샀더니 딱 한 번 떨어뜨렸는데 액정이 박살나서..."
               - 독자의 실제 경험이나 고민을 먼저 언급하고 해결책 제시
            
            2. **위트 있는 비유 & 생생한 표현**:
               - 딱딱한 설명 대신 재미있고 기억에 남는 비유 활용
               - ❌ 나쁜 예: "튼튼한 케이스는 보호력이 뛰어납니다"
               - ✅ 좋은 예: "마치 갑옷을 입은 기사처럼 든든하지만, 주머니에 넣으면 '아, 이게 들어가긴 하나?' 싶을 정도로 두꺼운 케이스들"
               - 일상적 비유, 유머러스한 표현으로 글을 생동감 있게 작성
            
            3. **감정 자극 & 손실 회피 심리**:
               - 단순 통계 나열 → 감정을 움직이는 스토리텔링으로 전환
               - ❌ 나쁜 예: "87%가 최고 평점을 주었습니다"
               - ✅ 좋은 예: "2,504명 중 무려 87%가 '이거 진짜 대박!'이라고 극찬한 이유는? 단 한 번의 충격에서 500,000원짜리 아이폰을 구해냈기 때문입니다"
               - 금액, 시간 낭비, 실패 경험 등으로 독자의 감정 자극
            
            4. **실패담 → 교훈 패턴**:
               - 사용자 후기를 단순 인용하지 말고 스토리로 재구성
               - ❌ 나쁜 예: "김정 님은 '떨어뜨리니 찍힘이 생겼다'고 했습니다"
               - ✅ 좋은 예: "김정 님은 '예쁘다고 샀는데 딱 한 번 떨어뜨리니 모서리가 찍혔어요. 이제는 디자인보다 보호력을 먼저 봅니다'라며 뼈아픈 교훈을 전했습니다. 500,000원짜리 아이폰이 순식간에 중고 가격으로..."
               - 실패 → 깨달음 → 올바른 선택으로 이어지는 내러티브 구성
            
            5. **독자 참여 유도 질문**:
               - 일방적 정보 전달에서 벗어나 독자와 대화하듯 질문 활용
               - ✅ 예시: "당신은 어느 타입인가요? 디자인파 vs 보호력파 vs 실용성파"
               - ✅ 예시: "이런 고민 해보신 적 있으신가요?"
               - ✅ 예시: "혹시 여러분도 이런 실수를 하고 계시진 않나요?"
               - 글의 도입부나 섹션 시작에 질문으로 독자 주의 집중
            
            6. **숫자와 사실을 스토리로 포장**:
               - ❌ 나쁜 예: "1,656개 리뷰에서 70% 만족도"
               - ✅ 좋은 예: "1,656명이 실제로 사용해보고 10명 중 7명이 '이거 진짜 예쁘다!'고 인정한 케이스"
               - 통계를 일상 언어로 변환하여 체감도 높이기
            
            7. **대비와 반전 활용**:
               - "~인 줄 알았는데, 알고 보니..." 패턴으로 흥미 유발
               - ✅ 예시: "얇아서 보호력이 약할 줄 알았는데, 에어 포켓 디자인 덕분에 1.5m 낙하 테스트도 통과했습니다"
               - 예상 뒤집기로 독자의 호기심 자극
            
            **[적용 우선순위]**:
            - 섹션1 (도입부): 공감 스토리 + 독자 참여 질문 필수
            - 섹션2~4 (본문): 위트 있는 비유 + 감정 자극 표현 + 실패담 교훈 활용
            - 섹션5 (결론): 대비/반전 + 행동 유도
            
            **[재미 & 흥미 강화 규칙 - 🚨 초안 검증 필수 항목]**:
            
            🔥 **[MANDATORY CHECKPOINT] 초안 작성 전 반드시 확인**:
            - 아래 4가지 항목 중 하나라도 누락되면 초안이 거부됩니다
            - 각 항목은 초안 제출 전 자체 검증을 통해 확인하세요
            
            1. **🎭 스토리텔링 필수 삽입 (최소 2곳, 🚨 검증 필수)**:
               
               **[필수 패턴 - 반드시 아래 형태로 작성]**:
               - "저도 처음엔 [행동A]했다가, [시간] 만에 [문제 발생]해서 [감정/교훈]했어요"
               - "실제로 사용해보니 [예상]과 달리 [실제 경험]이더라고요"
               - "친구가 [실수/선택]했는데, [결과]해서 저는 [다른 선택]을 했어요"
               
               **[✅ 올바른 예시]**:
               - ✅ "저도 처음엔 스티커가 귀찮아서 안 붙였다가, 3개월 만에 카드가 긁혀서 후회했어요"
               - ✅ "실제로 얇은 케이스를 썼는데, 떨어뜨리니 바로 모서리가 찍혀서 튼튼한 케이스로 바꿨어요"
               - ✅ "친구가 예쁜 케이스만 고집하다가 아이폰이 박살나서, 저는 보호력을 최우선으로 골랐습니다"
               
               **[❌ 잘못된 예시 - 거부됨]**:
               - ❌ "많은 사용자들이 스티커를 붙이지 않는 경우가 있습니다" (스토리가 아닌 일반론)
               - ❌ "케이스 선택은 중요합니다" (경험담 없음)
               
               **[삽입 위치]**:
               - 서론에 1곳: 독자 공감 유도를 위한 문제 상황 스토리
               - 본문에 1곳: 제품/방법 설명 중 실제 사용 경험담
               
               **[🚨 검증 방법]**:
               초안 제출 전 "저도", "실제로", "친구가" 같은 키워드로 검색하여 최소 2곳 이상 포함되었는지 확인하세요
            
            2. **🧠 "왜"에 대한 깊이 있는 설명 필수 (🚨 검증 필수)**:
               
               **[필수 패턴 - "무엇" + "왜 그런지" 세트로 작성]**:
               - [제품/특징]은 [특성]입니다 → [원리/이유]이기 때문입니다
               - "~하는 이유는", "~때문에", "원리는" 같은 설명 키워드 포함
               
               **[✅ 올바른 예시]**:
               - ❌ 나쁜 예: "TPU는 부드럽습니다" (무엇만 나열)
               - ✅ 좋은 예: "TPU는 분자 구조가 탄성 고분자로 되어 있어서 충격을 흡수할 때 변형되었다가 원래대로 돌아옵니다. 그래서 카드 긁힘 방지에 효과적이죠"
               
               - ❌ 나쁜 예: "맥세이프는 편리합니다"
               - ✅ 좋은 예: "맥세이프는 자석 정렬 기술로 정확한 위치에 부착되기 때문에 무선 충전 효율이 90% 이상 유지됩니다"
               
               **[🚨 검증 방법]**:
               초안에서 주요 제품/특징 설명 문장을 찾아, "왜 그런지" 원리 설명이 함께 있는지 확인하세요
            
            3. **💝 감정선 강화 (독자 몰입 유도)**:
               
               **[필수 패턴 - 감정 흐름 구성]**:
               - 문제 상황 → 고민/불안 → 해결/선택 → 만족/안도
               - 감정 키워드: "짜증나던", "신경쓰이던", "걱정되던" → "안심되는", "만족스러운"
               
               **[✅ 올바른 예시]**:
               - "매번 카드가 긁힐까 신경쓰이던 순간들(문제), 어떤 케이스를 골라야 할지 고민이 많았는데(고민), 이 제품을 쓰고 나서는(해결) 정말 안심되더라고요(만족)"
               
            4. **💬 구어체 표현 적절히 섞기 (너무 딱딱하지 않게)**:
               - "~하죠", "~네요", "~거든요", "~더라고요" 같은 자연스러운 말투
               - 최소 3개 이상의 구어체 표현 포함 권장
               - 단, 전문가 톤과 균형 유지 (너무 캐주얼하지 않게)
            
            **[균형 유지]**: 너무 과장되거나 선정적이지 않되, 독자가 지루하지 않게 적절한 재미 요소 배치. 신뢰성을 해치지 않는 선에서 흥미 유발!
            
            - **원본 본문**(리뉴얼 아이디어)이 제공된 경우:
              * 그 내용을 핵심 기반으로 삼아 팩트 기반 작성하되, 단순 복사가 아닌 새로운 관점이나 더 풍부한 정보로 발전시켜주세요.
            
            - **자료 연결(참고 자료)**이 제공된 경우 - 다음 규칙을 절대적으로 준수하세요:
              
              1. **제품명/브랜드 직접 언급 필수**:
                 - 참고 자료에 특정 제품명이나 브랜드가 있다면, 본문에서 반드시 해당 제품명을 직접 언급하세요.
                 - ❌ 나쁜 예: "이런 제품들이 있습니다", "다양한 케이스가 있습니다"
                 - ✅ 좋은 예: "누아트 맥세이프 마그네틱 컬러 엣지 케이스는 1,656개의 리뷰에서 75%의 최고 평점을 받았습니다"
              
              2. **구체적인 수치와 통계 직접 인용**:
                 - 참고 자료에 리뷰 개수, 평점, 만족도 등의 통계가 있다면 반드시 본문에 포함하세요.
                 - 예: "2,000명 이상이 만족했으며, 견고함 78%, 디자인 83% 만족도를 기록했습니다"
              
              3. **실제 사용자 후기 내용 통합**:
                 - 참고 자료에 사용자 리뷰가 있다면, 핵심 장단점을 본문에 자연스럽게 녹여주세요.
                 - ✅ 좋은 예: "실제 사용자들은 '카드 2~3장을 수납할 수 있고, 500g의 강력한 자력으로 맥세이프 거치대에서 흔들림이 없다'고 평가했습니다"
                 - ✅ 좋은 예: "다만 일부 사용자는 '풀커버라 화면에 지문이 많이 남고 유막 현상이 있다'는 점을 단점으로 지적했습니다"
              
              4. **참고 자료의 제품이 최우선**:
                 - 참고 자료에 특정 제품 정보가 있다면, 그 제품을 본문의 추천/비교 대상으로 우선 활용하세요.
                 - 참고 자료에 없는 제품을 임의로 추천하지 마세요.
                 - ❌ 절대 금지: 참고 자료에 "누아트 케이스" 정보가 있는데, 본문에서 "ESR 케이스", "신지모루 케이스" 등 전혀 다른 제품 추천
              
              5. **기능과 스펙의 구체적 서술**:
                 - 참고 자료에 제품 기능, 소재, 특징이 명시되어 있다면 본문에서 구체적으로 설명하세요.
                 - ✅ 좋은 예: "PC와 TPU 이중 구조로 변색을 최소화하고, 카메라 보호 필름이 포함되어 있으며, 카드 1장 수납 시에도 내부 고정 클립으로 안전하게 고정됩니다"
              
              6. **자연스러운 통합, 나열 금지**:
                 - 단순히 "참고 자료 1에 따르면...", "출처 2에서..." 같은 딱딱한 표현 금지
                 - 본문의 흐름에 자연스럽게 녹여서 독자가 참고 자료 내용인지 모르게 작성하세요
              
              7. **참고 자료 우선순위 엄수**:
                 - 참고 자료 > 일반 지식
                 - 참고 자료에 정보가 있다면 절대 일반론으로 대체하지 마세요
                 - 참고 자료가 비어있거나 관련 없는 내용일 때만 일반 지식을 활용하세요
              
              **[Before/After 예시 - 반드시 이 패턴을 따르세요]**
              
              📌 **예시 1: 제품 추천 섹션**
              
              ❌ 잘못된 작성 (참고 자료 무시):
              "맥세이프 케이스를 고를 때는 ESR 할로락이나 신지모루 M-에어로핏 같은 제품이 좋습니다. 다양한 케이스가 시중에 나와 있으니 비교해보세요."
              
              ✅ 올바른 작성 (참고 자료 직접 활용):
              "누아트 맥세이프 마그네틱 컬러 엣지 풀커버 케이스는 1,656개의 사용자 리뷰에서 75%가 최고 평점을 주었으며, 견고함 61%, 디자인 70%의 만족도를 기록했습니다. 실제 사용자들은 '케이스 자체가 카메라까지 모두 덮는 구조라 별도의 카메라 필름이 필요 없고, 500g의 강력한 자력으로 무선 충전에도 문제가 없다'고 평가했습니다.
              
              SUMMIT 맥세이프 카드 케이스 세트는 2,504개 리뷰에서 87%가 최고 평점을 주었으며, 2,000명 이상이 만족했다고 응답했습니다. 견고함 78%, 디자인 83%의 높은 만족도를 보였으며, '카드 2~3장을 수납할 수 있고, 카드 1장만 넣어도 내부 고정 클립으로 안전하게 고정된다'는 점이 장점입니다."
              
              📌 **예시 2: 장단점 섹션**
              
              ❌ 잘못된 작성 (일반론):
              "맥세이프 케이스는 자력이 강해서 충전이 편리하지만, 때로는 케이스가 두꺼워질 수 있습니다."
              
              ✅ 올바른 작성 (실제 후기 기반):
              "실제 사용자들이 꼽은 주요 장점은 다음과 같습니다. '맥세이프 충전기나 카드지갑을 붙였을 때 딱 하고 붙는 느낌이 확실하고, 흔들림 없이 안정적으로 고정된다'는 평가가 많았습니다. 특히 차량용 거치대나 무선 충전기에서도 흔들림 없이 안정적으로 사용할 수 있다는 점이 높이 평가받았습니다.
              
              다만 일부 사용자는 단점도 지적했습니다. 누아트 케이스의 경우 '풀커버 형태라 화면이 지저분해지고 손자국이 많이 남으며, 유막 현상이 있어 은근 거슬린다'는 의견이 있었습니다. SUMMIT 카드 케이스는 '카드 2장 이상 넣으면 손가락으로 밀어도 카드가 잘 안 빠진다'는 불편함이 있었습니다."
              
              📌 **예시 3: 제품 비교 표**
              
              ❌ 잘못된 작성:
              "다양한 제품들을 비교해보세요."
              
              ✅ 올바른 작성:
              "| 제품명 | 리뷰 수 | 최고 평점 비율 | 견고함 만족도 | 디자인 만족도 | 주요 특징 |
              |--------|---------|---------------|--------------|--------------|-----------|
              | 누아트 맥세이프 풀커버 | 1,656개 | 75% | 61% | 70% | 카메라 보호 필름 포함, 500g 강력 자력 |
              | SUMMIT 카드 케이스 세트 | 2,504개 | 87% | 78% | 83% | 카드 2-3장 수납, 내부 고정 클립 |"
              
              **목표**: 독자가 참고 자료를 따로 읽지 않아도 이 초안만으로 참고 자료의 핵심 정보를 모두 얻을 수 있어야 합니다.
            
            - **참고 자료가 없는 경우**:
              * 일반적인 지식과 경험을 바탕으로 작성하되, 확실하지 않은 내용은 추측하지 마세요.
            
            - **필수**: 할루시네이션(허위 정보 생성)을 피하고, 참고 자료에 있는 확실한 정보만 포함해주세요.

            [작성 규칙]
            1. **이모지 사용 제한**: 이모지나 이모티콘은 절대 사용하지 마세요. 텍스트만으로 작성하세요.
               - 제목, 본문, 결론 어디에도 이모지를 포함하지 마세요.
               - 감정이나 강조는 텍스트 표현으로만 전달하세요.
            
            2. **제목 최적화**: SEO 최적화된 제목을 생성하고, 이 제목을 h1 태그로 문서의 맨 처음에 포함해주세요. 아이디어 제목과는 다를 수 있습니다.
               - **년도 사용 원칙**: 위에서 명시한 년도 사용 규칙을 엄격히 따르세요. 꼭 필요한 경우에만 년도를 포함하세요.
               - **절대 금지**: 목차의 첫 번째 항목을 제목으로 사용하지 마세요. 제목은 별도로 생성해야 합니다.
               - 제목 다음에는 서론을 작성하고, 그 다음에 목차의 첫 번째 항목부터 본문 섹션으로 작성하세요.
            3. '현재까지 작성된 초안'이 비어있지 않다면, 그 내용을 존중하여 이어서 작성하거나 내용을 더 풍부하게 만들어주세요.
            4. **문서 구조**: 제목(h1) → 구분선(---) → 서론 → 본문(h2 섹션들, 목차 기반) → 결론(h2) 순서로 작성하세요.
               - 목차의 각 항목은 본문의 h2 섹션 제목으로만 사용하세요.
               - 서론과 결론은 목차에 포함되지 않으므로 별도로 작성하세요.
            5. '롱테일 키워드'를 본문에 자연스럽게 통합하여 SEO를 최적화해주세요. 키워드 스터핑은 피하고, 문맥에 맞게 사용해주세요.
            6. '추천 검색어'는 초안 작성에 필요한 자료 수집을 위한 검색어입니다. 이 검색어들이 암시하는 정보 유형(통계, 가이드, 비교, 사례, 트렌드 등)을 이해하고, 해당 정보를 본문에 풍부하게 포함해주세요. 검색어 자체를 단순 나열하지 마세요.
            7. '관련 참고 자료'의 내용을 활용할 때는 단순히 나열하거나 요약하지 말고, 본문의 흐름에 자연스럽게 녹여서 작성해주세요. 자료의 핵심 정보를 재해석하거나 독자의 이해를 돕는 방식으로 통합해주세요.
            8. **하이라이트 텍스트는 span 태그 사용**: 중요한 텍스트를 강조할 때 mark 태그가 아닌 span 태그를 사용하세요.
               - ❌ 금지: <mark style="...">텍스트</mark>
               - ✅ 권장: <span style="background-color: rgba(255, 255, 204, 0.5); padding: 2px 4px; border-radius: 3px;">텍스트</span>
            8. 각 섹션은 독자가 이해하기 쉽고, 실용적인 정보를 제공하도록 작성해주세요. 독자의 체류시간을 늘리고 유용한 정보를 제공하는 데 집중해주세요.
            9. **이미지 생성 프롬프트 삽입**: 본문에서 이미지를 삽입할 적절한 위치를 찾아서 텍스트로 이미지 생성 프롬프트를 삽입해주세요. 
              - **매우 중요**: 이미지 프롬프트는 해당 위치의 콘텐츠 내용과 직접적으로 관련된 이미지여야 합니다.
              - **형식 규칙 (매우 중요)**:
                * **줄바꿈 강제**: 영어 프롬프트와 한글 프롬프트는 반드시 줄을 나누어 작성해주세요. 절대 한 줄에 붙여서 작성하지 마세요. 두 프롬프트 사이에는 반드시 줄바꿈이 있어야 합니다.
                * 각 프롬프트는 녹색 텍스트 색상으로 표시되어야 합니다 (마크다운: <span style="color: #2e7d32;">텍스트</span> 형식 사용).
                * 형식 예시 (아래처럼 반드시 두 줄로 작성):
                  <span style="color: #2e7d32;">[이미지 생성 프롬프트 (영어): High-quality photo of [글의 핵심 주제], professional lighting, 8K resolution, photorealistic style]</span>
                  
                  <span style="color: #2e7d32;">[이미지 생성 프롬프트 (한글): [글의 핵심 주제]에 대한 고품질 사진, 전문적인 조명, 사실적 스타일]</span>
                * 위 예시처럼 영어 프롬프트 다음에 빈 줄 하나를 두고 한글 프롬프트를 작성하세요.
                * 잘못된 예 (절대 금지): 
                  - "<span style="color: #2e7d32;">[이미지 생성 프롬프트 (영어): ...] [이미지 생성 프롬프트 (한글): ...]</span>" (한 줄에 붙어 있음, 줄바꿈 없음)
                  - "> [이미지 생성 프롬프트 ...]" (인용구 형식 사용 금지)
              - 메인 이미지는 제목 바로 아래, 서론 시작 전에 1개: 
                * 해당 글의 주제와 직접 관련된 이미지 프롬프트를 작성하세요.
              - 본문 이미지는 각 섹션 사이에 3~4개 배치: 
                * 각 섹션의 내용과 직접 관련된 이미지 프롬프트를 작성하세요.
                * 예: "SmartThings AI 콤보" 섹션이면 SmartThings 관련 이미지, "해결 방법" 섹션이면 해결 과정 관련 이미지
              - **절대 금지**: 글의 주제와 무관한 예시 이미지(예: 갤럭시 탭, 사무실 등)를 사용하지 마세요. 반드시 해당 글의 실제 내용과 관련된 이미지만 생성하세요.
            ${
              affiliateLinks.length > 0
                ? `
            10. **페르소나 자기소개 금지 (Strict)**:
               - AI가 페르소나를 연기하는 자기소개는 절대 사용하지 마세요.
               - 예: "옆집 언니처럼 알려드릴게요", "전문가로서 말씀드리자면", "친구처럼 솔직하게 말하면" 등
               - 자연스럽고 객관적인 톤으로 작성하세요. 독자가 AI가 쓴 글처럼 느껴지지 않도록 하세요.

            11. **제휴 마케팅 링크 (수익화) - [🚨 CRITICAL - 초안 거부 기준]**:
              
              🚨 **[초안 거부 규칙]**: 제휴 링크가 **2개 미만**으로 삽입된 초안은 **즉시 거부**됩니다!
              
              🎯 **[필수 강제 규칙]**: 
              - 제휴 링크 목록이 제공되었다면 **무조건 최소 2개 이상, 최대 3개**를 본문에 삽입해야 합니다.
              - 연관성이 약하더라도 **창의적으로 연결**하여 반드시 2개 이상 삽입하세요.
              - 1개만 삽입하거나 0개 삽입 시 → **초안 작성 실패**로 간주됩니다.
              
              아래는 사용자가 등록한 제휴 링크(상품) 목록입니다. **반드시 이 목록에서 최소 2개를 선택**하여 본문에 삽입하세요.

              [제휴 링크 목록]
              ${affiliateLinks
                .map(
                  (link) =>
                    `- 키워드: "${(link.keywords || []).join(', ')}"${
                      link.productName ? ` / 상품명: "${link.productName}"` : ''
                    } / URL: ${link.url}`
                )
                .join('\n              ')}

              📋 **[제휴 링크 삽입 규칙 - 엄격 준수]**
              
              **0. 연관성 확인 (Critical)**:
                 - **절대 규칙**: 제휴 상품이 이 글의 주제, 목차, 핵심 내용과 **직접적으로 연관되지 않으면 링크를 삽입하지 마세요**
                 - ✅ 올바른 예시:
                   * 글 주제: "아이폰 케이스 추천" + 제휴 상품: "아이폰 케이스" → 삽입 가능
                   * 글 주제: "스마트홈 구축 가이드" + 제휴 상품: "스마트 플러그" → 삽입 가능
                 - ❌ 잘못된 예시 (절대 금지):
                   * 글 주제: "파리 여행 가이드" + 제휴 상품: "갤럭시 탭" → 연관성 없음, 삽입 금지
                   * 글 주제: "블로그 글쓰기 팁" + 제휴 상품: "청소기" → 연관성 없음, 삽입 금지
              
              **1. 필수 삽입 개수 및 위치 (🚨 CRITICAL - 초안 거부 1순위 규칙)**:
                 - **필수**: 최소 2개 이상, 최대 3개의 제휴 링크를 반드시 삽입
                 
                 - **🔴 [ABSOLUTE RULE] 필수 위치 분산 규칙 - 매 섹션 작성 전 반복 확인**:
                   
                   **첫 번째 링크 삽입 시점 (섹션 2 또는 섹션 3 작성 중)**:
                   * 섹션 2를 작성하는 순간 또는 섹션 3을 작성하는 순간에 제휴 링크 1개를 삽입하세요
                   * ✅ 섹션 2 본문 내부에 링크 1개 OR ✅ 섹션 3 본문 내부에 링크 1개
                   * ❌ 섹션 2, 3을 건너뛰고 나중에 삽입하려는 생각은 금지
                   
                   **두 번째 링크 삽입 시점 (섹션 4 또는 섹션 5 작성 중)**:
                   * 섹션 4를 작성하는 순간 또는 섹션 5를 작성하는 순간에 제휴 링크 1개를 삽입하세요
                   * ✅ 섹션 4 본문 내부에 링크 1개 OR ✅ 섹션 5 본문 내부에 링크 1개
                   * ❌ 섹션 4, 5를 건너뛰고 결론에만 몰아서 삽입하려는 생각은 금지
                   
                   **세 번째 링크 삽입 시점 (결론 작성 중, 선택)**:
                   * 결론 섹션을 작성할 때 제휴 링크 1개를 추가로 삽입할 수 있습니다
                   * ✅ 결론에 링크 1개 (선택)
                   * ⚠️ 주의: 결론에만 2개 이상 몰아서 삽입하는 것은 절대 금지
                 
                 - 🚨 **[초안 즉시 거부 사유 - 자동 실패 처리]**:
                   * ❌ 섹션 2, 3을 작성했는데 제휴 링크가 없고, 결론에만 모든 링크가 있는 경우 → 즉시 거부
                   * ❌ 섹션 4, 5를 작성했는데 제휴 링크가 없고, 결론에만 모든 링크가 있는 경우 → 즉시 거부
                   * ❌ 첫 섹션(섹션 2 또는 3)에만 2-3개를 몰아서 삽입한 경우 → 즉시 거부
                   * ❌ 제휴 링크가 1개 이하인 경우 → 즉시 거부
                 
                 - ✅ **올바른 예시 (반드시 이 패턴을 따르세요)**:
                   * 섹션 2 작성 중 링크 1개 삽입 + 섹션 4 작성 중 링크 1개 삽입 + 결론 작성 중 링크 1개 삽입 (총 3개)
                   * 섹션 3 작성 중 링크 1개 삽입 + 섹션 5 작성 중 링크 1개 삽입 (총 2개)
                   * 섹션 2 작성 중 링크 1개 삽입 + 섹션 5 작성 중 링크 1개 삽입 (총 2개)
                 
                 - ❌ **잘못된 예시 (즉시 거부)**:
                   * 섹션 2, 3, 4, 5 작성 완료 → 결론에만 링크 2개 삽입 → 분산 규칙 위반
                   * 섹션 2에만 링크 3개 몰아서 삽입 → 분산 규칙 위반
                   * 섹션 2, 3, 4, 5에 링크 없음 → 결론에만 링크 1개 → 개수 부족 + 분산 규칙 위반
              
              **2. 삽입 위치 최적화 (구매 의도 발생 시점)**:
                 - ✅ 제품/서비스의 장점이나 필요성을 설명한 **직후**
                 - ✅ 비교 분석 후 특정 제품을 추천할 때
                 - ✅ 사용 방법이나 리뷰를 언급한 후
                 - ✅ "이런 제품이 필요하다면", "더 자세히 알고 싶다면" 같은 전환 문구와 함께
                 - ❌ 글 서론부나 관련 없는 내용 중간에 갑자기 삽입하지 마세요
              
              **3. 자연스러운 문맥 삽입 (Context-Aware)**:
                 - 단순히 키워드를 링크로 바꾸지 말고, 독자가 관심을 가질 만한 타이밍에 배치
                 - ✅ 좋은 예: "이러한 기능을 갖춘 제품을 찾고 있다면, <a href="URL" target="_blank" rel="noopener noreferrer">아이폰 케이스 최저가 확인하기</a>에서 다양한 옵션을 비교해보세요"
                 - ✅ 좋은 예: "실제 사용자 리뷰를 더 확인하고 싶다면 <a href="URL" target="_blank" rel="noopener noreferrer">상품 상세보기 및 후기 확인</a>을 참고하세요"
                 - ❌ 나쁜 예: "아이폰 케이스 [구매하기](URL)" (문맥 없이 갑자기 링크)
              
              **4. 매력적인 CTA(Call To Action) 생성**:
                 - 문맥에 어울리는 행동 유도 문구 사용
                 - 추천 문구: "최저가 확인하기", "상품 상세보기", "사용자 후기 모음 보기", "현재 할인 가격 알아보기", "지금 구매하기", "다양한 옵션 비교하기"
                 - ❌ 피해야 할 표현: "클릭", "여기", "링크" 같은 애매한 단어만 사용
              
              **5. 시각적 강조 (필수)**:
                 - **링크 형식**: <a href="URL" target="_blank" rel="noopener noreferrer">CTA 문구</a>
                 - 예시: <a href="https://link.coupang.com/..." target="_blank" rel="noopener noreferrer">아이폰 15 케이스 최저가 확인하기</a>
              
              **6. 외부 링크와 분리 (매우 중요)**:
                 - **절대 규칙**: 외부 참고 자료 링크와 제휴 링크를 같은 단락에 혼합하지 마세요
                 - ❌ 잘못된 예: "이 [외부 사이트](URL)를 보면... 그리고 [제품 구매하기](제휴URL)" (같은 단락)
                 - ✅ 올바른 방법:
                   * [단락 1] 외부 참고 링크로 정보 제공
                   * [단락 2-3] 추가 설명 (링크 없음)
                   * [단락 4] 제휴 링크로 제품 소개 및 구매 유도
              
              **7. 대가성 문구 자동 삽입 (법적 필수)**:
                 - 제휴 링크가 하나라도 삽입되었다면, **반드시 글의 맨 마지막(결론 다음)**에 아래 문구 포함
                 - **쿠팡 파트너스**: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다." (정확히 이 문장)
                 - **그 외 제휴**: "이 포스팅은 제휴마케팅 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받을 수 있습니다."
                 - **스타일**: <p style="color: #888; font-size: 0.8em; margin-top: 20px;">이 포스팅은 ... 제공받습니다.</p>
              
              **[제휴 링크 삽입 체크리스트 - 🚨 초안 제출 전 필수 확인]**:
              ✅ 글 주제와 연관성 확인했는가?
              ✅ 최소 2개 이상 삽입했는가? (1개만 있으면 초안 거부!)
              ✅ 본문 전체에 고르게 분산 배치했는가? (결론에만 있으면 초안 거부!)
              ✅ 구매 의도가 생기는 위치에 배치했는가?
              ✅ 적절한 링크 형식(<a href="URL">CTA</a>)을 사용했는가?
              ✅ 외부 링크와 분리했는가?
              ✅ 대가성 문구를 글 마지막에 추가했는가?
              
              **중요**: 제휴 링크는 블로그 수익화의 핵심입니다. 연관성이 있다면 반드시 2~3개를 자연스럽게 삽입하세요!
              
              **[초안 완성 전 최종 검증]**:
              - 초안을 완성하기 전에 본문 내 제휴 링크가 실제로 2~3개 삽입되었는지 반드시 확인하세요.
              - 제휴 링크를 찾지 못했다면, 다시 본문을 검토하여 자연스럽게 삽입할 위치를 찾으세요.
              - 연관성이 있는데도 링크가 0개라면, 이는 수익화 기회를 놓치는 것이므로 반드시 수정하세요.
            `
                : ''
            }
            12. **SEO용 JSON-LD 스키마 마크업 생성 (필수)**:
               - 구글 검색 엔진이 이 글을 더 잘 이해하고 상위 노출할 수 있도록, 글의 유형에 맞는 JSON-LD 구조화된 데이터를 생성해주세요.
               - **기본 유형**: 'BlogPosting' 스키마를 기본으로 사용하세요.
               - **리뷰 글인 경우**: 제품이나 장소를 평가하는 내용이라면 'Review' 스키마를 중첩하거나 사용하세요.
               - **FAQ가 포함된 경우**: 본문에 Q&A 섹션이 있다면 'FAQPage' 스키마를 포함하세요.
               - **필수 필드**: 
                 * headline: 위에서 생성한 SEO 최적화된 실제 초안 제목을 사용하세요. (아이디어 제목이 아닌, 실제 초안의 h1 제목)
                 * description: 이 글의 핵심 내용을 150-200자 내외로 요약한 설명을 작성하세요. 검색 결과에 표시될 수 있는 중요한 필드입니다.
                 * author: {
                     "@type": "Person",
                     "name": "${
                       channelInfo?.inputUrl
                         ? new URL(channelInfo.inputUrl).hostname.replace('www.', '')
                         : 'Content Pilot'
                     }"
                   }
                 * datePublished: 현재 날짜를 YYYY-MM-DD 형식으로 작성하세요. (예: ${
                   new Date().toISOString().split('T')[0]
                 })
                 * dateModified: 현재 날짜를 YYYY-MM-DD 형식으로 작성하세요. (필수 필드, datePublished와 동일한 값 사용)
                 * image: 대표 이미지 URL을 배열(List) 형태로 작성하세요. 3가지 비율의 이미지 URL을 포함해야 합니다:
                   - [0]: 1:1 비율 이미지 URL (Square)
                   - [1]: 4:3 비율 이미지 URL (Standard)
                   - [2]: 16:9 비율 이미지 URL (Wide)
                   실제 이미지가 있다면 그 URL을, 없다면 채널의 대표 이미지나 기본 이미지 URL을 3번 반복하여 배열로 작성하세요. 플레이스홀더가 아닌 실제 사용 가능한 URL을 작성해주세요.
                 * url (선택): 발행될 예상 URL이 있다면 포함하세요. (없으면 생략 가능)
               - **추가 권장 필드**:
                 * mainEntityOfPage: {
                     "@type": "WebPage",
                     "@id": "발행될 예상 URL (없으면 생략)"
                   }
                 * publisher: {
                     "@type": "Organization",
                     "name": "${
                       channelInfo?.inputUrl
                         ? new URL(channelInfo.inputUrl).hostname.replace('www.', '')
                         : 'Content Pilot'
                     }",
                     "logo": {
                       "@type": "ImageObject",
                       "url": "채널 로고 URL (없으면 생략 가능)"
                     }
                   }
               - **출력 형식**: 반드시 아래 태그로 감싸서 출력해주세요.
                 <JSON-LD>
                 {
                   "@context": "https://schema.org",
                   "@type": "BlogPosting",
                   "headline": "SEO 최적화된 제목",
                   "description": "150-200자 내외의 핵심 요약",
                   "author": {
                     "@type": "Person",
                     "name": "작성자명 또는 채널명"
                   },
                   "datePublished": "YYYY-MM-DD",
                   "dateModified": "YYYY-MM-DD",
                   "image": ["1:1 비율 URL", "4:3 비율 URL", "16:9 비율 URL"],
                   ...
                 }
                 </JSON-LD>
            13. **스마트 썸네일 A/B 테스팅 정보 생성 (매우 중요)**: 

              초안 생성 후, 클릭률(CTR)을 극대화하기 위해 서로 다른 3가지 컨셉의 썸네일 정보를 JSON 배열 형식으로 반환해주세요.
              
              [썸네일 생성 규칙]
              ${thumbnailPromptGuide}
              
              // ▼▼▼ [추가] 제휴 상품 반영 필수 규칙 시작 ▼▼▼
              [제휴 상품 반영 규칙 - 연관성 우선]
              - 앞서 제공된 **'제휴 마케팅 링크 (수익화)' 목록에 상품이 있고**, **그 상품이 이 글의 주제와 직접 연관된 경우에만**, 3가지 썸네일 프롬프트(thumbnailPromptEn) 중 최소 2개에는 **해당 상품의 구체적인 외형이나 상품명을 포함**시켜주세요.
              - **연관성 확인**: 글 주제가 "청소기 추천"이고 제휴 상품이 "다이슨 V15"라면 연관성 있음 → 프롬프트에 "Dyson V15 vacuum cleaner standing in a modern living room..."과 같이 구체적으로 명시.
              - **중요**: 글 주제가 "파리 여행 가이드"인데 제휴 상품이 "갤럭시 탭"이라면 연관성 없음 → 썸네일에 상품을 포함하지 마세요. 대신 글 주제와 관련된 이미지(파리 풍경 등)를 생성하세요.
              - 단순히 "Vacuum cleaner"라고 하지 말고 "Specific Product Name"을 포함하여 AI가 해당 제품과 최대한 유사한 이미지를 생성하도록 유도하세요 (연관성이 있는 경우에만).
              // ▲▲▲ [추가] 제휴 상품 반영 지침 끝 ▲▲▲
              
              각 컨셉의 특징:

              1. **호기심 자극형 (curiosity)**: "이거 모르면 손해", "충격적인 사실" 등 강렬한 문구와 시선을 끄는 이미지.

              2. **정보 요약형 (informative)**: 핵심 키워드나 숫자를 강조하여 유용함을 어필 (예: "3가지 방법", "완벽 가이드").

              3. **감성/공감형 (emotional)**: 사용자의 고민이나 상황에 공감하는 따뜻한 이미지와 문구.

              형식: 

              <썸네일정보>

              [

                {

                  "type": "curiosity",

                  "thumbnailPromptEn": "영어 프롬프트 (High contrast, dramatic lighting, vibrant colors, 16:9 aspect ratio. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay.)",

                  "thumbnailPromptKo": "한글 프롬프트 (호기심 자극, 강렬한 색상, 드라마틱한 조명)",

                  "thumbnailText": "호기심 문구 (12자 내)",
                  "textPosition": "bottom",
                  "altText": "이미지 대체 텍스트 (한글, SEO 최적화된 설명, 50자 내외)"

                },

                {

                  "type": "informative",

                  "thumbnailPromptEn": "영어 프롬프트 (Clean layout, professional design, bright lighting, organized composition, 16:9 aspect ratio. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay.)",

                  "thumbnailPromptKo": "한글 프롬프트 (정보 강조, 깔끔한 레이아웃, 숫자 표시)",

                  "thumbnailText": "정보형 문구 (12자 내)",
                  "textPosition": "bottom",
                  "altText": "이미지 대체 텍스트 (한글, SEO 최적화된 설명, 50자 내외)"

                },

                {

                  "type": "emotional",

                  "thumbnailPromptEn": "영어 프롬프트 (Warm lighting, cozy atmosphere, soft colors, welcoming feeling, 16:9 aspect ratio. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay.)",

                  "thumbnailPromptKo": "한글 프롬프트 (감성 전달, 따뜻한 조명, 공감대 형성)",

                  "thumbnailText": "공감형 문구 (12자 내)",
                  "textPosition": "bottom",
                  "altText": "이미지 대체 텍스트 (한글, SEO 최적화된 설명, 50자 내외)"

                }

              ]

              </썸네일정보>
              - **썸네일 문구 작성 요령 (매우 중요)**: 
                * 심플하지만 호기심을 유발하는 문구로 작성해주세요.
                * 단순한 키워드 나열(예: "스마트홈 컨트롤")이 아니라, 독자의 호기심을 자극하는 문구여야 합니다.
                * 예시:
                  - 나쁜 예: "스마트홈 컨트롤", "갤럭시 탭", "제품 소개"
                  - 좋은 예: "집 전체를 손끝으로", "미래가 온다", "이것만 있으면 끝", "당신의 집이 스마트해진다", "한 번의 터치로 모든 것 제어"
                * 핵심 키워드를 포함하되, 그것을 감싸는 매력적인 표현으로 작성해주세요.
                * 12자 이내로 제한되지만, 그 안에서 최대한 임팩트 있게 작성해주세요.
                * 질문 형식, 감탄 형식, 혜택 강조 형식 등을 활용할 수 있습니다.
              - **썸네일 이미지 프롬프트 작성 요령**: 
                * 커버 이미지는 글의 첫인상을 결정하는 만큼 눈에 확 들어오는 핵심 이미지를 사용해야 합니다.
                * **제휴 상품이 있다면 해당 상품이 주인공이 되도록 묘사해주세요.** (추가됨)
                * 전체적인 인상을 생생하게 느낄 수 있는 이미지라면 더더욱 좋습니다.
                * 콘텍스트의 매력을 가장 잘 느낄 수 있게 이미지 생성 텍스트 프롬프트로 작성해주세요.
                * 제목과 핵심 내용을 반영하여 시각적으로 강렬하고 매력적인 썸네일을 생성할 수 있도록 구체적이고 생동감 있는 묘사를 포함해주세요.
                * 예: "High-quality, eye-catching background image showcasing [핵심 주제], vibrant colors, professional composition, modern design, compelling visual narrative that captures the essence of [주제], 16:9 aspect ratio, photorealistic style. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay."
            14. **참고 자료 링크 통합 방법 (매우 중요):**
               - **절대 금지**: "(참고 자료 1)", "(참고 자료 2)", "참고 자료 1에 따르면", "참고 자료 3에서", "참고 자료 4" 같은 번호 표기는 절대 사용하지 마세요. 이런 표현이 발견되면 전체 초안이 거부됩니다.
               - **외부 참고 링크 필수**: 연결된 스크랩 자료가 있다면 최소 2-3개의 외부 링크를 본문에 자연스럽게 삽입하세요
               - 참고 자료를 언급할 때는 해당 자료의 제목이나 핵심 내용을 자연스러운 문장의 일부로 만들어 링크로 연결해주세요.
               - "참고하시기 바랍니다", "참고 자료에 따르면" 같은 딱딱한 표현도 피해주세요.
               - 링크는 문맥에 완전히 녹아들어야 하며, 독자가 자연스럽게 클릭하고 싶게 만들어주세요.
               - 좋은 예시들:
                 * "세탁기 고장 예방을 위해서는 [올바른 세제 사용법](URL)을 숙지하는 것이 중요합니다."
                 * "이러한 증상이 나타난다면 전문가의 [자가 진단 가이드](URL)를 확인해보시기 바랍니다."
                 * "더 자세한 내용은 [가전제품 A/S 정책 안내](URL)에서 확인할 수 있습니다."
                 * "실제 사용자들의 경험담은 [고장 사례 모음](URL)에서 볼 수 있습니다."
               - 나쁜 예시들 (절대 사용 금지):
                 * "참고 자료 1에 따르면..." (번호 표기 - 절대 금지)
                 * "(참고 자료 2)" (번호 표기 - 절대 금지)
                 * "참고 자료 3에서..." (번호 표기 - 절대 금지)
                 * "자세한 내용은 [여기](URL)를 참고하시기 바랍니다." (모호한 표현)
                 * "관련 자료: [제목](URL)" (나열식)
            
            ${
              myPastPostsText
                ? `
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            
            �🚫🚫 **[CRITICAL WARNING - 작업 중단 경고]** 🚫🚫🚫
            
            - 3개 삽입 = 통과 불가 (작업 중단)
            - 4-5개 삽입 = 통과 (작업 계속)
            
            ‼️ 링크 개수를 세 번 확인하세요:
            1차 확인: 계획 단계에서 4-5개 선정했는가?
            2차 확인: 작성 중 4-5개를 삽입하고 있는가?
            3차 확인: 작성 완료 후 총 4-5개가 맞는가?
            
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            
            �🚨🚨🚨 **[초안 작성 시작 전 최종 확인 - 필수]** 🚨🚨🚨
            
            지금부터 초안을 작성하기 전에 마지막으로 확인하세요:
            
${buildLinkRules(myPastPostsText, affiliateLinks, linkedScrapsText)}

${myPastPostsText}
            
            ⛔ **URL 중복 절대 금지 (다시 한 번 강조!)** ⛔
            - 앵커 텍스트가 달라도 같은 URL을 2번 쓰면 안 됩니다!
            - ❌ 금지 예시: 
              "케이스 관리는 [이 글](URL-A)을... 변색 방지는 [여기](URL-A)를..."
              → URL-A가 2번 사용됨!
            - ✅ 허용 예시:
              "케이스 관리는 [이 글](URL-A)을... 액세서리는 [여기](URL-B)를..."
              → URL-A, URL-B 모두 다름!
            
            **내부 링크 형식 (다시 한 번 강조):**
            - ✅ 올바른 형식: [투명 케이스 변색 막는 법](https://costcatcher.k-posting.info/entry/clear-case-yellowing-prevention-tips)
            - ❌ 틀린 형식: 투명 케이스 변색 막는 법https://costcatcher.k-posting.info/... (URL이 텍스트에 붙음)
            - ❌ 틀린 형식: [투명 케이스 변색 막는 법] (URL 없음)
            
            ${buildLinkRules(myPastPostsText, affiliateLinks, linkedScrapsText)}


            `
                : ''
            }
            
            [중요] **응답 형식 규칙:**
            - 반드시 **순수 마크다운 형식**으로만 작성해주세요.
            - 코드 블록(\`\`\`markdown ... \`\`\`)이나 다른 래퍼 태그 없이, 순수 마크다운 텍스트만 반환해주세요.
            - 예시: "# 제목\\n\\n본문 내용..." 형식으로 작성 (\`\`\`markdown 태그 없이)
            - 절대 금지: \`\`\`markdown으로 감싸거나, JSON 형식으로 감싸지 마세요.
        `;

    let rawDraft, cleanedDraft, formattedDraft, seoTitle, jsonLdSchema, thumbnailCandidates;
    // Flag used when cropping fails and we fall back to composed image
    let thumbnailGenerationPartialFailure = false;
    // 제목은 함수 최상단에서 하나만 선언되어야 함 (스코프 안정성)
    // title declared earlier (avoid redeclaration)

    // 초안 생성을 스킵하는 경우 기존 값 사용
    if (!generateDraft) {
      Logger.info('[generateDraftFromIdea] 📝 초안 생성 스킵, 기존 값 사용');
      formattedDraft = ideaData.currentDraft || ideaData.draftContent || '';
      seoTitle = ideaData.seoTitle || ideaData.title || '';
      jsonLdSchema = ideaData.publishInfo?.jsonLdSchema || null;
      thumbnailCandidates = ideaData.publishInfo?.thumbnailInfo || [];
    } else {
      Logger.info('[generateDraftFromIdea] 📝 초안 생성 시작');
      try {
        if (typeof options.onProgress === 'function')
          options.onProgress({
            step: 'draft_generation',
            progress: 20,
            message: '초안 생성 중...',
          });
      } catch (e) {
        void 0;
      }

      // API 호출을 helper로 분리 (재시도, 백오프 포함)
      try {
        rawDraft = await callDraftAPI(prompt);
        console.log(
          '[generateDraftFromIdea] checkpoint: rawDraft length:',
          rawDraft ? String(rawDraft).length : 0
        );
      } catch (apiError) {
        // generateDraftFromIdea의 기존 동작을 유지: 마지막 시도 실패 시 에러 전파
        throw apiError;
      }

      // 모든 재시도 후에도 빈 응답이면 기본 템플릿 제공
      if (!rawDraft || rawDraft.trim().length === 0) {
        Logger.error(
          '[generateDraftFromIdea] 모든 재시도 후에도 초안이 비어있습니다. 기본 템플릿을 생성합니다.'
        );

        // 기본 템플릿 생성
        const defaultTitle = title || '콘텐츠 제목';
        const defaultDescription = ideaData.description || '이 콘텐츠에 대한 설명입니다.';

        rawDraft = `# ${defaultTitle}

${defaultDescription}

## 소개

이 주제에 대해 알아보겠습니다.

## 본론

상세한 내용을 작성하는 부분입니다.

## 결론

마무리하는 내용입니다.`;
      } // 빈 응답 및 오류 응답 처리
      if (rawDraft.startsWith('오류:') || rawDraft.includes('오류:')) {
        Logger.error('[generateDraftFromIdea] Gemini API 오류:', rawDraft);
        const errorMessage =
          rawDraft.replace(/^오류:\s*/i, '').trim() || 'Gemini API에서 오류가 발생했습니다.';
        return { success: false, error: errorMessage };
      }

      // 응답 마크다운 -> cleanedDraft / JSON-LD / 썸네일 후보를 처리하는 helper로 이동
      const processed = processDraftResponse(rawDraft, ideaData);
      console.log(
        '[generateDraftFromIdea] checkpoint: processed.cleanedDraft length:',
        processed.cleanedDraft ? String(processed.cleanedDraft).length : 0
      );
      console.log(
        '[generateDraftFromIdea] checkpoint: thumbnailCandidates length:',
        processed.thumbnailCandidates ? processed.thumbnailCandidates.length : 0
      );
      try {
        if (typeof options.onProgress === 'function')
          options.onProgress({
            step: 'thumbnail_prepare',
            progress: 35,
            message: '썸네일 후보 분석 중...',
          });
      } catch (e) {
        void 0;
      }
      cleanedDraft = processed.cleanedDraft;
      jsonLdSchema = processed.jsonLdSchema;
      thumbnailCandidates = processed.thumbnailCandidates;

      // [변경] 2. 안전한 HTML 정제 및 포매팅 (Offscreen 위임)
      Logger.debug('[generateDraftFromIdea] HTML 정제 및 포매팅 시작 (Offscreen)');
      try {
        const sanitizeOptions = {
          disableHighlights: !!options.disableHighlights,
          maxHighlights: options.maxHighlights,
          highlightStyle: options.highlightStyle,
        };
        formattedDraft = await sanitizeHtmlInOffscreen(cleanedDraft, sanitizeOptions);
      } catch (sanitizationError) {
        Logger.error(
          '[generateDraftFromIdea] HTML 정제 실패, 원본 텍스트 사용 (위험):',
          sanitizationError
        );
        // 정제 실패 시 비상 대책: 최소한의 특수문자만이라도 이스케이프하거나 에러 반환
        // 여기서는 안전을 위해 에러를 던지는 것이 맞음
        throw new Error('보안 검사 중 오류가 발생했습니다. 다시 시도해주세요.');
      }

      // [신규] 1차 저장: 텍스트 초안 저장 (썸네일 생성 전)
      // 사용자가 썸네일 생성 중 이탈하더라도 텍스트는 보존되도록 함
      console.log('[generateDraftFromIdea] checkpoint: after sanitizeHtmlInOffscreen');
      if (ideaData.id && formattedDraft) {
        try {
          await saveIntermediateDraft(ideaData.id, formattedDraft);
          console.log('[generateDraftFromIdea] checkpoint: saveIntermediateDraft succeeded (1st)');
        } catch (e) {
          console.warn(
            '[generateDraftFromIdea] checkpoint: saveIntermediateDraft failed (1st):',
            e && e.message ? e.message : e
          );
        }
      }

      // 3. SEO 최적화된 제목 추출 (h1 태그에서)
      console.log('[generateDraftFromIdea] checkpoint: before SEO title extraction');
      // DOMPurify 후에는 확실한 HTML이므로 정규식이 더 잘 동작함
      // NOTE: previously 'let seoTitle = null' shadowed outer variable — use outer 'seoTitle'
      seoTitle = null;
      const h1Match = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      if (h1Match && h1Match[1]) {
        seoTitle = h1Match[1].trim();
      }

      // 4. 제목이 포함되어 있지 않으면 h1으로 추가
      if (title) {
        // h1 태그나 # 제목 형식이 없으면 추가
        const hasH1 = /<h1[^>]*>|<h1>|^#\s+/i.test(formattedDraft);
        if (!hasH1) {
          // 마크다운 형식이면 # 제목, HTML이면 <h1>제목</h1> 추가
          if (formattedDraft.includes('<')) {
            // HTML 형식
            formattedDraft = `<h1>${title}</h1>\n${formattedDraft}`;
            seoTitle = title; // 새로 추가된 제목을 seoTitle로 설정
          } else {
            // 마크다운 형식
            formattedDraft = `# ${title}\n\n${formattedDraft}`;
            seoTitle = title; // 새로 추가된 제목을 seoTitle로 설정
          }
        } else {
          // h1이 이미 있었지만 seoTitle이 추출되지 않았다면 다시 시도
          if (!seoTitle) {
            const h1MatchRetry =
              formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
              formattedDraft.match(/^#\s+(.+)$/m);
            if (h1MatchRetry && h1MatchRetry[1]) {
              seoTitle = h1MatchRetry[1].trim();
            }
          }
        }
      }

      // seoTitle이 여전히 없으면 기본 title 사용
      if (!seoTitle) {
        seoTitle = title;
      }

      // [Fix] Normalize SEO Title to prevent duplication (e.g. "Title - Title")
      if (seoTitle && title) {
        try {
          if (typeof normalizeSeoTitle === 'function') {
            seoTitle = normalizeSeoTitle(seoTitle, title);
          } else {
            // Fallback: if helper unavailable, keep seoTitle as-is
            Logger.warn(
              '[generateDraftFromIdea] normalizeSeoTitle helper missing, skipping normalization'
            );
          }
        } catch (e) {
          Logger.warn('[generateDraftFromIdea] normalizeSeoTitle failed, skipping:', e);
        }
      }

      // [버그 수정] 제목에 중복 년도 제거
      seoTitle = removeDuplicateYears(seoTitle);

      console.debug('[DIAG generateDraftFromIdea] seoTitle extracted from draft:', seoTitle);
    } // 초안 생성 블록 종료

    // [신규] 4-1. JSON-LD 스키마 후처리 (seoTitle 추출 후 실제 데이터로 보완)
    if (jsonLdSchema) {
      try {
        const now = new Date();
        const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

        console.debug(
          '[DIAG generateDraftFromIdea] JSON-LD post-processing - seoTitle before:',
          seoTitle
        );
        // headline이 없거나 비어있으면 seoTitle 사용
        if (!jsonLdSchema.headline || jsonLdSchema.headline.trim() === '') {
          jsonLdSchema.headline = seoTitle || ideaData.title || '';
        } // description이 없거나 비어있으면 ideaData.description 사용
        if (!jsonLdSchema.description || jsonLdSchema.description.trim() === '') {
          jsonLdSchema.description = ideaData.description || '';
          // description이 너무 길면 200자로 제한
          if (jsonLdSchema.description.length > 200) {
            jsonLdSchema.description = jsonLdSchema.description.substring(0, 197) + '...';
          }
        }

        // datePublished가 없거나 잘못된 형식이면 현재 날짜 사용
        if (
          !jsonLdSchema.datePublished ||
          !/^\d{4}-\d{2}-\d{2}$/.test(jsonLdSchema.datePublished)
        ) {
          jsonLdSchema.datePublished = today;
        }

        // [신규] dateModified 필드 추가 (필수)
        jsonLdSchema.dateModified = today;

        // author가 없거나 비어있으면 채널 정보 또는 기본값 사용
        if (
          !jsonLdSchema.author ||
          !jsonLdSchema.author.name ||
          jsonLdSchema.author.name === 'Content Pilot'
        ) {
          const authorName = channelInfo?.inputUrl
            ? new URL(channelInfo.inputUrl).hostname.replace('www.', '')
            : 'Content Pilot';
          jsonLdSchema.author = {
            '@type': 'Person',
            name: authorName,
          };
        }

        // [신규] image 필드를 배열로 처리 (thumbnailUrls가 있으면 실제 URL 사용)
        // thumbnailUrls는 나중에 설정되므로 여기서는 기본 처리만
        if (
          !jsonLdSchema.image ||
          jsonLdSchema.image === 'https://example.com/image.jpg' ||
          jsonLdSchema.image.includes('example.com')
        ) {
          // 채널의 대표 이미지가 있으면 사용, 없으면 제거 (선택 필드)
          if (channelInfo?.thumbnail || channelInfo?.logo) {
            // 배열 형태로 변환
            const channelImage = channelInfo.thumbnail || channelInfo.logo;
            jsonLdSchema.image = [channelImage, channelImage, channelImage]; // 3가지 비율 모두 동일 이미지
          } else {
            // image 필드를 제거 (Google은 선택 필드로 처리)
            delete jsonLdSchema.image;
          }
        } else if (typeof jsonLdSchema.image === 'string') {
          // 문자열인 경우 배열로 변환
          jsonLdSchema.image = [jsonLdSchema.image, jsonLdSchema.image, jsonLdSchema.image];
        } else if (!Array.isArray(jsonLdSchema.image)) {
          // 배열도 문자열도 아닌 경우 배열로 변환
          jsonLdSchema.image = [
            String(jsonLdSchema.image),
            String(jsonLdSchema.image),
            String(jsonLdSchema.image),
          ];
        }

        // url이 없고 publishInfo에 permalink가 있으면 조합
        if (!jsonLdSchema.url && ideaData.publishInfo?.permalink && channelInfo?.inputUrl) {
          try {
            const channelUrl = new URL(channelInfo.inputUrl);
            const isTistory = channelUrl.hostname.includes('tistory.com');
            if (isTistory) {
              jsonLdSchema.url = `${channelUrl.origin}/${ideaData.publishInfo.permalink}`;
            } else {
              jsonLdSchema.url = `${channelUrl.origin}/${ideaData.publishInfo.permalink}`;
            }
          } catch (e) {
            // URL 조합 실패 시 무시
          }
        }

        Logger.info('[generateDraftFromIdea] JSON-LD 스키마 후처리 완료', {
          headline: jsonLdSchema.headline?.substring(0, 50),
          hasDescription: !!jsonLdSchema.description,
          datePublished: jsonLdSchema.datePublished,
          author: jsonLdSchema.author?.name,
          hasImage: !!jsonLdSchema.image,
          hasUrl: !!jsonLdSchema.url,
        });
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] JSON-LD 후처리 실패:', e);
        // 후처리 실패해도 기본 스키마는 유지
      }
    }

    // 5. 퍼머링크 생성 (영문만, URL-safe) - 한글을 영문으로 변환
    const generatePermalink = async (title) => {
      if (!title) return '';

      // 기본 변환 함수 (빠른 폴백)
      const defaultConversion = (text) => {
        return text
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '') // 영문, 숫자, 공백, 하이픈만 유지 (한글 제거)
          .replace(/\s+/g, '-') // 공백을 하이픈으로
          .replace(/-+/g, '-') // 연속된 하이픈을 하나로
          .replace(/^-|-$/g, '') // 앞뒤 하이픈 제거
          .substring(0, 100); // 최대 100자
      };

      // 타임아웃을 포함한 Promise로 래핑
      const translationWithTimeout = Promise.race([
        (async () => {
          try {
            const translationPrompt = `다음 한국어 제목을 SEO에 최적화된 영문 URL 슬러그로 변환해주세요. 
- 영문, 숫자, 하이픈만 사용
- 소문자로 변환
- 공백은 하이픈으로
- 최대 100자
- 검색 최적화를 고려한 키워드 포함

제목: ${title}

영문 슬러그만 반환해주세요 (설명 없이):`;

            const translated = await callGeminiAPI(translationPrompt);
            if (translated && !translated.startsWith('오류:')) {
              return translated
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '') // 영문, 숫자, 공백, 하이픈만 유지
                .replace(/\s+/g, '-') // 공백을 하이픈으로
                .replace(/-+/g, '-') // 연속된 하이픈을 하나로
                .replace(/^-|-$/g, '') // 앞뒤 하이픈 제거
                .substring(0, 100); // 최대 100자
            }
          } catch (e) {
            Logger.error('퍼머링크 번역 실패:', e);
          }
          return null;
        })(),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)), // 5초 타임아웃
      ]);

      try {
        const translated = await translationWithTimeout;
        if (translated) {
          return translated;
        }
      } catch (e) {
        Logger.error('퍼머링크 생성 중 오류:', e);
      }

      // 번역 실패 또는 타임아웃 시 기본 변환 반환
      return defaultConversion(title);
    };

    // 퍼머링크 생성 (타임아웃 보호)
    let permalink = '';
    try {
      permalink = await generatePermalink(seoTitle || title);
    } catch (e) {
      Logger.error('퍼머링크 생성 실패, 기본값 사용:', e);
      // 기본 변환 사용
      const titleForPermalink = seoTitle || title || '';
      permalink = titleForPermalink
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 100);
    }

    // 6. 태그 생성 (쉼표 구분)
    const tagsForPublish = tags
      .map((t) => t.replace(/^#/, ''))
      .filter((t) => t && t !== 'AI-추천')
      .join(', ');

    // 7. 썸네일 정보는 오직 AI 초안(또는 명시적 publishInfo.thumbnailInfo)에서 제공된 경우에만 사용합니다.
    // 따라서 여태까지의 폴백 템플릿/자동 생성 로직은 제거되었습니다.

    // [신규] 썸네일 자동 생성 및 업로드 (첫 번째 컨셉 사용)
    let thumbnailUrls = ideaData.publishInfo?.thumbnailUrls || null; // { url_1x1, url_4x3, url_16x9, altText }

    // If thumbnail candidates exist (provided by draft or parsed tags), or the caller explicitly requested thumbnail generation,
    // try to enhance candidates via generateThumbnailTexts. When thumbnailCandidates are missing but generation is requested,
    // synthesize lightweight candidates from generated slogans (no templated image prompts).
    if (
      (Array.isArray(thumbnailCandidates) && thumbnailCandidates.length > 0) ||
      options.generateThumbnail
    ) {
      try {
        const { slogans } = await generateThumbnailTexts(
          ideaData.outline || [],
          formattedDraft || ''
        );
        if (Array.isArray(slogans) && slogans.length > 0) {
          if (Array.isArray(thumbnailCandidates) && thumbnailCandidates.length > 0) {
            // Map slogans onto existing candidates
            thumbnailCandidates = thumbnailCandidates.map((c, i) => {
              const suggested = slogans[i] || slogans[i % slogans.length] || '';
              const fallbackText = (seoTitle || title || '')
                .replace(/[^\p{L}\p{N}\s]+/gu, '')
                .trim()
                .substring(0, 12);
              return {
                ...c,
                thumbnailText: sanitizeThumbnailText(
                  suggested || c.thumbnailText || '',
                  fallbackText
                ),
              };
            });
          } else {
            // No existing candidates; create minimal candidates from slogans
            const types = ['curiosity', 'informative', 'emotional'];
            thumbnailCandidates = slogans.slice(0, 3).map((s, i) => ({
              type: types[i] || `type${i}`,
              thumbnailPromptEn: '',
              thumbnailPromptKo: '',
              thumbnailText: sanitizeThumbnailText(
                s || '',
                (seoTitle || title || '')
                  .replace(/[^\p{L}\p{N}\s]+/gu, '')
                  .trim()
                  .substring(0, 12)
              ),
              fontFamily: "'Pretendard', sans-serif",
              textColor: 'auto',
              ratio: '16:9',
              bgImage: null,
              overlayOpacity: 0.0,
            }));
          }
        } else {
          // No slogans generated — sanitize existing candidates' thumbnailText if any
          if (Array.isArray(thumbnailCandidates) && thumbnailCandidates.length > 0) {
            thumbnailCandidates = thumbnailCandidates.map((c) => ({
              ...c,
              thumbnailText: sanitizeThumbnailText(
                c.thumbnailText || '',
                (seoTitle || title || '')
                  .replace(/[^\p{L}\p{N}\s]+/gu, '')
                  .trim()
                  .substring(0, 12)
              ),
            }));
          }
        }
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] generateThumbnailTexts failed:', e);
        if (Array.isArray(thumbnailCandidates) && thumbnailCandidates.length > 0) {
          thumbnailCandidates = thumbnailCandidates.map((c) => ({
            ...c,
            thumbnailText: sanitizeThumbnailText(
              c.thumbnailText || '',
              (seoTitle || title || '')
                .replace(/[^\p{L}\p{N}\s]+/gu, '')
                .trim()
                .substring(0, 12)
            ),
          }));
        }
      }
    } else {
      // No thumbnail candidates provided and thumbnail generation not requested; remain empty
      thumbnailCandidates = Array.isArray(thumbnailCandidates) ? thumbnailCandidates : [];
    }

    // NOTE: Thumbnail IMAGE creation (AI image generation, composition, and upload)
    // has been intentionally removed from the draft generation flow. Generating
    // actual thumbnail images is a separate operation and must be invoked via
    // the dedicated `generate_thumbnail_images` action (see `generateThumbnailImages`).
    // This keeps text/draft generation fast and prevents unexpected side-effects
    // (storage writes / image uploads) when only working with text drafts.
    //
    // The pipeline still prepares `thumbnailCandidates` (thumbnailInfo) and short
    // slogans above, but leaves image creation to the explicit image-generation flow.

    // (Thumbnail generation moved to `generateThumbnailImages`)

    // Ensure thumbnail altText exists for accessibility/SEO (set a sanitized fallback when necessary)
    if (thumbnailUrls) {
      try {
        thumbnailUrls.altText = sanitizeAltText(
          thumbnailUrls.altText,
          `${(seoTitle || ideaData.title || '').slice(0, 150)} 썸네일 이미지`
        );
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] 썸네일 altText 설정 실패:', e);
      }
    }

    // Create a metaDescription (150-200 chars) for publishing / preview
    let metaDescription = '';
    try {
      if (jsonLdSchema && jsonLdSchema.description) {
        metaDescription = jsonLdSchema.description;
      } else if (ideaData.description) {
        metaDescription = (ideaData.description || '').substring(0, 200).trim();
      } else if (formattedDraft) {
        const txt = formattedDraft.replace(/<[^>]+>/g, ' ');
        metaDescription = txt.replace(/\s+/g, ' ').trim().substring(0, 200);
      }
      console.log('[generateDraftFromIdea] checkpoint: metaDescription prepared');
    } catch (e) {
      Logger.warn('[generateDraftFromIdea] metaDescription 생성 실패:', e);
    }

    // POST-PROCESS: validate and optionally auto-insert affiliate links
    try {
      // [신규] 시즌 부적합 콘텐츠 검증
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const seasonalKeywords = {
        크리스마스: [12], // 12월만 허용
        '연말연시': [12, 1], // 12월, 1월 허용
        '새해': [12, 1, 2], // 12월~2월 허용
        '겨울방학': [12, 1, 2], // 12월~2월 허용
        '여름휴가': [6, 7, 8], // 6~8월 허용
        '휴가철': [6, 7, 8],
        '한여름': [6, 7, 8],
        '겨울나기': [11, 12, 1, 2], // 11월~2월 허용
        '난방': [10, 11, 12, 1, 2, 3], // 10월~3월 허용
      };
      
      let hasSeasonalIssue = false;
      const seasonalWarnings = [];
      
      for (const [keyword, allowedMonths] of Object.entries(seasonalKeywords)) {
        if (formattedDraft.includes(keyword) && !allowedMonths.includes(currentMonth)) {
          hasSeasonalIssue = true;
          seasonalWarnings.push(`"${keyword}" (현재 ${currentMonth}월에 부적절)`);
        }
      }
      
      if (hasSeasonalIssue) {
        Logger.warn(
          `[generateDraftFromIdea] ⚠️ 시즌 부적합 콘텐츠 감지:`,
          seasonalWarnings.join(', ')
        );
        // 사용자에게 알림 (선택적)
        try {
          chrome.runtime.sendMessage({
            action: 'show_notification',
            title: '시즌 부적합 콘텐츠 감지',
            message: `초안에 현재 시기에 맞지 않는 콘텐츠가 포함되어 있습니다: ${seasonalWarnings.slice(0, 2).join(', ')}`,
          }).catch(() => {});
        } catch (e) {
          // 알림 실패 무시
        }
      }
      
      const storageRes = await chrome.storage.local.get('autoInsertAffiliateLinks');
      const userAutoInsert = storageRes?.autoInsertAffiliateLinks;
      const ideaOptIn = ideaData?.autoInsertAffiliateLinks;
      const shouldAutoInsert = typeof ideaOptIn === 'boolean' ? ideaOptIn : !!userAutoInsert;

      // Auto-insert links: affiliate, internal, reference
      try {
        const internalLinks =
          typeof myPosts !== 'undefined' && Array.isArray(myPosts)
            ? myPosts.map((p) => ({ title: p.title, url: p.fullLink || p.link, keywords: [] }))
            : [];

        const referenceLinks = (ideaData.linkedScrapsContent || [])
          .filter((s) => s && s.url)
          .map((s) => ({ title: s.title || '', url: s.url }));

        const anyLinksAvailable =
          (Array.isArray(affiliateLinks) && affiliateLinks.length > 0) ||
          internalLinks.length > 0 ||
          referenceLinks.length > 0;

        if (shouldAutoInsert && anyLinksAvailable) {
          try {
            formattedDraft = postProcessAffiliateHtml(formattedDraft, affiliateLinks || [], {
              maxLinks: 3,
              internalLinks,
              referenceLinks,
              internalMin: 4,
            });

            // [신규] 제휴 링크 최종 검증: AI가 삽입했는지 확인
            const minRequiredAffiliateLinks = 2;
            if (Array.isArray(affiliateLinks) && affiliateLinks.length >= minRequiredAffiliateLinks) {
              const affiliateLinkCount = (formattedDraft.match(/<a[^>]+href=["'][^"']*["'][^>]*>/gi) || [])
                .filter(tag => {
                  // affiliateLinks의 URL이 포함되어 있는지 확인
                  return affiliateLinks.some(link => tag.includes(link.url));
                }).length;

              if (affiliateLinkCount < minRequiredAffiliateLinks) {
                Logger.warn(
                  `[generateDraftFromIdea] ⚠️ 제휴 링크 삽입 실패: ${affiliateLinkCount}/${minRequiredAffiliateLinks}개`,
                  '- AI가 프롬프트를 무시했거나 postProcessAffiliateHtml이 실패했습니다.'
                );
                try {
                  chrome.runtime.sendMessage({
                    action: 'show_notification',
                    title: '⚠️ 제휴 링크 부족',
                    message: `초안에 제휴 링크가 ${affiliateLinkCount}개만 삽입되었습니다 (최소 ${minRequiredAffiliateLinks}개 필요)`,
                  }).catch(() => {});
                } catch (e) {
                  // 알림 실패 무시
                }
              } else {
                Logger.info(
                  `[generateDraftFromIdea] ✅ 제휴 링크 삽입 성공: ${affiliateLinkCount}개`
                );
              }
            }
          } catch (e) {
            Logger.warn('[generateDraftFromIdea] postProcessAffiliateHtml failed:', e);
          }
        }
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] 자동 링크 삽입 준비 실패:', e);
      }
    } catch (e) {
      Logger.warn('[generateDraftFromIdea] 자동 제휴 삽입 설정 확인 실패:', e);
    }

    // Debug: count anchor tags and matched link types
    try {
      const totalAnchors = (formattedDraft.match(/<a\s+[^>]*href=["'][^"']+["'][^>]*>/gi) || []).length;
      const affiliateAnchorCount = (formattedDraft.match(/<a[^>]+href=["'][^"']*["'][^>]*>/gi) || [])
        .filter(tag => Array.isArray(affiliateLinks) && affiliateLinks.some(link => tag.includes(link.url))).length;
      const internalAnchorCount = (formattedDraft.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [])
        .filter(tag => Array.isArray(internalLinks) && internalLinks.some(il => tag.includes(il.url))).length;
      const referenceAnchorCount = (formattedDraft.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [])
        .filter(tag => Array.isArray(referenceLinks) && referenceLinks.some(r => tag.includes(r.url))).length;
      Logger.debug('[generateDraftFromIdea] Link counts - total:', totalAnchors, 'affiliate:', affiliateAnchorCount, 'internal:', internalAnchorCount, 'reference:', referenceAnchorCount);
    } catch (e) {
      Logger.debug('[generateDraftFromIdea] link counting failed:', e);
    }

    Logger.info(
      '[generateDraftFromIdea] ✅ 초안 생성 완료 - draft 길이:',
      formattedDraft?.length || 0,
      '문자'
    );

    Logger.debug(
      '[generateDraftFromIdea] draft 내용 미리보기:',
      formattedDraft?.substring(0, 200) + '...'
    );

    // Ensure final jsonLdSchema is present for downstream consumers
    if (!jsonLdSchema) {
      try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        const authorName = channelInfo?.inputUrl
          ? new URL(channelInfo.inputUrl).hostname.replace('www.', '')
          : 'Content Pilot';

        const imgArr = [];
        if (thumbnailUrls) {
          if (thumbnailUrls.url_1x1) imgArr.push(thumbnailUrls.url_1x1);
          if (thumbnailUrls.url_4x3) imgArr.push(thumbnailUrls.url_4x3);
          if (thumbnailUrls.url_16x9) imgArr.push(thumbnailUrls.url_16x9);
        }

        jsonLdSchema = {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: seoTitle || ideaData.title || '',
          description: metaDescription || ideaData.description || '',
          author: { '@type': 'Person', name: authorName },
          datePublished: today,
          dateModified: today,
        };

        if (imgArr.length > 0) jsonLdSchema.image = imgArr;
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] final JSON-LD 생성 실패:', e);
      }
    }

    // Final safety: ensure seoTitle is always populated for downstream consumers
    try {
      if (!seoTitle) {
        // prefer jsonLdSchema headline, then H1 extracted from formattedDraft, then ideaData fields
        seoTitle =
          jsonLdSchema?.headline ||
          (typeof formattedDraft === 'string' &&
            (formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1]) ||
          ideaData?.seoTitle ||
          ideaData?.title ||
          '';
      }
      console.log('[generateDraftFromIdea] checkpoint: seoTitle set:', seoTitle);
    } catch (e) {
      // non-fatal — fallback will be empty string
      seoTitle = seoTitle || '';
    }

    console.log(
      '[generateDraftFromIdea] checkpoint: before finalResponse, thumbnailUrls:',
      !!thumbnailUrls
    );
    console.log(
      '[generateDraftFromIdea] DBG: final flags - shouldGenerateThumbnailPrompts:',
      shouldGenerateThumbnailPrompts,
      'generatedThumbUpdates:',
      JSON.stringify(generatedThumbUpdates).slice(0, 200)
    );
    const finalResponse = {
      success: true,
      draft: formattedDraft,
      permalink: permalink,
      tags: tagsForPublish,
      seoTitle: seoTitle, // SEO 최적화된 제목
      thumbnailInfo: thumbnailCandidates, // 썸네일 정보 (배열 형태)
      thumbnailUrls: thumbnailUrls, // [신규] 자동 생성된 썸네일 URL (3가지 비율)
      thumbnailPartialFailure: !!thumbnailGenerationPartialFailure,
      jsonLdSchema: jsonLdSchema, // [신규] JSON-LD 구조화된 데이터
      metaDescription: metaDescription,
      // include generated thumbnail prompt suggestions if requested — default to empty arrays so callers can rely on shape
      thumbnailPrompts:
        options && (options.generateThumbnailPrompts || options.generateThumbnail)
          ? { curiosity: [], info: [], empathy: [] }
          : undefined,
    };
    // Debug: show options at finalization
    try {
      Logger.debug('[generateDraftFromIdea] final options:', options);
    } catch (e) {}

    // Persist thumbnail prompt suggestions to Firebase when requested
    if (shouldGenerateThumbnailPrompts) {
      try {
        console.log(
          '[generateDraftFromIdea] DBG: shouldGenerateThumbnailPrompts block entered - options:',
          options,
          'ideaData.id:',
          ideaData && ideaData.id
        );
        console.log(
          '[generateDraftFromIdea] DBG: entering final persistence block - generateDraft:',
          generateDraft,
          'generatedThumbUpdates:',
          generatedThumbUpdates !== null
        );
        Logger.debug('[generateDraftFromIdea] persisting thumbnail prompts - start');
        const contextText = `${seoTitle || title}${metaDescription ? ' - ' + metaDescription : ''}`;
        const prompts = {
          curiosity: `Generate a JSON array of 4 short curiosity-stimulating thumbnail phrases (Korean), for the topic: "${contextText}". Return JSON array only, e.g. ["...","..."]`,
          info: `Generate a JSON array of 4 concise informational thumbnail phrases (Korean) that summarize the topic: "${contextText}". Return JSON array only.`,
          empathy: `Generate a JSON array of 4 emotional/empathetic thumbnail phrases (Korean) for the topic: "${contextText}". Return JSON array only.`,
        };

        const thumbUpdates = { curiosity: [], info: [], empathy: [] };
        for (const [key, p] of Object.entries(prompts)) {
          try {
            const res = await callGeminiAPI(p);
            console.log(
              '[generateDraftFromIdea] DBG: callGeminiAPI(final) returned for key',
              key,
              '->',
              String(res).slice(0, 200)
            );
            let arr = tryParseArray(String(res || ''));
            if (!Array.isArray(arr)) {
              arr = String(res || '')
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);
            }
            if (Array.isArray(arr)) {
              thumbUpdates[key] = arr.map((s) => String(s).replace(/\s+/g, ' ').trim()).slice(0, 6);
            }
          } catch (e) {
            Logger.warn(
              '[generateDraftFromIdea] thumbnail prompt generation failed for ' + key + ':',
              e
            );
          }
        }
        // assign to holder so finalization persistence picks it up
        generatedThumbUpdates = thumbUpdates;

        // fallback: if AI didn't produce any thumbnail prompts, try to extract from existing thumbnailCandidates
        if (
          (!thumbUpdates.curiosity || thumbUpdates.curiosity.length === 0) &&
          (!thumbUpdates.info || thumbUpdates.info.length === 0) &&
          (!thumbUpdates.empathy || thumbUpdates.empathy.length === 0)
        ) {
          try {
            if (Array.isArray(thumbnailCandidates) && thumbnailCandidates.length > 0) {
              const findByType = (keys) => {
                const found = thumbnailCandidates.find((t) =>
                  keys.some((k) =>
                    String(t.type || '')
                      .toLowerCase()
                      .includes(k)
                  )
                );
                if (!found) return [];
                const src =
                  found.thumbnailPromptKo || found.thumbnailPromptEn || found.thumbnailText || '';
                return src ? [String(src).trim()] : [];
              };
              thumbUpdates.curiosity = findByType(['curiosity', 'curio']);
              thumbUpdates.info = findByType(['inform', 'info', 'informative']);
              thumbUpdates.empathy = findByType(['emot', 'empath', '감성', 'emotional']);
              console.log(
                '[generateDraftFromIdea] DBG: fallback thumbUpdates from thumbnailCandidates:',
                thumbUpdates
              );
            }
          } catch (fallbackErr) {
            Logger.warn(
              '[generateDraftFromIdea] fallback thumbnailCandidates extraction failed:',
              fallbackErr
            );
          }
        }

        if (
          (thumbUpdates.curiosity && thumbUpdates.curiosity.length > 0) ||
          (thumbUpdates.info && thumbUpdates.info.length > 0) ||
          (thumbUpdates.empathy && thumbUpdates.empathy.length > 0) ||
          options.generateDraft === false
        ) {
          try {
            const status = ideaData.status || 'ideas';
            const cardId = ideaData.id;
            if (cardId) {
              const uid = await getCurrentUserId();
              const updatePath = `kanban/${uid}/${status}/${cardId}`;
              Logger.debug('[generateDraftFromIdea] Persisting thumbnailPrompts to:', updatePath);
              // ensure arrays exist even if empty so UI and tests can rely on shape
              const toPersist = {
                curiosity: Array.isArray(thumbUpdates.curiosity) ? thumbUpdates.curiosity : [],
                info: Array.isArray(thumbUpdates.info) ? thumbUpdates.info : [],
                empathy: Array.isArray(thumbUpdates.empathy) ? thumbUpdates.empathy : [],
              };
              console.log(
                '[generateDraftFromIdea] DBG: about to call update(top-level) with publishInfo.thumbnailPrompts:',
                updatePath,
                toPersist
              );
              await update(
                ref(getDb(), updatePath),
                cleanDataForFirebase({ publishInfo: { thumbnailPrompts: toPersist } })
              );
              try {
                console.log(
                  '[generateDraftFromIdea] DBG: about to call update(nested) with thumbnailPrompts:',
                  `${updatePath}/workspace/draft/publishInfo`,
                  toPersist
                );
                await update(
                  ref(getDb(), `${updatePath}/workspace/draft/publishInfo`),
                  cleanDataForFirebase({ thumbnailPrompts: toPersist })
                );
              } catch (nestedErr) {
                Logger.debug(
                  '[generateDraftFromIdea] nested thumbnailPrompts update failed:',
                  nestedErr?.message || String(nestedErr)
                );
              }
            }
          } catch (e) {
            Logger.warn('[generateDraftFromIdea] thumbnailPrompts persistence failed:', e);
          }
        }
      } catch (e) {
        Logger.warn('[generateDraftFromIdea] thumbnail prompts generation overall failed:', e);
      }
    }

    // SAFETY-NET: ensure publishInfo.thumbnailPrompts shape is persisted when requested
    try {
      if (shouldGenerateThumbnailPrompts && ideaData && ideaData.id) {
        const status = ideaData.status || 'ideas';
        const uid = await getCurrentUserId();
        const updatePath = `kanban/${uid}/${status}/${ideaData.id}`;
        const toPersist = {
          curiosity: Array.isArray(generatedThumbUpdates?.curiosity)
            ? generatedThumbUpdates.curiosity
            : [],
          info: Array.isArray(generatedThumbUpdates?.info) ? generatedThumbUpdates.info : [],
          empathy: Array.isArray(generatedThumbUpdates?.empathy)
            ? generatedThumbUpdates.empathy
            : [],
        };
        console.log(
          '[generateDraftFromIdea] SAFETY-NET persisting thumbnailPrompts:',
          updatePath,
          toPersist
        );
        try {
          await update(
            ref(getDb(), updatePath),
            cleanDataForFirebase({ publishInfo: { thumbnailPrompts: toPersist } })
          );
          await update(
            ref(getDb(), `${updatePath}/workspace/draft/publishInfo`),
            cleanDataForFirebase({ thumbnailPrompts: toPersist })
          );
        } catch (safetyErr) {
          Logger.warn(
            '[generateDraftFromIdea] safety-net thumbnailPrompts persistence failed:',
            safetyErr
          );
        }
      }
    } catch (safetyErrOuter) {
      Logger.warn('[generateDraftFromIdea] safety-net outer error:', safetyErrOuter);
    }

    // Ensure finalResponse.thumbnailPrompts reflects any thumbnail generation attempts
    try {
      console.log(
        '[generateDraftFromIdea] ASSIGN FINAL thumbnailPrompts - shouldGenerateThumbnailPrompts:',
        shouldGenerateThumbnailPrompts,
        'generatedThumbUpdates:',
        JSON.stringify(generatedThumbUpdates).slice(0, 200)
      );
      if (shouldGenerateThumbnailPrompts) {
        finalResponse.thumbnailPrompts = {
          curiosity: Array.isArray(generatedThumbUpdates?.curiosity)
            ? generatedThumbUpdates.curiosity
            : [],
          info: Array.isArray(generatedThumbUpdates?.info) ? generatedThumbUpdates.info : [],
          empathy: Array.isArray(generatedThumbUpdates?.empathy)
            ? generatedThumbUpdates.empathy
            : [],
        };
      } else {
        finalResponse.thumbnailPrompts = undefined;
      }
    } catch (e) {
      finalResponse.thumbnailPrompts = { curiosity: [], info: [], empathy: [] };
    }

    console.debug('[DIAG generateDraftFromIdea] final response:', {
      hasDraft: !!formattedDraft,
      seoTitle,
      permalink,
      tagsCount: tagsForPublish?.length,
      hasThumbnailUrls: !!thumbnailUrls,
    });

    // Final safety: ensure the returned object includes thumbnailPrompts shape if caller requested it
    try {
      const requested = !!(
        options &&
        (options.generateThumbnailPrompts || options.generateThumbnail)
      );
      if (requested && finalResponse.thumbnailPrompts === undefined) {
        finalResponse.thumbnailPrompts = {
          curiosity: Array.isArray(generatedThumbUpdates?.curiosity)
            ? generatedThumbUpdates.curiosity
            : [],
          info: Array.isArray(generatedThumbUpdates?.info) ? generatedThumbUpdates.info : [],
          empathy: Array.isArray(generatedThumbUpdates?.empathy)
            ? generatedThumbUpdates.empathy
            : [],
        };
      }
    } catch (e) {
      // ignore
    }

    try {
      console.log(
        '[generateDraftFromIdea] about to RETURN finalResponse.thumbnailPrompts:',
        finalResponse.thumbnailPrompts
      );
    } catch (e) {}
    return finalResponse;
  } catch (e) {
    // If an error occurs late in the pipeline but we already have a formattedDraft,
    // return a best-effort successful response to avoid losing the generated content.
    Logger.error('[generateDraftFromIdea] 오류:', e && e.stack ? e.stack : e);
    if (typeof formattedDraft === 'string' && formattedDraft.trim().length > 0) {
      Logger.warn(
        '[generateDraftFromIdea] 오류 발생했지만 formattedDraft가 있습니다. 베스트-에포트 결과 반환'
      );
      const safeThumbs = {
        curiosity: Array.isArray(generatedThumbUpdates?.curiosity)
          ? generatedThumbUpdates.curiosity
          : [],
        info: Array.isArray(generatedThumbUpdates?.info) ? generatedThumbUpdates.info : [],
        empathy: Array.isArray(generatedThumbUpdates?.empathy) ? generatedThumbUpdates.empathy : [],
      };
      console.log(
        '[generateDraftFromIdea] about to RETURN error-handling success result thumbnailPrompts:',
        shouldGenerateThumbnailPrompts ? safeThumbs : undefined
      );
      return {
        success: true,
        draft: formattedDraft,
        permalink: permalink || null,
        tags: tagsForPublish || [],
        seoTitle: seoTitle || '',
        thumbnailInfo: thumbnailCandidates || [],
        thumbnailUrls: thumbnailUrls || null,
        thumbnailPartialFailure: !!thumbnailGenerationPartialFailure,
        jsonLdSchema: jsonLdSchema || null,
        metaDescription: metaDescription || '',
        thumbnailPrompts: shouldGenerateThumbnailPrompts ? safeThumbs : undefined,
      };
    }
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * Generate thumbnail images (AI generation/composition/upload) from prepared
 * thumbnail candidates and context. This was intentionally split out of
 * `generateDraftFromIdea` to avoid side-effects during draft generation.
 * @param {Object} params - see enhanceDraftWithFeatures params
 * @returns {Promise<Object>} - { success, thumbnailUrls?, thumbnailInfo?, formattedDraft?, jsonLdSchema?, thumbnailGenerationPartialFailure?, error? }
 */
export async function generateThumbnailImages(params = {}) {
  try {
    // Use dynamic import to call the exported enhanceDraftWithFeatures so that
    // tests can spy/mock the exported function reliably.
    const mod = await import('./aiService.js');
    const enhanced = await mod.enhanceDraftWithFeatures(params);
    return {
      success: true,
      thumbnailUrls: enhanced.thumbnailUrls || null,
      thumbnailInfo: params.thumbnailCandidates || [],
      formattedDraft: enhanced.formattedDraft || params.formattedDraft || '',
      jsonLdSchema: enhanced.jsonLdSchema || params.jsonLdSchema || null,
      thumbnailGenerationPartialFailure: !!enhanced.thumbnailGenerationPartialFailure,
    };
  } catch (e) {
    Logger.error('[generateThumbnailImages] error:', e && e.message ? e.message : e);
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

// 6. 아이디어 브리핑
export async function generateIdeaBriefing(cardId, title, description, options = {}) {
  const { onProgress, status = 'ideas', originType = null, origin = null } = options; // status 옵션 추가 + origin context
  const userId = await getCurrentUserId(); // 동적으로 사용자 ID 가져오기
  const updates = {};

  try {
    Logger.info(
      `[generateIdeaBriefing] 시작 - cardId: ${cardId}, title: ${title}, status: ${status}, userId: ${userId}`
    );

    // Gemini API 키 확인
    const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
    if (!geminiApiKey || !geminiApiKey.trim()) {
      Logger.warn(`[generateIdeaBriefing] Gemini API 키가 없습니다. 브리핑 생성을 건너뜁니다.`);
      // API 키가 없으면 조용히 실패 (에러를 throw하지 않고 조용히 종료)
      // 사용자에게는 UI에서 알림을 표시할 수 있도록 메시지 전송
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                action: 'gemini_api_key_missing',
                message:
                  'Gemini API 키가 설정되지 않았습니다. 채널 관리에서 API 키를 입력해주세요.',
              })
              .catch(() => {});
          }
        });
      });
      return { success: false, reason: 'no_gemini_api_key' }; // 에러를 throw하지 않고 명시적인 실패 반환
    }

    // Mark briefing as processing right away so UI can show progress state
    try {
      // update both top-level and workspace/draft so UI that reads either location stays consistent
      await update(ref(getDb(), `kanban/${userId}/${status}/${cardId}`), {
        briefingStatus: 'processing',
        briefingStartedAt: serverTimestamp(),
        briefingProgress: 0,
      });
      try {
        await update(ref(getDb(), `kanban/${userId}/${status}/${cardId}/workspace/draft`), {
          briefingStatus: 'processing',
          briefingStartedAt: serverTimestamp(),
          briefingProgress: 0,
        });
      } catch (nestedErr) {
        // ignore nested update failure
      }
    } catch (e) {
      Logger.warn(
        '[generateIdeaBriefing] briefing processing state update failed:',
        e?.message || String(e)
      );
    }

    // helper to persist briefing progress into DB so UI can show progress bars
    const persistProgress = async (p) => {
      try {
        // keep p numeric and between 0..100
        const value = typeof p === 'number' ? Math.max(0, Math.min(100, Math.round(p))) : null;
        if (value === null) return;
        // update both top-level and nested workspace/draft when possible
        await update(ref(getDb(), `kanban/${userId}/${status}/${cardId}`), {
          briefingProgress: value,
        });
        try {
          await update(ref(getDb(), `kanban/${userId}/${status}/${cardId}/workspace/draft`), {
            briefingProgress: value,
          });
        } catch (nestedErr) {
          // ignore nested path update failures
        }
      } catch (ex) {
        // don't fail the main flow for UI sync issues
        Logger.debug(
          '[generateIdeaBriefing] briefing progress persistence failed:',
          ex?.message || String(ex)
        );
      }
    };

    // set small initial progress marker
    try {
      await persistProgress(5);
    } catch (e) {}

    // helper to parse array responses robustly (try JSON parse, extract array, code block)
    const tryParseArray = (res) => {
      try {
        if (!res) return null;
        let arr = null;
        try {
          arr = JSON.parse(res.trim());
        } catch (e1) {}
        if (!Array.isArray(arr)) {
          const arrayMatch = res.match(/\[[\s\S]*?\]/);
          if (arrayMatch) {
            try {
              arr = JSON.parse(arrayMatch[0]);
            } catch (e2) {
              arr = null;
            }
          }
          if (!Array.isArray(arr)) {
            const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
            if (codeBlockMatch) {
              try {
                arr = JSON.parse(codeBlockMatch[1]);
              } catch (e3) {
                arr = null;
              }
            }
          }
        }
        return Array.isArray(arr) ? arr : null;
      } catch (e) {
        return null;
      }
    };

    // Build context text for prompts: include title + description + affiliate/product info when available
    const buildContextText = () => {
      let ctx = title;
      if (description && description.trim()) ctx += ` - ${description.trim()}`;
      if (originType === 'affiliate_link' && origin) {
        const name = origin.productName || origin.productName || origin.name || '';
        if (name) ctx += ` - 상품명: ${name}`;
        if (origin.platform) ctx += ` - 플랫폼: ${origin.platform}`;
      }
      return ctx;
    };

    const contextText = buildContextText();

    // [핵심 추가] 블로그 수준 분석 함수 (3단계 Fallback: 애널리틱스 → 수동 입력 → 포스팅 개수)
    const analyzeBlogLevel = async () => {
      try {
        const db = getDb(); // 이미 import된 함수 사용
        
        // [1단계] 애널리틱스 데이터 확인 (가장 정확)
        const analyticsSnapshot = await get(ref(db, `analytics/${userId}`));
        
        if (analyticsSnapshot.exists()) {
          const analyticsData = analyticsSnapshot.val();
          let totalPageviews = 0;
          Object.values(analyticsData).forEach(post => {
            if (post.pageviews) totalPageviews += post.pageviews;
          });
          
          Logger.info(`[generateIdeaBriefing] 애널리틱스 기반 분석: 월 ${totalPageviews}명 유입`);
          
          if (totalPageviews < 100) {
            return {
              level: 'beginner',
              strategy: '롱테일 키워드 100% - 경쟁 낮은 키워드로 신뢰도 구축',
              monthlyVisitors: totalPageviews,
              source: 'analytics',
              longTailRatio: 1.0,
              midTailRatio: 0.0
            };
          } else if (totalPageviews < 1000) {
            return {
              level: 'intermediate',
              strategy: '롱테일 70% + 미들테일 30% - 점진적 경쟁 키워드 진입',
              monthlyVisitors: totalPageviews,
              source: 'analytics',
              longTailRatio: 0.7,
              midTailRatio: 0.3
            };
          } else {
            return {
              level: 'advanced',
              strategy: '미들테일 60% + 헤드 키워드 40% - 경쟁 키워드 적극 공략',
              monthlyVisitors: totalPageviews,
              source: 'analytics',
              longTailRatio: 0.3,
              midTailRatio: 0.7
            };
          }
        }
        
        // [2단계] 사용자 수동 입력 확인 (채널 설정에서)
        const { activeChannelId } = await chrome.storage.local.get('activeChannelId');
        if (activeChannelId) {
          const channelSnapshot = await get(ref(db, `channels/${userId}/${activeChannelId}`));
          if (channelSnapshot.exists()) {
            const channelData = channelSnapshot.val();
            const manualVisitors = channelData.estimatedMonthlyVisitors || channelData.monthlyVisitors;
            
            if (manualVisitors && manualVisitors > 0) {
              Logger.info(`[generateIdeaBriefing] 수동 입력 기반 분석: 월 ${manualVisitors}명 유입`);
              
              if (manualVisitors < 100) {
                return {
                  level: 'beginner',
                  strategy: '롱테일 키워드 100% - 경쟁 낮은 키워드로 신뢰도 구축',
                  monthlyVisitors: manualVisitors,
                  source: 'manual',
                  longTailRatio: 1.0,
                  midTailRatio: 0.0
                };
              } else if (manualVisitors < 1000) {
                return {
                  level: 'intermediate',
                  strategy: '롱테일 70% + 미들테일 30% - 점진적 경쟁 키워드 진입',
                  monthlyVisitors: manualVisitors,
                  source: 'manual',
                  longTailRatio: 0.7,
                  midTailRatio: 0.3
                };
              } else {
                return {
                  level: 'advanced',
                  strategy: '미들테일 60% + 헤드 키워드 40% - 경쟁 키워드 적극 공략',
                  monthlyVisitors: manualVisitors,
                  source: 'manual',
                  longTailRatio: 0.3,
                  midTailRatio: 0.7
                };
              }
            }
          }
        }
        
        // [3단계] 발행된 포스팅 개수로 추정 (최후의 방법)
        const publishedSnapshot = await get(ref(db, `kanban/${userId}/published`));
        let publishedCount = 0;
        
        if (publishedSnapshot.exists()) {
          publishedCount = Object.keys(publishedSnapshot.val()).length;
          Logger.info(`[generateIdeaBriefing] 포스팅 개수 기반 분석: ${publishedCount}개 발행`);
          
          if (publishedCount <= 5) {
            return {
              level: 'beginner',
              strategy: '롱테일 키워드 100% - 경쟁 낮은 키워드로 신뢰도 구축',
              monthlyVisitors: 0,
              source: 'post_count',
              note: `발행 포스팅 ${publishedCount}개 (신규 블로그)`,
              longTailRatio: 1.0,
              midTailRatio: 0.0
            };
          } else if (publishedCount <= 20) {
            return {
              level: 'intermediate',
              strategy: '롱테일 70% + 미들테일 30% - 점진적 경쟁 키워드 진입',
              monthlyVisitors: 0,
              source: 'post_count',
              note: `발행 포스팅 ${publishedCount}개 (성장 중)`,
              longTailRatio: 0.7,
              midTailRatio: 0.3
            };
          } else {
            return {
              level: 'advanced',
              strategy: '미들테일 60% + 헤드 키워드 40% - 경쟁 키워드 적극 공략',
              monthlyVisitors: 0,
              source: 'post_count',
              note: `발행 포스팅 ${publishedCount}개 (성숙 블로그)`,
              longTailRatio: 0.3,
              midTailRatio: 0.7
            };
          }
        }
        
        // [기본값] 모든 방법 실패 시
        Logger.warn('[generateIdeaBriefing] 블로그 수준 판단 불가 - 신규 블로그로 간주');
        return {
          level: 'beginner',
          strategy: '롱테일 키워드 100% - 경쟁 낮은 키워드로 신뢰도 구축',
          monthlyVisitors: 0,
          source: 'default',
          note: '데이터 없음 (신규 블로그 추정)',
          longTailRatio: 1.0,
          midTailRatio: 0.0
        };
      } catch (e) {
        Logger.error('[generateIdeaBriefing] 블로그 수준 분석 실패:', e);
        return {
          level: 'beginner',
          strategy: '롱테일 키워드 100% (기본값)',
          monthlyVisitors: 0,
          source: 'error',
          longTailRatio: 1.0,
          midTailRatio: 0.0
        };
      }
    };

    // 블로그 수준 분석 실행
    const blogLevel = await analyzeBlogLevel();
    Logger.info(
      `[generateIdeaBriefing] 블로그 수준: ${blogLevel.level}, 월 유입: ${blogLevel.monthlyVisitors}명, ` +
      `출처: ${blogLevel.source}, 전략: ${blogLevel.strategy}` +
      (blogLevel.note ? `, 참고: ${blogLevel.note}` : '')
    );

    if (options.generateOutline) {
      Logger.debug(`[generateIdeaBriefing] 목차 생성 시작 - 블로그 수준: ${blogLevel.level}`);
      // SEO 최적화 목차 생성 프롬프트
      const prompt = `"${contextText}" 주제의 블로그 포스트 목차 5개를 생성해주세요.

[목차 생성 원칙]
1. **SEO 최적화**: 각 섹션 제목에 검색 의도를 반영한 키워드 포함
2. **독자 여정**: 문제 인식 → 정보 탐색 → 해결책 비교 → 실행 → 확신 순서
3. **검색 질문 형태**: "왜?", "어떻게?", "무엇이?" 등 질문 형태로 구성
4. **구체성**: 추상적 제목보다 구체적 혜택/결과 명시

[블로그 수준 맞춤 전략]
- 현재 수준: ${blogLevel.level}
- 월 유입: ${blogLevel.monthlyVisitors}명
- 권장 전략: ${blogLevel.strategy}

${blogLevel.level === 'beginner' ? '[신규 블로그] 롱테일 키워드 중심 목차 - 구체적이고 세밀한 질문 형태로 작성 (예: "아이폰 15 케이스 카드 수납 기능 필요한가요?")' : ''}
${blogLevel.level === 'intermediate' ? '[성장 중 블로그] 롱테일 + 미들테일 혼합 - 일부 섹션은 구체적 질문, 일부는 일반적 주제로 작성' : ''}
${blogLevel.level === 'advanced' ? '[성숙 블로그] 미들테일 중심 목차 - 포괄적이고 권위 있는 제목으로 작성' : ''}

[목차 구조 예시]
✅ 좋은 예: ["1. 왜 고민될까? 케이스 선택의 딜레마", "2. 디자인 vs 보호력: 어떤 것이 더 중요할까?", "3. 재질별 특징 완벽 비교", "4. 나에게 맞는 케이스 찾기", "5. 추천 제품 TOP 5"]

❌ 나쁜 예: ["1. 소개", "2. 본문", "3. 결론"]

JSON 배열 형식으로만 반환하세요. 예: ["1. 제목", "2. 제목", ...]`;
      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(`[generateIdeaBriefing] Gemini API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] Gemini API 호출 실패:`, apiError);
        // API 호출 실패 시 목차 생성을 건너뛰고 계속 진행
        if (
          apiError.message.includes('Gemini API 키가 없습니다') ||
          apiError.message.includes('API key not valid') ||
          apiError.message.includes('Please pass a valid API key')
        ) {
          Logger.warn(
            `[generateIdeaBriefing] Gemini API 키가 없거나 유효하지 않아 목차 생성을 건너뜁니다.`
          );
          // 사용자에게 알림을 보내기 위해 UI에 메시지 전송
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs
                  .sendMessage(tab.id, {
                    action: 'gemini_api_key_error',
                    message:
                      'Gemini API 키가 없거나 유효하지 않습니다. 채널 관리에서 API 키를 확인해주세요.',
                  })
                  .catch(() => {});
              }
            });
          });
        }
        res = null;
      }

      if (res && !res.startsWith('오류:')) {
        try {
          let outlineArray = tryParseArray(res);
          // if parsing failed, retry once with explicit instruction
          if (!Array.isArray(outlineArray)) {
            try {
              const retryPrompt = `다시 요청합니다. 이전 응답을 무시하고, "${contextText}" 주제의 블로그 목차 5개를 반드시 JSON 배열 형식으로만 응답해주세요.`;
              const retryRes = await callGeminiAPI(retryPrompt);
              outlineArray = tryParseArray(retryRes);
            } catch (retryErr) {
              /* ignore retry error */
            }
          }

          // 방법 1: 직접 JSON 파싱 시도
          try {
            outlineArray = JSON.parse(res.trim());
          } catch (e1) {
            // 방법 2: 배열 부분만 추출
            const arrayMatch = res.match(/\[[\s\S]*?\]/);
            if (arrayMatch) {
              outlineArray = JSON.parse(arrayMatch[0]);
            } else {
              // 방법 3: 마크다운 코드 블록에서 추출
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                outlineArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }

          // 배열인지 확인하고 문자열 배열로 변환
          if (Array.isArray(outlineArray)) {
            updates.outline = outlineArray
              .map((item) => {
                // 객체인 경우 문자열로 변환
                if (typeof item === 'object' && item !== null) {
                  return item.title || item.text || item.name || String(item);
                }
                return String(item);
              })
              .filter((item) => item && item.trim().length > 0);
            Logger.info(
              `[generateIdeaBriefing] 목차 생성 성공: ${updates.outline.length}개 항목`,
              updates.outline
            );
          } else {
            Logger.warn(
              `[generateIdeaBriefing] 목차 파싱 실패: 배열이 아님 - ${typeof outlineArray}`,
              outlineArray
            );
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 목차 파싱 오류:`, parseError);
          Logger.debug(`[generateIdeaBriefing] 원본 응답: ${res}`);
        }
      } else {
        Logger.warn(`[generateIdeaBriefing] 목차 생성 실패 - 응답: ${res || 'null'}`);
      }

      if (onProgress) onProgress(30);
      // persist progress for UI
      await persistProgress(30);
    }

    // 주요 키워드 생성 (미들테일 전략)
    if (options.generateMainKeywords) {
      Logger.debug(`[generateIdeaBriefing] 주요 키워드(미들테일) 생성 시작`);
      const prompt = `"${contextText}" 주제의 블로그 포스트에 적합한 미들테일 키워드 5개를 JSON 배열 형식으로만 반환해주세요.

[미들테일 키워드 선정 기준 - 필수 준수]
1. 검색량: 월 500-1,000회 이상 (네이버 기준)
2. 경쟁도: 중간 수준 (신규 블로그도 6개월 내 진입 가능)
3. 형태: 2-3단어 조합 (예: "아이폰 케이스 추천", "스마트홈 구축 방법")
4. 의도: 정보 탐색형 (구매 의도보다는 학습 의도)

[현재 블로그 수준]
- 수준: ${blogLevel.level}
- 월 유입: ${blogLevel.monthlyVisitors}명
- 권장 전략: ${blogLevel.strategy}

예시: ["아이폰 케이스 추천", "스마트홈 기기", "블로그 글쓰기 팁"]`;
      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(`[generateIdeaBriefing] 주요 키워드 API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] 주요 키워드 API 호출 실패:`, apiError);
        if (
          apiError.message.includes('API key not valid') ||
          apiError.message.includes('Please pass a valid API key')
        ) {
          Logger.warn(
            `[generateIdeaBriefing] Gemini API 키가 유효하지 않아 주요 키워드 생성을 건너뜁니다.`
          );
        }
        res = null;
      }

      if (res && !res.startsWith('오류:')) {
        try {
          let keywordsArray = tryParseArray(res);
          if (!Array.isArray(keywordsArray)) {
            try {
              const retryPrompt = `다시 요청합니다. 이전 응답을 무시하고, "${contextText}" 주제의 블로그 포스트에 적합한 주요 키워드 5개를 JSON 배열 형식으로만 응답해주세요.`;
              const retryRes = await callGeminiAPI(retryPrompt);
              keywordsArray = tryParseArray(retryRes);
            } catch (retryErr) {}
          }
          try {
            keywordsArray = JSON.parse(res.trim());
          } catch (e1) {
            const arrayMatch = res.match(/\[[\s\S]*?\]/);
            if (arrayMatch) {
              keywordsArray = JSON.parse(arrayMatch[0]);
            } else {
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                keywordsArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }

          if (Array.isArray(keywordsArray)) {
            updates.mainKeywords = keywordsArray
              .map((item) => {
                if (typeof item === 'object' && item !== null) {
                  return item.keyword || item.text || item.name || String(item);
                }
                return String(item);
              })
              .filter((item) => item && item.trim().length > 0)
              .slice(0, 5);
            Logger.info(
              `[generateIdeaBriefing] 주요 키워드 생성 성공: ${updates.mainKeywords.length}개`,
              updates.mainKeywords
            );
          } else {
            Logger.warn(`[generateIdeaBriefing] 주요 키워드 파싱 실패: 배열이 아님`);
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 주요 키워드 파싱 오류:`, parseError);
        }
      }

      if (onProgress) onProgress(50);
      await persistProgress(50);
    }

    // 롱테일 키워드 생성 (블로그 수준 반영)
    if (options.generateLongTail) {
      Logger.debug(`[generateIdeaBriefing] 롱테일 키워드 생성 시작 - 블로그 수준: ${blogLevel.level}`);
      const prompt = `"${contextText}" 주제의 블로그 포스트에 적합한 롱테일 키워드(검색 질문 형태) 5개를 JSON 배열 형식으로만 반환해주세요.

[롱테일 키워드 선정 기준 - 필수 준수]
1. 검색량: 월 50-200회 (네이버 기준)
2. 경쟁도: 매우 낮음 (신규 블로그도 1-3개월 내 상위 노출 가능)
3. 형태: 4-6단어 이상 구체적 질문 (예: "아이폰 케이스 스티커 꼭 필요한가")
4. 의도: 구체적 문제 해결 (예: "~해도 되나요", "~차이점은", "~방법")

[현재 블로그 수준]
- 수준: ${blogLevel.level}
- 월 유입: ${blogLevel.monthlyVisitors}명
- 권장 비율: 롱테일 ${Math.round(blogLevel.longTailRatio * 100)}%, 미들테일 ${Math.round(blogLevel.midTailRatio * 100)}%
- 전략: ${blogLevel.strategy}

${blogLevel.level === 'beginner' ? '[신규 블로그 전략] 롱테일 키워드 100% 집중 - 경쟁 낮은 키워드로 신뢰도 구축 후 미들테일 진입' : ''}
${blogLevel.level === 'intermediate' ? '[성장 중 블로그 전략] 롱테일 70% + 미들테일 30% - 기존 신뢰도 활용하여 점진적 경쟁 키워드 진입' : ''}
${blogLevel.level === 'advanced' ? '[성숙 블로그 전략] 미들테일 중심 - 경쟁 키워드 적극 공략하되 롱테일로 안정적 유입 유지' : ''}

예시: ["아이폰 케이스 카드 수납 스티커 꼭 필요한가", "스마트홈 기기 연동 안될 때 해결 방법"]`;
      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(`[generateIdeaBriefing] 롱테일 키워드 API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] 롱테일 키워드 API 호출 실패:`, apiError);
        if (
          apiError.message.includes('API key not valid') ||
          apiError.message.includes('Please pass a valid API key')
        ) {
          Logger.warn(
            `[generateIdeaBriefing] Gemini API 키가 유효하지 않아 롱테일 키워드 생성을 건너뜁니다.`
          );
        }
        res = null;
      }

      if (res && !res.startsWith('오류:')) {
        try {
          let longTailArray = tryParseArray(res);
          if (!Array.isArray(longTailArray)) {
            try {
              const retryPrompt = `다시 요청합니다. 이전 응답을 무시하고, "${contextText}" 주제의 블로그 포스트에 적합한 롱테일 키워드(검색 질문 형태) 5개를 JSON 배열 형식으로만 응답해주세요.`;
              const retryRes = await callGeminiAPI(retryPrompt);
              longTailArray = tryParseArray(retryRes);
            } catch (retryErr) {}
          }
          try {
            longTailArray = JSON.parse(res.trim());
          } catch (e1) {
            const arrayMatch = res.match(/\[[\s\S]*?\]/);
            if (arrayMatch) {
              longTailArray = JSON.parse(arrayMatch[0]);
            } else {
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                longTailArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }

          if (Array.isArray(longTailArray)) {
            updates.longTailKeywords = longTailArray
              .map((item) => {
                if (typeof item === 'object' && item !== null) {
                  return item.keyword || item.text || item.name || String(item);
                }
                return String(item);
              })
              .filter((item) => item && item.trim().length > 0)
              .slice(0, 5);
            Logger.info(
              `[generateIdeaBriefing] 롱테일 키워드 생성 성공: ${updates.longTailKeywords.length}개`,
              updates.longTailKeywords
            );
          } else {
            Logger.warn(`[generateIdeaBriefing] 롱테일 키워드 파싱 실패: 배열이 아님`);
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 롱테일 키워드 파싱 오류:`, parseError);
        }
      }

      if (onProgress) onProgress(70);
      await persistProgress(70);
    }

    // 일반 키워드/추천 검색어 생성 (자료 수집 최적화)
    if (options.generateKeywords) {
      Logger.debug(`[generateIdeaBriefing] 추천 검색어 생성 시작 (자료 수집 목적)`);

      // 자료 수집에 최적화된 프롬프트
      const prompt = `"${contextText}" 주제로 블로그 초안을 작성하기 위해 필요한 자료를 수집할 때 사용할 검색어 10개를 추천해주세요.

## 검색어 목적
초안 작성 시 인용할 통계, 사례, 전문가 의견, 최신 트렌드, 비교 데이터 등을 찾기 위한 실용적인 검색어

## 검색어 생성 원칙
1. **구체성**: "아이폰케이스" 같은 단순 키워드가 아닌, "아이폰 15 케이스 보호력 비교"처럼 구체적인 정보를 찾을 수 있는 검색어
2. **다양성**: 통계, 사례, 가이드, 비교, 리뷰, 최신 뉴스 등 다양한 자료 유형을 커버
3. **실용성**: 실제로 검색 엔진에 입력했을 때 양질의 결과가 나올 검색어
4. **관련성**: 주제와 직접 관련된 키워드 (너무 광범위하거나 무관한 키워드 제외)
5. **단순 키워드 금지**: "아이폰케이스", "아이폰케이스추천" 같은 단순 키워드는 피하고, 반드시 "아이폰 15 케이스 보호력 비교 2024"처럼 구체적인 정보를 찾을 수 있는 문구로 작성

## 검색어 유형 (균형있게 포함, 각 2개씩)
- 통계/데이터 검색어 (예: "스마트홈 시장 규모 2024", "아이폰 케이스 판매량 순위")
- 가이드/방법 검색어 (예: "스마트홈 설치 가이드 초보자용", "아이폰 케이스 선택 기준")
- 비교/분석 검색어 (예: "구글홈 vs 아마존 에코 비교", "실리콘 vs 하드 케이스 장단점")
- 사례/후기 검색어 (예: "스마트홈 구축 사례 집", "아이폰 케이스 장기 사용 후기")
- 최신 트렌드 검색어 (예: "2024 스마트홈 트렌드", "아이폰 16 신기능 전망")

## 잘못된 예시 (절대 금지)
- ❌ "아이폰케이스" (너무 단순, 구체성 부족)
- ❌ "아이폰케이스추천" (단순 키워드 나열)
- ❌ "케이스디자인" (너무 광범위)
- ❌ "폰케이스추천" (주제와 직접 관련 없음)

## 올바른 예시
- ✅ "아이폰 15 케이스 보호력 테스트 결과"
- ✅ "아이폰 케이스 재질별 비교 분석"
- ✅ "갤럭시 vs 아이폰 케이스 시장 점유율 2024"
- ✅ "실리콘 케이스 내구성 분석 후기"
- ✅ "아이폰 케이스 트렌드 변화 전망"

JSON 배열 형식으로만 반환. 해시태그(#) 제외. 반드시 구체적인 문구로 작성.
예: ["스마트홈 시장 규모 2024", "스마트홈 설치 가이드 초보자용", "IoT 기기 추천 순위 비교"]`;

      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(`[generateIdeaBriefing] 추천 검색어 API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] 추천 검색어 API 호출 실패:`, apiError);
        if (
          apiError.message.includes('API key not valid') ||
          apiError.message.includes('Please pass a valid API key')
        ) {
          Logger.warn(
            `[generateIdeaBriefing] Gemini API 키가 유효하지 않아 추천 검색어 생성을 건너뜁니다.`
          );
        }
        res = null;
      }

      if (res && !res.startsWith('오류:')) {
        try {
          let keywordsArray = tryParseArray(res);
          if (!Array.isArray(keywordsArray)) {
            try {
              const retryPrompt = `다시 요청합니다. 이전 응답을 무시하고, "${contextText}" 주제로 초안 작성에 필요한 자료를 수집하기 위한 실용적인 검색어 10개를 JSON 배열 형식으로만 응답해주세요. 해시태그(#) 제외.`;
              const retryRes = await callGeminiAPI(retryPrompt);
              keywordsArray = tryParseArray(retryRes);
            } catch (retryErr) {}
          }
          try {
            keywordsArray = JSON.parse(res.trim());
          } catch (e1) {
            const arrayMatch = res.match(/\[[\s\S]*?\]/);
            if (arrayMatch) {
              keywordsArray = JSON.parse(arrayMatch[0]);
            } else {
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                keywordsArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }

          if (Array.isArray(keywordsArray)) {
            // 자료 수집용 검색어로 저장 (해시태그 형태 변환 제거)
            updates.tags = keywordsArray
              .map((item) => {
                let keyword =
                  typeof item === 'object' && item !== null
                    ? item.keyword || item.text || item.name || String(item)
                    : String(item);
                // 불필요한 기호 제거 및 정리
                keyword = keyword.replace(/^[#\-*•]+/, '').trim();
                return keyword;
              })
              .filter((item) => item && item.trim().length > 0)
              .slice(0, 10);
            Logger.info(
              `[generateIdeaBriefing] 자료 수집용 추천 검색어 생성 성공: ${updates.tags.length}개`,
              updates.tags
            );
          } else {
            Logger.warn(`[generateIdeaBriefing] 추천 검색어 파싱 실패: 배열이 아님`);
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 추천 검색어 파싱 오류:`, parseError);
        }
      }

      if (onProgress) onProgress(90);
      await persistProgress(90);
    }

    // Optional: generate a short SEO meta description and store it as a suggestion
    if (options.generateMetaDescription) {
      Logger.debug(`[generateIdeaBriefing] meta description generation start`);
      try {
        const mdPrompt = `Write a concise SEO meta description (one sentence, max 200 characters) for the topic: "${contextText}". Provide plain text only.`;
        const mdRes = await callGeminiAPI(mdPrompt);
        if (mdRes && String(mdRes).trim()) {
          const md = String(mdRes).replace(/\s+/g, ' ').trim().substring(0, 200);
          updates.publishInfo = updates.publishInfo || {};
          updates.publishInfo.suggestedDescription = md;
          Logger.info(`[generateIdeaBriefing] suggestedDescription generated`);
        }
      } catch (e) {
        Logger.warn('[generateIdeaBriefing] meta description generation failed:', e);
      }
    }

    // Optional: generate thumbnail prompt concepts + example phrases for three categories
    if (options.generateThumbnailPrompts) {
      Logger.debug('[generateIdeaBriefing] options.generateThumbnailPrompts is true');
      Logger.debug(`[generateIdeaBriefing] thumbnail prompts generation start`);
      try {
        const prompts = {
          curiosity: `Generate a JSON array of 4 short curiosity-stimulating thumbnail phrases (Korean), for the topic: "${contextText}". Return JSON array only, e.g. ["...","..."]`,
          info: `Generate a JSON array of 4 concise informational thumbnail phrases (Korean) that summarize the topic: "${contextText}". Return JSON array only.`,
          empathy: `Generate a JSON array of 4 emotional/empathetic thumbnail phrases (Korean) for the topic: "${contextText}". Return JSON array only.`,
        };

        const thumbUpdates = { curiosity: [], info: [], empathy: [] };

        for (const [key, p] of Object.entries(prompts)) {
          try {
            const res = await callGeminiAPI(p);
            Logger.debug(
              `[generateIdeaBriefing] thumbnail prompt response for ${key}:`,
              String(res || '')
            );
            let arr = tryParseArray(String(res || ''));
            Logger.debug(`[generateIdeaBriefing] parsed array for ${key}:`, arr);
            if (!Array.isArray(arr)) {
              // fallback: attempt simple splitting by newline when not JSON
              arr = String(res || '')
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);
            }
            if (Array.isArray(arr)) {
              // keep short phrases only and limit to 6
              thumbUpdates[key] = arr.map((s) => String(s).replace(/\s+/g, ' ').trim()).slice(0, 6);
            }
          } catch (e) {
            Logger.warn(`[generateIdeaBriefing] ${key} thumbnail prompts failed:`, e);
          }
        }

        // Persist only when we have any suggestions
        if (
          (thumbUpdates.curiosity && thumbUpdates.curiosity.length > 0) ||
          (thumbUpdates.info && thumbUpdates.info.length > 0) ||
          (thumbUpdates.empathy && thumbUpdates.empathy.length > 0) ||
          options.generateDraft === false
        ) {
          updates.publishInfo = updates.publishInfo || {};
          updates.publishInfo.thumbnailPrompts = thumbUpdates;
          Logger.info('[generateIdeaBriefing] thumbnailPrompts generated');
        }
      } catch (e) {
        Logger.warn('[generateIdeaBriefing] thumbnail prompts generation overall failed:', e);
      }
    }

    if (Object.keys(updates).length > 0) {
      const updatePath = `kanban/${userId}/${status}/${cardId}`;
      Logger.debug(
        `[generateIdeaBriefing] Firebase 업데이트 시작 - path: ${updatePath}, updates:`,
        updates
      );
      try {
        // Debug: show if thumbnail prompts will be persisted
        if (updates.publishInfo && updates.publishInfo.thumbnailPrompts) {
          Logger.debug(
            '[generateIdeaBriefing] Persisting thumbnailPrompts (top-level):',
            updates.publishInfo.thumbnailPrompts
          );
        }

        await update(ref(getDb(), updatePath), cleanDataForFirebase(updates));

        // Also persist only the thumbnailPrompts to the nested workspace/draft/publishInfo so UI reading the nested draft sees it
        try {
          if (updates.publishInfo && updates.publishInfo.thumbnailPrompts) {
            await update(
              ref(getDb(), `${updatePath}/workspace/draft/publishInfo`),
              cleanDataForFirebase({ thumbnailPrompts: updates.publishInfo.thumbnailPrompts })
            );
            Logger.debug(
              '[generateIdeaBriefing] Persisted thumbnailPrompts to nested workspace/draft/publishInfo'
            );
          }
        } catch (nestedErr) {
          Logger.debug(
            '[generateIdeaBriefing] nested publishInfo thumbnailPrompts update failed:',
            nestedErr?.message || String(nestedErr)
          );
        }

        // mark completion metadata so UI and other consumers know briefing finished
        try {
          await update(ref(getDb(), updatePath), {
            briefingStatus: 'done',
            briefingCompletedAt: serverTimestamp(),
            briefingProgress: 100,
          });
        } catch (e) {
          Logger.warn(
            '[generateIdeaBriefing] briefing completion state update failed:',
            e?.message || String(e)
          );
        }
        // also update the nested workspace/draft location if present to keep initial queued flag in sync
        try {
          await update(ref(getDb(), `${updatePath}/workspace/draft`), {
            briefingStatus: 'done',
            briefingCompletedAt: serverTimestamp(),
            briefingProgress: 100,
          });
        } catch (nestedErr) {}

        Logger.biz(
          `✅ [generateIdeaBriefing] 브리핑 생성 완료 - cardId: ${cardId}, status: ${status}, 업데이트 항목: ${Object.keys(
            updates
          ).join(', ')}`
        );
      } catch (updateError) {
        Logger.error(`[generateIdeaBriefing] Firebase 업데이트 실패:`, updateError);
        // mark failure and return structured error
        try {
          await update(ref(getDb(), updatePath), {
            briefingStatus: 'failed',
            briefingError: String(updateError),
            briefingCompletedAt: serverTimestamp(),
          });
        } catch (e) {}
        return { success: false, error: updateError?.message || String(updateError) };
      }

      // REST API 모드에서는 실시간 리스너가 작동하지 않으므로, UI 갱신을 위해 최신 데이터를 가져와서 메시지 전송
      try {
        const kanbanRef = ref(getDb(), `kanban/${userId}`);
        const kanbanSnap = await get(kanbanRef);
        const kanbanData = kanbanSnap?.val() || {};

        // 1. 확장 프로그램 UI(사이드 패널/팝업)에 메시지 전송 (chrome.runtime.sendMessage)
        chrome.runtime
          .sendMessage({
            action: 'kanban_data_updated',
            data: kanbanData,
          })
          .catch((err) => {
            // 확장 프로그램 UI가 닫혔을 수 있음 (정상적인 상황)
            if (
              err?.message &&
              !err.message.includes('message port closed') &&
              !err.message.includes('Could not establish connection')
            ) {
              Logger.debug(
                `[generateIdeaBriefing] 확장 프로그램 UI 메시지 전송 실패:`,
                err.message
              );
            }
          });

        // 2. 웹페이지 탭의 content script에도 메시지 전송 (chrome.tabs.sendMessage)
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (
              tab.id &&
              tab.url &&
              !tab.url.startsWith('chrome://') &&
              !tab.url.startsWith('edge://') &&
              !tab.url.startsWith('about:')
            ) {
              chrome.tabs
                .sendMessage(tab.id, {
                  action: 'kanban_data_updated',
                  data: kanbanData,
                })
                .catch(() => {
                  // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
                  // 조용히 무시
                });
            }
          });
        });
        Logger.debug(`[generateIdeaBriefing] UI 갱신 메시지 전송 완료`);
      } catch (updateError) {
        Logger.warn(`[generateIdeaBriefing] UI 갱신 메시지 전송 실패:`, updateError);
        // UI 갱신 실패해도 브리핑 생성은 성공으로 처리
      }
    } else {
      Logger.warn(
        `[generateIdeaBriefing] 업데이트할 데이터 없음 - 모든 생성 옵션이 실패했거나 비활성화됨`
      );
      // mark no-updates as a completed but empty briefing
      try {
        await update(ref(getDb(), `kanban/${userId}/${status}/${cardId}`), {
          briefingStatus: 'done',
          briefingCompletedAt: serverTimestamp(),
        });
      } catch (e) {
        void 0;
      }
      return { success: true, updates: [] };
    }
  } catch (error) {
    Logger.error(
      `[generateIdeaBriefing] 전체 오류 - cardId: ${cardId}, title: ${title}, userId: ${userId}:`,
      error
    );
    // 에러를 다시 throw하여 상위에서 처리할 수 있도록 함
    // persist failure state
    try {
      await update(ref(getDb(), `kanban/${userId}/${status}/${cardId}`), {
        briefingStatus: 'failed',
        briefingError: error?.message || String(error),
        briefingCompletedAt: serverTimestamp(),
        briefingProgress: 0,
      });
    } catch (e) {
      void 0;
    }
    // also propagate failed status to nested workspace/draft
    try {
      await update(ref(getDb(), `kanban/${userId}/${status}/${cardId}/workspace/draft`), {
        briefingStatus: 'failed',
        briefingError: error?.message || String(error),
        briefingCompletedAt: serverTimestamp(),
        briefingProgress: 0,
      });
    } catch (nestedErr) {}
    return { success: false, error: error?.message || String(error) };
  }
  // 성공 시 구조화된 결과를 반환
  return { success: true, updates: Object.keys(updates) };
}

// 7. 이미지 생성 (병렬 처리 적용) - Imagen 3 API 적용
export async function generateAiImage(prompt, count = 1, referenceImage = null) {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (!geminiApiKey) {
    throw new Error('Gemini API 키가 없습니다.');
  }

  // [수정] Gemini 2.0 모델 사용 (generateContent 엔드포인트)
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.IMAGE}:generateContent?key=${geminiApiKey}`;
  const userId = await getCurrentUserId();

  const MAX_CONCURRENT = 3;

  const generateSingleImage = async (index) => {
    try {
      // [핵심 수정] 시스템 프롬프트(THUMBNAIL_SYSTEM_PROMPT) 제거!
      // 대신 "이미지를 생성하라"는 명확한 지시어를 추가합니다.
      const imageGenerationPrompt = `Generate a high-quality blog thumbnail image based on the following description: ${prompt}`;

      // DEV: broadcast the constructed image prompt for UI debug
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'debug_show_prompt',
            promptType: 'imageGeneration.input',
            prompt: imageGenerationPrompt,
          });
        }
      } catch (e) {}

      const parts = [{ text: imageGenerationPrompt }];

      // [DEBUG] generateAiImage에 전달된 referenceImage 요약
      try {
        const refsSummary = Array.isArray(referenceImage)
          ? referenceImage.map((r) => ({
              mimeType: r?.mimeType,
              hasData: !!r?.data,
              dataLen: r?.data ? r.data.length : 0,
            }))
          : referenceImage
            ? [
                {
                  mimeType: referenceImage.mimeType,
                  hasData: !!referenceImage.data,
                  dataLen: referenceImage.data ? referenceImage.data.length : 0,
                },
              ]
            : [];
        console.log('%c[AI 썸네일 메이커 디버깅][generateAiImage input summary]', 'color:#9E9E9E', {
          refsSummary,
        });
      } catch (e) {
        void 0;
      }

      // 참조 이미지(s)가 있는 경우 추가 (단일 오브젝트 또는 배열 허용)
      if (referenceImage) {
        const refs = Array.isArray(referenceImage) ? referenceImage : [referenceImage];
        const inlineCount = refs.filter((r) => r && r.data).length;
        if (inlineCount > 0) {
          for (const [i, r] of refs.entries()) {
            if (r && r.data) {
              // 데이터 길이 로그
              try {
                console.log('%c[AI 썸네일 메이커 디버깅][inlineData add]', 'color:#9E9E9E', {
                  index: i,
                  mimeType: r.mimeType,
                  dataLen: r.data.length,
                });
              } catch (e) {
                void 0;
              }
              parts.push({
                inlineData: {
                  mimeType: r.mimeType || 'image/png',
                  data: r.data,
                },
              });
            }
          }
          Logger.debug(`[generateAiImage] 🖼️ 참조 이미지 ${inlineCount}개를 포함하여 요청합니다.`);
        }
      }

      // [DEBUG] 최종 요청 데이터 확인
      console.log('%c[AI 썸네일 메이커 디버깅][API Request]', 'color:#9E9E9E', {
        textPart: parts.find((p) => p.text)?.text,
        imagePartsCount: parts.filter((p) => p.inlineData).length,
      });

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: parts }],
          // [추가] 텍스트가 아닌 이미지를 강제로 반환하도록 설정
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API 오류: ${res.status}`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error.message || '이미지 생성 실패');
      }

      if (!data.candidates || data.candidates.length === 0) {
        if (data.promptFeedback && data.promptFeedback.blockReason) {
          throw new Error(`이미지 생성 차단됨 (사유: ${data.promptFeedback.blockReason})`);
        }
        throw new Error('이미지 생성 응답에 candidates가 없습니다.');
      }

      const candidate = data.candidates[0];

      // 안전 차단 확인
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`AI가 이미지 생성을 중단했습니다. 사유: ${candidate.finishReason}`);
      }

      let base64 = null;
      let mimeType = 'image/png';

      // [수정] Gemini 2.0의 이미지 응답(Inline Data) 찾기
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          // Gemini가 이미지를 생성하면 inlineData에 담겨 옵니다.
          if (part.inlineData?.data) {
            base64 = part.inlineData.data;
            mimeType = part.inlineData.mimeType || 'image/png';
            break;
          }
        }
      }

      if (base64) {
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const url = await uploadImageToFirebaseStorage(
          dataUrl,
          `thumbnails/${userId}/${Date.now()}_${index}.png`,
          userId
        );
        Logger.debug(`[generateAiImage] ✅ 이미지 ${index + 1}/${count} 업로드 완료`);
        return url;
      } else {
        // 이미지가 없고 텍스트만 온 경우 (거부 메시지 등)
        if (candidate.content?.parts?.[0]?.text) {
          const textResponse = candidate.content.parts[0].text;
          Logger.warn('[generateAiImage] 이미지가 아닌 텍스트 응답이 왔습니다:', textResponse);
          throw new Error(
            `AI가 이미지를 생성하지 않고 텍스트로 응답했습니다. (내용: "${textResponse.substring(0, 50)}...")`
          );
        }
        throw new Error('base64 데이터를 찾을 수 없습니다. (API 응답에 이미지 데이터 누락)');
      }
    } catch (e) {
      Logger.error(`[generateAiImage] 이미지 ${index + 1}/${count} 생성 실패:`, e);
      return null;
    }
  };

  const tasks = Array.from({ length: count }, (_, i) => () => generateSingleImage(i));

  const results = [];
  const executing = [];

  for (const task of tasks) {
    const p = task();
    results.push(p);

    const e = p.then(() => {
      executing.splice(executing.indexOf(e), 1);
    });
    executing.push(e);

    if (executing.length >= MAX_CONCURRENT) {
      await Promise.race(executing);
    }
  }

  const allResults = await Promise.all(results);
  const successfulImages = allResults.filter((url) => url !== null);

  if (successfulImages.length === 0) {
    throw new Error('생성된 이미지가 없습니다. (모든 시도 실패)');
  }

  return successfulImages;
}

// 8. 템플릿 분석
export async function analyzeImageForTemplate(_data) {
  // ... (Vision API 호출 로직)
  return { success: true };
}

// 9. 채널 분석
export async function analyzeMyChannel(_data) {
  // TODO: 채널 분석 로직 구현
  return { success: true, analysis: '' };
}

// 10. 콘텐츠 아이디어 생성
export async function generateContentIdeas(_data) {
  // TODO: 콘텐츠 아이디어 생성 로직 구현
  return { success: true, ideas: [] };
}

// 11. 검색 키워드 생성 및 전송
export async function generateAndSendKeywords(data, sender) {
  // TODO: 검색 키워드 생성 로직 구현
  const keywords = [];
  if (sender.tab?.id) {
    chrome.tabs
      .sendMessage(sender.tab.id, {
        action: 'search_queries_recommended',
        success: true,
        data: keywords,
        cardId: data.cardId,
        status: data.status,
        cardTitle: data.title,
      })
      .catch(() => {});
  }
  return { success: true, keywords };
}

// 12. 비디오 댓글 분석
export async function analyzeVideoComments(_videoId) {
  // TODO: 비디오 댓글 분석 로직 구현
  return { success: true, comments: [] };
}
