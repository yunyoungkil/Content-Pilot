// js/ui/snsPostModal.js
// SNS 게시글 생성 모달

import { showToast } from '../utils.js';

/**
 * SNS 플랫폼별 게시글 생성 AI 프롬프트
 */
function generateSnsPrompt(platform, title) {
  const basePrompt = `다음 콘텐츠 제목을 기반으로 ${platform} 게시글을 3가지 스타일로 작성해주세요.\n\n콘텐츠 제목: ${title}\n\n`;

  const styleGuide = {
    twitter: '트위터/X 특성: 280자 제한, 간결하고 임팩트있게, 해시태그 2-3개',
    threads: '쓰레드 특성: 여러 문단 가능, 스토리텔링, 개인적 경험 강조',
    facebook: '페이스북 특성: 친근한 톤, 질문 유도, 이모지 활용',
    pinterest: '핀터레스트 특성: 시각적 설명, 영감 주는 톤, DIY/튜토리얼 강조',
    linkedin: '링크드인 특성: 전문적 톤, 인사이트 강조, 비즈니스 가치',
    reddit: '레딧 특성: 정보 제공, 토론 유도, 진솔한 톤',
  };

  return (
    basePrompt +
    `
${styleGuide[platform] || '일반 SNS 게시글'}

다음 3가지 스타일로 작성:
1. **캐주얼/친근한 톤**: 이모지 활용, 편안한 말투
2. **전문적/정보 전달 톤**: 가치와 인사이트 강조
3. **질문형/참여 유도 톤**: 독자 참여 유도, 공감 형성

각 스타일을 다음 형식으로 작성:
[스타일1]
(게시글 텍스트)

[스타일2]
(게시글 텍스트)

[스타일3]
(게시글 텍스트)

---

추가로, 이 콘텐츠에 어울리는 **카드 뉴스용 이미지 프롬프트**를 3개 작성해주세요.
각 이미지 프롬프트는 영어로 작성하며, Imagen 3 API로 생성할 수 있도록 구체적이고 시각적으로 표현해주세요.

다음 형식으로 작성:
[이미지프롬프트1]
(영어 이미지 프롬프트)

[이미지프롬프트2]
(영어 이미지 프롬프트)

[이미지프롬프트3]
(영어 이미지 프롬프트)
`
  );
}

/**
 * AI 응답에서 톤 정보 추출 (스타일 레이블 제거 전에 실행)
 */
function extractStyleTones(response) {
  const tones = [];
  // **[스타일1] 캐주얼/친근한 톤** 형식에서 톤 설명만 추출
  // [^\n\r]+ 로 같은 줄에 있는 텍스트만 매칭 (줄바꿈 이전까지)
  const regex = /\*?\*?\[스타일\d+\]\s*([^\n\r*]+?)(?:\*\*)?(?:\r?\n|$)/g;
  const matches = response.matchAll(regex);

  for (const match of matches) {
    if (match[1]) {
      const tone = match[1].trim();
      // 빈 문자열, 너무 긴 텍스트, 괄호로 둘러싸인 플레이스홀더는 제외
      if (tone && tone.length > 0 && tone.length < 50 && !tone.match(/^\(.+\)$/)) {
        tones.push(tone);
      }
    }
  }

  // 톤 정보가 충분하지 않으면 기본값 사용
  if (tones.length < 3) {
    return ['캐주얼/친근한 톤', '전문적/정보 전달 톤', '질문형/참여 유도 톤'];
  }

  return tones;
}

/**
 * AI 응답에서 3가지 스타일 파싱 (스타일 레이블과 톤 정보 제거)
 * @returns {{ styles: string[], tones: string[], imagePrompts: string[] }}
 */
