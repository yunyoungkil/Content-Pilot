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
`
  );
}

/**
 * AI 응답에서 3가지 스타일 파싱
 */
function parseSnsStyles(response) {
  const styles = [];
  const sections = response.split(/\[스타일\d\]/);

  for (let i = 1; i < sections.length && i <= 3; i++) {
    const text = sections[i].trim();
    if (text) {
      styles.push(text);
    }
  }

  // 파싱 실패 시 전체 응답을 하나의 스타일로
  if (styles.length === 0) {
    styles.push(response.trim());
  }

  return styles;
}

/**
 * SNS 게시글 생성 모달 표시
 */
export async function showSnsPostModal(platform, title, url, itemId, container) {
  console.log('[SNS Post Modal] Called with platform:', platform);

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

    const styles = parseSnsStyles(aiText);

    console.log('[SNS Post] Parsed styles:', styles);

    // 게시글 옵션 UI 렌더링
    const modalBody = modal.querySelector('.sns-post-modal-body');
    modalBody.innerHTML = `
      <div class="sns-post-options" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px;">
        ${styles
          .map(
            (text, index) => `
          <div class="sns-post-option" style="border: 1px solid #dee2e6; border-radius: 8px; padding: 16px;">
            <div class="sns-post-option-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <span class="sns-post-option-label" style="font-size: 13px; font-weight: 600; color: #495057;">스타일 ${index + 1}</span>
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
      <div class="sns-post-url-section" style="margin-bottom: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
        <label style="display: block; font-size: 13px; font-weight: 500; color: #495057; margin-bottom: 8px;">🔗 링크 (함께 공유됩니다):</label>
        <input type="text" class="sns-post-url-input" value="${escapeHtml(url)}" readonly style="width: 100%; padding: 10px 12px; border: 1px solid #dee2e6; border-radius: 6px; font-size: 13px; background: white; color: #6c757d; font-family: 'Courier New', monospace;">
      </div>
      <div class="sns-post-footer" style="display: flex; justify-content: center; padding-top: 16px; border-top: 1px solid #e9ecef;">
        <button class="sns-post-cancel-btn" style="padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; background: #f8f9fa; color: #495057; border: 1px solid #dee2e6;">닫기</button>
      </div>
    `;

    console.log('[SNS Post] Modal body updated');

    // 이벤트 리스너
    modalBody.querySelector('.sns-post-cancel-btn').onclick = () => modal.remove();

    // 각 스타일별 공유 버튼
    modalBody.querySelectorAll('.sns-post-share-this-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        const index = parseInt(e.target.dataset.index);
        const textareas = modalBody.querySelectorAll('.sns-post-textarea');
        const shareText = textareas[index].value;

        console.log('[SNS Post] Sharing style', index + 1, 'to platform:', platform);

        // 플랫폼별 공유 URL 생성
        let shareUrl = '';
        switch (platform) {
          case 'twitter':
            shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
            break;
          case 'threads':
            shareUrl = `https://www.threads.net/intent/post?text=${encodeURIComponent(shareText + '\n\n' + url)}`;
            break;
          case 'facebook':
            shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(shareText)}`;
            break;
          case 'pinterest':
            shareUrl = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(shareText)}`;
            break;
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

        // 공유 횟수 증가
        if (itemId) {
          try {
            await chrome.runtime.sendMessage({
              action: 'increment_share_count',
              itemId: itemId,
              platform: platform,
            });
            console.log('[SNS Post] Share count incremented for', platform);
            showToast(`✅ ${platform} 공유 횟수가 기록되었습니다.`);

            // 테이블 새로고침
            if (container && typeof container.__refreshPublishTable === 'function') {
              setTimeout(() => {
                console.log('[SNS Post] Refreshing publish table');
                container.__refreshPublishTable();
              }, 1000);
            }
          } catch (err) {
            console.error('[SNS Post] Failed to increment share count:', err);
            showToast('⚠️ 공유 횟수 기록에 실패했습니다.');
          }
        }

        // 모달 닫기
        setTimeout(() => modal.remove(), 500);
      };
    });
  } catch (error) {
    console.error('SNS post generation failed:', error);
    const modalBody = modal.querySelector('.sns-post-modal-body');
    modalBody.innerHTML = `
      <div class="sns-post-error">
        <p>⚠️ 게시글 생성에 실패했습니다.</p>
        <p class="sns-post-error-detail">${error.message}</p>
        <button class="sns-post-retry-btn">다시 시도</button>
      </div>
    `;

    modalBody.querySelector('.sns-post-retry-btn').onclick = () => {
      modal.remove();
      showSnsPostModal(platform, title, url, itemId, container);
    };
  }
}

/**
 * HTML 이스케이프
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
