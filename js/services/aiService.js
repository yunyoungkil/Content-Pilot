// js/services/aiService.js

import { getDb, CONSTANTS, uploadImageToFirebaseStorage, cleanDataForFirebase } from './firebaseService.js';
import { ref, update, get } from 'firebase/database';
// 순수 데이터 분석 함수만 import (순환 참조 방지)
import { analyzePerformanceData, getUserFeedbackPatterns } from './analyticsService.js';
import { Logger } from '../utils.js';

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
/**
 * [PersonaInjector] 페르소나 기반 AI 톤앤매너 주입 시스템
 * 사용자 설정에 따라 동적으로 System Instruction을 교체합니다.
 */
export const PERSONA_TEMPLATES = {
  professional: {
    name: "전문가형",
    systemPrompt: `당신은 해당 분야의 10년 차 전문가이자 전문 칼럼니스트입니다.

[톤앤매너 지침]
- 신뢰감 있고 정제된 비즈니스 톤을 사용하세요 ("~입니다", "~합니다").
- 객관적인 사실, 통계, 전문 용어를 적절히 섞어 깊이 있는 정보를 제공하세요.
- 독자가 '진짜 전문가가 썼구나'라고 느끼도록 논리적인 구조로 작성하세요.
- 첫 문장은 전문적이고 신뢰감 있는 톤으로 시작하세요 (예: "본 글에서는...", "이번에는...").

[작성 스타일]
- 서론에서 독자의 문제를 명확히 정의하고, 본론에서 체계적으로 해결책을 제시하세요.
- 데이터와 근거를 바탕으로 설득력 있는 내용을 구성하세요.`,
    tone: "전문적/신뢰감",
    firstSentenceExamples: ["본 글에서는", "이번에는", "다음과 같은", "주목할 만한"]
  },
  friendly: {
    name: "친근한형",
    systemPrompt: `당신은 구독자와 소통하는 것을 좋아하는 인기 블로거입니다.

[톤앤매너 지침]
- 옆집 언니/오빠처럼 친근하고 편안한 구어체를 사용하되, 반드시 존댓말을 사용하세요 ("~했어요", "~거예요", "~네요", "~어요").
- 절대 반말("~해", "~야", "~지")을 사용하지 마세요. 항상 존댓말로 작성하세요.
- 자신의 경험담을 이야기하듯 감성적인 표현을 풍부하게 사용하세요.
- 독자의 공감을 이끌어내는 질문을 던지며 소통하듯 작성하세요 ("~해보셨어요?", "~아시나요?").
- 첫 문장은 친근하고 편안한 톤으로 시작하세요 (예: "안녕하세요!", "오늘은", "여러분께").

[작성 스타일]
- 개인적인 경험과 일화를 자연스럽게 녹여내세요.
- 이모티콘은 사용하지 않되, 따뜻하고 친근한 말투를 유지하세요.`,
    tone: "친근함/감성적",
    firstSentenceExamples: ["안녕하세요!", "오늘은", "여러분께", "꿀팁 드려요", "혹시"]
  },
  viral: {
    name: "바이럴형",
    systemPrompt: `당신은 바이럴 콘텐츠를 만드는 전문가입니다. 독자의 호기심을 자극하고 클릭을 유도하는 글을 작성합니다.

[톤앤매너 지침]
- 강렬하고 임팩트 있는 첫 문장으로 독자의 관심을 즉시 끌어야 합니다 (예: "이거 진짜 놀라운데요?", "아무도 모르는 비밀", "이거 하나만 알면").
- 숫자, 비교, 놀라운 사실을 활용해 호기심을 자극하세요 ("3가지", "10배", "99%가 모르는").
- 짧고 임팩트 있는 문장을 사용하고, 긴 문단은 피하세요.
- 독자의 감정을 자극하는 표현을 사용하세요 ("충격적", "놀라운", "반드시", "절대").
- 클릭을 유도하는 제목과 첫 문장을 작성하세요.

[작성 스타일]
- 리스트 형식을 활용해 가독성을 높이세요.
- 핵심 정보를 앞부분에 배치하고, 긴 설명은 뒤로 미루세요.
- 독자가 끝까지 읽고 싶게 만드는 클리프행어 기법을 사용하세요.`,
    tone: "바이럴/임팩트",
    firstSentenceExamples: ["이거 진짜 놀라운데요?", "아무도 모르는 비밀", "이거 하나만 알면", "99%가 모르는", "충격적인 사실"]
  }
};