function parseSnsStyles(response) {
  console.log('[parseSnsStyles] 원본 응답:', response);

  // 먼저 톤 정보 추출
  const tones = extractStyleTones(response);

  const styles = [];
  const imagePrompts = [];

  // 1. 먼저 이미지 프롬프트 섹션을 분리하여 추출
  // "---"로 시작하는 부분이나 [이미지프롬프트1] 패턴을 찾아서 그 이후를 이미지 프롬프트 섹션으로 간주
  let contentPart = response;
  let imagePromptPart = '';

  // --- 기준으로 먼저 분리
  const dashSeparatorMatch = response.match(/(^|\n)\s*---\s*\n/);
  if (dashSeparatorMatch) {
    const separatorIndex = dashSeparatorMatch.index;
    contentPart = response.substring(0, separatorIndex);
    imagePromptPart = response.substring(separatorIndex);
    console.log('[parseSnsStyles] --- 구분자로 분리됨');
  } else {
    // [이미지프롬프트1] 패턴으로 분리
    const imagePromptMatch = response.match(/\[이미지프롬프트\d+\]/);
    if (imagePromptMatch) {
      contentPart = response.substring(0, imagePromptMatch.index);
      imagePromptPart = response.substring(imagePromptMatch.index);
      console.log('[parseSnsStyles] [이미지프롬프트] 패턴으로 분리됨');
    }
  }

  console.log('[parseSnsStyles] 콘텐츠 부분 길이:', contentPart.length);
  console.log('[parseSnsStyles] 이미지 프롬프트 부분 길이:', imagePromptPart.length);

  // 2. 스타일 파싱 (콘텐츠 부분만 사용)
  const styleRegex = /\[스타일(\d+)\][^\n]*\n+([\s\S]*?)(?=\[스타일\d+\]|$)/gi;
  const styleMatches = contentPart.matchAll(styleRegex);

  for (const match of styleMatches) {
    let text = match[2].trim();

    // 첫 줄이 톤 설명이면 제거
    const lines = text.split('\n');
    if (lines.length > 0 && lines[0].match(/^\*\*[^\*]+\*\*$|^\([^\)]+\)$/)) {
      text = lines.slice(1).join('\n').trim();
    }

    if (text) {
      styles.push(text);
      console.log(`[parseSnsStyles] 스타일 ${match[1]} 파싱됨, 길이: ${text.length}`);
    }
  }

  // 3. 이미지 프롬프트 파싱
  if (imagePromptPart) {
    const promptRegex = /\[이미지프롬프트(\d+)\]\s*\n+([\s\S]*?)(?=\[이미지프롬프트\d+\]|$)/gi;
    const promptMatches = imagePromptPart.matchAll(promptRegex);

    for (const match of promptMatches) {
      const prompt = match[2].trim();
      if (prompt && prompt.length > 0 && prompt.length < 2000) {
        imagePrompts.push(prompt);
        console.log(`[parseSnsStyles] 이미지 프롬프트 ${match[1]} 파싱됨, 길이: ${prompt.length}`);
      }
    }
  }

  // 파싱 실패 시 전체 응답을 하나의 스타일로
  if (styles.length === 0) {
    console.warn('[parseSnsStyles] 스타일 파싱 실패, 전체를 하나의 스타일로 사용');
    styles.push(contentPart.trim());
  }

  console.log('[parseSnsStyles] 최종 결과:', {
    stylesCount: styles.length,
    tonesCount: tones.length,
    imagePromptsCount: imagePrompts.length,
  });

  return { styles, tones, imagePrompts };
}

/**
 * SNS 게시글 생성 모달 표시
 */
