// js/services/aiService.js

import {
  getDb,
  CONSTANTS,
  uploadImageToFirebaseStorage,
  cleanDataForFirebase,
  getCurrentUserId,
} from "./firebaseService.js";
// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
import { ref, update, get } from "./firebaseService.js";
// 순수 데이터 분석 함수만 import (순환 참조 방지)
import {
  analyzePerformanceData,
  getUserFeedbackPatterns,
} from "./analyticsService.js";
import { Logger } from "../utils.js";
import {
  sanitizeHtmlInOffscreen,
  cropImageInOffscreen,
  composeThumbnailInOffscreen,
} from "./offscreenService.js"; // [추가]
// [추가] PromptService 임포트
import {
  PromptBuilder,
  detectPersona,
  PROMPT_CONFIG,
} from "./promptService.js";
// [추가] 상수 임포트
import { AI_MODELS, COLLECTIONS } from "../constants.js";

// 1. Gemini API 호출 (Core)
/**
 * Gemini API를 호출하여 텍스트 생성을 수행합니다.
 * @param {string} prompt - AI에게 전달할 프롬프트 텍스트
 * @returns {Promise<string>} 생성된 텍스트 응답
 * @throws {Error} API 키가 없거나 API 호출 실패 시 에러 발생
 */
export async function callGeminiAPI(prompt) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    Logger.error(
      "[callGeminiAPI] Gemini API 키가 없습니다. 설정에서 API 키를 입력해주세요."
    );
    throw new Error(
      "Gemini API 키가 없습니다. 설정에서 API 키를 입력해주세요."
    );
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.TEXT}:generateContent?key=${geminiApiKey}`;

  try {
    Logger.debug(
      `[callGeminiAPI] API 호출 시작 - prompt 길이: ${prompt.length}`
    );
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await response.json();
    if (!response.ok) {
      Logger.error(`[callGeminiAPI] API 오류 (${response.status}):`, data);
      throw new Error(data.error?.message || `API Error (${response.status})`);
    }
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    Logger.debug(`[callGeminiAPI] API 호출 성공 - 응답 길이: ${result.length}`);
    return result;
  } catch (e) {
    Logger.error("[callGeminiAPI] Gemini API 호출 실패:", e);
    throw e; // 에러를 다시 throw하여 상위에서 처리할 수 있도록
  }
}

// [삭제] PERSONA_TEMPLATES 상수 삭제 (PromptService로 이관됨)
// [삭제] selectPersona 함수 삭제 (detectPersona로 대체 및 generateDraftFromIdea 내부로 통합)
// [삭제] logPersona 함수 삭제 (PromptBuilder의 getPersonaName/getToneName으로 대체)

// 3. 키워드 갭 분석 (AI 분석)
export async function analyzeKeywordGap(myContent, competitorContent) {
  // (단순화를 위해 Set 연산만 수행, 필요시 AI 필터링 추가)
  const myTags = new Set();
  myContent.forEach((c) =>
    (c.tags || []).forEach((t) => myTags.add(t.replace(/^#/, "")))
  );

  const compTags = new Set();
  competitorContent.forEach((c) =>
    (c.tags || []).forEach((t) => compTags.add(t.replace(/^#/, "")))
  );

  const gapKeywords = [...compTags].filter((t) => !myTags.has(t)).slice(0, 10);
  return { gapKeywords, gapCount: gapKeywords.length };
}

// 4. 트렌드 분석 (AI 추론)
export async function getEmergingTopics(channelContext) {
  if (!channelContext) return null;
  const prompt = `다음 채널 맥락을 바탕으로 최신 트렌드 주제 5개를 제안해줘:\n${channelContext}`;
  return await callGeminiAPI(prompt);
}

// [신규] 제휴 링크 조회 및 필터링 헬퍼 함수
async function getRelevantAffiliateLinks(userId, contextText) {
  try {
    const snap = await get(ref(getDb(), `affiliate_links/${userId}`));
    const linksMap = snap?.val();

    if (!linksMap) {
      Logger.debug("[getRelevantAffiliateLinks] 제휴 링크 없음");
      return [];
    }

    const links = Object.values(linksMap);
    if (links.length === 0) {
      Logger.debug("[getRelevantAffiliateLinks] 제휴 링크 배열이 비어있음");
      return [];
    }

    // contextText(제목+태그)에 키워드가 포함된 링크만 필터링 (토큰 절약 및 정확도 향상)
    // 키워드가 없거나, 키워드가 문맥에 포함된 경우 선택
    const contextLower = contextText.toLowerCase();
    const relevantLinks = links.filter((link) => {
      if (!link.keyword || !link.url) {
        Logger.debug(
          `[getRelevantAffiliateLinks] 링크 필터링 제외 (키워드/URL 없음):`,
          link
        );
        return false;
      }

      const keywordLower = link.keyword.toLowerCase();
      const productNameLower = (link.productName || "").toLowerCase();

      // 키워드나 상품명이 문맥에 포함된 경우 선택
      const isRelevant =
        contextLower.includes(keywordLower) ||
        (productNameLower && contextLower.includes(productNameLower));

      if (isRelevant) {
        Logger.debug(
          `[getRelevantAffiliateLinks] 관련 링크 발견: ${
            link.keyword
          } (${link.url.substring(0, 50)}...)`
        );
      }

      return isRelevant;
    });

    // 최대 10개까지만 반환 (프롬프트 과부하 방지)
    const result = relevantLinks.slice(0, 10);
    Logger.info(
      `[getRelevantAffiliateLinks] 관련 링크 ${result.length}개 선택됨 (전체 ${links.length}개 중)`
    );
    return result;
  } catch (error) {
    Logger.warn("[getRelevantAffiliateLinks] 제휴 링크 조회 실패:", error);
    return [];
  }
}

// 5. 초안 생성 (메인 로직)
// [삭제] function formatDraftForReadability(draftText) { ... }
// 더 이상 이 함수는 사용되지 않으며 OffscreenService로 대체됨

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
export async function generateDraftFromIdea(ideaData) {
  try {
    // 1. 페르소나 결정 (사용자 설정 > 자동 감지)
    let personaKey = ideaData.persona;

    // 사용자 설정이 없으면 자동 감지
    if (!personaKey || !PROMPT_CONFIG.personas[personaKey]) {
      // 사용자 설정에서 기본 톤앤매너 확인
      try {
        const storage = await chrome.storage.local.get([
          "defaultPersona",
          "defaultTone",
        ]);
        personaKey = storage.defaultPersona || storage.defaultTone;
      } catch (e) {
        Logger.warn("[generateDraftFromIdea] 사용자 설정 읽기 실패:", e);
      }

      // 여전히 없으면 자동 감지
      if (!personaKey || !PROMPT_CONFIG.personas[personaKey]) {
        const textToAnalyze = `${ideaData.title} ${ideaData.description} ${(
          ideaData.tags || []
        ).join(" ")}`;
        personaKey = detectPersona(textToAnalyze);
        Logger.debug(
          `[generateDraftFromIdea] 페르소나 자동 감지: ${personaKey}`
        );
      }
    }

    // 2. PromptBuilder 초기화
    const builder = new PromptBuilder(personaKey);

    // 3. 톤앤매너 오버라이드 (ideaData.tone이 있다면)
    if (ideaData.tone && PROMPT_CONFIG.tones[ideaData.tone]) {
      builder.setTone(ideaData.tone);
    }

    // 4. 트렌드 데이터 주입 (SEO 강화)
    const keywords = (ideaData.tags || []).filter((t) => t !== "#AI-추천");
    const trends = ideaData.recommendedSearches || []; // 연관 검색어 활용
    builder.setTrendContext(keywords, trends);

    // 4-A. 제휴 마케팅 링크 데이터 준비
    const userId = await getCurrentUserId();
    const contextForLinks = `${ideaData.title} ${(ideaData.tags || []).join(
      " "
    )} ${ideaData.description || ""}`;
    const affiliateLinks = await getRelevantAffiliateLinks(
      userId,
      contextForLinks
    );

    // 4-B. 채널 정보 가져오기 (JSON-LD용)
    let channelInfo = null;
    try {
      const { activeChannelId } = await chrome.storage.local.get(
        "activeChannelId"
      );
      if (activeChannelId) {
        const channelsSnap = await get(ref(getDb(), `channels/${userId}`));
        const channelsData = channelsSnap?.val() || {};
        const myBlogs = channelsData.myChannels?.blogs || [];
        const myYoutubes = channelsData.myChannels?.youtubes || [];
        const allChannels = [...myBlogs, ...myYoutubes];
        channelInfo = allChannels.find((ch) => {
          const chId =
            ch.id || (ch.apiUrl ? btoa(ch.apiUrl).replace(/=/g, "") : null);
          return chId === activeChannelId;
        });
      }
    } catch (error) {
      Logger.warn("[generateDraftFromIdea] 채널 정보 조회 실패:", error);
    }

    // 5. 글쓰기 스킬 주입 (동적 옵션)
    if (ideaData.skills && Array.isArray(ideaData.skills)) {
      ideaData.skills.forEach((skill) => builder.addSkill(skill));
    } else {
      // 기본 스킬 매핑
      if (personaKey === "viral") {
        builder.addSkill("cliffhanger");
      }
      if (personaKey === "professional") {
        builder.addSkill("statistics").addSkill("comparison");
      }
      if (personaKey === "friendly") {
        builder.addSkill("questioning").addSkill("storytelling");
      }
    }

    // 6. 시스템 프롬프트 생성
    const systemPrompt = builder.buildSystemPrompt();

    // 로깅
    Logger.biz(
      `🎭 [Persona Build]`,
      `Type: ${builder.getPersonaName()}, Custom Tone: ${
        ideaData.tone || builder.getToneName()
      }`
    );

    // 데이터 준비 (analyticsService 활용)
    const performanceData = await analyzePerformanceData(ideaData.channelId);
    const feedback = await getUserFeedbackPatterns();

    // 1. 모든 키워드를 수집하고 중복을 제거합니다.
    const allKeywords = new Set([
      ...(ideaData.tags || []).filter((t) => t !== "#AI-추천"),
      ...(ideaData.longTailKeywords || []),
    ]);
    const keywordsText = Array.from(allKeywords).join("\n- ");

    // 2. 연결된 자료 텍스트를 프롬프트 형식으로 만듭니다.
    const linkedScrapsText = (ideaData.linkedScrapsContent || [])
      .map((scrap, index) => {
        const title =
          scrap.title ||
          scrap.text?.substring(0, 50) ||
          `참고 자료 ${index + 1}`;
        const url = scrap.url || "";
        return `[참고 자료 ${index + 1}]\n제목: ${title}\nURL: ${url}\n내용: ${
          scrap.text || ""
        }\n`;
      })
      .join("\n");

    // 3. 원본 본문 참조: origin.fullContent가 있으면 참고 자료에 추가
    let originalContentText = "";
    if (
      ideaData.origin?.fullContent &&
      ideaData.origin.fullContent.length > 0
    ) {
      originalContentText = `[원본 본문 (리뉴얼 참고용)]\n${ideaData.origin.fullContent.substring(
        0,
        5000
      )}\n\n`;
    }

    // 4. [스마트 내부 링크] 내 과거 포스팅 목록 조회
    let myPastPostsText = "";
    try {
      const userId = await getCurrentUserId();
      const contentSnap = await get(
        ref(getDb(), `channel_content/${userId}/blogs`)
      );
      const allBlogs = contentSnap?.val() || {};

      // 현재 채널의 글만 필터링 (channelId가 일치하는 경우)
      const myPosts = Object.values(allBlogs)
        .filter((item) => item !== null && item.title && item.fullLink)
        .filter((item) => {
          // channelId가 있으면 일치하는 것만, 없으면 모두 포함
          if (ideaData.channelId) {
            return item.sourceId === ideaData.channelId;
          }
          return true; // channelId가 없으면 모든 글 포함
        })
        .sort((a, b) => {
          // 최신순 정렬 (publishedAt 또는 createdAt 기준)
          const dateA = a.publishedAt || a.createdAt || 0;
          const dateB = b.publishedAt || b.createdAt || 0;
          return dateB - dateA;
        })
        .slice(0, 20); // 최근 20개만 사용

      if (myPosts.length > 0) {
        myPastPostsText = `[내 과거 포스팅 목록 (내부 링크 추천용)]\n`;
        myPastPostsText += myPosts
          .map((post, idx) => {
            const title = post.title || "제목 없음";
            const url = post.fullLink || post.link || "";
            const description =
              post.description || post.cleanText?.substring(0, 100) || "";
            return `${
              idx + 1
            }. 제목: ${title}\n   URL: ${url}\n   설명: ${description}\n`;
          })
          .join("\n");
        myPastPostsText += "\n";
      }
    } catch (error) {
      Logger.warn("[generateDraftFromIdea] 내 과거 포스팅 조회 실패:", error);
      // 오류가 발생해도 계속 진행
    }

    // 5. 추천 검색어와 롱테일 키워드 수집
    const recommendedSearches = ideaData.recommendedSearches || [];
    const longTailKeywords = ideaData.longTailKeywords || [];
    const tags = (ideaData.tags || []).filter((t) => t !== "#AI-추천");

    // 6. 프롬프트 구성
    const performanceInfo =
      performanceData.decayContent && performanceData.decayContent.length > 0
        ? `재활용 후보 콘텐츠: ${performanceData.decayContent.length}개 발견 (과거 고성과 콘텐츠 재활용 가능)`
        : "";

    // 백업 파일의 상세한 프롬프트 구성
    const prompt = `
            ${systemPrompt}
            
            [작성 요청]
            아래 정보를 바탕으로 블로그 포스트 초안을 작성해주세요.
            
            SEO에 최적화되고 독자의 흥미를 끄는 완성도 높은 블로그 포스트 초안을 작성해주세요.

            ### 1. 아이디어 제목 (참고용)
            - ${ideaData.title}

            ### 1-1. SEO 최적화된 실제 초안 제목 생성
            위 아이디어 제목을 참고하여, 검색 노출에 최적화되고 독자의 체류시간을 늘릴 수 있는 실제 초안 제목을 생성해주세요.
            - 검색 키워드를 자연스럽게 포함
            - 클릭을 유도하는 제목
            - 독자의 문제를 해결하거나 유용한 정보를 제공한다는 것을 명확히 표현
            - 50자 이내로 간결하게
            - 이 제목을 h1 태그로 문서의 맨 처음에 포함해주세요
            - **중요**: 아래 목차의 첫 번째 항목은 제목이 아닙니다. 목차는 본문 구조를 위한 것이며, 제목은 별도로 생성해야 합니다.

            ### 2. 핵심 요약
            - ${ideaData.description || "주제에 대한 상세 설명"}

            ### 3. 현재까지 작성된 초안 (이 내용을 바탕으로 발전시켜주세요)
            ${ideaData.currentDraft || "(비어 있음)"}

            ### 4. 본문 구조 (목차 - 이 목차는 본문 섹션 제목으로만 사용하세요)
            ${
              (ideaData.outline || []).length > 0
                ? ideaData.outline
                    .map((item, idx) => `${idx + 1}. ${item}`)
                    .join("\n")
                : "목차가 제공되지 않았습니다. 논리적이고 체계적인 구조로 작성해주세요."
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
            ${
              tags.length > 0
                ? tags.map((t) => `- ${t.replace(/^#/, "")}`).join("\n")
                : "없음"
            }

            ### 6. 롱테일 키워드 (SEO 최적화를 위해 본문에 자연스럽게 통합해주세요)
            ${
              longTailKeywords.length > 0
                ? longTailKeywords.map((k) => `- ${k}`).join("\n")
                : "없음"
            }
            
            ### 7. 추천 검색어 (독자들이 검색할 수 있는 키워드, 본문에 자연스럽게 활용해주세요)
            ${
              recommendedSearches.length > 0
                ? recommendedSearches
                    .map((s, idx) => `${idx + 1}. ${s}`)
                    .join("\n")
                : "없음"
            }

            ### 8. 관련 참고 자료
            ${originalContentText}${linkedScrapsText || "참고 자료 없음"}
            
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
                : ""
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
            10. **제휴 마케팅 링크 (수익화) - [매우 중요]**:
              아래는 사용자가 등록한 제휴 링크(상품) 목록입니다. 본문 작성 시, 해당 키워드나 구매 의도가 나타나는 문맥에 **자연스럽게** 제휴 링크를 삽입해주세요.

              [제휴 링크 목록]
              ${affiliateLinks
                .map(
                  (link) =>
                    `- 키워드: "${link.keyword}"${
                      link.productName ? ` / 상품명: "${link.productName}"` : ""
                    } / URL: ${link.url}`
                )
                .join("\n              ")}

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

              **중요**: 제휴 링크는 글의 품질을 해치지 않으면서도 자연스럽게 수익화를 달성하는 것이 목표입니다. 무리하게 삽입하지 마세요.
            `
                : ""
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
                         ? new URL(channelInfo.inputUrl).hostname.replace(
                             "www.",
                             ""
                           )
                         : "Content Pilot"
                     }"
                   }
                 * datePublished: 현재 날짜를 YYYY-MM-DD 형식으로 작성하세요. (예: ${
                   new Date().toISOString().split("T")[0]
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
                         ? new URL(channelInfo.inputUrl).hostname.replace(
                             "www.",
                             ""
                           )
                         : "Content Pilot"
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
                * 전체적인 인상을 생생하게 느낄 수 있는 이미지라면 더더욱 좋습니다.
                * 콘텍스트의 매력을 가장 잘 느낄 수 있게 이미지 생성 텍스트 프롬프트로 작성해주세요.
                * 제목과 핵심 내용을 반영하여 시각적으로 강렬하고 매력적인 썸네일을 생성할 수 있도록 구체적이고 생동감 있는 묘사를 포함해주세요.
                * 예: "High-quality, eye-catching background image showcasing [핵심 주제], vibrant colors, professional composition, modern design, compelling visual narrative that captures the essence of [주제], 16:9 aspect ratio, photorealistic style. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay."
            11. **참고 자료 링크 통합 방법 (매우 중요):**
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

    const rawDraft = await callGeminiAPI(prompt);

    // 빈 응답 및 오류 응답 처리
    if (!rawDraft || rawDraft.trim() === "") {
      Logger.error("[generateDraftFromIdea] 초안이 비어있습니다.");
      return {
        success: false,
        error:
          "초안이 생성되지 않았습니다. Gemini API 응답이 비어있습니다. 다시 시도해주세요.",
      };
    }

    if (rawDraft.startsWith("오류:") || rawDraft.includes("오류:")) {
      Logger.error("[generateDraftFromIdea] Gemini API 오류:", rawDraft);
      const errorMessage =
        rawDraft.replace(/^오류:\s*/i, "").trim() ||
        "Gemini API에서 오류가 발생했습니다.";
      return { success: false, error: errorMessage };
    }

    // 응답이 너무 짧거나 유효하지 않은 경우 체크
    if (rawDraft.trim().length < 50) {
      Logger.warn("[generateDraftFromIdea] 초안이 너무 짧습니다:", rawDraft);
      // 너무 짧은 경우에도 경고만 하고 계속 진행 (사용자가 확인할 수 있도록)
    }

    // 1. 마크다운 클리닝: 코드 블록 태그 제거
    let cleanedDraft = rawDraft;
    cleanedDraft = cleanedDraft.replace(/^```markdown\s*\n?/i, "");
    cleanedDraft = cleanedDraft.replace(/^```md\s*\n?/i, "");
    cleanedDraft = cleanedDraft.replace(/^```\s*\n?/i, "");
    cleanedDraft = cleanedDraft.replace(/\n?```\s*$/i, "");
    cleanedDraft = cleanedDraft.replace(/\n?```markdown\s*$/i, "");
    cleanedDraft = cleanedDraft.replace(/\n?```md\s*$/i, "");
    cleanedDraft = cleanedDraft.trim();

    // [신규] 1-1. JSON-LD 스키마 추출 및 파싱 (HTML 변환 전에 먼저 처리)
    // 주의: seoTitle은 나중에 추출되므로, 여기서는 기본 추출만 하고 나중에 보완
    let jsonLdSchema = null;
    // cleanedDraft에서 먼저 찾고, 없으면 rawDraft에서 찾기
    const jsonLdMatch =
      cleanedDraft.match(/<JSON-LD>([\s\S]*?)<\/JSON-LD>/i) ||
      rawDraft.match(/<JSON-LD>([\s\S]*?)<\/JSON-LD>/i);

    if (jsonLdMatch && jsonLdMatch[1]) {
      try {
        // JSON 파싱 시도
        jsonLdSchema = JSON.parse(jsonLdMatch[1].trim());

        // 본문에서 태그 제거 (사용자에게는 보이지 않아야 함)
        cleanedDraft = cleanedDraft.replace(
          /<JSON-LD>[\s\S]*?<\/JSON-LD>/gi,
          ""
        );

        Logger.info(
          "[generateDraftFromIdea] JSON-LD 스키마 생성 및 파싱 성공 (후처리 대기)"
        );
      } catch (e) {
        Logger.warn("[generateDraftFromIdea] JSON-LD 파싱 실패:", e);
        // 파싱 실패 시 null 반환 (본문에는 영향 없음)
        // 태그는 제거
        cleanedDraft = cleanedDraft.replace(
          /<JSON-LD>[\s\S]*?<\/JSON-LD>/gi,
          ""
        );
      }
    }

    // [신규] 1-2. 썸네일 정보 추출 및 제거 (HTML 변환 전에 먼저 처리)
    let thumbnailCandidates = [];
    const thumbnailMatch = cleanedDraft.match(
      /<썸네일정보>([\s\S]*?)<\/썸네일정보>/
    );

    if (thumbnailMatch && thumbnailMatch[1]) {
      try {
        const parsed = JSON.parse(thumbnailMatch[1].trim());
        if (Array.isArray(parsed)) {
          thumbnailCandidates = parsed;
        } else {
          // 배열이 아닌 단일 객체로 온 경우 (구버전 호환)
          thumbnailCandidates = [parsed];
        }

        // 태그 제거 (HTML 변환 전에 제거하여 본문에 포함되지 않도록)
        cleanedDraft = cleanedDraft
          .replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, "")
          .trim();
        Logger.debug("[generateDraftFromIdea] 썸네일 정보 추출 완료:", {
          count: thumbnailCandidates.length,
          types: thumbnailCandidates.map((c) => c.type),
        });
      } catch (e) {
        Logger.error("[generateDraftFromIdea] 썸네일 JSON 파싱 실패:", e);
        // 파싱 실패 시에도 태그는 제거
        cleanedDraft = cleanedDraft
          .replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, "")
          .trim();
      }
    }

    // [변경] 2. 안전한 HTML 정제 및 포매팅 (Offscreen 위임)
    Logger.debug(
      "[generateDraftFromIdea] HTML 정제 및 포매팅 시작 (Offscreen)"
    );
    let formattedDraft;
    try {
      formattedDraft = await sanitizeHtmlInOffscreen(cleanedDraft);
    } catch (sanitizationError) {
      Logger.error(
        "[generateDraftFromIdea] HTML 정제 실패, 원본 텍스트 사용 (위험):",
        sanitizationError
      );
      // 정제 실패 시 비상 대책: 최소한의 특수문자만이라도 이스케이프하거나 에러 반환
      // 여기서는 안전을 위해 에러를 던지는 것이 맞음
      throw new Error("보안 검사 중 오류가 발생했습니다. 다시 시도해주세요.");
    }

    // 3. SEO 최적화된 제목 추출 (h1 태그에서)
    // DOMPurify 후에는 확실한 HTML이므로 정규식이 더 잘 동작함
    let seoTitle = null;
    const h1Match = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1]) {
      seoTitle = h1Match[1].trim();
    }

    // 4. 제목이 포함되어 있지 않으면 h1으로 추가
    const title = ideaData.title || "";
    if (title) {
      // h1 태그나 # 제목 형식이 없으면 추가
      const hasH1 = /<h1[^>]*>|<h1>|^#\s+/i.test(formattedDraft);
      if (!hasH1) {
        // 마크다운 형식이면 # 제목, HTML이면 <h1>제목</h1> 추가
        if (formattedDraft.includes("<")) {
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

    // [신규] 4-1. JSON-LD 스키마 후처리 (seoTitle 추출 후 실제 데이터로 보완)
    if (jsonLdSchema) {
      try {
        const now = new Date();
        const today = now.toISOString().split("T")[0]; // YYYY-MM-DD

        // headline이 없거나 비어있으면 seoTitle 사용
        if (!jsonLdSchema.headline || jsonLdSchema.headline.trim() === "") {
          jsonLdSchema.headline = seoTitle || ideaData.title || "";
        }

        // description이 없거나 비어있으면 ideaData.description 사용
        if (
          !jsonLdSchema.description ||
          jsonLdSchema.description.trim() === ""
        ) {
          jsonLdSchema.description = ideaData.description || "";
          // description이 너무 길면 200자로 제한
          if (jsonLdSchema.description.length > 200) {
            jsonLdSchema.description =
              jsonLdSchema.description.substring(0, 197) + "...";
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
          jsonLdSchema.author.name === "Content Pilot"
        ) {
          const authorName = channelInfo?.inputUrl
            ? new URL(channelInfo.inputUrl).hostname.replace("www.", "")
            : "Content Pilot";
          jsonLdSchema.author = {
            "@type": "Person",
            name: authorName,
          };
        }

        // [신규] image 필드를 배열로 처리 (thumbnailUrls가 있으면 실제 URL 사용)
        // thumbnailUrls는 나중에 설정되므로 여기서는 기본 처리만
        if (
          !jsonLdSchema.image ||
          jsonLdSchema.image === "https://example.com/image.jpg" ||
          jsonLdSchema.image.includes("example.com")
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
        } else if (typeof jsonLdSchema.image === "string") {
          // 문자열인 경우 배열로 변환
          jsonLdSchema.image = [
            jsonLdSchema.image,
            jsonLdSchema.image,
            jsonLdSchema.image,
          ];
        } else if (!Array.isArray(jsonLdSchema.image)) {
          // 배열도 문자열도 아닌 경우 배열로 변환
          jsonLdSchema.image = [
            String(jsonLdSchema.image),
            String(jsonLdSchema.image),
            String(jsonLdSchema.image),
          ];
        }

        // url이 없고 publishInfo에 permalink가 있으면 조합
        if (
          !jsonLdSchema.url &&
          ideaData.publishInfo?.permalink &&
          channelInfo?.inputUrl
        ) {
          try {
            const channelUrl = new URL(channelInfo.inputUrl);
            const isTistory = channelUrl.hostname.includes("tistory.com");
            if (isTistory) {
              jsonLdSchema.url = `${channelUrl.origin}/${ideaData.publishInfo.permalink}`;
            } else {
              jsonLdSchema.url = `${channelUrl.origin}/${ideaData.publishInfo.permalink}`;
            }
          } catch (e) {
            // URL 조합 실패 시 무시
          }
        }

        Logger.info("[generateDraftFromIdea] JSON-LD 스키마 후처리 완료", {
          headline: jsonLdSchema.headline?.substring(0, 50),
          hasDescription: !!jsonLdSchema.description,
          datePublished: jsonLdSchema.datePublished,
          author: jsonLdSchema.author?.name,
          hasImage: !!jsonLdSchema.image,
          hasUrl: !!jsonLdSchema.url,
        });
      } catch (e) {
        Logger.warn("[generateDraftFromIdea] JSON-LD 후처리 실패:", e);
        // 후처리 실패해도 기본 스키마는 유지
      }
    }

    // 5. 퍼머링크 생성 (영문만, URL-safe) - 한글을 영문으로 변환
    const generatePermalink = async (title) => {
      if (!title) return "";

      // 기본 변환 함수 (빠른 폴백)
      const defaultConversion = (text) => {
        return text
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "") // 영문, 숫자, 공백, 하이픈만 유지 (한글 제거)
          .replace(/\s+/g, "-") // 공백을 하이픈으로
          .replace(/-+/g, "-") // 연속된 하이픈을 하나로
          .replace(/^-|-$/g, "") // 앞뒤 하이픈 제거
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
            if (translated && !translated.startsWith("오류:")) {
              return translated
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "") // 영문, 숫자, 공백, 하이픈만 유지
                .replace(/\s+/g, "-") // 공백을 하이픈으로
                .replace(/-+/g, "-") // 연속된 하이픈을 하나로
                .replace(/^-|-$/g, "") // 앞뒤 하이픈 제거
                .substring(0, 100); // 최대 100자
            }
          } catch (e) {
            Logger.error("퍼머링크 번역 실패:", e);
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
        Logger.error("퍼머링크 생성 중 오류:", e);
      }

      // 번역 실패 또는 타임아웃 시 기본 변환 반환
      return defaultConversion(title);
    };

    // 퍼머링크 생성 (타임아웃 보호)
    let permalink = "";
    try {
      permalink = await generatePermalink(seoTitle || title);
    } catch (e) {
      Logger.error("퍼머링크 생성 실패, 기본값 사용:", e);
      // 기본 변환 사용
      const titleForPermalink = seoTitle || title || "";
      permalink = titleForPermalink
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 100);
    }

    // 6. 태그 생성 (쉼표 구분)
    const tagsForPublish = tags
      .map((t) => t.replace(/^#/, ""))
      .filter((t) => t && t !== "AI-추천")
      .join(", ");

    // 7. 썸네일 정보가 없거나 실패 시 기본값 생성 (3가지 컨셉 강제 생성)
    // (썸네일 정보는 이미 위에서 추출되었으므로, 여기서는 기본값 생성만 처리)
    if (thumbnailCandidates.length === 0) {
      const baseTitle = seoTitle || title || "콘텐츠";
      thumbnailCandidates = [
        {
          type: "curiosity",
          thumbnailPromptEn: `High-quality, dramatic thumbnail for "${baseTitle}", mysterious atmosphere, question mark, vibrant colors, dramatic lighting, eye-catching composition, 16:9 aspect ratio`,
          thumbnailPromptKo: `"${baseTitle}"에 대한 호기심 자극형 썸네일, 드라마틱한 조명, 강렬한 색상, 시선을 끄는 구성, 16:9 비율`,
          thumbnailText: "이거 실화냐?",
        },
        {
          type: "informative",
          thumbnailPromptEn: `Clean, professional background image for "${baseTitle}", bright lighting, organized layout, modern design, 16:9 aspect ratio. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay.`,
          thumbnailPromptKo: `"${baseTitle}"에 대한 정보 요약형 썸네일, 깔끔한 레이아웃, 밝은 조명, 숫자나 체크마크 포함, 전문적인 디자인, 16:9 비율`,
          thumbnailText: "완벽 정리",
        },
        {
          type: "emotional",
          thumbnailPromptEn: `Warm, cozy background image for "${baseTitle}", soft lighting, welcoming atmosphere, friendly colors, comfortable feeling, 16:9 aspect ratio. IMPORTANT: Do NOT include any text, letters, or words in the image. Keep the background clean for text overlay.`,
          thumbnailPromptKo: `"${baseTitle}"에 대한 감성/공감형 썸네일, 따뜻한 조명, 인간적 요소, 환영하는 분위기, 친근한 색상, 편안한 느낌, 16:9 비율`,
          thumbnailText: "당신을 위한",
        },
      ];
    }

    // [신규] 썸네일 자동 생성 및 업로드 (첫 번째 컨셉 사용)
    let thumbnailUrls = null; // { url_1x1, url_4x3, url_16x9, altText }
    if (thumbnailCandidates.length > 0 && permalink) {
      try {
        const selectedThumbnail = thumbnailCandidates[0]; // 첫 번째 컨셉 사용
        Logger.info("[generateDraftFromIdea] 썸네일 자동 생성 시작:", {
          type: selectedThumbnail.type,
          permalink: permalink.substring(0, 30),
        });

        // 1. 16:9 원본 배경 이미지 생성 (AI - 텍스트 없이)
        const originalImages = await generateAiImage(
          selectedThumbnail.thumbnailPromptEn,
          1
        );
        if (originalImages.length === 0) {
          throw new Error("썸네일 이미지 생성 실패");
        }

        // 2. [신규] 텍스트 합성 (하이브리드 합성)
        const thumbnailText =
          selectedThumbnail.thumbnailText ||
          `${seoTitle || ideaData.title}`.substring(0, 12);
        Logger.info("[generateDraftFromIdea] 썸네일 텍스트 합성 시작:", {
          text: thumbnailText,
        });

        const textPosition = selectedThumbnail.textPosition || "bottom"; // AI가 결정한 위치 또는 기본값
        Logger.info("[generateDraftFromIdea] 썸네일 텍스트 합성 시작:", {
          text: thumbnailText,
          position: textPosition,
        });

        const composedDataUrl = await composeThumbnailInOffscreen(
          originalImages[0],
          thumbnailText,
          textPosition
        );

        // 3. 병렬 크롭 처리 (1:1, 4:3) - 합성된 이미지 사용
        const userId = await getCurrentUserId();
        const cropPromises = [
          // 1:1 비율
          cropImageInOffscreen(composedDataUrl, 1).then((dataUrl) => ({
            ratio: "1x1",
            dataUrl,
          })),
          // 4:3 비율
          cropImageInOffscreen(composedDataUrl, 4 / 3).then((dataUrl) => ({
            ratio: "4x3",
            dataUrl,
          })),
        ];

        const croppedResults = await Promise.all(cropPromises);

        // 4. SEO 파일명으로 업로드
        const uploadPromises = [
          // 1:1 업로드
          uploadImageToFirebaseStorage(
            croppedResults[0].dataUrl,
            `thumbnails/${userId}/${permalink}-1x1.png`,
            userId
          ),
          // 4:3 업로드
          uploadImageToFirebaseStorage(
            croppedResults[1].dataUrl,
            `thumbnails/${userId}/${permalink}-4x3.png`,
            userId
          ),
          // 16:9 업로드 (합성된 이미지)
          uploadImageToFirebaseStorage(
            composedDataUrl,
            `thumbnails/${userId}/${permalink}-16x9.png`,
            userId
          ),
        ];

        const [url_1x1, url_4x3, url_16x9] = await Promise.all(uploadPromises);

        thumbnailUrls = {
          url_1x1,
          url_4x3,
          url_16x9,
          altText:
            selectedThumbnail.altText ||
            `${seoTitle || ideaData.title} 썸네일 이미지`,
        };

        Logger.info(
          "[generateDraftFromIdea] ✅ 썸네일 자동 생성 및 업로드 완료:",
          {
            url_1x1: url_1x1.substring(0, 50) + "...",
            url_4x3: url_4x3.substring(0, 50) + "...",
            url_16x9: url_16x9.substring(0, 50) + "...",
          }
        );

        // [신규] JSON-LD image 배열을 실제 Firebase URL로 교체
        if (jsonLdSchema) {
          jsonLdSchema.image = [url_1x1, url_4x3, url_16x9];
          Logger.info(
            "[generateDraftFromIdea] JSON-LD image 배열 업데이트 완료"
          );
        }
      } catch (error) {
        Logger.error(
          "[generateDraftFromIdea] 썸네일 자동 생성 실패 (계속 진행):",
          error
        );
        Logger.error("[generateDraftFromIdea] 썸네일 생성 실패 상세:", {
          errorMessage: error.message,
          errorStack: error.stack,
          permalink: permalink?.substring(0, 30),
          hasThumbnailCandidates: thumbnailCandidates.length > 0,
        });
        // 썸네일 생성 실패해도 초안 생성은 계속 진행
      }
    }

    // [신규] HTML 본문에 대표 이미지 삽입 및 alt 속성 추가
    if (thumbnailUrls && thumbnailUrls.url_16x9) {
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
            const h1EndIndex = formattedDraft.indexOf("</h1>") + 5;
            const imgTag = `\n<img src="${thumbnailUrls.url_16x9}" alt="${
              thumbnailUrls.altText || seoTitle || ideaData.title
            }" style="max-width: 100%; height: auto; display: block;">\n`;
            formattedDraft =
              formattedDraft.slice(0, h1EndIndex) +
              imgTag +
              formattedDraft.slice(h1EndIndex);
          }
        }

        Logger.info(
          "[generateDraftFromIdea] HTML 본문에 썸네일 이미지 삽입 완료"
        );
      } catch (error) {
        Logger.warn(
          "[generateDraftFromIdea] HTML 본문 이미지 삽입 실패:",
          error
        );
      }
    }

    return {
      success: true,
      draft: formattedDraft,
      permalink: permalink,
      tags: tagsForPublish,
      seoTitle: seoTitle, // SEO 최적화된 제목
      thumbnailInfo: thumbnailCandidates, // 썸네일 정보 (배열 형태)
      thumbnailUrls: thumbnailUrls, // [신규] 자동 생성된 썸네일 URL (3가지 비율)
      jsonLdSchema: jsonLdSchema, // [신규] JSON-LD 구조화된 데이터
    };
  } catch (e) {
    Logger.error("[generateDraftFromIdea] 오류:", e);
    return { success: false, error: e.message };
  }
}

