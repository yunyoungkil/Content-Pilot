// js/ui/workspaceMode.js (수정 완료된 최종 버전)

import { shortenLink } from "../utils.js";

export function renderWorkspace(container, ideaData) {
  ideaData.linkedScraps = Array.isArray(ideaData.linkedScraps) ? ideaData.linkedScraps : (ideaData.linkedScraps ? Object.keys(ideaData.linkedScraps) : []);
  
  container.innerHTML = `
    <div class="workspace-container">
      <div id="ai-briefing-panel" class="workspace-column">
        <h2>✨ AI 브리핑</h2>
        <div class="ai-briefing-content">
          <h4>주요 키워드</h4>
          <div class="keyword-list">
            ${(ideaData.tags || ['AI 글쓰기', '콘텐츠 전략', 'SEO']).map(k => `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`).join('')}
          </div>
          <h4>추천 목차</h4>
          <ul class="outline-list">
            <li>1. 서론: AI 글쓰기, 왜 필요한가?</li>
            <li>2. 본론 1: AI 도구별 장단점 비교</li>
            <li>3. 본론 2: 실제 활용 사례 분석</li>
            <li>4. 결론: 나에게 맞는 AI 글쓰기 전략</li>
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

    generateDraftBtn.addEventListener('click', () => {
        generateDraftBtn.textContent = 'AI가 초안을 작성하는 중...';
        generateDraftBtn.disabled = true;
        chrome.runtime.sendMessage({ action: 'generate_draft_from_idea', data: ideaData }, (response) => {
            if (response && response.success) {
                editorTextarea.value = response.draft;
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
            
            const scrapData = {
                id: cardItem.dataset.scrapId,
                text: cardItem.dataset.text,
                image: imageEl ? imageEl.src : null,
                url: snippetEl ? snippetEl.textContent : '', 
                tags: Array.from(card.querySelectorAll('.card-tags .tag')).map(t => t.textContent.replace('#', ''))
            };
            
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
            // ... (에디터에 드롭하는 로직은 변경 없습니다) ...
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