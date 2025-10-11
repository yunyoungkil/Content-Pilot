// js/ui/workspaceMode.js (수정 완료된 최종 버전)

import { shortenLink } from "../utils.js";

export function renderWorkspace(container, ideaData) {
  ideaData.linkedScraps = Array.isArray(ideaData.linkedScraps) ? ideaData.linkedScraps : (ideaData.linkedScraps ? Object.keys(ideaData.linkedScraps) : []);
  
  const outlineHtml = (ideaData.outline && ideaData.outline.length > 0)
    ? ideaData.outline.map(item => `<li>${item}</li>`).join('')
    : '<li>추천 목차가 없습니다.</li>';

  const longTailKeywordsHtml = (ideaData.longTailKeywords && ideaData.longTailKeywords.length > 0)
    ? ideaData.longTailKeywords.map(k => `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`).join('')
    : '<span>제안된 롱테일 키워드가 없습니다.</span>';


  const searchesHtml = (ideaData.recommendedKeywords && ideaData.recommendedKeywords.length > 0)
    ? ideaData.recommendedKeywords.map(item => `<li><a href="https://www.google.com/search?q=${encodeURIComponent(item)}" target="_blank">${item}</a></li>`).join('')
    : '<li>추천 검색어가 없습니다.</li>';

  container.innerHTML = `
    <div class="workspace-container">
      <div id="ai-briefing-panel" class="workspace-column">
        <h2>✨ AI 브리핑</h2>
        <div class="ai-briefing-content">
          <h4>주요 키워드</h4>
          <div class="keyword-list">
            ${(ideaData.tags || []).filter(t => t !== '#AI-추천').map(k => `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`).join('')}
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
        <h2>✍️ 초안 작성</h2>
        <textarea class="main-editor-textarea" placeholder="이곳에 콘텐츠 초안을 작성하거나, 자료 보관함에서 스크랩을 끌어다 놓으세요...">${ideaData.draftContent || ''}</textarea>
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
  
  chrome.runtime.sendMessage({ action: 'get_all_scraps' }, (response) => {
    if (response && response.success) {
      const allScrapsContainer = container.querySelector('.all-scraps-list');
      const linkedScrapsContainer = container.querySelector('.linked-scraps-list');
      
      if (response.scraps.length > 0) {
        const allScrapsData = response.scraps;
        
        const linkedScrapsHtml = allScrapsData
          .filter(s => ideaData.linkedScraps.includes(s.id))
          .map(s => createScrapCard(s, true))
          .join('');
          
        const allScrapsHtml = allScrapsData
          .map(s => createScrapCard(s, false))
          .join('');

        linkedScrapsContainer.innerHTML = linkedScrapsHtml || '<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>';
        allScrapsContainer.innerHTML = allScrapsHtml;
      } else {
        linkedScrapsContainer.innerHTML = '<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>';
        allScrapsContainer.innerHTML = '<p>자료 보관함이 비어있습니다.</p>';
      }
    }
  });

addWorkspaceEventListeners(container.querySelector('.workspace-container'), ideaData);
}


function createScrapCard(scrap, isLinked) {
  const textContent = scrap.text || '(내용 없음)';
  const cleanedTitle = textContent.replace(/\s+/g, ' ').trim();

  const tagsHtml = scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
    ? `<div class="card-tags">${scrap.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}</div>`
    : '';

  const actionButton = isLinked
    ? `<button class="scrap-card-delete-btn unlink-scrap-btn" title="연결 해제">
         <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>
       </button>`
    : '';

  return `
    <div class="scrap-card-item" draggable="true" data-scrap-id="${scrap.id}" data-text="${textContent.replace(/"/g, '&quot;')}">
        <div class="scrap-card">
            ${actionButton}
            ${scrap.image ? `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image" referrerpolicy="no-referrer"></div>` : ''}
            <div class="scrap-card-info">
                <div class="scrap-card-title">${cleanedTitle.substring(0, 20)}...</div>
                <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
                ${tagsHtml}
            </div>
        </div>
    </div>
  `;
}


function addWorkspaceEventListeners(workspaceEl, ideaData) {
    const editorTextarea = workspaceEl.querySelector('.main-editor-textarea');
    const resourceLibrary = workspaceEl.querySelector('#resource-library-panel');
    const linkedScrapsList = workspaceEl.querySelector('.linked-scraps-list');
    const keywordList = workspaceEl.querySelector('.keyword-list');
    const generateDraftBtn = workspaceEl.querySelector('#generate-draft-btn');


    editorTextarea.addEventListener('blur', () => {
        const currentDraft = editorTextarea.value;
        
        // 데이터베이스에 저장된 초안과 내용이 다를 경우에만 저장 요청
        if (currentDraft !== (ideaData.draftContent || '')) {
            console.log("Saving draft...");
            const saveData = {
                ideaId: ideaData.id,
                status: ideaData.status,
                draft: currentDraft
            };
            chrome.runtime.sendMessage({ action: 'save_draft_content', data: saveData }, (saveResponse) => {
                if (saveResponse && saveResponse.success) {
                    // 저장 성공 시, ideaData 객체도 업데이트하여 일관성 유지
                    ideaData.draftContent = currentDraft; 
                    console.log("Draft saved successfully on blur.");
                } else {
                    console.error("Failed to save draft on blur:", saveResponse.error);
                }
            });
        }
    });

    
    generateDraftBtn.addEventListener('click', () => {
        generateDraftBtn.textContent = 'AI가 초안을 작성하는 중...';
        generateDraftBtn.disabled = true;

        // 1. '연결된 자료' 목록에서 스크랩 텍스트를 모두 수집합니다.
        const linkedScrapsContent = Array.from(
            linkedScrapsList.querySelectorAll('.scrap-card-item')
        ).map(cardItem => {
            return {
                text: cardItem.dataset.text || '',
                // 필요하다면 출처(URL)도 함께 보낼 수 있습니다.
                url: cardItem.querySelector('.scrap-card-snippet')?.textContent || '' 
            };
        });

        // 2. AI에게 보낼 모든 데이터를 하나의 객체로 통합합니다.
        const payload = {
            ...ideaData, // title, description, tags, outline, keywords 등 모든 아이디어 데이터
            currentDraft: editorTextarea.value, // 현재 에디터에 작성된 내용
            linkedScrapsContent: linkedScrapsContent // 연결된 자료의 텍스트 목록
        };

        // 3. 통합된 데이터를 background.js로 전송합니다.
        chrome.runtime.sendMessage({ action: 'generate_draft_from_idea', data: payload }, (response) => {
            if (response && response.success) {
                editorTextarea.value = response.draft;
                const saveData = {
                    ideaId: ideaData.id,
                    status: ideaData.status,
                    draft: response.draft
                };
                chrome.runtime.sendMessage({ action: 'save_draft_content', data: saveData }, (saveResponse) => {
                    if (!saveResponse || !saveResponse.success) {
                        console.error("Failed to save draft:", saveResponse.error);
                        // (선택) 저장 실패 시 사용자에게 알림을 줄 수 있습니다.
                    } else {
                        console.log("Draft saved successfully.");
                    }
                });

            } else {
                alert('초안 생성에 실패했습니다: ' + (response.error || '알 수 없는 오류'));
            }
            generateDraftBtn.textContent = '📄 AI로 초안 생성하기';
            generateDraftBtn.disabled = false;
        });
    });

    keywordList.addEventListener('click', (e) => {
        if (e.target.classList.contains('interactive-tag')) {
            const keyword = e.target.textContent;
            editorTextarea.value += `\n\n## ${keyword}\n\n`;
            editorTextarea.scrollTop = editorTextarea.scrollHeight;
            editorTextarea.focus();
        }
    });

    linkedScrapsList.addEventListener('click', (e) => {
        const unlinkBtn = e.target.closest('.unlink-scrap-btn');
        if (unlinkBtn) {
            e.stopPropagation();
            const cardItem = unlinkBtn.closest('.scrap-card-item');
            const scrapId = cardItem.dataset.scrapId;
            
            const message = {
                action: 'unlink_scrap_from_idea',
                data: {
                    ideaId: ideaData.id,
                    scrapId: scrapId,
                    status: ideaData.status
                }
            };
            chrome.runtime.sendMessage(message, (response) => {
                if (response && response.success) {
                    cardItem.remove();
                    if (ideaData.linkedScraps) {
                        const index = ideaData.linkedScraps.indexOf(scrapId);
                        if (index > -1) {
                            ideaData.linkedScraps.splice(index, 1);
                        }
                    }
                    if (linkedScrapsList.children.length === 0) {
                        linkedScrapsList.innerHTML = '<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>';
                    }
                } else {
                    alert('스크랩 연결 해제에 실패했습니다: ' + (response.error || '알 수 없는 오류'));
                }
            });
        }
    });

    // --- '연결된 자료' 툴팁 기능 (수정된 최종 버전) ---
    let tooltipTimeout;
    let activeTooltip = null;

    // 툴팁을 워크스페이스 최상단에 한 번만 생성
    const tooltip = document.createElement('div');
    tooltip.className = 'scrap-tooltip';
    workspaceEl.appendChild(tooltip);

    linkedScrapsList.addEventListener('mouseover', (e) => {
        const cardItem = e.target.closest('.scrap-card-item');
        if (cardItem) {
            // 마우스가 다른 카드로 이동했을 때 이전 타이머 취소
            clearTimeout(tooltipTimeout);

            // 0.2초 지연 후 툴팁 표시
            tooltipTimeout = setTimeout(() => {
                const textContent = cardItem.dataset.text;
                if (textContent) {
                    // 툴팁 내용 업데이트
                    tooltip.innerHTML = `<p>${textContent}</p>`;
                    
                    // 툴팁 위치 계산
                    const cardRect = cardItem.getBoundingClientRect();
                    tooltip.style.left = `${cardRect.right + 12}px`;
                    tooltip.style.top = `${cardRect.top}px`;

                    // 툴팁 보이기
                    tooltip.classList.add('visible');
                    activeTooltip = cardItem; // 현재 툴팁이 활성화된 카드 저장
                }
            }, 200);
        }
    });

    linkedScrapsList.addEventListener('mouseout', (e) => {
        // 마우스가 목록 영역을 벗어나면 타이머 취소 및 툴팁 숨기기
        clearTimeout(tooltipTimeout);
        
        // 마우스가 실제로 다른 요소로 이동했는지 확인 (카드 내부 요소 이동 시 툴팁이 깜빡이는 현상 방지)
        if (!linkedScrapsList.contains(e.relatedTarget)) {
            tooltip.classList.remove('visible');
            activeTooltip = null;
        }
    });

    resourceLibrary.addEventListener('dragstart', (e) => {
        const cardItem = e.target.closest('.scrap-card-item');
        if (cardItem) {
        const card = cardItem.querySelector('.scrap-card');
        const imageEl = card.querySelector('.scrap-card-img-wrap img');
        const snippetEl = card.querySelector('.scrap-card-snippet');
        
        // 드래그 시 필요한 모든 스크랩 데이터를 객체로 만듭니다.
        const scrapData = {
            id: cardItem.dataset.scrapId,
            text: cardItem.dataset.text, // 에디터에 삽입될 텍스트
            image: imageEl ? imageEl.src : null,
            url: snippetEl ? snippetEl.textContent : '', 
            tags: Array.from(card.querySelectorAll('.card-tags .tag')).map(t => t.textContent.replace('#', ''))
        };
        
        // 데이터를 JSON 문자열 형태로 dataTransfer 객체에 저장합니다.
        e.dataTransfer.setData('application/json', JSON.stringify(scrapData));
        e.dataTransfer.effectAllowed = 'copyLink';
        cardItem.style.opacity = '0.5';
    }
    });

    resourceLibrary.addEventListener('dragend', (e) => {
        const cardItem = e.target.closest('.scrap-card-item');
        if (cardItem) {
            cardItem.style.opacity = '1';
        }
    });

    workspaceEl.addEventListener('dragover', (e) => {
        const dropTarget = e.target;
        if (dropTarget === editorTextarea || linkedScrapsList.contains(dropTarget)) {
            e.preventDefault();
            const targetElement = (dropTarget === editorTextarea) ? editorTextarea : linkedScrapsList;
            targetElement.classList.add('drag-over');
            e.dataTransfer.dropEffect = (targetElement === editorTextarea) ? 'copy' : 'link';
        }
    });
    
    workspaceEl.addEventListener('dragleave', (e) => {
        const target = e.target;
        if (target === editorTextarea || linkedScrapsList.contains(target)) {
            target.classList.remove('drag-over');
        }
    });

   workspaceEl.addEventListener('drop', (e) => {
        e.preventDefault();
        
        let scrapData;
        try {
            scrapData = JSON.parse(e.dataTransfer.getData('application/json'));
        } catch (error) { return; }

        if (!scrapData) return;

        if (e.target === editorTextarea) {
            // 1. 드롭 대상이 에디터일 경우, drag-over 스타일을 제거합니다.
            editorTextarea.classList.remove('drag-over');

            // 2. 스크랩의 텍스트 내용을 가져옵니다.
            const textToInsert = scrapData.text || '';

            // 3. 에디터의 기존 내용에 새로운 텍스트를 추가합니다. (줄 바꿈 추가)
            editorTextarea.value += `\n\n--- (스크랩 인용) ---\n${textToInsert}\n------------------\n\n`;

            // 4. 스크롤을 맨 아래로 이동하여 삽입된 내용을 확인시킵니다.
            editorTextarea.scrollTop = editorTextarea.scrollHeight;
        }
        else if (linkedScrapsList.contains(e.target)) {
            linkedScrapsList.classList.remove('drag-over');
            
            if (linkedScrapsList.querySelector(`[data-scrap-id="${scrapData.id}"]`)) {
                return; 
            }
            
            const message = {
                action: 'link_scrap_to_idea',
                data: {
                    ideaId: ideaData.id,
                    scrapId: scrapData.id,
                    status: ideaData.status
                }
            };
            chrome.runtime.sendMessage(message, (response) => {
                if (response && response.success) {
                    const newLinkedCardHtml = createScrapCard(scrapData, true);
                    const placeholder = linkedScrapsList.querySelector('p');
                    if (placeholder) placeholder.remove();
                    linkedScrapsList.insertAdjacentHTML('beforeend', newLinkedCardHtml);
                    
                    if (!ideaData.linkedScraps) ideaData.linkedScraps = [];
                    ideaData.linkedScraps.push(scrapData.id);
                } else {
                    alert('스크랩 연결에 실패했습니다: ' + (response.error || '알 수 없는 오류'));
                }
            });
        }
    });
}