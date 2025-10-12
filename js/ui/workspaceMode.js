// js/ui/workspaceMode.js (최종 수정 완료 버전)

import { shortenLink, showToast } from "../utils.js";

export function renderWorkspace(container, ideaData) {
  ideaData.linkedScraps = Array.isArray(ideaData.linkedScraps) ? ideaData.linkedScraps : (ideaData.linkedScraps ? Object.keys(ideaData.linkedScraps) : []);
  
  const outlineHtml = (ideaData.outline && ideaData.outline.length > 0) ? ideaData.outline.map(item => `<li>${item}</li>`).join('') : '<li>추천 목차가 없습니다.</li>';
  const longTailKeywordsHtml = (ideaData.longTailKeywords && ideaData.longTailKeywords.length > 0) ? ideaData.longTailKeywords.map(k => `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`).join('') : '<span>제안된 롱테일 키워드가 없습니다.</span>';
  const searchesHtml = (ideaData.recommendedKeywords && ideaData.recommendedKeywords.length > 0) ? ideaData.recommendedKeywords.map(item => `<li><a href="https://www.google.com/search?q=${encodeURIComponent(item)}" target="_blank">${item}</a></li>`).join('') : '<li>추천 검색어가 없습니다.</li>';

  container.innerHTML = `
    <div class="workspace-container">
      <div id="ai-briefing-panel" class="workspace-column">
        <h2>✨ AI 브리핑</h2>
        <div class="ai-briefing-content">
          <h4>주요 키워드</h4>
          <div class="keyword-list">
            ${(ideaData.tags || []).filter(t => t !== '#AI-추천').map(k => `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k.replace('#','')}</span>`).join('')}
          </div>
          <h4>롱테일 키워드</h4>
          <div class="keyword-list">
            ${longTailKeywordsHtml}
          </div>
          <h4>추천 목차</h4>
          <ul class="outline-list">
            ${outlineHtml}
          </ul>
          <h4>추천 검색어</h4>
          <ul class="keyword-list">
            ${searchesHtml}
          </ul>
          <button id="generate-draft-btn">📄 AI로 초안 생성하기</button>
        </div>
      </div>
      <div id="main-editor-panel" class="workspace-column">
        <div class="editor-header">
          <h2>✍️ 초안 작성</h2>
          <button id="copy-html-btn" class="editor-btn">HTML 복사</button>
        </div>
        <div id="toast-editor"></div>
        <div id="linked-scraps-section">
          <h4>🔗 연결된 자료</h4>
          <div class="scrap-list linked-scraps-list" data-idea-id="${ideaData.id}">
            <p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>
          </div>
        </div>
      </div>
      <div id="resource-library-panel" class="workspace-column">
        <h2>📖 모든 스크랩</h2>
        <div class="scrap-list all-scraps-list">
          <p class="loading-scraps">스크랩 목록을 불러오는 중...</p>
        </div>
      </div>
    </div>
  `;
  
  let editorInstance;

  const editorInterval = setInterval(() => {
    if (window.toastui && window.toastui.Editor) {
      clearInterval(editorInterval);
      
      const editorEl = container.querySelector('#toast-editor');
      if (!editorEl) return;

      editorInstance = new window.toastui.Editor({
        el: editorEl,
        height: '100%',
        initialEditType: 'wysiwyg',
        previewStyle: 'vertical',
        initialValue: ideaData.draftContent || '',
        events: {
            blur: () => {
                const currentDraft = editorInstance.getHTML();
                if (currentDraft !== (ideaData.draftContent || '')) {
                    const saveData = {
                        ideaId: ideaData.id, status: ideaData.status, draftId: ideaData.draftId,
                        draft: currentDraft, draftTitle: ideaData.draftTitle || '사용자 수정본'
                    };
                    chrome.runtime.sendMessage({ action: 'save_draft_content', data: saveData }, (response) => {
                        if (response && response.success) {
                            ideaData.draftContent = currentDraft;
                            console.log("초안이 자동 저장되었습니다.");
                        } else { console.error("초안 자동 저장 실패:", response?.error); }
                    });
                }
            }
        }
      });
    }
  }, 100);

  chrome.runtime.sendMessage({ action: 'get_all_scraps' }, (response) => {
    if (response && response.success) {
      const allScrapsContainer = container.querySelector('.all-scraps-list');
      const linkedScrapsContainer = container.querySelector('.linked-scraps-list');
      if (response.scraps.length > 0) {
        const allScrapsData = response.scraps;
        const linkedScrapsHtml = allScrapsData.filter(s => ideaData.linkedScraps.includes(s.id)).map(s => createScrapCard(s, true)).join('');
        const allScrapsHtml = allScrapsData.map(s => createScrapCard(s, false)).join('');
        linkedScrapsContainer.innerHTML = linkedScrapsHtml || '<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>';
        allScrapsContainer.innerHTML = allScrapsHtml;
      } else {
        linkedScrapsContainer.innerHTML = '<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>';
        allScrapsContainer.innerHTML = '<p>자료 보관함이 비어있습니다.</p>';
      }
    }
  });

  addWorkspaceEventListeners(container.querySelector('.workspace-container'), ideaData, () => editorInstance);
}

