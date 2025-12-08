import { Logger, showToast } from '../utils.js';

function buildPermalinkUrl(channelUrl, permalink, isTistory = null) {
  if (!channelUrl || !permalink) return '';
  try {
    const urlObj = new URL(channelUrl);
    const host = urlObj.hostname.toLowerCase();
    if (isTistory === true) return `${urlObj.origin}/entry/${permalink}`;
    if (isTistory === null && host.includes('tistory.com'))
      return `${urlObj.origin}/entry/${permalink}`;
    if (host.includes('blog.naver.com'))
      return permalink.startsWith('http') ? permalink : `${urlObj.origin}/${permalink}`;
    if (host.includes('brunch.co.kr')) {
      const pathMatch = urlObj.pathname.match(/^\/@([^\/]+)/);
      return pathMatch ? `${urlObj.origin}/@${pathMatch[1]}/${permalink}` : `${urlObj.origin}/${permalink}`;
    }
    return `${urlObj.origin.replace(/\/$/, '')}/${permalink}`;
  } catch (e) {
    return '';
  }
}

export function showPublishInfo(workspaceEl, permalink, tags, seoTitle, ideaData) {
  Logger.debug('[DEBUG showPublishInfo] called (lazy module) - seoTitle:', seoTitle, 'ideaId:', ideaData?.id);

  try {
    // remove existing panel
    const existingInfo = workspaceEl.querySelector('.publish-info-panel');
    if (existingInfo) existingInfo.remove();

    permalink = permalink || '';
    const originalTags = tags;
    if (Array.isArray(tags)) tags = tags.join(', ');
    else tags = tags || '';
    seoTitle = seoTitle || '';

    if (!seoTitle && ideaData?.publishInfo?.seoTitle) {
      seoTitle = ideaData.publishInfo.seoTitle;
    }

    // Prepare updates and optionally send DB updates
    if (ideaData && ideaData.id) {
      const updates = {};
      const publishInfoUpdates = {};
      let hasNonEmptyValue = false;

      if (permalink !== undefined && permalink.trim() !== '') {
        publishInfoUpdates.permalink = permalink;
        hasNonEmptyValue = true;
      } else if (permalink !== undefined && permalink.trim() === '' && ideaData.publishInfo?.permalink) {
        publishInfoUpdates.permalink = ideaData.publishInfo.permalink;
        hasNonEmptyValue = true;
      }

      if (originalTags !== undefined && originalTags !== null) {
        if (Array.isArray(originalTags)) {
          if (originalTags.length > 0) {
            publishInfoUpdates.tags = originalTags;
            hasNonEmptyValue = true;
          }
        } else if (String(tags).trim() !== '') {
          publishInfoUpdates.tags = String(tags).split(',').map((t) => t.trim()).filter(Boolean);
          hasNonEmptyValue = publishInfoUpdates.tags.length > 0;
        }
      } else if (originalTags !== undefined && String(tags).trim() === '' && ideaData.publishInfo?.tags) {
        publishInfoUpdates.tags = ideaData.publishInfo.tags;
        hasNonEmptyValue = true;
      }

      if (seoTitle !== undefined && seoTitle.trim() !== '') {
        updates.seoTitle = seoTitle;
        publishInfoUpdates.seoTitle = seoTitle;
        hasNonEmptyValue = true;
      }

      if (hasNonEmptyValue && Object.keys(publishInfoUpdates).length > 0) {
        publishInfoUpdates.updatedAt = Date.now();
        if (ideaData.publishInfo) {
          Object.keys(ideaData.publishInfo).forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(publishInfoUpdates, key)) {
              publishInfoUpdates[key] = ideaData.publishInfo[key];
            }
          });
        }
        updates.publishInfo = publishInfoUpdates;
      }

      if (Object.keys(updates).length > 0) {
        chrome.runtime.sendMessage(
          {
            action: 'update_kanban_card',
            data: { cardId: ideaData.id, status: ideaData.status || 'ideas', updates },
          },
          (response) => {
            if (response && !response.success) Logger.error('[Workspace] publish-info save failed:', response);
            else if (response && response.success) Logger.debug('[Workspace] publish-info saved');
          }
        );
      }
    }

    // fetch channel info and render the panel
    chrome.runtime.sendMessage({ action: 'get_my_channels' }, (channelsResponse) => {
      const myChannels = channelsResponse?.channels?.myChannels?.blogs || [];
      const firstChannel = myChannels.length > 0 ? myChannels[0] : null;
      const channelUrl = firstChannel?.inputUrl || '';
      const isTistory = channelUrl.includes('tistory.com');
      const fullUrl = buildPermalinkUrl(channelUrl, permalink, isTistory);

      const publishInfoPanel = document.createElement('div');
      publishInfoPanel.className = 'publish-info-panel';
      publishInfoPanel.style.cssText = `padding: 16px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;`;

      const ideaTitle = ideaData?.title || '';

      publishInfoPanel.innerHTML = `
        <div style="font-weight: 600; font-size: 14px; color: #333; margin-bottom: 4px;">📝 발행 정보</div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">아이디어 제목</label>
            <input type="text" id="idea-title-input" value="${ideaTitle}" readonly style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
          </div>
          <div>
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">SEO 최적화 제목</label>
            <input type="text" id="seo-title-input" value="${seoTitle || ''}" readonly style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
          </div>
          <div>
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">퍼머링크</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="text" id="permalink-input" value="${permalink || ''}" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
              ${fullUrl ? `<button id="connect-permalink-btn" style="padding: 6px 12px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🔗 연결</button>` : ''}
            </div>
            ${fullUrl ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">전체 URL: <span style="color: #1a73e8;">${fullUrl}</span></div>` : ''}
          </div>
          <div>
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">태그</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="text" id="tags-input" value="${tags || ''}" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
              <button id="copy-tags-btn" style="padding: 6px 12px; background: #fff; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 12px;">📋 복사</button>
            </div>
          </div>
          <div>
            <button id="copy-html-btn" style="width: 100%; padding: 10px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;">📄 HTML 복사 (JSON-LD 포함)</button>
          </div>
        </div>
      `;

      const publishInfoArea = workspaceEl.querySelector('#publish-info-content');
      if (publishInfoArea) {
        publishInfoArea.innerHTML = '';
        publishInfoArea.appendChild(publishInfoPanel);
      } else {
        const publishInfoAreaContainer = workspaceEl.querySelector('#publish-info-area');
        if (publishInfoAreaContainer) {
          publishInfoAreaContainer.innerHTML = '';
          publishInfoAreaContainer.appendChild(publishInfoPanel);
        }
      }

      const seoInput = publishInfoPanel.querySelector('#seo-title-input');
      Logger.debug('[DIAG showPublishInfo] seo-title-input in DOM:', !!seoInput, 'value:', seoInput?.value);

      const connectBtn = publishInfoPanel.querySelector('#connect-permalink-btn');
      if (connectBtn && fullUrl) {
        connectBtn.addEventListener('click', () => {
          const currentStatus = ideaData.status || window.__cp_workspace_idea_data?.status || 'in-progress';
          chrome.runtime.sendMessage({ action: 'link_published_url', data: { cardId: ideaData.id, url: fullUrl, status: currentStatus } }, (res) => {
            if (res && res.success) {
              showToast('✅ 발행 URL이 연결되었습니다. 성과 추적이 시작됩니다.');
              if (window.__cp_workspace_idea_data) {
                window.__cp_workspace_idea_data.publishedUrl = fullUrl;
                window.__cp_workspace_idea_data.performanceTracked = true;
              }
            } else showToast(`❌ 연결 실패: ${res?.error || '알 수 없는 오류'}`, 'error');
          });
        });
      }

      const copyTagsBtn = publishInfoPanel.querySelector('#copy-tags-btn');
      if (copyTagsBtn) {
        copyTagsBtn.addEventListener('click', () => {
          const tagsInput = publishInfoPanel.querySelector('#tags-input');
          if (tagsInput && tagsInput.value) navigator.clipboard.writeText(tagsInput.value).then(() => alert('📋 태그 복사 완료'));
        });
      }

      const copyHtmlBtn = publishInfoPanel.querySelector('#copy-html-btn');
      if (copyHtmlBtn) {
        copyHtmlBtn.addEventListener('click', async () => {
          try {
            copyHtmlBtn.disabled = true;
            copyHtmlBtn.textContent = '⏳ 생성 중...';

            const currentIdeaData = window.__cp_workspace_idea_data || ideaData;
            const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
            let editorHtml = '';

            if (editorIframe && editorIframe.contentWindow) {
              const messageId = `get-content-html-${Date.now()}`;
              // use a promise-based message handshake
              editorHtml = await new Promise((resolve) => {
                const handler = (event) => {
                  if (event.data?.action === 'content-html-response' && event.data?.requestId === messageId) {
                    window.removeEventListener('message', handler);
                    resolve(event.data.data || '');
                  }
                };
                window.addEventListener('message', handler);
                editorIframe.contentWindow.postMessage({ action: 'get-content-html', requestId: messageId }, '*');
                setTimeout(() => {
                  window.removeEventListener('message', handler);
                  resolve('');
                }, 2000);
              });
            }

            // fallback simple HTML generation
            const htmlToCopy = editorHtml || `<h1>${(currentIdeaData.title || '').replace(/</g, '&lt;')}</h1>`;
            await navigator.clipboard.writeText(htmlToCopy);
            alert('✅ HTML 복사 완료');
          } catch (e) {
            showToast('❌ HTML 복사가 실패했습니다.', 'error');
          } finally {
            copyHtmlBtn.disabled = false;
            copyHtmlBtn.textContent = '📄 HTML 복사 (JSON-LD 포함)';
          }
        });
      }
    });
  } catch (e) {
    Logger.error('[DIAG showPublishInfo] error during rendering:', e);
  }
}

export { buildPermalinkUrl };