/**
 * 페르소나 선택 함수
 * 1. ideaData.persona 또는 ideaData.tone 설정 확인
 * 2. 사용자 설정에서 기본 톤앤매너 확인
 * 3. 자동 감지 (기존 로직)
 */
async function selectPersona(ideaData) {
  // 1. 명시적으로 설정된 페르소나가 있으면 사용
  if (ideaData.persona && PERSONA_TEMPLATES[ideaData.persona]) {
    return PERSONA_TEMPLATES[ideaData.persona];
  }
  
  // 2. 사용자 설정에서 기본 톤앤매너 확인
  try {
    const storage = await chrome.storage.local.get(['defaultPersona', 'defaultTone']);
    const userPersona = storage.defaultPersona || storage.defaultTone;
    if (userPersona && PERSONA_TEMPLATES[userPersona]) {
      return PERSONA_TEMPLATES[userPersona];
    }
  } catch (e) {
    console.warn('[selectPersona] 사용자 설정 읽기 실패:', e);
  }
  
  // 3. 자동 감지 (기존 로직)
  const text = `${ideaData.title} ${ideaData.description} ${(ideaData.tags||[]).join(' ')}`.toLowerCase();
  
  // 키워드 스코어링
  let scores = { professional: 0, friendly: 0, viral: 0 };
  
  // 친근한 키워드
  if (/후기|리뷰|일상|여행|맛집|추천|솔직|내돈내산/.test(text)) scores.friendly += 3;
  // 전문적 키워드
  if (/가이드|사용법|강좌|정리|뉴스|소식|트렌드|통계/.test(text)) scores.professional += 3;
  // 바이럴 키워드
  if (/비밀|꿀팁|초간단|초보|모르는|충격|놀라운|반드시|절대/.test(text)) scores.viral += 3;
  // 비판적 키워드 (전문가형으로 분류)
  if (/비교|장단점|분석|문제점|해결|vs/.test(text)) scores.professional += 2;
  
  // 최고 점수 페르소나 선택 (동점일 경우 professional 기본)
  const selectedKey = Object.keys(scores).reduce((a, b) => scores[a] >= scores[b] ? a : b);
  
  return PERSONA_TEMPLATES[selectedKey];
}

/**
 * 보라색 콘솔 로그 출력 (Logger.biz 사용)
 */
function logPersona(persona) {
  const personaName = persona.name || persona.tone || 'Unknown';
  Logger.biz(`🎭 [Persona: ${personaName}]`, `톤앤매너: ${persona.tone}`);
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
    // 페르소나 선택 및 로깅
    const persona = await selectPersona(ideaData);
    logPersona(persona);
    
    // 데이터 준비 (analyticsService 활용)
    const performanceData = await analyzePerformanceData(ideaData.channelId);
    const feedback = await getUserFeedbackPatterns();
    
    // 프롬프트 구성
    const performanceInfo = performanceData.decayContent && performanceData.decayContent.length > 0
      ? `재활용 후보 콘텐츠: ${performanceData.decayContent.length}개 발견 (과거 고성과 콘텐츠 재활용 가능)`
      : '';
    
    // System Instruction을 명확히 분리하여 프롬프트 최상단에 배치
    const prompt = `
[System Instruction - 반드시 이 톤앤매너를 따라주세요]
${persona.systemPrompt}

[작성 요청]
주제: ${ideaData.title}
톤앤매너: ${persona.tone}
핵심요약: ${ideaData.description}
목차: ${(ideaData.outline || []).join(', ')}

[참고 데이터]
${performanceInfo ? `${performanceInfo}\n` : ''}${feedback ? `독자 선호 패턴: ${feedback}` : ''}

위 정보를 바탕으로 SEO 최적화된 블로그 포스트 초안을 마크다운 형식으로 작성해주세요.
- 첫 문장은 반드시 ${persona.tone} 톤으로 시작하세요 (예: ${persona.firstSentenceExamples?.slice(0, 2).join(', ') || '적절한 인사말'})
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
