// js/services/aiService.js

import { getDb, CONSTANTS, uploadImageToFirebaseStorage, cleanDataForFirebase } from './firebaseService.js';
import { ref, update, get } from 'firebase/database';
// 순수 데이터 분석 함수만 import (순환 참조 방지)
import { analyzePerformanceData, getUserFeedbackPatterns } from './analyticsService.js';

// 1. Gemini API 호출 (Core)
export async function callGeminiAPI(prompt) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) throw new Error("Gemini API 키가 없습니다.");

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
  
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "API Error");
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (e) {
    console.error("Gemini API 호출 실패:", e);
    return `오류: ${e.message}`;
  }
}

// 2. 페르소나 및 유틸리티
const PROMPT_TEMPLATES = {
  professional: { systemPrompt: "당신은 10년차 전문가입니다. 신뢰감 있고 전문적인 톤으로 작성하세요.", tone: "전문적" },
  friendly: { systemPrompt: "당신은 친근한 블로거입니다. 옆집 언니처럼 친절하고 부드러운 해요체를 사용하세요.", tone: "친근함" },
  critical: { systemPrompt: "당신은 냉철한 분석가입니다. 장단점을 명확히 짚어주세요.", tone: "분석적" }
};

function selectPersona(ideaData) {
  const text = `${ideaData.title} ${ideaData.description} ${(ideaData.tags||[]).join(' ')}`.toLowerCase();
  if (/후기|리뷰|일상|추천/.test(text)) return PROMPT_TEMPLATES.friendly;
  if (/비교|장단점|분석/.test(text)) return PROMPT_TEMPLATES.critical;
  return PROMPT_TEMPLATES.professional;
}

