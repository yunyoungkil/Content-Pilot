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

// [신규] 제목에서 중복 년도를 제거하는 헬퍼 함수
function removeDuplicateYears(title) {
  if (!title) return title;
  // 정규식으로 연속된 같은 년도 패턴을 찾아 하나로 줄임
  // 예: "2024년 2024년 최고의" -> "2024년 최고의"
  return title.replace(/(\d{4}년)(\s+\1)+/g, '$1');
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
            console.log('[fetchImageAsBase64 DEBUG] background fetch succeeded for URL', url);
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
          console.log(
            '[fetchImageAsBase64 DEBUG] background fetch failed, falling back to fetch for URL',
            url
          );
        } catch (e) {
          void 0;
        }
      }
    }

    Logger.debug('[fetchImageAsBase64] Falling back to fetch for URL:', url);
    try {
      console.log('[fetchImageAsBase64 DEBUG] falling back to fetch for URL', url);
    } catch (e) {
      void 0;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`이미지 다운로드 실패: ${response.status}`);
    try {
      console.log('[fetchImageAsBase64 DEBUG] fetch succeeded for URL', url);
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
      } catch (e) {
        Logger.warn('[processDraftResponse] 썸네일정보 파싱 실패:', e);
        thumbnailCandidates = [];
      }

      // Remove the thumbnail tag from the draft
      cleanedDraft = cleanedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '').trim();
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

    const sourceImageUrl = generatedImages[0];
    Logger.info('[enhanceDraftWithFeatures] sourceImageUrl chosen:', sourceImageUrl);

    // Compose text overlay if requested
    let composedDataUrl = sourceImageUrl;
    if (composeThumbnailText) {
      const thumbnailText =
        selectedThumbnail.thumbnailText ||
        (ideaData.title.length > 10 ? ideaData.title.substring(0, 8) + '...' : ideaData.title);
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
        const COMPOSE_TIMEOUT_MS = 8000;
        const composePromise = composeThumbnailInOffscreen(
          sourceImageUrl,
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

// [신규] 제휴 링크 조회 및 필터링 헬퍼 함수
async function getRelevantAffiliateLinks(userId, contextText, options = {}) {
  try {
    const snap = await get(ref(getDb(), `affiliate_links/${userId}`));
    const linksMap = snap?.val();

    if (!linksMap) {
      Logger.debug('[getRelevantAffiliateLinks] 제휴 링크 없음');
      return [];
    }

    const links = Object.values(linksMap);
    if (links.length === 0) {
      Logger.debug('[getRelevantAffiliateLinks] 제휴 링크 배열이 비어있음');
      return [];
    }

    // contextText(제목+태그)에 키워드/상품명이 포함된 링크를 스코어링하고 정렬
    const contextLower = (contextText || '').toLowerCase();
    const preferredId = options.preferredAffiliateId || null;

    const scored = links
      .map((link) => {
        const keywords = Array.isArray(link.keywords) ? link.keywords : [];
        let score = 0;
        // keywords matching score
        keywords.forEach((keyword) => {
          try {
            if (keyword && contextLower.includes(String(keyword).toLowerCase())) score += 1;
          } catch (e) {
            /* ignore */
          }
        });
        // product name match gives higher priority
        const productNameLower = (link.productName || '').toLowerCase();
        if (productNameLower && contextLower.includes(productNameLower)) score += 5;
        // if preferred id provided, give a large bonus
        if (preferredId && link.id === preferredId) score += 1000;
        return { link, score };
      })
      // Exclude invalid entries (no keywords/url) or zero score, unless it's preferred
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
        return score > 0;
      });

    // sort by score desc, then most recent
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.link.createdAt || 0) - (a.link.createdAt || 0);
    });

    const relevantLinks = scored.map((s) => s.link);
    try {
      Logger.debug(
        '[getRelevantAffiliateLinks] link scores:',
        scored.map((s) => ({
          id: s.link.id,
          score: s.score,
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
        scored.map((s) => ({
          id: s.link.id,
          score: s.score,
          hasImage: !!s.link.cardData?.imageUrl,
        }))
      );
    } catch (e) {
      void 0;
    }

    // 최대 10개까지만 반환 (프롬프트 과부하 방지)
    const result = relevantLinks.slice(0, 10);
    Logger.info(
      `[getRelevantAffiliateLinks] 관련 링크 ${result.length}개 선택됨 (전체 ${links.length}개 중)`
    );
    return result;
  } catch (error) {
    Logger.warn('[getRelevantAffiliateLinks] 제휴 링크 조회 실패:', error);
    return [];
  }
}
export { getRelevantAffiliateLinks };
export { sanitizeThumbnailText };

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
  const { maxLinks = 3 } = options || {};
  if (!html || !Array.isArray(affiliateLinks) || affiliateLinks.length === 0) return html;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Normalize affiliate urls for quick lookup
    const normalized = affiliateLinks.map((l) => ({
      url: (l.url || '').trim(),
      productName: l.productName || '',
      keywords: Array.isArray(l.keywords) ? l.keywords : [],
    }));

    // Helper: check if href matches any affiliate URL (startsWith or exact)
    const findAffiliateByHref = (href) => {
      if (!href) return null;
      const hrefNorm = href.trim();
      return normalized.find((a) => hrefNorm === a.url || hrefNorm.startsWith(a.url));
    };

    // 1) Ensure existing anchors that match affiliate links are wrapped/styled
    const anchors = Array.from(doc.querySelectorAll('a[href]') || []);
    let insertedCount = 0;
    anchors.forEach((a) => {
      const match = findAffiliateByHref(a.getAttribute('href'));
      if (match && insertedCount < maxLinks) {
        // Wrap with span color style if not already
        const parent = a.parentElement;
        if (
          !parent ||
          parent.tagName.toLowerCase() !== 'span' ||
          !parent.getAttribute('style')?.includes('#2e7d32')
        ) {
          const span = doc.createElement('span');
          span.setAttribute('style', 'color: #2e7d32;');
          a.replaceWith(span);
          span.appendChild(a);
        }
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

    // 2) If we need more, attempt deterministic insertion: find keywords/productName matches in text nodes
    if (insertedCount < maxLinks) {
      const usedUrls = new Set(
        Array.from(doc.querySelectorAll("span[style*='#2e7d32'] a[href]")).map((el) =>
          el.getAttribute('href')
        )
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

      // Helper to escape regex
      const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      for (const link of normalized) {
        if (insertedCount >= maxLinks) break;
        const targetUrl = link.url;
        if (!targetUrl || usedUrls.has(targetUrl)) continue;

        const candidates = [...(link.keywords || []), link.productName].filter(Boolean);
        if (candidates.length === 0) continue;

        // try to find first occurrence among text nodes
        let matched = false;
        // Use plain substring match (case-insensitive) for keywords and product names
        const patterns = candidates.map((c) => new RegExp(escapeReg(c), 'i'));

        for (const tnode of textNodes) {
          const txt = tnode.textContent;
          for (const pattern of patterns) {
            const m = txt.match(pattern);
            if (m) {
              // Create replacement span > a
              const span = doc.createElement('span');
              span.setAttribute('style', 'color: #2e7d32;');
              const a = doc.createElement('a');
              a.setAttribute('href', targetUrl);
              a.setAttribute('target', '_blank');
              a.setAttribute('rel', 'noopener noreferrer');
              // CTA text - prefer short CTA using productName when available
              const cta = link.productName
                ? `${link.productName} 최저가 확인하기`
                : '상품 상세보기';
              a.textContent = cta;
              span.appendChild(a);

              // Replace only the first match occurrence inside this text node
              const before = txt.slice(0, m.index);
              const after = txt.slice(m.index + m[0].length);
              const frag = doc.createDocumentFragment();
              if (before) frag.appendChild(doc.createTextNode(before));
              frag.appendChild(span);
              if (after) frag.appendChild(doc.createTextNode(after));

              // Guard against detached text nodes: ensure parentNode exists before replacing
              if (tnode.parentNode) {
                tnode.parentNode.replaceChild(frag, tnode);
              } else {
                Logger.warn(
                  '[postProcessAffiliateHtml] 텍스트 노드의 parentNode가 존재하지 않아 대체 작업을 건너뜁니다.',
                  tnode
                );
              }
              insertedCount += 1;
              usedUrls.add(targetUrl);
              matched = true;
              break;
            }
          }
          if (matched) break;
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

    // 사용자 설정 로드 (options에 값이 없으면 저장소에서 확인)
    let composeThumbnailText = options.composeThumbnailText;
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
    const systemPrompt = builder.buildSystemPrompt();

    // 로깅
    Logger.biz(
      `🎭 [Persona Build]`,
      `Type: ${builder.getPersonaName()}, Custom Tone: ${ideaData.tone || builder.getToneName()}`
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
        .replace(/\n\s*\n/g, '\n') // 여러 줄 공백을 한 줄로 축소
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

        // 이미지가 있고 텍스트가 적거나(500자 미만) 이미지를 강조하고 싶을 때 분석 시도
        // 여기서는 이미지가 있으면 무조건 분석하도록 설정 (필요시 조건 조절)
        let imageAnalysis = '';
        if (scrap.image) {
          Logger.info(`[generateDraft] 스크랩 #${index + 1} 이미지 분석 시작...`);
          const analysisResult = await analyzeScrapImage(scrap.image);
          if (analysisResult) {
            imageAnalysis = `\n\n[이미지 분석 내용 (Vision AI)]:\n${analysisResult}`;
          }
        }

        // 길이 제한 (2500자)
        if (content.length > 2500) {
          const front = content.substring(0, 2000);
          const back = content.substring(content.length - 500);
          content = `${front}\n...(중략)...\n${back}`;
        }

        processedScraps[index] =
          `[참고 자료 ${index + 1}]\n제목: ${scrap.title || ''}\nURL: ${scrap.url || ''}\n내용:\n${content}${imageAnalysis}\n`;
      })
    );

    const linkedScrapsText = processedScraps.join('\n\n');

    // 3. 원본 본문 참조: origin.fullContent가 있으면 참고 자료에 추가
    let originalContentText = '';
    if (ideaData.origin?.fullContent && ideaData.origin.fullContent.length > 0) {
      originalContentText = `[원본 본문 (리뉴얼 참고용)]\n${ideaData.origin.fullContent.substring(
        0,
        5000
      )}\n\n`;
    }

    // 4. [스마트 내부 링크] 내 과거 포스팅 목록 조회 (수정됨)
    let myPastPostsText = '';
    try {
      const userId = await getCurrentUserId();
      const contentSnap = await get(ref(getDb(), `channel_content/${userId}/blogs`));
      const allBlogs = contentSnap?.val() || {};

      // 현재 채널의 글만 필터링
      const myPosts = Object.values(allBlogs)
        .filter((item) => item !== null && item.title && item.fullLink)
        .filter((item) => {
          // channelId가 지정되지 않은 카드는 모든 글을 포함
          if (!ideaData.channelId) return true;

          // [핵심 수정] 변환된 ID(targetSourceId)와 비교
          if (targetSourceId && item.sourceId === targetSourceId) return true;

          // 기존 방식 호환 (혹시 모를 구버전 데이터 대응)
          if (item.sourceId === ideaData.channelId) return true;

          return false;
        })
        .sort((a, b) => {
          // 최신순 정렬
          const dateA = a.publishedAt || a.createdAt || 0;
          const dateB = b.publishedAt || b.createdAt || 0;
          return dateB - dateA;
        })
        .slice(0, 20); // 최근 20개

      Logger.debug(`[Internal Link] 최종 매칭된 내 글 개수: ${myPosts.length}개`);

      if (myPosts.length > 0) {
        myPastPostsText = `[내 과거 포스팅 목록 (내부 링크 추천용)]\n`;
        myPastPostsText += myPosts
          .map((post, idx) => {
            const title = post.title || '제목 없음';
            const url = post.fullLink || post.link || '';
            const description = post.description || post.cleanText?.substring(0, 100) || '';
            return `${idx + 1}. 제목: ${title}\n   URL: ${url}\n   설명: ${description}\n`;
          })
          .join('\n');
        myPastPostsText += '\n';
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

    // [추가] 현재 날짜 및 연도 정보 생성
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentDateString = today.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

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

    const prompt = `
            ${systemPrompt}
            
            [현재 시점 정보]
            - 오늘 날짜: ${currentDateString}
            - **현재 연도: ${currentYear}년**
            - 주의: 글을 작성할 때 반드시 **${currentYear}년**을 기준으로 최신 정보를 반영하고, 제목이나 본문에 연도가 들어갈 경우 **${currentYear}년**을 사용하세요. (과거 연도 사용 금지)

            [작성 요청]
            아래 정보를 바탕으로 블로그 포스트 초안을 작성해주세요.
            
            SEO에 최적화되고 독자의 흥미를 끄는 완성도 높은 블로그 포스트 초안을 작성해주세요.

            ### 1. 아이디어 제목 (참고용)
            - ${ideaData.title}

            ### 1-1. SEO 최적화된 실제 초안 제목 생성
            위 아이디어 제목을 참고하여, 검색 노출에 최적화되고 독자의 체류시간을 늘릴 수 있는 실제 초안 제목을 생성해주세요.
            - **${currentYear}년**을 기준으로 최신 트렌드와 정보를 반영한 제목을 생성하세요.
            - 제목에 연도가 들어갈 경우 반드시 **${currentYear}년**을 사용하세요. (예: "2023년" 같은 과거 연도 사용 금지)
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
               - 각 섹션에 충실한 내용을 작성하세요.
               - 하위 섹션이 필요하면 h3(### 제목)를 사용하세요.
            
            4. **결론**: 본문 마지막에 결론 섹션을 h2(## 결론)로 추가해주세요.
               - 글의 핵심 내용 요약
               - 독자에게 도움이 되는 마무리
            
            [작성 순서]
            h1 제목 → 서론(일반 텍스트) → 본문(h2 섹션들) → 결론(h2)

            ### 5. 주요 키워드 (본문에 자연스럽게 포함해주세요)
            ${tags.length > 0 ? tags.map((t) => `- ${t.replace(/^#/, '')}`).join('\n') : '없음'}

            ### 6. 롱테일 키워드 (SEO 최적화를 위해 본문에 자연스럽게 통합해주세요)
            ${
              longTailKeywords.length > 0
                ? longTailKeywords.map((k) => `- ${k}`).join('\n')
                : '없음'
            }
            
            ### 7. 추천 검색어 (독자들이 검색할 수 있는 키워드, 본문에 자연스럽게 활용해주세요)
            ${
              recommendedSearches.length > 0
                ? recommendedSearches.map((s, idx) => `${idx + 1}. ${s}`).join('\n')
                : '없음'
            }

            ### 8. 관련 참고 자료
            ${originalContentText}${linkedScrapsText || '참고 자료 없음'}
            
            ${
              myPastPostsText
                ? `### 9. 내 과거 포스팅 목록 (스마트 내부 링크 추천)
            ${myPastPostsText}
            
            [스마트 내부 링크 삽입 규칙 - 매우 중요]
            - 현재 작성 중인 글의 주제와 **문맥상 자연스럽게 연관된** 내 과거 포스팅이 있다면, 해당 위치에 내부 링크를 삽입해주세요.
            - 링크는 문맥에 완전히 녹아들어야 하며, 독자가 자연스럽게 클릭하고 싶게 만들어주세요.
            - 링크 형식: 마크다운 링크 형식 [관련 글: 제목](URL) 또는 [제목](URL) 형식으로 작성해주세요.
            - 좋은 예시들:
              * "이러한 증상이 나타난다면 [갤럭시 S23 후기](URL)에서 더 자세한 사용 경험을 확인할 수 있습니다."
              * "스마트홈 설정 방법은 [스마트싱스 초기 설정 가이드](URL)에서 상세히 다루었습니다."
              * "관련 주제로는 [아이폰 15 프로 리뷰](URL)도 참고하시기 바랍니다."
            - 나쁜 예시들 (절대 사용 금지):
              * "관련 글: [제목](URL)" (문맥 없이 나열)
              * "참고: [제목](URL)" (딱딱한 표현)
              * "이전 글: [제목](URL)" (과거 글임을 강조하는 표현)
            - **중요**: 관련성이 없는 과거 글에 무리하게 링크를 걸지 마세요. 문맥상 자연스럽게 연결될 때만 링크를 삽입하세요.
            - 내부 링크는 본문 중간에 2~3개 정도가 적당합니다. 너무 많으면 독자 경험이 나빠질 수 있습니다.
            `
                : ''
            }
            
            [참고 자료 활용 규칙]
            - 원본 본문이 제공된 경우(리뉴얼 아이디어), 그 내용을 바탕으로 팩트 기반으로 작성하되, 단순 복사가 아닌 새로운 관점이나 더 풍부한 정보로 발전시켜주세요.
            - 참고 자료가 제공된 경우, 그 내용을 바탕으로 팩트 기반으로 작성해주세요.
            - 참고 자료가 없는 경우, 일반적인 지식과 경험을 바탕으로 작성하되, 확실하지 않은 내용은 추측하지 마세요.
            - 할루시네이션(허위 정보 생성)을 피하고, 확실한 정보만 포함해주세요.

            [작성 규칙]
            1. **이모지 사용 제한**: 이모지나 이모티콘은 절대 사용하지 마세요. 텍스트만으로 작성하세요.
               - 제목, 본문, 결론 어디에도 이모지를 포함하지 마세요.
               - 감정이나 강조는 텍스트 표현으로만 전달하세요.
            
            2. **제목 최적화**: SEO 최적화된 제목을 생성하고, 이 제목을 h1 태그로 문서의 맨 처음에 포함해주세요. 아이디어 제목과는 다를 수 있습니다.
               - **절대 금지**: 목차의 첫 번째 항목을 제목으로 사용하지 마세요. 제목은 별도로 생성해야 합니다.
               - 제목 다음에는 서론을 작성하고, 그 다음에 목차의 첫 번째 항목부터 본문 섹션으로 작성하세요.
            3. '현재까지 작성된 초안'이 비어있지 않다면, 그 내용을 존중하여 이어서 작성하거나 내용을 더 풍부하게 만들어주세요.
            4. **문서 구조**: 제목(h1) → 구분선(---) → 서론 → 본문(h2 섹션들, 목차 기반) → 결론(h2) 순서로 작성하세요.
               - 목차의 각 항목은 본문의 h2 섹션 제목으로만 사용하세요.
               - 서론과 결론은 목차에 포함되지 않으므로 별도로 작성하세요.
            5. '롱테일 키워드'를 본문에 자연스럽게 통합하여 SEO를 최적화해주세요. 키워드 스터핑은 피하고, 문맥에 맞게 사용해주세요.
            6. '추천 검색어'를 참고하여 독자가 검색할 만한 키워드를 본문에 자연스럽게 포함해주세요.
            7. '관련 참고 자료'의 내용을 활용할 때는 단순히 나열하거나 요약하지 말고, 본문의 흐름에 자연스럽게 녹여서 작성해주세요. 자료의 핵심 정보를 재해석하거나 독자의 이해를 돕는 방식으로 통합해주세요.
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

            11. **제휴 마케팅 링크 (수익화) - [매우 중요]**:
              아래는 사용자가 등록한 제휴 링크(상품) 목록입니다. 본문 작성 시, 해당 키워드나 구매 의도가 나타나는 문맥에 **자연스럽게** 제휴 링크를 삽입해주세요.

              [제휴 링크 목록]
              ${affiliateLinks
                .map(
                  (link) =>
                    `- 키워드: "${(link.keywords || []).join(', ')}"${
                      link.productName ? ` / 상품명: "${link.productName}"` : ''
                    } / URL: ${link.url}`
                )
                .join('\n              ')}

              [링크 삽입 규칙]
              1. **문맥 기반 자연스러운 삽입 (Context-Aware Injection)**: 
                 - 단순히 키워드를 링크로 바꾸지 마세요. 
                 - 독자가 해당 상품에 관심을 가질만한 타이밍(장점 설명, 추천, 필요성 언급 등)에 자연스럽게 배치하세요.
                 - 글의 흐름을 방해하지 않는 것이 최우선입니다.
                 - 예: "이 기능을 사용하려면 [최저가 확인하기](URL)에서 구매할 수 있습니다." (기능 설명 후)
                 - 예: "더 자세한 스펙은 [상품 상세보기](URL)에서 확인하세요." (스펙 언급 후)

              2. **AI 기반 CTA(Call To Action) 자동 생성**: 
                 - 문맥에 어울리는 매력적인 문구로 링크를 감싸주세요.
                 - 예: "최저가 확인하기", "더 자세한 스펙 보기", "사용자 후기 모음", "현재 할인 가격 알아보기", "지금 구매하기", "상품 상세보기"
                 - 형식: **[CTA 문구](URL)** (마크다운 링크 형식)

              3. **개수 제한**: 
                 - 전체 글에서 제휴 링크는 **최대 3개**까지만 삽입하세요. (과도한 광고는 독자를 이탈시킵니다.)
                 - 가장 효과적일 것 같은 위치 3곳을 엄선하여 배치하세요.
                 - 중복 키워드가 있어도 링크는 최대 3개까지만 삽입하세요.

              4. **시각적 강조 (매우 중요)**: 
                 - 제휴 링크는 눈에 띄도록 녹색 텍스트 스타일을 적용해주세요.
                 - **반드시** 다음 형식을 정확히 따라주세요: <span style="color: #2e7d32;"><a href="URL">CTA 문구</a></span>
                 - 또는 마크다운 형식: <span style="color: #2e7d32;">[CTA 문구](URL)</span>
                 - 예시 1 (HTML): <span style="color: #2e7d32;"><a href="https://coupang.com/...">아이폰 15 최저가 확인하기</a></span>
                 - 예시 2 (마크다운): <span style="color: #2e7d32;">[아이폰 15 최저가 확인하기](https://coupang.com/...)</span>
                 - **중요**: span 태그로 링크를 감싸야 하며, span의 style 속성에 color: #2e7d32가 반드시 포함되어야 합니다.

              5. **구매 의도 발생 시점 파악**:
                 - 상품의 장점이나 필요성을 설명한 직후
                 - 비교 분석 후 추천할 때
                 - 사용 방법이나 리뷰를 언급한 후
                 - "이런 기능이 필요하다면", "더 자세히 알고 싶다면" 같은 전환 문구와 함께 배치

              // ▼▼▼ [추가] 대가성 문구 필수 규칙 시작 ▼▼▼
              6. **[법적 필수] 대가성 문구(공정위 문구) 자동 삽입**: 
                 - 제휴 링크가 하나라도 삽입되었다면, **반드시 글의 맨 마지막(결론 다음)**에 아래 기준에 맞는 문구를 포함해야 합니다.
                 - **쿠팡 파트너스 상품이 포함된 경우**: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다." (정확히 이 문장 사용)
                 - **그 외 제휴 상품인 경우**: "이 포스팅은 제휴마케팅 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받을 수 있습니다."
                 - **스타일링**: 본문과 구분되도록 회색 텍스트나 작은 글씨로 작성해주세요.
                 - 예시 (HTML): <p style="color: #888; font-size: 0.8em; margin-top: 20px;">이 포스팅은 ... 제공받습니다.</p>
              // ▲▲▲ [추가] 대가성 문구 필수 규칙 끝 ▲▲▲

              **중요**: 제휴 링크는 글의 품질을 해치지 않으면서도 자연스럽게 수익화를 달성하는 것이 목표입니다. 무리하게 삽입하지 마세요.
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
              [제휴 상품 반영 필수 규칙]
              - 앞서 제공된 **'제휴 마케팅 링크 (수익화)' 목록에 상품이 있는 경우**, 3가지 썸네일 프롬프트(thumbnailPromptEn) 중 최소 2개에는 **해당 상품의 구체적인 외형이나 상품명을 반드시 포함**시켜야 합니다.
              - 예: 글 주제가 '청소기 추천'이고 제휴 상품이 '다이슨 V15'라면, 프롬프트에 "Dyson V15 vacuum cleaner standing in a modern living room..."과 같이 구체적으로 명시하세요.
              - 단순히 "Vacuum cleaner"라고 하지 말고 "Specific Product Name"을 포함하여 AI가 해당 제품과 최대한 유사한 이미지를 생성하도록 유도하세요.
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
                * **절대 금지: 제목을 그대로 사용하거나 구두점만 있는 텍스트(예: "?", "!!", "...")는 절대 사용하지 마세요**
                * 예시:
                  - 나쁜 예: "스마트홈 컨트롤", "갤럭시 탭", "제품 소개", "?", "!!", "이거 실화냐?"
                  - 좋은 예: "집 전체를 손끝으로", "미래가 온다", "이것만 있으면 끝", "당신의 집이 스마트해진다", "한 번의 터치로 모든 것 제어"
                * 핵심 키워드를 포함하되, 그것을 감싸는 매력적인 표현으로 작성해주세요.
                * 12자 이내로 제한되지만, 그 안에서 최대한 임팩트 있게 작성해주세요.
                * 질문 형식, 감탄 형식, 혜택 강조 형식 등을 활용할 수 있습니다.
                * 각 thumbnailText는 반드시 한글, 영문, 또는 숫자를 최소 1개 이상 포함해야 합니다.
              - **썸네일 이미지 프롬프트 작성 요령**: 
                * 커버 이미지는 글의 첫인상을 결정하는 만큼 눈에 확 들어오는 핵심 이미지를 사용해야 합니다.
                * **제휴 상품이 있다면 해당 상품이 주인공이 되도록 묘사해주세요.** (추가됨)
                * 전체적인 인상을 생생하게 느낄 수 있는 이미지라면 더더욱 좋습니다.
                * 콘텍스트의 매력을 가장 잘 느낄 수 있게 이미지 생성 텍스트 프롬프트로 작성해주세요.
                * 제목과 핵심 내용을 반영하여 시각적으로 강렬하고 매력적인 썸네일을 생성할 수 있도록 구체적이고 생동감 있는 묘사를 포함해주세요.
                * 예: "High-quality, eye-catching background image showcasing [핵심 주제], vibrant colors, professional composition, modern design, compelling visual narrative that captures the essence of [주제], 16:9 aspect ratio, photorealistic style. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay."
            14. **참고 자료 링크 통합 방법 (매우 중요):**
               - **절대 금지**: "(참고 자료 1)", "(참고 자료 2)", "참고 자료 1에 따르면", "참고 자료 3에서", "참고 자료 4" 같은 번호 표기는 절대 사용하지 마세요. 이런 표현이 발견되면 전체 초안이 거부됩니다.
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
        formattedDraft = await sanitizeHtmlInOffscreen(cleanedDraft);
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

    // 7. 썸네일 정보가 없거나 실패 시 기본값 생성 (3가지 컨셉 강제 생성)
    // (썸네일 정보는 이미 위에서 추출되었으므로, 여기서는 기본값 생성만 처리)
    if (thumbnailCandidates.length === 0) {
      const baseTitle = seoTitle || title || '콘텐츠';
      thumbnailCandidates = [
        {
          type: 'curiosity',
          thumbnailPromptEn: `High-quality, dramatic thumbnail for "${baseTitle}", mysterious atmosphere, vibrant colors, dramatic lighting, eye-catching composition, 16:9 aspect ratio`,
          thumbnailPromptKo: `"${baseTitle}"에 대한 호기심 자극형 썸네일, 드라마틱한 조명, 강렬한 색상, 시선을 끄는 구성, 16:9 비율`,
          thumbnailText: '',
        },
        {
          type: 'informative',
          thumbnailPromptEn: `Clean, professional background image for "${baseTitle}", bright lighting, organized layout, modern design, 16:9 aspect ratio. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay.`,
          thumbnailPromptKo: `"${baseTitle}"에 대한 정보 요약형 썸네일, 깔끔한 레이아웃, 밝은 조명, 숫자나 체크마크 포함, 전문적인 디자인, 16:9 비율`,
          thumbnailText: '완벽 정리',
        },
        {
          type: 'emotional',
          thumbnailPromptEn: `Warm, cozy background image for "${baseTitle}", soft lighting, welcoming atmosphere, friendly colors, comfortable feeling, 16:9 aspect ratio. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay.`,
          thumbnailPromptKo: `"${baseTitle}"에 대한 감성/공감형 썸네일, 따뜻한 조명, 인간적 요소, 환영하는 분위기, 친근한 색상, 편안한 느낌, 16:9 비율`,
          thumbnailText: '당신을 위한',
        },
      ];
    }

    // [신규] 썸네일 자동 생성 및 업로드 (첫 번째 컨셉 사용)
    let thumbnailUrls = ideaData.publishInfo?.thumbnailUrls || null; // { url_1x1, url_4x3, url_16x9, altText }

    // Try to generate short thumbnail slogans dynamically using outlines/draft
    try {
      const { slogans } = await generateThumbnailTexts(
        ideaData.outline || [],
        formattedDraft || ''
      );
      if (Array.isArray(slogans) && slogans.length > 0) {
        thumbnailCandidates = thumbnailCandidates.map((c, i) => {
          const suggested = slogans[i] || slogans[i % slogans.length] || '';
          const fallbackText = (seoTitle || title || '')
            .replace(/[^\p{L}\p{N}\s]+/gu, '')
            .trim()
            .substring(0, 12);
          return {
            ...c,
            thumbnailText: sanitizeThumbnailText(suggested || c.thumbnailText || '', fallbackText),
          };
        });
      } else {
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
    } catch (e) {
      Logger.warn('[generateDraftFromIdea] generateThumbnailTexts failed:', e);
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

    if (generateThumbnail && thumbnailCandidates.length > 0 && permalink) {
      Logger.info('[generateDraftFromIdea] 🎨 썸네일 생성 시작');
      try {
        const enhanced = await enhanceDraftWithFeatures({
          thumbnailCandidates,
          affiliateLinks,
          permalink,
          composeThumbnailText,
          seoTitle,
          ideaData,
          jsonLdSchema,
          formattedDraft,
          onProgress: options.onProgress,
        });

        // merge results back into local variables
        formattedDraft = enhanced.formattedDraft;
        thumbnailUrls = enhanced.thumbnailUrls;
        thumbnailGenerationPartialFailure = enhanced.thumbnailGenerationPartialFailure;
        jsonLdSchema = enhanced.jsonLdSchema;

        // [신규] 2차 저장: 썸네일 포함 초안 저장
        if (ideaData.id && formattedDraft) {
          try {
            await saveIntermediateDraft(ideaData.id, formattedDraft);
            console.log(
              '[generateDraftFromIdea] checkpoint: saveIntermediateDraft succeeded (2nd)'
            );
          } catch (e) {
            console.warn(
              '[generateDraftFromIdea] checkpoint: saveIntermediateDraft failed (2nd):',
              e && e.message ? e.message : e
            );
          }
        }
      } catch (error) {
        Logger.error('[generateDraftFromIdea] 썸네일 자동 생성 실패 (계속 진행):', error);
        Logger.error('[generateDraftFromIdea] 썸네일 생성 실패 상세:', {
          errorMessage: error.message,
          errorStack: error.stack,
          permalink: permalink?.substring(0, 30),
          hasThumbnailCandidates: thumbnailCandidates.length > 0,
        });
      }
    } else if (!generateThumbnail) {
      Logger.info('[generateDraftFromIdea] 🎨 썸네일 생성 스킵, 기존 값 사용');
    }

    // [신규] HTML 본문에 대표 이미지 삽입 및 alt 속성 추가
    if (thumbnailUrls && thumbnailUrls.url_16x9) {
      // Ensure formattedDraft is at least an empty string to avoid accidental undefined/null
      if (typeof formattedDraft !== 'string' || !formattedDraft) formattedDraft = '';
      try {
        // 본문의 첫 번째 이미지 태그를 찾아서 교체하거나, 없으면 삽입
        const imgTagRegex = /<img[^>]*>/i;
        const firstImgMatch = formattedDraft.match(imgTagRegex);

        if (firstImgMatch) {
          // 첫 번째 이미지 태그를 교체
          const newImgTag = `<img src="${thumbnailUrls.url_16x9}" alt="${
            thumbnailUrls.altText || seoTitle || ideaData.title
          }" style="max-width: 100%; height: auto; display: block;">`;
          formattedDraft = formattedDraft.replace(imgTagRegex, newImgTag);
        } else {
          // 이미지 태그가 없으면 제목 바로 아래에 삽입
          const h1Match = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i);
          if (h1Match) {
            const h1EndIndex = formattedDraft.indexOf('</h1>') + 5;
            const imgTag = `\n<img src="${thumbnailUrls.url_16x9}" alt="${
              thumbnailUrls.altText || seoTitle || ideaData.title
            }" style="max-width: 100%; height: auto; display: block;">\n`;
            formattedDraft =
              formattedDraft.slice(0, h1EndIndex) + imgTag + formattedDraft.slice(h1EndIndex);
          }
        }

        Logger.info('[generateDraftFromIdea] HTML 본문에 썸네일 이미지 삽입 완료');
      } catch (error) {
        Logger.warn('[generateDraftFromIdea] HTML 본문 이미지 삽입 실패:', error);
      }
    }

    // Ensure thumbnail altText exists for accessibility/SEO
    if (thumbnailUrls) {
      try {
        // Ensure altText is meaningful; sanitize and fallback to title when it's only punctuation
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
      const storageRes = await chrome.storage.local.get('autoInsertAffiliateLinks');
      const userAutoInsert = storageRes?.autoInsertAffiliateLinks;
      const ideaOptIn = ideaData?.autoInsertAffiliateLinks;
      const shouldAutoInsert = typeof ideaOptIn === 'boolean' ? ideaOptIn : !!userAutoInsert;

      if (shouldAutoInsert && Array.isArray(affiliateLinks) && affiliateLinks.length > 0) {
        try {
          formattedDraft = postProcessAffiliateHtml(formattedDraft, affiliateLinks, {
            maxLinks: 3,
          });
        } catch (e) {
          Logger.warn('[generateDraftFromIdea] postProcessAffiliateHtml failed:', e);
        }
      }
    } catch (e) {
      Logger.warn('[generateDraftFromIdea] 자동 제휴 삽입 설정 확인 실패:', e);
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
    };
    console.debug('[DIAG generateDraftFromIdea] final response:', {
      hasDraft: !!formattedDraft,
      seoTitle,
      permalink,
      tagsCount: tagsForPublish?.length,
      hasThumbnailUrls: !!thumbnailUrls,
    });
    return finalResponse;
  } catch (e) {
    // If an error occurs late in the pipeline but we already have a formattedDraft,
    // return a best-effort successful response to avoid losing the generated content.
    Logger.error('[generateDraftFromIdea] 오류:', e && e.stack ? e.stack : e);
    if (typeof formattedDraft === 'string' && formattedDraft.trim().length > 0) {
      Logger.warn(
        '[generateDraftFromIdea] 오류 발생했지만 formattedDraft가 있습니다. 베스트-에포트 결과 반환'
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
      };
    }
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

    if (options.generateOutline) {
      Logger.debug(`[generateIdeaBriefing] 목차 생성 시작`);
      // include context (title + description + affiliate info) to improve quality
      const prompt = `"${contextText}" 주제의 블로그 목차 5개를 JSON 배열 형식으로만 반환해주세요. 예: ["1. 소개", "2. 본문", "3. 결론"]`;
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

    // 주요 키워드 생성
    if (options.generateMainKeywords) {
      Logger.debug(`[generateIdeaBriefing] 주요 키워드 생성 시작`);
      const prompt = `"${contextText}" 주제의 블로그 포스트에 적합한 주요 키워드 5개를 JSON 배열 형식으로만 반환해주세요. 예: ["스마트홈", "AI", "IoT"]`;
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

    // 롱테일 키워드 생성
    if (options.generateLongTail) {
      Logger.debug(`[generateIdeaBriefing] 롱테일 키워드 생성 시작`);
      const prompt = `"${contextText}" 주제의 블로그 포스트에 적합한 롱테일 키워드(검색 질문 형태) 5개를 JSON 배열 형식으로만 반환해주세요. 예: ["스마트홈이란 무엇인가", "AI 기반 스마트홈 구축 방법"]`;
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

    // 일반 키워드/추천 검색어 생성
    if (options.generateKeywords) {
      Logger.debug(`[generateIdeaBriefing] 추천 검색어 생성 시작`);
      const prompt = `"${contextText}" 주제의 블로그 포스트에 적합한 추천 검색어(태그 형태) 10개를 JSON 배열 형식으로만 반환해주세요. 예: ["#스마트홈", "#AI", "#IoT", "#홈오토메이션"]`;
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
              const retryPrompt = `다시 요청합니다. 이전 응답을 무시하고, "${contextText}" 주제에 적합한 추천 검색어(태그 형태) 10개를 JSON 배열 형식으로만 응답해주세요.`;
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
            // # 제거하고 태그 배열로 변환
            updates.tags = keywordsArray
              .map((item) => {
                let keyword =
                  typeof item === 'object' && item !== null
                    ? item.keyword || item.text || item.name || String(item)
                    : String(item);
                // # 제거
                keyword = keyword.replace(/^#+/, '').trim();
                return keyword;
              })
              .filter((item) => item && item.trim().length > 0)
              .slice(0, 10);
            Logger.info(
              `[generateIdeaBriefing] 추천 검색어 생성 성공: ${updates.tags.length}개`,
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

    if (Object.keys(updates).length > 0) {
      const updatePath = `kanban/${userId}/${status}/${cardId}`;
      Logger.debug(
        `[generateIdeaBriefing] Firebase 업데이트 시작 - path: ${updatePath}, updates:`,
        updates
      );
      try {
        await update(ref(getDb(), updatePath), cleanDataForFirebase(updates));
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

      const parts = [{ text: imageGenerationPrompt }];

      // 참조 이미지(제품)가 있는 경우 추가
      if (referenceImage && referenceImage.data) {
        parts.push({
          inlineData: {
            mimeType: referenceImage.mimeType,
            data: referenceImage.data,
          },
        });
        Logger.debug('[generateAiImage] 🖼️ 참조 이미지(제품)를 포함하여 요청합니다.');
      }

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