export async function showSnsPostModal(platform, title, url, itemId, container) {
  console.log('[SNS Post Modal] Called with platform:', platform);

  // 중복 게시 확인
  if (itemId) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'get_sns_post_history',
        itemId: itemId,
        platform: platform,
      });

      if (response && response.success && response.history && response.history.length > 0) {
        const lastPost = response.history[0];
        const lastPostDate = new Date(lastPost.postedAt);
        const hoursSinceLastPost = (Date.now() - lastPostDate.getTime()) / (1000 * 60 * 60);

        // 최근 24시간 이내 게시 경고
        if (hoursSinceLastPost < 24) {
          const confirmMsg = `⚠️ 이 콘텐츠를 ${Math.round(hoursSinceLastPost)}시간 전에 ${platform}에 이미 게시했습니다.\n\n계속 진행하시겠습니까?`;
          if (!confirm(confirmMsg)) {
            console.log('[SNS Post Modal] User cancelled due to duplicate warning');
            return;
          }
        }

        console.log(
          `[SNS Post Modal] Previous posts on ${platform}: ${response.history.length} times`
        );
      }
    } catch (err) {
      console.warn('[SNS Post Modal] Could not check post history:', err);
      // 이력 확인 실패해도 계속 진행
    }
  }

  // 기존 모달이 있으면 제거 (중복 방지)
  const existingModals = document.querySelectorAll('.sns-post-modal-overlay');
  existingModals.forEach((modal) => {
    console.log('[SNS Post Modal] Removing existing modal');
    modal.remove();
  });

  const platformNames = {
    twitter: '트위터/X',
    threads: '쓰레드',
    facebook: '페이스북',
    pinterest: '핀터레스트',
    linkedin: '링크드인',
    reddit: '레딧',
  };

  const platformName = platformNames[platform] || platform;

  // Shadow Root 찾기 (패널이 Shadow DOM 내부에 있을 경우)
  let targetRoot = document.body;
  if (container) {
    const shadowRoot = container.getRootNode();
    if (shadowRoot !== document) {
      // Shadow DOM이 있으면 모달도 Shadow Root에 추가
      targetRoot = shadowRoot;
    }
  }

  // 모달 생성
  const modal = document.createElement('div');
  modal.className = 'sns-post-modal-overlay';
  modal.style.cssText =
    'position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0, 0, 0, 0.8) !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 2147483647 !important;';
  modal.innerHTML = `
    <div class="sns-post-modal" style="background: white; border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); max-width: 700px; width: 90%; max-height: 85vh; display: flex; flex-direction: column; position: relative; z-index: 2147483647;">
      <div class="sns-post-modal-header" style="padding: 20px 24px; border-bottom: 1px solid #e9ecef; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #212529;">📱 ${platformName} 게시글 작성</h3>
        <button class="sns-post-modal-close" style="background: none; border: none; font-size: 24px; color: #6c757d; cursor: pointer; padding: 0; width: 32px; height: 32px; border-radius: 6px;" title="닫기">✕</button>
      </div>
      <div class="sns-post-modal-body" style="padding: 24px; overflow-y: auto; flex: 1;">
        <div class="sns-post-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px;">
          <div class="sns-post-spinner" style="width: 48px; height: 48px; border: 4px solid #f3f3f3; border-top: 4px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px;"></div>
          <p style="color: #6c757d; font-size: 14px; margin: 0;">AI가 게시글을 작성하고 있습니다...</p>
        </div>
      </div>
    </div>
  `;

  targetRoot.appendChild(modal);
  console.log(
    '[SNS Post] Modal appended to:',
    targetRoot === document.body ? 'document.body' : 'Shadow Root'
  );

  // 닫기 버튼 및 오버레이 클릭
  modal.querySelector('.sns-post-modal-close').onclick = () => modal.remove();
  // 백드롭(오버레이) 클릭은 모달을 닫지 않도록 변경 — 사용자가 닫기 버튼을 눌러 직접 닫게 함
  modal.onclick = (e) => {
    if (e.target === modal) {
      // 의도적으로 아무 동작도 하지 않음 (실수로 닫히는 것을 방지)
      console.log('[SNS Post] Backdrop click ignored to keep modal open');
    }
  };

  // 1. 먼저 캐시 확인 (itemId가 있을 때만)
  if (itemId) {
    try {
      console.log('🔍 [SNS Post] 캐시 확인 시작:', { itemId, platform });
      const cacheResponse = await chrome.runtime.sendMessage({
        action: 'get_sns_post_cache',
        itemId: itemId,
        platform: platform,
      });

      console.log('📦 [SNS Post] 캐시 응답 받음:', {
        response: cacheResponse,
        success: cacheResponse?.success,
        cached: cacheResponse?.cached,
        hasData: !!cacheResponse?.data,
        dataKeys: cacheResponse?.data ? Object.keys(cacheResponse.data) : [],
      });

      if (cacheResponse && cacheResponse.success && cacheResponse.cached) {
        console.log('✅ [SNS Post] 캐시 사용 - AI 호출 안함!');
        console.log('📄 [SNS Post] 캐시된 데이터:', cacheResponse.data);
        const cachedData = cacheResponse.data;

        // 캐시 데이터가 객체인지 배열인지 확인
        const stylesData = cachedData.stylesData
          ? cachedData.stylesData // 새 형식: { styles, tones }
          : { styles: cachedData.styles || [], tones: [] }; // 구 형식: styles만 있음

        const generatedAt = new Date(cachedData.generatedAt);
        const hoursAgo = Math.floor((Date.now() - generatedAt.getTime()) / (1000 * 60 * 60));

        // 캐시된 게시글 표시
        renderSnsPostsUI(modal, stylesData, platform, url, itemId, container, true, hoursAgo);
        return;
      } else {
        console.log('❌ [SNS Post] 캐시 없음 또는 조건 불만족 - AI 호출 예정');
        console.log('🔎 [SNS Post] 캐시 체크 상세:', {
          hasResponse: !!cacheResponse,
          isSuccess: cacheResponse?.success,
          isCached: cacheResponse?.cached,
          hasData: !!cacheResponse?.data,
          rawResponse: JSON.stringify(cacheResponse, null, 2),
        });
      }
    } catch (err) {
      console.warn('⚠️ [SNS Post] 캐시 확인 중 에러:', err);
      // 캐시 확인 실패하면 새로 생성
    }
  } else {
    console.warn('⚠️ [SNS Post] itemId 없음 - 캐시 사용 불가');
  }

  // 2. 캐시가 없으면 AI로 새로 생성
  console.log('🤖 [SNS Post] AI 호출하여 새 게시글 생성');
  generateNewSnsPosts(modal, platform, title, url, itemId, container);
}