// 3. 키워드 갭 분석 (AI 분석)
export async function analyzeKeywordGap(myContent, competitorContent) {
  // (단순화를 위해 Set 연산만 수행, 필요시 AI 필터링 추가)
  const myTags = new Set();
  myContent.forEach(c => (c.tags || []).forEach(t => myTags.add(t.replace(/^#/, ''))));
  
  const compTags = new Set();
  competitorContent.forEach(c => (c.tags || []).forEach(t => compTags.add(t.replace(/^#/, ''))));
  
  const gapKeywords = [...compTags].filter(t => !myTags.has(t)).slice(0, 10);
  return { gapKeywords, gapCount: gapKeywords.length };
}

// 4. 트렌드 분석 (AI 추론)
export async function getEmergingTopics(channelContext) {
  if (!channelContext) return null;
  const prompt = `다음 채널 맥락을 바탕으로 최신 트렌드 주제 5개를 제안해줘:\n${channelContext}`;
  return await callGeminiAPI(prompt);
}

// 5. 초안 생성 (메인 로직)
function formatDraftForReadability(draftText) {
  if (!draftText) return draftText;
  let html = draftText;
  // 마크다운 링크 변환 [text](url) -> <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="text-decoration: none; color: #1a73e8;">$1</a>');
  // 구분선 변환
  html = html.replace(/\n\s*---\s*\n/gi, '\n<hr style="border: none; border-top: 2px solid #e0e0e0; margin: 24px 0 32px 0;">\n');
  // (참고 자료 X) 제거
  html = html.replace(/\(참고\s*자료\s*\d+\)/gi, '');
  return html;
}

export async function generateDraftFromIdea(ideaData) {
  try {
    const persona = selectPersona(ideaData);
    
    // 데이터 준비 (analyticsService 활용)
    const performanceData = await analyzePerformanceData(ideaData.channelId);
    const feedback = await getUserFeedbackPatterns();
    
    // 프롬프트 구성
    const performanceInfo = performanceData.decayContent && performanceData.decayContent.length > 0
      ? `재활용 후보 콘텐츠: ${performanceData.decayContent.length}개 발견 (과거 고성과 콘텐츠 재활용 가능)`
      : '';
    
    const prompt = `
      ${persona.systemPrompt}
      [작성 요청]
      주제: ${ideaData.title}
      톤앤매너: ${persona.tone}
      핵심요약: ${ideaData.description}
      목차: ${(ideaData.outline || []).join(', ')}
      
      [참고 데이터]
      ${performanceInfo ? `${performanceInfo}\n` : ''}${feedback ? `독자 선호 패턴: ${feedback}` : ''}
      
      위 정보를 바탕으로 SEO 최적화된 블로그 포스트 초안을 마크다운 형식으로 작성해주세요.
      - h1 태그로 제목 시작
      - 본문 중간에 [이미지 생성 프롬프트] 삽입
      - 맨 마지막에 <썸네일정보>{"thumbnailText": "..."}</썸네일정보> JSON 포함
    `;

    const rawDraft = await callGeminiAPI(prompt);
    
    // 1. 마크다운 클리닝
    let cleanedDraft = rawDraft
      .replace(/^```markdown\s*\n?/i, '')
      .replace(/^```\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
    
    // 2. 가독성 포맷팅
    let formattedDraft = formatDraftForReadability(cleanedDraft);

    // 3. SEO 제목 추출 (h1 태그)
    let seoTitle = ideaData.title;
    const h1Match = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i) || cleanedDraft.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) seoTitle = h1Match[1].trim();

    // 4. 썸네일 정보 추출
    let thumbnailInfo = null;
    const thumbMatch = cleanedDraft.match(/<썸네일정보>([\s\S]*?)<\/썸네일정보>/);
    if (thumbMatch) {
      try {
        thumbnailInfo = JSON.parse(thumbMatch[1]);
        // 본문에서 태그 제거
        formattedDraft = formattedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '');
        cleanedDraft = cleanedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '');
      } catch(e) {
        console.warn('[generateDraftFromIdea] 썸네일 정보 파싱 실패:', e);
      }
    }
    
    return { 
      success: true, 
      draft: formattedDraft,
      seoTitle: seoTitle,
      thumbnailInfo: thumbnailInfo,
      tags: (ideaData.tags || []).join(', ')
    };

  } catch (e) {
    console.error('[generateDraftFromIdea] 오류:', e);
    return { success: false, error: e.message };
  }
}

// 6. 아이디어 브리핑
export async function generateIdeaBriefing(cardId, title, description, options = {}) {
  const { onProgress } = options;
  const userId = CONSTANTS.USER_ID;
  const updates = {};

  if (options.generateOutline) {
    const res = await callGeminiAPI(`"${title}" 주제의 블로그 목차 5개를 JSON 배열로 줘.`);
    try { updates.outline = JSON.parse(res.match(/\[.*\]/s)[0]); } catch(e) {}
    if (onProgress) onProgress(30);
  }
  
  // ... (키워드 생성 등 추가 로직)

  if (Object.keys(updates).length > 0) {
    await update(ref(getDb(), `kanban/${userId}/ideas/${cardId}`), updates);
  }
}

// 7. 이미지 생성
export async function generateAiImage(prompt, count = 1) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    throw new Error("Gemini API 키가 없습니다.");
  }
  
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiApiKey}`;
  
  const images = [];
  const userId = CONSTANTS.USER_ID;
  
  for (let i = 0; i < count; i++) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API 오류: ${res.status}`);
      }
      
      const data = await res.json();
      const base64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (base64) {
        const url = await uploadImageToFirebaseStorage(
           `data:image/png;base64,${base64}`, 
           `thumbnails/${userId}/${Date.now()}_${i}.png`,
           userId
        );
        images.push(url);
      } else {
        console.warn(`[generateAiImage] 이미지 ${i + 1}/${count} 생성 실패: base64 데이터 없음`);
      }
    } catch(e) { 
      console.error(`[generateAiImage] 이미지 ${i + 1}/${count} 생성 실패:`, e);
    }
  }
  return images;
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
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "search_queries_recommended",
      success: true,
      data: keywords,
      cardId: data.cardId,
      status: data.status,
      cardTitle: data.title,
    }).catch(() => {});
  }
  return { success: true, keywords };
}

// 12. 비디오 댓글 분석
export async function analyzeVideoComments(videoId) {
  // TODO: 비디오 댓글 분석 로직 구현
  return { success: true, comments: [] };
}