// 6. 아이디어 브리핑
export async function generateIdeaBriefing(
  cardId,
  title,
  description,
  options = {}
) {
  const { onProgress, status = "ideas" } = options; // status 옵션 추가
  const userId = await getCurrentUserId(); // 동적으로 사용자 ID 가져오기
  const updates = {};

  try {
    Logger.info(
      `[generateIdeaBriefing] 시작 - cardId: ${cardId}, title: ${title}, status: ${status}, userId: ${userId}`
    );

    // Gemini API 키 확인
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    if (!geminiApiKey || !geminiApiKey.trim()) {
      Logger.warn(
        `[generateIdeaBriefing] Gemini API 키가 없습니다. 브리핑 생성을 건너뜁니다.`
      );
      // API 키가 없으면 조용히 실패 (에러를 throw하지 않고 조용히 종료)
      // 사용자에게는 UI에서 알림을 표시할 수 있도록 메시지 전송
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                action: "gemini_api_key_missing",
                message:
                  "Gemini API 키가 설정되지 않았습니다. 채널 관리에서 API 키를 입력해주세요.",
              })
              .catch(() => {});
          }
        });
      });
      return; // 에러를 throw하지 않고 조용히 종료
    }

    if (options.generateOutline) {
      Logger.debug(`[generateIdeaBriefing] 목차 생성 시작`);
      const prompt = `"${title}" 주제의 블로그 목차 5개를 JSON 배열 형식으로만 반환해주세요. 예: ["1. 소개", "2. 본문", "3. 결론"]`;
      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(
          `[generateIdeaBriefing] Gemini API 응답: ${res.substring(0, 200)}...`
        );
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] Gemini API 호출 실패:`, apiError);
        // API 호출 실패 시 목차 생성을 건너뛰고 계속 진행
        if (
          apiError.message.includes("Gemini API 키가 없습니다") ||
          apiError.message.includes("API key not valid") ||
          apiError.message.includes("Please pass a valid API key")
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
                    action: "gemini_api_key_error",
                    message:
                      "Gemini API 키가 없거나 유효하지 않습니다. 채널 관리에서 API 키를 확인해주세요.",
                  })
                  .catch(() => {});
              }
            });
          });
        }
        res = null;
      }

      if (res && !res.startsWith("오류:")) {
        try {
          // JSON 배열 추출 시도 (여러 방법)
          let outlineArray = null;

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
              const codeBlockMatch = res.match(
                /```(?:json)?\s*(\[[\s\S]*?\])\s*```/
              );
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
                if (typeof item === "object" && item !== null) {
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
        Logger.warn(
          `[generateIdeaBriefing] 목차 생성 실패 - 응답: ${res || "null"}`
        );
      }

      if (onProgress) onProgress(30);
    }

    // 주요 키워드 생성
    if (options.generateMainKeywords) {
      Logger.debug(`[generateIdeaBriefing] 주요 키워드 생성 시작`);
      const prompt = `"${title}" 주제의 블로그 포스트에 적합한 주요 키워드 5개를 JSON 배열 형식으로만 반환해주세요. 예: ["스마트홈", "AI", "IoT"]`;
      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(
          `[generateIdeaBriefing] 주요 키워드 API 응답: ${res.substring(
            0,
            200
          )}...`
        );
      } catch (apiError) {
        Logger.error(
          `[generateIdeaBriefing] 주요 키워드 API 호출 실패:`,
          apiError
        );
        if (
          apiError.message.includes("API key not valid") ||
          apiError.message.includes("Please pass a valid API key")
        ) {
          Logger.warn(
            `[generateIdeaBriefing] Gemini API 키가 유효하지 않아 주요 키워드 생성을 건너뜁니다.`
          );
        }
        res = null;
      }

      if (res && !res.startsWith("오류:")) {
        try {
          let keywordsArray = null;
          try {
            keywordsArray = JSON.parse(res.trim());
          } catch (e1) {
            const arrayMatch = res.match(/\[[\s\S]*?\]/);
            if (arrayMatch) {
              keywordsArray = JSON.parse(arrayMatch[0]);
            } else {
              const codeBlockMatch = res.match(
                /```(?:json)?\s*(\[[\s\S]*?\])\s*```/
              );
              if (codeBlockMatch) {
                keywordsArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }

          if (Array.isArray(keywordsArray)) {
            updates.mainKeywords = keywordsArray
              .map((item) => {
                if (typeof item === "object" && item !== null) {
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
            Logger.warn(
              `[generateIdeaBriefing] 주요 키워드 파싱 실패: 배열이 아님`
            );
          }
        } catch (parseError) {
          Logger.error(
            `[generateIdeaBriefing] 주요 키워드 파싱 오류:`,
            parseError
          );
        }
      }

      if (onProgress) onProgress(50);
    }

    // 롱테일 키워드 생성
    if (options.generateLongTail) {
      Logger.debug(`[generateIdeaBriefing] 롱테일 키워드 생성 시작`);
      const prompt = `"${title}" 주제의 블로그 포스트에 적합한 롱테일 키워드(검색 질문 형태) 5개를 JSON 배열 형식으로만 반환해주세요. 예: ["스마트홈이란 무엇인가", "AI 기반 스마트홈 구축 방법"]`;
      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(
          `[generateIdeaBriefing] 롱테일 키워드 API 응답: ${res.substring(
            0,
            200
          )}...`
        );
      } catch (apiError) {
        Logger.error(
          `[generateIdeaBriefing] 롱테일 키워드 API 호출 실패:`,
          apiError
        );
        if (
          apiError.message.includes("API key not valid") ||
          apiError.message.includes("Please pass a valid API key")
        ) {
          Logger.warn(
            `[generateIdeaBriefing] Gemini API 키가 유효하지 않아 롱테일 키워드 생성을 건너뜁니다.`
          );
        }
        res = null;
      }

      if (res && !res.startsWith("오류:")) {
        try {
          let longTailArray = null;
          try {
            longTailArray = JSON.parse(res.trim());
          } catch (e1) {
            const arrayMatch = res.match(/\[[\s\S]*?\]/);
            if (arrayMatch) {
              longTailArray = JSON.parse(arrayMatch[0]);
            } else {
              const codeBlockMatch = res.match(
                /```(?:json)?\s*(\[[\s\S]*?\])\s*```/
              );
              if (codeBlockMatch) {
                longTailArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }

          if (Array.isArray(longTailArray)) {
            updates.longTailKeywords = longTailArray
              .map((item) => {
                if (typeof item === "object" && item !== null) {
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
            Logger.warn(
              `[generateIdeaBriefing] 롱테일 키워드 파싱 실패: 배열이 아님`
            );
          }
        } catch (parseError) {
          Logger.error(
            `[generateIdeaBriefing] 롱테일 키워드 파싱 오류:`,
            parseError
          );
        }
      }

      if (onProgress) onProgress(70);
    }

    // 일반 키워드/추천 검색어 생성
    if (options.generateKeywords) {
      Logger.debug(`[generateIdeaBriefing] 추천 검색어 생성 시작`);
      const prompt = `"${title}" 주제의 블로그 포스트에 적합한 추천 검색어(태그 형태) 10개를 JSON 배열 형식으로만 반환해주세요. 예: ["#스마트홈", "#AI", "#IoT", "#홈오토메이션"]`;
      let res;
      try {
        res = await callGeminiAPI(prompt);
        Logger.debug(
          `[generateIdeaBriefing] 추천 검색어 API 응답: ${res.substring(
            0,
            200
          )}...`
        );
      } catch (apiError) {
        Logger.error(
          `[generateIdeaBriefing] 추천 검색어 API 호출 실패:`,
          apiError
        );
        if (
          apiError.message.includes("API key not valid") ||
          apiError.message.includes("Please pass a valid API key")
        ) {
          Logger.warn(
            `[generateIdeaBriefing] Gemini API 키가 유효하지 않아 추천 검색어 생성을 건너뜁니다.`
          );
        }
        res = null;
      }

      if (res && !res.startsWith("오류:")) {
        try {
          let keywordsArray = null;
          try {
            keywordsArray = JSON.parse(res.trim());
          } catch (e1) {
            const arrayMatch = res.match(/\[[\s\S]*?\]/);
            if (arrayMatch) {
              keywordsArray = JSON.parse(arrayMatch[0]);
            } else {
              const codeBlockMatch = res.match(
                /```(?:json)?\s*(\[[\s\S]*?\])\s*```/
              );
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
                  typeof item === "object" && item !== null
                    ? item.keyword || item.text || item.name || String(item)
                    : String(item);
                // # 제거
                keyword = keyword.replace(/^#+/, "").trim();
                return keyword;
              })
              .filter((item) => item && item.trim().length > 0)
              .slice(0, 10);
            Logger.info(
              `[generateIdeaBriefing] 추천 검색어 생성 성공: ${updates.tags.length}개`,
              updates.tags
            );
          } else {
            Logger.warn(
              `[generateIdeaBriefing] 추천 검색어 파싱 실패: 배열이 아님`
            );
          }
        } catch (parseError) {
          Logger.error(
            `[generateIdeaBriefing] 추천 검색어 파싱 오류:`,
            parseError
          );
        }
      }

      if (onProgress) onProgress(90);
    }

    if (Object.keys(updates).length > 0) {
      const updatePath = `kanban/${userId}/${status}/${cardId}`;
      Logger.debug(
        `[generateIdeaBriefing] Firebase 업데이트 시작 - path: ${updatePath}, updates:`,
        updates
      );
      try {
        await update(ref(getDb(), updatePath), cleanDataForFirebase(updates));
        Logger.biz(
          `✅ [generateIdeaBriefing] 브리핑 생성 완료 - cardId: ${cardId}, status: ${status}, 업데이트 항목: ${Object.keys(
            updates
          ).join(", ")}`
        );
      } catch (updateError) {
        Logger.error(
          `[generateIdeaBriefing] Firebase 업데이트 실패:`,
          updateError
        );
        throw updateError;
      }

      // REST API 모드에서는 실시간 리스너가 작동하지 않으므로, UI 갱신을 위해 최신 데이터를 가져와서 메시지 전송
      try {
        const kanbanRef = ref(getDb(), `kanban/${userId}`);
        const kanbanSnap = await get(kanbanRef);
        const kanbanData = kanbanSnap?.val() || {};

        // 1. 확장 프로그램 UI(사이드 패널/팝업)에 메시지 전송 (chrome.runtime.sendMessage)
        chrome.runtime
          .sendMessage({
            action: "kanban_data_updated",
            data: kanbanData,
          })
          .catch((err) => {
            // 확장 프로그램 UI가 닫혔을 수 있음 (정상적인 상황)
            if (
              err?.message &&
              !err.message.includes("message port closed") &&
              !err.message.includes("Could not establish connection")
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
              !tab.url.startsWith("chrome://") &&
              !tab.url.startsWith("edge://") &&
              !tab.url.startsWith("about:")
            ) {
              chrome.tabs
                .sendMessage(tab.id, {
                  action: "kanban_data_updated",
                  data: kanbanData,
                })
                .catch((err) => {
                  // "message port closed"는 정상적인 상황 (탭이 닫혔거나 content script가 없을 때)
                  // 조용히 무시
                });
            }
          });
        });
        Logger.debug(`[generateIdeaBriefing] UI 갱신 메시지 전송 완료`);
      } catch (updateError) {
        Logger.warn(
          `[generateIdeaBriefing] UI 갱신 메시지 전송 실패:`,
          updateError
        );
        // UI 갱신 실패해도 브리핑 생성은 성공으로 처리
      }
    } else {
      Logger.warn(
        `[generateIdeaBriefing] 업데이트할 데이터 없음 - 모든 생성 옵션이 실패했거나 비활성화됨`
      );
    }
  } catch (error) {
    Logger.error(
      `[generateIdeaBriefing] 전체 오류 - cardId: ${cardId}, title: ${title}, userId: ${userId}:`,
      error
    );
    // 에러를 다시 throw하여 상위에서 처리할 수 있도록 함
    throw error;
  }
}

// 7. 이미지 생성
// 7. 이미지 생성 (병렬 처리 적용)
export async function generateAiImage(prompt, count = 1) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    throw new Error("Gemini API 키가 없습니다.");
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.IMAGE}:generateContent?key=${geminiApiKey}`;
  const userId = CONSTANTS.USER_ID;
  
  // 동시 요청 제한 설정 (API Rate Limit 고려)
  const MAX_CONCURRENT = 3; 

  // 단일 이미지 생성 함수
  const generateSingleImage = async (index) => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API 오류: ${res.status}`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error.message || "이미지 생성 실패");
      }

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error("이미지 생성 응답에 candidates가 없습니다.");
      }

      const candidate = data.candidates[0];
      let base64 = null;
      let mimeType = "image/png";

      // Inline Data 확인
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
           if (part.inlineData?.data) {
             base64 = part.inlineData.data;
             mimeType = part.inlineData.mimeType || "image/png";
             break;
           }
           // 텍스트 내 Base64 확인
           if (part.text) {
             const base64Match = part.text.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
             if (base64Match) {
               base64 = base64Match[1];
               const mimeMatch = part.text.match(/data:image\/([^;]+);base64/);
               if (mimeMatch) mimeType = `image/${mimeMatch[1]}`;
               break;
             }
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
        throw new Error("base64 데이터를 찾을 수 없습니다.");
      }
    } catch (e) {
      Logger.error(`[generateAiImage] 이미지 ${index + 1}/${count} 생성 실패:`, e);
      return null; // 실패 시 null 반환
    }
  };

  // 작업 큐 생성
  const tasks = Array.from({ length: count }, (_, i) => () => generateSingleImage(i));

  // 병렬 처리 로직 (Concurrency Control)
  const results = [];
  const executing = [];

  for (const task of tasks) {
    const p = task(); // 작업 시작
    results.push(p); // 결과 추적

    // 실행 중인 작업 리스트 관리 (완료 시 제거)
    const e = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
    });
    executing.push(e);

    // 동시 실행 수가 제한에 도달하면 하나가 끝날 때까지 대기
    if (executing.length >= MAX_CONCURRENT) {
        await Promise.race(executing);
    }
  }

  // 모든 작업 완료 대기
  const allResults = await Promise.all(results);
  
  // 성공한 이미지(URL)만 필터링
  const successfulImages = allResults.filter(url => url !== null);

  if (successfulImages.length === 0) {
    throw new Error("생성된 이미지가 없습니다. (모든 시도 실패)");
  }

  return successfulImages;
}

// 8. 템플릿 분석
export async function analyzeImageForTemplate(data) {
  // ... (Vision API 호출 로직)
  return { success: true };
}

// 9. 채널 분석
export async function analyzeMyChannel(data) {
  // TODO: 채널 분석 로직 구현
  return { success: true, analysis: "" };
}

// 10. 콘텐츠 아이디어 생성
export async function generateContentIdeas(data) {
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
        action: "search_queries_recommended",
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
export async function analyzeVideoComments(videoId) {
  // TODO: 비디오 댓글 분석 로직 구현
  return { success: true, comments: [] };
}