/**
 * AI로 새 SNS 게시글 생성
 */
async function generateNewSnsPosts(modal, platform, title, url, itemId, container) {
  const modalBody = modal.querySelector('.sns-post-modal-body');
  modalBody.innerHTML = `
    <div class="sns-post-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px;">
      <div class="sns-post-spinner" style="width: 48px; height: 48px; border: 4px solid #f3f3f3; border-top: 4px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px;"></div>
      <p style="color: #6c757d; font-size: 14px; margin: 0;">AI가 게시글을 작성하고 있습니다...</p>
    </div>
  `;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  try {
    // AI로 게시글 생성
    const prompt = generateSnsPrompt(platform, title);
    const response = await chrome.runtime.sendMessage({
      action: 'call_gemini_api',
      prompt: prompt,
      model: 'gemini-2.0-flash',
    });

    console.log('[SNS Post] Response:', response);

    if (!response || !response.success) {
      throw new Error(response?.error || 'AI 응답 실패');
    }

    // response 구조 확인: response.result 또는 response.text
    const aiText = response.result || response.text || '';
    console.log('[SNS Post] AI Text:', aiText);

    if (!aiText) {
      throw new Error('AI 응답이 비어있습니다');
    }

    const stylesData = parseSnsStyles(aiText);

    console.log('[SNS Post] Parsed styles:', stylesData);

    // 캐시에 저장
    if (itemId) {
      try {
        await chrome.runtime.sendMessage({
          action: 'save_sns_post_cache',
          itemId: itemId,
          platform: platform,
          stylesData: stylesData, // { styles, tones } 객체 저장
        });
        console.log('[SNS Post] Cached generated posts');
      } catch (err) {
        console.warn('[SNS Post] Failed to cache posts:', err);
      }
    }

    // UI 렌더링
    renderSnsPostsUI(modal, stylesData, platform, url, itemId, container, false, 0);
  } catch (error) {
    console.error('SNS post generation failed:', error);
    const modalBody = modal.querySelector('.sns-post-modal-body');
    modalBody.innerHTML = `
      <div class="sns-post-error" style="text-align: center; padding: 40px 20px;">
        <p style="font-size: 16px; color: #dc3545; margin-bottom: 8px;">⚠️ 게시글 생성에 실패했습니다.</p>
        <p class="sns-post-error-detail" style="font-size: 13px; color: #6c757d; margin-bottom: 20px;">${error.message}</p>
        <button class="sns-post-retry-btn" style="background: #667eea; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;">다시 시도</button>
      </div>
    `;

    modalBody.querySelector('.sns-post-retry-btn').onclick = () => {
      modal.remove();
      showSnsPostModal(platform, title, url, itemId, container);
    };
  }
}

