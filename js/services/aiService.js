// js/services/aiService.js

import { getDb, CONSTANTS, uploadImageToFirebaseStorage, cleanDataForFirebase, getCurrentUserId } from './firebaseService.js';
// [중요] firebase/database import 제거 - REST API 사용으로 대체됨
import { ref, update, get } from './firebaseService.js';
// 순수 데이터 분석 함수만 import (순환 참조 방지)
import { analyzePerformanceData, getUserFeedbackPatterns } from './analyticsService.js';
import { Logger } from '../utils.js';

// 1. Gemini API 호출 (Core)
export async function callGeminiAPI(prompt) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    Logger.error("[callGeminiAPI] Gemini API 키가 없습니다. 설정에서 API 키를 입력해주세요.");
    throw new Error("Gemini API 키가 없습니다. 설정에서 API 키를 입력해주세요.");
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
  
  try {
    Logger.debug(`[callGeminiAPI] API 호출 시작 - prompt 길이: ${prompt.length}`);
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
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
  
  // 마크다운 형식인지 확인 (마크다운 문법이 있으면 HTML로 변환 필요)
  const isMarkdown = /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|^>\s|\[.*\]\(.*\)/m.test(draftText);
  
  // 마크다운이면 HTML로 변환
  if (isMarkdown) {
    // 마크다운 링크를 HTML로 변환하면서 밑줄 제거
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="text-decoration: none; color: #1a73e8;">$1</a>');
  }
  
  // 기존 HTML 링크의 밑줄 제거
  html = html.replace(/<a\s+([^>]*?)>/gi, (match, attrs) => {
    if (!attrs.includes('style=')) {
      return `<a ${attrs} style="text-decoration: none; color: #1a73e8;">`;
    } else if (!attrs.includes('text-decoration')) {
      return `<a ${attrs.replace(/style="([^"]*)"/, 'style="$1; text-decoration: none; color: #1a73e8;"')}>`;
    }
    return match;
  });
  
  // 마크다운 형식의 구분선을 HTML로 변환 (기존 구분선은 유지)
  // 단, mark 태그 안에 있는 것은 제외
  html = html.replace(/\n\s*---\s*\n/gi, (match, offset, string) => {
    // mark 태그 안에 있는지 확인
    const beforeMatch = string.substring(0, offset);
    const lastMarkOpen = beforeMatch.lastIndexOf('<mark');
    const lastMarkClose = beforeMatch.lastIndexOf('</mark>');
    // 마지막 <mark>가 </mark>보다 뒤에 있으면 mark 태그 안에 있음
    if (lastMarkOpen > lastMarkClose) {
      return match; // 변환하지 않음
    }
    return '\n<hr style="border: none; border-top: 2px solid #e0e0e0; margin: 24px 0 32px 0;">\n';
  });
  
  // 잘못된 mark 태그 안의 hr 태그 제거
  html = html.replace(/<mark[^>]*>\s*<hr[^>]*>/gi, '<mark style="background-color: rgb(255, 255, 204); padding: 2px 4px; border-radius: 3px;">');
  html = html.replace(/<\/mark>\s*<hr[^>]*>/gi, '</mark>');
  
  // "(참고 자료 X)" 같은 번호 표기 제거
  if (!isMarkdown || html.includes('<')) {
    // HTML 태그를 임시로 치환하여 텍스트만 처리
    const textNodes = [];
    let tagIndex = 0;
    const tagPlaceholder = '__TAG_PLACEHOLDER__';
    
    // HTML 태그를 임시로 치환
    html = html.replace(/<[^>]+>/g, (match) => {
      textNodes[tagIndex] = match;
      return `${tagPlaceholder}${tagIndex++}${tagPlaceholder}`;
    });
    
    // 텍스트에서 참고 자료 번호 표기 제거
    html = html.replace(/\(참고\s*자료\s*\d+\)/gi, '');
    html = html.replace(/\[참고\s*자료\s*\d+\]/gi, '');
    html = html.replace(/참고\s*자료\s*\d+\s*에\s*따르면/gi, '');
    html = html.replace(/참고\s*자료\s*\d+\s*에서/gi, '');
    html = html.replace(/참고\s*자료\s*\d+\s*에\s*의하면/gi, '');
    html = html.replace(/참고\s*자료\s*\d+/gi, '');
    // 문장 중간에 있는 경우 처리
    html = html.replace(/[ \t]*\(참고\s*자료\s*\d+\)[ \t]*/gi, ' ');
    html = html.replace(/[ \t]*\[참고\s*자료\s*\d+\][ \t]*/gi, ' ');
    // 빈 괄호 제거
    html = html.replace(/\([ \t]*\)/g, '');
    // 연속된 공백을 하나로 (줄바꿈은 유지)
    html = html.replace(/[ \t]{2,}/g, ' ');
    // 마침표 앞 공백 정리
    html = html.replace(/[ \t]+\./g, '.');
    html = html.replace(/\.[ \t]+\./g, '.');
    
    // 태그 복원
    html = html.replace(new RegExp(`${tagPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)${tagPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), (match, index) => {
      return textNodes[parseInt(index)] || match;
    });
  } else {
    // 마크다운 형식이면 텍스트에서만 제거
    html = html.replace(/\(참고\s*자료\s*\d+\)/gi, '');
    html = html.replace(/\[참고\s*자료\s*\d+\]/gi, '');
    html = html.replace(/참고\s*자료\s*\d+\s*에\s*따르면/gi, '');
    html = html.replace(/참고\s*자료\s*\d+\s*에서/gi, '');
    html = html.replace(/참고\s*자료\s*\d+\s*에\s*의하면/gi, '');
    html = html.replace(/참고\s*자료\s*\d+/gi, '');
  }
  
  // 중요한 문장에 배경색 적용 (AI가 <mark> 태그를 사용하지 않은 경우)
  // 단, hr 태그나 다른 블록 요소가 포함된 경우는 제외
  // 서론 부분(제목 다음, 첫 번째 h2 이전)은 제외
  if (!html.includes('<mark')) {
    const importantKeywords = ['중요', '핵심', '요약', '결론', '주의', '필수', '반드시', '꼭'];
    let importantCount = 0;
    
    // 서론 부분 찾기 (h1 다음부터 첫 번째 h2 이전까지)
    const h1Match = html.match(/<h1[^>]*>.*?<\/h1>/i);
    const firstH2Match = html.match(/<h2[^>]*>/i);
    const introEndIndex = firstH2Match ? firstH2Match.index : html.length;
    const introStartIndex = h1Match ? h1Match.index + h1Match[0].length : 0;
    
    importantKeywords.forEach(keyword => {
      if (importantCount >= 2) return;
      // 문장 단위로 찾기
      const regex = new RegExp(`([^<]*${keyword}[^<]*[.!?])`, 'gi');
      html = html.replace(regex, (match, p1, offset, string) => {
        // 서론 부분이면 mark 태그를 추가하지 않음
        if (offset >= introStartIndex && offset < introEndIndex) {
          return match;
        }
        // hr 태그나 다른 블록 요소가 포함되어 있으면 mark 태그를 추가하지 않음
        if (match.includes('<hr') || match.includes('<div') || match.includes('<p>') || match.includes('<h')) {
          return match;
        }
        if (importantCount < 2 && !match.includes('<mark') && match.trim().length > 10) {
          importantCount++;
          return `<mark style="background-color: rgb(255, 255, 204); padding: 2px 4px; border-radius: 3px;">${match}</mark>`;
        }
        return match;
      });
    });
  }
  
  // 이미 mark 태그 안에 hr 태그가 잘못 들어간 경우 수정
  html = html.replace(/<mark([^>]*)>([^<]*)<hr([^>]*)>([^<]*)<\/mark>/gi, '<hr$3><mark$1>$2$4</mark>');
  html = html.replace(/<mark([^>]*)><hr([^>]*)>/gi, '<hr$2><mark$1>');
  
  // 서론 부분(제목 다음, 첫 번째 h2 이전)의 mark 태그 제거
  const h1Match = html.match(/<h1[^>]*>.*?<\/h1>/i);
  const firstH2Match = html.match(/<h2[^>]*>/i);
  if (h1Match && firstH2Match) {
    const introStartIndex = h1Match.index + h1Match[0].length;
    const introEndIndex = firstH2Match.index;
    const beforeIntro = html.substring(0, introStartIndex);
    const introSection = html.substring(introStartIndex, introEndIndex);
    const afterIntro = html.substring(introEndIndex);
    
    // 서론 부분에서 mark 태그 제거
    const cleanedIntro = introSection.replace(/<mark[^>]*>/gi, '').replace(/<\/mark>/gi, '');
    html = beforeIntro + cleanedIntro + afterIntro;
  }
  
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
    
    // 1. 모든 키워드를 수집하고 중복을 제거합니다.
    const allKeywords = new Set([
      ...(ideaData.tags || []).filter((t) => t !== "#AI-추천"),
      ...(ideaData.longTailKeywords || []),
    ]);
    const keywordsText = Array.from(allKeywords).join("\n- ");

    // 2. 연결된 자료 텍스트를 프롬프트 형식으로 만듭니다.
    const linkedScrapsText = (ideaData.linkedScrapsContent || [])
      .map((scrap, index) => {
        const title = scrap.title || scrap.text?.substring(0, 50) || `참고 자료 ${index + 1}`;
        const url = scrap.url || "";
        return `[참고 자료 ${index + 1}]\n제목: ${title}\nURL: ${url}\n내용: ${scrap.text || ""}\n`;
      })
      .join("\n");

    // 3. 원본 본문 참조: origin.fullContent가 있으면 참고 자료에 추가
    let originalContentText = "";
    if (ideaData.origin?.fullContent && ideaData.origin.fullContent.length > 0) {
      originalContentText = `[원본 본문 (리뉴얼 참고용)]\n${ideaData.origin.fullContent.substring(0, 5000)}\n\n`;
    }

    // 4. [스마트 내부 링크] 내 과거 포스팅 목록 조회
    let myPastPostsText = "";
    try {
      const userId = await getCurrentUserId();
      const contentSnap = await get(ref(getDb(), `channel_content/${userId}/blogs`));
      const allBlogs = contentSnap?.val() || {};
      
      // 현재 채널의 글만 필터링 (channelId가 일치하는 경우)
      const myPosts = Object.values(allBlogs)
        .filter(item => item !== null && item.title && item.fullLink)
        .filter(item => {
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
        myPastPostsText += myPosts.map((post, idx) => {
          const title = post.title || "제목 없음";
          const url = post.fullLink || post.link || "";
          const description = post.description || post.cleanText?.substring(0, 100) || "";
          return `${idx + 1}. 제목: ${title}\n   URL: ${url}\n   설명: ${description}\n`;
        }).join("\n");
        myPastPostsText += "\n";
      }
    } catch (error) {
      Logger.warn('[generateDraftFromIdea] 내 과거 포스팅 조회 실패:', error);
      // 오류가 발생해도 계속 진행
    }

    // 5. 추천 검색어와 롱테일 키워드 수집
    const recommendedSearches = ideaData.recommendedSearches || [];
    const longTailKeywords = ideaData.longTailKeywords || [];
    const tags = (ideaData.tags || []).filter((t) => t !== "#AI-추천");
    
    // 6. 프롬프트 구성
    const performanceInfo = performanceData.decayContent && performanceData.decayContent.length > 0
      ? `재활용 후보 콘텐츠: ${performanceData.decayContent.length}개 발견 (과거 고성과 콘텐츠 재활용 가능)`
      : '';
    
    // 백업 파일의 상세한 프롬프트 구성
    const prompt = `
            ${persona.systemPrompt}
            
            [작성 요청]
            아래 정보를 바탕으로 블로그 포스트 초안을 작성해주세요.
            톤앤매너: ${persona.tone}
            
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
            ${(ideaData.outline || []).length > 0 
              ? ideaData.outline.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
              : "목차가 제공되지 않았습니다. 논리적이고 체계적인 구조로 작성해주세요."}
            
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
            ${tags.length > 0 ? tags.map(t => `- ${t.replace(/^#/, "")}`).join("\n") : "없음"}

            ### 6. 롱테일 키워드 (SEO 최적화를 위해 본문에 자연스럽게 통합해주세요)
            ${longTailKeywords.length > 0 
              ? longTailKeywords.map(k => `- ${k}`).join("\n")
              : "없음"}
            
            ### 7. 추천 검색어 (독자들이 검색할 수 있는 키워드, 본문에 자연스럽게 활용해주세요)
            ${recommendedSearches.length > 0 
              ? recommendedSearches.map((s, idx) => `${idx + 1}. ${s}`).join("\n")
              : "없음"}

            ### 8. 관련 참고 자료
            ${originalContentText}${linkedScrapsText || "참고 자료 없음"}
            
            ${myPastPostsText ? `### 9. 내 과거 포스팅 목록 (스마트 내부 링크 추천)
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
            ` : ""}
            
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
            10. **썸네일 정보 생성**: 초안 생성 후 다음 정보를 JSON 형식으로 반환해주세요:
              - 썸네일 텍스트 이미지 프롬프트 (영어): 썸네일 이미지 생성을 위한 영어 프롬프트 (상세하고 기술적으로, Gemini 이미지 생성 가이드 참고)
              - 썸네일 텍스트 이미지 프롬프트 (한글): 썸네일 이미지 생성을 위한 한글 프롬프트 (의미 전달 중심)
              - 썸네일 문구: 썸네일에 표시할 짧은 문구 (12자 이내, 핵심 키워드)
              형식: <썸네일정보>{"thumbnailPromptEn": "영어 프롬프트", "thumbnailPromptKo": "한글 프롬프트", "thumbnailText": "썸네일 문구"}</썸네일정보>
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
                * 예: "High-quality, eye-catching cover image showcasing [핵심 주제], vibrant colors, professional composition, modern design, compelling visual narrative that captures the essence of [주제], 16:9 aspect ratio, photorealistic style"
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
      Logger.error('[generateDraftFromIdea] 초안이 비어있습니다.');
      return { success: false, error: '초안이 생성되지 않았습니다. Gemini API 응답이 비어있습니다. 다시 시도해주세요.' };
    }
    
    if (rawDraft.startsWith("오류:") || rawDraft.includes("오류:")) {
      Logger.error('[generateDraftFromIdea] Gemini API 오류:', rawDraft);
      const errorMessage = rawDraft.replace(/^오류:\s*/i, '').trim() || 'Gemini API에서 오류가 발생했습니다.';
      return { success: false, error: errorMessage };
    }
    
    // 응답이 너무 짧거나 유효하지 않은 경우 체크
    if (rawDraft.trim().length < 50) {
      Logger.warn('[generateDraftFromIdea] 초안이 너무 짧습니다:', rawDraft);
      // 너무 짧은 경우에도 경고만 하고 계속 진행 (사용자가 확인할 수 있도록)
    }
    
    // 1. 마크다운 클리닝: 코드 블록 태그 제거
    let cleanedDraft = rawDraft;
    cleanedDraft = cleanedDraft.replace(/^```markdown\s*\n?/i, '');
    cleanedDraft = cleanedDraft.replace(/^```md\s*\n?/i, '');
    cleanedDraft = cleanedDraft.replace(/^```\s*\n?/i, '');
    cleanedDraft = cleanedDraft.replace(/\n?```\s*$/i, '');
    cleanedDraft = cleanedDraft.replace(/\n?```markdown\s*$/i, '');
    cleanedDraft = cleanedDraft.replace(/\n?```md\s*$/i, '');
    cleanedDraft = cleanedDraft.trim();
    
    // 2. 가독성 포맷팅
    let formattedDraft = formatDraftForReadability(cleanedDraft);
    
    // 3. SEO 최적화된 제목 추출 (h1 태그에서)
    let seoTitle = null;
    const h1Match = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i) || formattedDraft.match(/^#\s+(.+)$/m);
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
          const h1MatchRetry = formattedDraft.match(/<h1[^>]*>([^<]+)<\/h1>/i) || formattedDraft.match(/^#\s+(.+)$/m);
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
            if (translated && !translated.startsWith("오류:")) {
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
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)) // 5초 타임아웃
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
      .map(t => t.replace(/^#/, ''))
      .filter(t => t && t !== 'AI-추천')
      .join(', ');
    
    // 7. 썸네일 정보 추출 (초안에서 <썸네일정보> 태그 찾기)
    let thumbnailInfo = null;
    // cleanedDraft에서 먼저 찾고, 없으면 formattedDraft에서 찾기
    const thumbnailMatch = cleanedDraft.match(/<썸네일정보>([\s\S]*?)<\/썸네일정보>/) || formattedDraft.match(/<썸네일정보>([\s\S]*?)<\/썸네일정보>/);
    if (thumbnailMatch && thumbnailMatch[1]) {
      try {
        thumbnailInfo = JSON.parse(thumbnailMatch[1].trim());
        // 초안에서 썸네일 정보 태그 제거 (cleanedDraft와 formattedDraft 모두에서)
        cleanedDraft = cleanedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '');
        formattedDraft = formattedDraft.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '');
      } catch (e) {
        Logger.error('[generateDraftFromIdea] 썸네일 정보 JSON 파싱 실패:', e);
        // JSON 파싱 실패 시 기본값 사용 (아래에서 처리)
      }
    }
    
    // 8. 썸네일 정보가 없으면 기본값 생성 (Gemini 이미지 생성 API 최적화)
    if (!thumbnailInfo) {
      // Gemini 2.5 Flash Image 모델에 최적화된 프롬프트
      const thumbnailPromptEn = `Create a high-quality, eye-catching cover image for a blog post titled "${seoTitle || title}". 
The image should have vibrant colors, professional composition, modern design, and a compelling visual narrative that captures the essence of the topic. 
Use a 16:9 aspect ratio with a realistic style. The image should be suitable for use as a thumbnail and should draw the viewer's attention.`;
      
      thumbnailInfo = {
        thumbnailPromptEn: thumbnailPromptEn.trim(),
        thumbnailPromptKo: `"${seoTitle || title}"에 대한 고품질 썸네일 이미지, 생생한 색상, 전문적인 구성, 현대적인 디자인, 눈길을 사로잡는 시각적 내러티브, 16:9 비율, 사실적인 스타일`,
        thumbnailText: (seoTitle || title || '').substring(0, 12)
      };
    }
    
    return { 
      success: true, 
      draft: formattedDraft,
      permalink: permalink,
      tags: tagsForPublish,
      seoTitle: seoTitle, // SEO 최적화된 제목
      thumbnailInfo: thumbnailInfo // 썸네일 정보
    };

  } catch (e) {
    Logger.error('[generateDraftFromIdea] 오류:', e);
    return { success: false, error: e.message };
  }
}

// 6. 아이디어 브리핑
export async function generateIdeaBriefing(cardId, title, description, options = {}) {
  const { onProgress, status = 'ideas' } = options; // status 옵션 추가
  const userId = await getCurrentUserId(); // 동적으로 사용자 ID 가져오기
  const updates = {};

  try {
    Logger.info(`[generateIdeaBriefing] 시작 - cardId: ${cardId}, title: ${title}, status: ${status}, userId: ${userId}`);
    
    // Gemini API 키 확인
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    if (!geminiApiKey || !geminiApiKey.trim()) {
      Logger.warn(`[generateIdeaBriefing] Gemini API 키가 없습니다. 브리핑 생성을 건너뜁니다.`);
      // API 키가 없으면 조용히 실패 (에러를 throw하지 않고 조용히 종료)
      // 사용자에게는 UI에서 알림을 표시할 수 있도록 메시지 전송
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              action: "gemini_api_key_missing",
              message: "Gemini API 키가 설정되지 않았습니다. 채널 관리에서 API 키를 입력해주세요."
            }).catch(() => {});
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
        Logger.debug(`[generateIdeaBriefing] Gemini API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] Gemini API 호출 실패:`, apiError);
        // API 호출 실패 시 목차 생성을 건너뛰고 계속 진행
        if (apiError.message.includes("Gemini API 키가 없습니다") || 
            apiError.message.includes("API key not valid") ||
            apiError.message.includes("Please pass a valid API key")) {
          Logger.warn(`[generateIdeaBriefing] Gemini API 키가 없거나 유효하지 않아 목차 생성을 건너뜁니다.`);
          // 사용자에게 알림을 보내기 위해 UI에 메시지 전송
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                  action: "gemini_api_key_error",
                  message: "Gemini API 키가 없거나 유효하지 않습니다. 채널 관리에서 API 키를 확인해주세요."
                }).catch(() => {});
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
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                outlineArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }
          
          // 배열인지 확인하고 문자열 배열로 변환
          if (Array.isArray(outlineArray)) {
            updates.outline = outlineArray.map(item => {
              // 객체인 경우 문자열로 변환
              if (typeof item === 'object' && item !== null) {
                return item.title || item.text || item.name || String(item);
              }
              return String(item);
            }).filter(item => item && item.trim().length > 0);
            Logger.info(`[generateIdeaBriefing] 목차 생성 성공: ${updates.outline.length}개 항목`, updates.outline);
          } else {
            Logger.warn(`[generateIdeaBriefing] 목차 파싱 실패: 배열이 아님 - ${typeof outlineArray}`, outlineArray);
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 목차 파싱 오류:`, parseError);
          Logger.debug(`[generateIdeaBriefing] 원본 응답: ${res}`);
        }
      } else {
        Logger.warn(`[generateIdeaBriefing] 목차 생성 실패 - 응답: ${res || 'null'}`);
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
        Logger.debug(`[generateIdeaBriefing] 주요 키워드 API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] 주요 키워드 API 호출 실패:`, apiError);
        if (apiError.message.includes("API key not valid") ||
            apiError.message.includes("Please pass a valid API key")) {
          Logger.warn(`[generateIdeaBriefing] Gemini API 키가 유효하지 않아 주요 키워드 생성을 건너뜁니다.`);
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
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                keywordsArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }
          
          if (Array.isArray(keywordsArray)) {
            updates.mainKeywords = keywordsArray.map(item => {
              if (typeof item === 'object' && item !== null) {
                return item.keyword || item.text || item.name || String(item);
              }
              return String(item);
            }).filter(item => item && item.trim().length > 0).slice(0, 5);
            Logger.info(`[generateIdeaBriefing] 주요 키워드 생성 성공: ${updates.mainKeywords.length}개`, updates.mainKeywords);
          } else {
            Logger.warn(`[generateIdeaBriefing] 주요 키워드 파싱 실패: 배열이 아님`);
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 주요 키워드 파싱 오류:`, parseError);
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
        Logger.debug(`[generateIdeaBriefing] 롱테일 키워드 API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] 롱테일 키워드 API 호출 실패:`, apiError);
        if (apiError.message.includes("API key not valid") ||
            apiError.message.includes("Please pass a valid API key")) {
          Logger.warn(`[generateIdeaBriefing] Gemini API 키가 유효하지 않아 롱테일 키워드 생성을 건너뜁니다.`);
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
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                longTailArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }
          
          if (Array.isArray(longTailArray)) {
            updates.longTailKeywords = longTailArray.map(item => {
              if (typeof item === 'object' && item !== null) {
                return item.keyword || item.text || item.name || String(item);
              }
              return String(item);
            }).filter(item => item && item.trim().length > 0).slice(0, 5);
            Logger.info(`[generateIdeaBriefing] 롱테일 키워드 생성 성공: ${updates.longTailKeywords.length}개`, updates.longTailKeywords);
          } else {
            Logger.warn(`[generateIdeaBriefing] 롱테일 키워드 파싱 실패: 배열이 아님`);
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 롱테일 키워드 파싱 오류:`, parseError);
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
        Logger.debug(`[generateIdeaBriefing] 추천 검색어 API 응답: ${res.substring(0, 200)}...`);
      } catch (apiError) {
        Logger.error(`[generateIdeaBriefing] 추천 검색어 API 호출 실패:`, apiError);
        if (apiError.message.includes("API key not valid") ||
            apiError.message.includes("Please pass a valid API key")) {
          Logger.warn(`[generateIdeaBriefing] Gemini API 키가 유효하지 않아 추천 검색어 생성을 건너뜁니다.`);
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
              const codeBlockMatch = res.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch) {
                keywordsArray = JSON.parse(codeBlockMatch[1]);
              }
            }
          }
          
          if (Array.isArray(keywordsArray)) {
            // # 제거하고 태그 배열로 변환
            updates.tags = keywordsArray.map(item => {
              let keyword = typeof item === 'object' && item !== null
                ? (item.keyword || item.text || item.name || String(item))
                : String(item);
              // # 제거
              keyword = keyword.replace(/^#+/, '').trim();
              return keyword;
            }).filter(item => item && item.trim().length > 0).slice(0, 10);
            Logger.info(`[generateIdeaBriefing] 추천 검색어 생성 성공: ${updates.tags.length}개`, updates.tags);
          } else {
            Logger.warn(`[generateIdeaBriefing] 추천 검색어 파싱 실패: 배열이 아님`);
          }
        } catch (parseError) {
          Logger.error(`[generateIdeaBriefing] 추천 검색어 파싱 오류:`, parseError);
        }
      }
      
      if (onProgress) onProgress(90);
    }

    if (Object.keys(updates).length > 0) {
      const updatePath = `kanban/${userId}/${status}/${cardId}`;
      Logger.debug(`[generateIdeaBriefing] Firebase 업데이트 시작 - path: ${updatePath}, updates:`, updates);
      try {
        await update(ref(getDb(), updatePath), cleanDataForFirebase(updates));
        Logger.biz(`✅ [generateIdeaBriefing] 브리핑 생성 완료 - cardId: ${cardId}, status: ${status}, 업데이트 항목: ${Object.keys(updates).join(', ')}`);
      } catch (updateError) {
        Logger.error(`[generateIdeaBriefing] Firebase 업데이트 실패:`, updateError);
        throw updateError;
      }
      
      // REST API 모드에서는 실시간 리스너가 작동하지 않으므로, UI 갱신을 위해 최신 데이터를 가져와서 메시지 전송
      try {
        const kanbanRef = ref(getDb(), `kanban/${userId}`);
        const kanbanSnap = await get(kanbanRef);
        const kanbanData = kanbanSnap?.val() || {};
        
        // 1. 확장 프로그램 UI(사이드 패널/팝업)에 메시지 전송 (chrome.runtime.sendMessage)
        chrome.runtime.sendMessage({
          action: "kanban_data_updated",
          data: kanbanData
        }).catch((err) => {
          // 확장 프로그램 UI가 닫혔을 수 있음 (정상적인 상황)
          if (err?.message && !err.message.includes('message port closed') && !err.message.includes('Could not establish connection')) {
            Logger.debug(`[generateIdeaBriefing] 확장 프로그램 UI 메시지 전송 실패:`, err.message);
          }
        });
        
        // 2. 웹페이지 탭의 content script에도 메시지 전송 (chrome.tabs.sendMessage)
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
              chrome.tabs.sendMessage(tab.id, {
                action: "kanban_data_updated",
                data: kanbanData
              }).catch((err) => {
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
      Logger.warn(`[generateIdeaBriefing] 업데이트할 데이터 없음 - 모든 생성 옵션이 실패했거나 비활성화됨`);
    }
  } catch (error) {
    Logger.error(`[generateIdeaBriefing] 전체 오류 - cardId: ${cardId}, title: ${title}, userId: ${userId}:`, error);
    // 에러를 다시 throw하여 상위에서 처리할 수 있도록 함
    throw error;
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