function createScrapCard(scrap, isLinked) {
  const textContent = scrap.text || '(내용 없음)';
  const cleanedTitle = textContent.replace(/\s+/g, ' ').trim();
  const tagsHtml = (scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0) ? `<div class="card-tags">${scrap.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}</div>` : '';
  const actionButton = isLinked ? `<button class="scrap-card-delete-btn unlink-scrap-btn" title="연결 해제"><svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg></button>` : '';
  return `
    <div class="scrap-card-item" draggable="true" data-scrap-id="${scrap.id}" data-text="${textContent.replace(/"/g, '&quot;')}" data-url="${scrap.url || ''}">
        <div class="scrap-card">
            ${actionButton}
            ${scrap.image ? `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image" referrerpolicy="no-referrer"></div>` : ''}
            <div class="scrap-card-info">
                <div class="scrap-card-title">${cleanedTitle.substring(0, 20)}...</div>
                <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
                ${tagsHtml}
            </div>
        </div>
    </div>`;
}

function addWorkspaceEventListeners(workspaceEl, ideaData, getEditor) {
    const resourceLibrary = workspaceEl.querySelector('#resource-library-panel');
    const linkedScrapsList = workspaceEl.querySelector('.linked-scraps-list');
    const generateDraftBtn = workspaceEl.querySelector('#generate-draft-btn');
    const copyHtmlBtn = workspaceEl.querySelector('#copy-html-btn');
    const aiBriefingPanel = workspaceEl.querySelector('#ai-briefing-panel');

    aiBriefingPanel.addEventListener('click', (e) => {
        if (e.target.classList.contains('interactive-tag')) {
            const editor = getEditor();
            if (editor) {
                editor.exec('addHTML', `<h2>${e.target.textContent}</h2>`);
            }
        }
    });

    generateDraftBtn.addEventListener('click', () => {
        const editor = getEditor();
        if (!editor) return;
        generateDraftBtn.textContent = 'AI가 초안을 작성하는 중...';
        generateDraftBtn.disabled = true;

        const linkedScrapsContent = Array.from(linkedScrapsList.querySelectorAll('.scrap-card-item'))
            .map(cardItem => ({
                text: cardItem.dataset.text || '',
                url: cardItem.dataset.url || ''
            }));
        const payload = { ...ideaData, currentDraft: editor.getHTML(), linkedScrapsContent };
        chrome.runtime.sendMessage({ action: 'generate_draft_from_idea', data: payload }, (response) => {
            if (response && response.success) {
                editor.setHTML(response.draft);
                const newDraftId = `draft_${Date.now()}`;
                const saveData = { ideaId: ideaData.id, status: ideaData.status, draftId: newDraftId, draft: response.draft, draftTitle: `AI 생성 초안 (${new Date().toLocaleTimeString()})` };
                chrome.runtime.sendMessage({ action: 'save_draft_content', data: saveData }, (saveResponse) => {
                    if(saveResponse && saveResponse.success) {
                        ideaData.draftId = newDraftId;
                        ideaData.draftContent = response.draft;
                    }
                });
            } else {
                alert('초안 생성에 실패했습니다: ' + (response?.error || '알 수 없는 오류'));
            }
            generateDraftBtn.textContent = '📄 AI로 초안 생성하기';
            generateDraftBtn.disabled = false;
        });
    });

    copyHtmlBtn.addEventListener('click', () => {
        const editor = getEditor();
        if (editor) {
            navigator.clipboard.writeText(editor.getHTML())
                .then(() => showToast('✅ HTML이 클립보드에 복사되었습니다.'))
                .catch(() => showToast('❌ 복사에 실패했습니다.', true));
        }
    });
    
    linkedScrapsList.addEventListener('click', (e) => {
        const unlinkBtn = e.target.closest('.unlink-scrap-btn');
        if (unlinkBtn) {
            const cardItem = unlinkBtn.closest('.scrap-card-item');
            const scrapId = cardItem.dataset.scrapId;
            const message = { action: 'unlink_scrap_from_idea', data: { ideaId: ideaData.id, scrapId: scrapId, status: ideaData.status } };
            chrome.runtime.sendMessage(message, (response) => {
                if (response && response.success) {
                    cardItem.remove();
                    const index = ideaData.linkedScraps.indexOf(scrapId);
                    if (index > -1) ideaData.linkedScraps.splice(index, 1);
                    if (linkedScrapsList.children.length === 0) linkedScrapsList.innerHTML = '<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>';
                }
            });
        }
    });

    resourceLibrary.addEventListener('dragstart', (e) => {
        const cardItem = e.target.closest('.scrap-card-item');
        if (cardItem) {
            const scrapData = { id: cardItem.dataset.scrapId, text: cardItem.dataset.text, url: cardItem.dataset.url };
            e.dataTransfer.setData('application/json', JSON.stringify(scrapData));
            e.dataTransfer.effectAllowed = 'copyLink';
        }
    });

    workspaceEl.addEventListener('dragover', (e) => {
        const editorEl = workspaceEl.querySelector('#toast-editor');
        if (editorEl.contains(e.target) || linkedScrapsList.contains(e.target)) { e.preventDefault(); }
    });

    workspaceEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const editorEl = workspaceEl.querySelector('#toast-editor');
        let scrapData;
        try { scrapData = JSON.parse(e.dataTransfer.getData('application/json')); } catch (error) { return; }
        if (!scrapData) return;

        if (editorEl.contains(e.target)) {
            const editor = getEditor();
            if (editor) {
                const textToInsert = scrapData.text || '';
                const sourceLink = scrapData.url ? shortenLink(scrapData.url) : '알 수 없는 출처';
                editor.exec('insertHTML', `<br><p>--- (인용: ${sourceLink}) ---</p><blockquote>${textToInsert}</blockquote><p>------------------</p><br>`);
            }
        } else if (linkedScrapsList.contains(e.target)) {
            if (linkedScrapsList.querySelector(`[data-scrap-id="${scrapData.id}"]`)) return;
            const message = { action: 'link_scrap_to_idea', data: { ideaId: ideaData.id, scrapId: scrapData.id, status: ideaData.status } };
            chrome.runtime.sendMessage(message, (response) => {
                if (response && response.success) {
                    const newLinkedCardHtml = createScrapCard(scrapData, true);
                    const placeholder = linkedScrapsList.querySelector('p');
                    if (placeholder) placeholder.remove();
                    linkedScrapsList.insertAdjacentHTML('beforeend', newLinkedCardHtml);
                    ideaData.linkedScraps.push(scrapData.id);
                }
            });
        }
    });
}