/**
 * SNS 게시글 UI 렌더링 (캐시된 것 또는 새로 생성된 것)
 */
function renderSnsPostsUI(modal, stylesData, platform, url, itemId, container, isCached, hoursAgo) {
  const modalBody = modal.querySelector('.sns-post-modal-body');

  // stylesData가 배열이면 (구 형식) 객체로 변환
  const { styles, tones, imagePrompts } = Array.isArray(stylesData)
    ? { styles: stylesData, tones: [], imagePrompts: [] }
    : { ...stylesData, imagePrompts: stylesData.imagePrompts || [] };

  const cacheInfo = isCached
    ? `<div style="background: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 6px; padding: 12px; margin-bottom: 16px; font-size: 13px; color: #004085;">
        💾 캐시된 게시글 (${hoursAgo < 1 ? '방금' : hoursAgo < 24 ? `${hoursAgo}시간 전` : `${Math.floor(hoursAgo / 24)}일 전`} 생성)
        <button class="sns-regenerate-btn" style="background: #667eea; color: white; border: none; padding: 4px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-left: 12px;">🔄 새로 생성</button>
      </div>`
    : '';

  // 이미지 프롬프트 섹션 HTML 생성
  const imagePromptsSection =
    imagePrompts && imagePrompts.length > 0
      ? `
    <div class="sns-post-image-prompts-section" style="margin-bottom: 20px; padding: 16px; background: #fff9f0; border: 1px solid #ffd89b; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <label style="display: block; font-size: 14px; font-weight: 600; color: #495057; margin: 0;">🎨 카드 뉴스 이미지 프롬프트</label>
        <span style="font-size: 12px; color: #6c757d;">클릭하여 복사</span>
      </div>
      <div class="sns-post-image-prompts" style="display: flex; flex-direction: column; gap: 12px;">
        ${imagePrompts
          .map(
            (prompt, index) => `
          <div class="sns-post-image-prompt-item" data-prompt="${escapeHtml(prompt)}" style="display: flex; align-items: start; gap: 8px; padding: 12px; background: white; border: 1px solid #e9ecef; border-radius: 6px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.borderColor='#667eea'; this.style.boxShadow='0 2px 8px rgba(102, 126, 234, 0.1)';" onmouseout="this.style.borderColor='#e9ecef'; this.style.boxShadow='none';" title="클릭하여 복사">
            <span style="flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #667eea; color: white; border-radius: 50%; font-size: 12px; font-weight: 600;">${index + 1}</span>
            <span style="flex: 1; font-size: 13px; color: #495057; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${escapeHtml(prompt)}</span>
            <span class="copy-icon" style="flex-shrink: 0; font-size: 16px; opacity: 0.5;">📋</span>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
    `
      : '';

  modalBody.innerHTML = `
    ${cacheInfo}
    <div class="sns-post-options" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px;">
      ${styles
        .map(
          (text, index) => `
        <div class="sns-post-option" style="border: 1px solid #dee2e6; border-radius: 8px; padding: 16px;">
          <div class="sns-post-option-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span class="sns-post-option-label" style="font-size: 13px; font-weight: 600; color: #495057;">스타일 ${index + 1}${tones[index] ? ` - ${tones[index]}` : ''}</span>
            <div style="display: flex; gap: 8px;">
              <button class="sns-post-share-this-btn" data-index="${index}" style="background: #667eea; color: white; border: none; padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; box-shadow: 0 2px 4px rgba(102, 126, 234, 0.2);" title="이 스타일로 공유">
                🚀 공유하기
              </button>
            </div>
          </div>
          <textarea class="sns-post-textarea" rows="6" style="width: 100%; padding: 12px; border: 1px solid #ced4da; border-radius: 6px; font-size: 14px; line-height: 1.6; resize: vertical; min-height: 120px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${escapeHtml(text)}</textarea>
        </div>
      `
        )
        .join('')}
    </div>
    ${imagePromptsSection}
    <div class="sns-post-url-section" style="margin-bottom: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
      <label style="display: block; font-size: 13px; font-weight: 500; color: #495057; margin-bottom: 8px;">🔗 링크 (함께 공유됩니다):</label>
      <input type="text" class="sns-post-url-input" value="${escapeHtml(url)}" readonly style="width: 100%; padding: 10px 12px; border: 1px solid #dee2e6; border-radius: 6px; font-size: 13px; background: white; color: #6c757d; font-family: 'Courier New', monospace;">
    </div>
    <div class="sns-post-footer" style="display: flex; justify-content: center; padding-top: 16px; border-top: 1px solid #e9ecef;">
      <button class="sns-post-cancel-btn" style="padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; background: #f8f9fa; color: #495057; border: 1px solid #dee2e6;">닫기</button>
    </div>
  `;

  // 이미지 프롬프트 클릭 이벤트 (복사)
  if (imagePrompts && imagePrompts.length > 0) {
    modalBody.querySelectorAll('.sns-post-image-prompt-item').forEach((item) => {
      item.onclick = async () => {
        const prompt = item.dataset.prompt;
        try {
          await navigator.clipboard.writeText(prompt);
          const copyIcon = item.querySelector('.copy-icon');
          const originalText = copyIcon.textContent;
          copyIcon.textContent = '✅';
          showToast('📋 이미지 프롬프트가 클립보드에 복사되었습니다!');
          setTimeout(() => {
            copyIcon.textContent = originalText;
          }, 2000);
        } catch (err) {
          console.error('[SNS Post] Failed to copy image prompt:', err);
          showToast('⚠️ 복사에 실패했습니다.');
        }
      };
    });
  }

  // 새로 생성 버튼 (캐시된 경우에만)
  if (isCached) {
    const regenerateBtn = modalBody.querySelector('.sns-regenerate-btn');
    if (regenerateBtn) {
      regenerateBtn.onclick = () => {
        const platformNames = {
          twitter: '트위터/X',
          threads: '쓰레드',
          facebook: '페이스북',
          pinterest: '핀터레스트',
          linkedin: '링크드인',
          reddit: '레딧',
        };
        // 모달의 title 가져오기
        const modalHeader = modal.querySelector('.sns-post-modal-header h3');
        const title = modalHeader
          ? modalHeader.textContent.replace('📱 ', '').replace(' 게시글 작성', '')
          : platformNames[platform];

        generateNewSnsPosts(modal, platform, title, url, itemId, container);
      };
    }
  }

  // 닫기 버튼
  const cancelBtn = modalBody.querySelector('.sns-post-cancel-btn');
  if (cancelBtn) {
    cancelBtn.onclick = () => modal.remove();
  }

  // 각 스타일별 공유 버튼
  modalBody.querySelectorAll('.sns-post-share-this-btn').forEach((btn) => {
    btn.onclick = async (e) => {
      const index = parseInt(e.target.dataset.index);
      const textareas = modalBody.querySelectorAll('.sns-post-textarea');
      const shareText = textareas[index].value;

      console.log('[SNS Post] Sharing style', index + 1, 'to platform:', platform);

      // Threads는 클립보드 복사 후 앱 열기
      if (platform === 'threads') {
        try {
          // 클립보드에 텍스트 복사
          await navigator.clipboard.writeText(shareText + '\n\n' + url);

          // Threads 앱 열기
          window.open('https://www.threads.net/', '_blank');

          showToast('📋 게시글이 클립보드에 복사되었습니다! Threads에서 붙여넣기 하세요.');

          // SNS 발행 이력 저장
          if (itemId) {
            try {
              await chrome.runtime.sendMessage({
                action: 'save_sns_post_history',
                itemId: itemId,
                platform: platform,
                postText: shareText,
                style: index + 1,
              });
              console.log('[SNS Post] History saved');
            } catch (err) {
              console.warn('[SNS Post] Failed to save history:', err);
            }
          }
          return;
        } catch (err) {
          console.error('[SNS Post] Failed to copy to clipboard:', err);
          showToast('⚠️ 클립보드 복사에 실패했습니다.');
          return;
        }
      }

      // 플랫폼별 공유 URL 생성
      let shareUrl = '';
      switch (platform) {
        case 'twitter':
          shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
          break;
        case 'facebook':
          shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(shareText)}`;
          break;
        case 'pinterest': {
          // Pinterest requires an image. Try to fetch the card's thumbnail (if itemId provided).
          let imageUrl = '';
          if (itemId) {
            try {
              const cardResp = await chrome.runtime.sendMessage({
                action: 'get_idea_data',
                ideaId: itemId,
              });
              if (cardResp && cardResp.success && cardResp.data) {
                const card = cardResp.data;
                const publishInfo = card.publishInfo || {};
                const tInfo = publishInfo.thumbnailInfo || [];
                if (Array.isArray(tInfo) && tInfo.length > 0) {
                  const sel =
                    typeof publishInfo.selectedThumbnailIndex === 'number'
                      ? publishInfo.selectedThumbnailIndex
                      : 0;
                  const thumb = tInfo[sel] || tInfo[0] || {};
                  imageUrl =
                    thumb.bgImage ||
                    (Array.isArray(thumb.bgImages) && thumb.bgImages[0]) ||
                    thumb.url ||
                    '';
                }
                if (!imageUrl && card.thumbnail) imageUrl = card.thumbnail;
                if (
                  !imageUrl &&
                  Array.isArray(card.publishInfo?.bgImages) &&
                  card.publishInfo.bgImages.length
                ) {
                  imageUrl = card.publishInfo.bgImages[0];
                }
              }
            } catch (err) {
              console.warn('[SNS Post] Failed to fetch card data for Pinterest image:', err);
            }
          }

          if (!imageUrl) {
            showToast('⚠️ Pinterest 공유는 이미지가 필요합니다. 썸네일을 설정한 뒤 재시도하세요.');
            return;
          }

          // Both `image_url` and `media` are supported by Pinterest sharing endpoints; include both.
          shareUrl = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(
            shareText
          )}&image_url=${encodeURIComponent(imageUrl)}&media=${encodeURIComponent(imageUrl)}`;
          break;
        }
        case 'linkedin':
          shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&summary=${encodeURIComponent(shareText)}`;
          break;
        case 'reddit':
          shareUrl = `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareText)}`;
          break;
      }

      // 공유창 열기
      const width = platform === 'pinterest' || platform === 'reddit' ? 850 : 550;
      const height = platform === 'pinterest' || platform === 'reddit' ? 550 : 420;
      const left = (window.screen.width - width) / 2;
      const top = (window.screen.height - height) / 2;

      const popup = window.open(
        shareUrl,
        `${platform}-share`,
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
      );

      if (!popup) {
        showToast('⚠️ 팝업이 차단되었습니다. 팝업 차단을 해제해주세요.');
        return;
      }

      showToast('✅ 공유창이 열렸습니다!');

      // 공유 횟수 증가 및 이력 저장
      if (itemId) {
        try {
          // 1. 공유 횟수 증가
          await chrome.runtime.sendMessage({
            action: 'increment_share_count',
            itemId: itemId,
            platform: platform,
          });

          // 2. SNS 게시 이력 저장
          await chrome.runtime.sendMessage({
            action: 'save_sns_post_history',
            itemId: itemId,
            platform: platform,
            postText: shareText,
            style: index === 0 ? 'casual' : index === 1 ? 'professional' : 'question',
          });

          console.log('[SNS Post] Share count incremented and history saved for', platform);
          showToast(`✅ ${platform} 공유가 기록되었습니다.`);

          // 테이블 새로고침
          if (container && typeof container.__refreshPublishTable === 'function') {
            setTimeout(() => {
              console.log('[SNS Post] Refreshing publish table');
              container.__refreshPublishTable();
            }, 1000);
          }
        } catch (err) {
          console.error('[SNS Post] Failed to save share data:', err);
          showToast('⚠️ 공유 기록에 실패했습니다.');
        }
      }

      // 모달을 자동으로 닫지 않음 — 공유 후에도 사용자가 수동으로 닫을 수 있도록 유지합니다.
      // (필요 시 명시적으로 `modal.remove()`를 호출해 닫을 수 있습니다.)
    };
  });
}

/**
 * HTML 이스케이프
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
