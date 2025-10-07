// js/ui/scrapbookMode.js (필터링 로직 분리)
import { shortenLink, showConfirmationToast } from "../utils.js";

let selectedScrapId = null;
let allScraps = [];
// ▼▼▼ [추가] 스크랩북만의 독립적인 태그 필터 변수 ▼▼▼
let activeScrapbookTagFilter = null;

// 스크랩북 모드 UI 렌더링 함수
export function renderScrapbook(container) {
  container.innerHTML = `
    <div class="scrapbook-root">
      <div class="scrapbook-list-section">
        <div class="scrapbook-list-header"><div class="scrapbook-list-title">스크랩 목록</div></div>
        <div class="scrapbook-controls">
            <div class="filter-status-container">
                <span class="filter-placeholder">태그 클릭 시 필터가 여기에 표시됩니다.</span>
            </div>
            <input type="text" id="scrapbook-keyword-input" class="scrapbook-keyword-input" placeholder="키워드로 검색...">
        </div>
        <div class="scrapbook-list-cards"><p style="text-align:center;color:#888;margin-top:20px;">스크랩을 불러오는 중...</p></div>
      </div>
      <div class="scrapbook-detail-section">
        <div class="scrapbook-detail-header">상세 정보</div>
        <div class="scrapbook-detail-content" id="scrapbook-detail-content-area"><div class="scrapbook-detail-empty">왼쪽 목록에서 스크랩을 선택하세요.</div></div>
      </div>
    </div>
  `;
  
  requestScrapsAndRender(container);

  const keywordInput = container.querySelector('#scrapbook-keyword-input');
  keywordInput.addEventListener('keyup', () => {
      renderScrapList(allScraps, container); // 키워드 입력 시에도 전체 목록을 다시 렌더링하여 필터링
  });
}

function requestScrapsAndRender(container) {
    chrome.runtime.sendMessage({ action: "cp_get_firebase_scraps" }, (response) => {
        if (response && response.data) {
            allScraps = response.data.sort((a, b) => b.timestamp - a.timestamp);
            renderScrapList(allScraps, container);
        } else {
            const listContainer = container.querySelector('.scrapbook-list-cards');
            if(listContainer) listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
        }
    });
}

function renderScrapList(scraps, container) {
    const listContainer = container.querySelector('.scrapbook-list-cards');
    const keywordInput = container.querySelector('#scrapbook-keyword-input');
    if (!listContainer || !keywordInput) return;

    // ▼▼▼ [추가] 필터 상태 UI 업데이트 로직 ▼▼▼
    const filterStatusContainer = container.querySelector('.filter-status-container');
    if (filterStatusContainer) {
        if (activeScrapbookTagFilter) {
            filterStatusContainer.innerHTML = `
                <div class="active-filter-chip">
                    <span>#${activeScrapbookTagFilter}</span>
                    <button class="clear-filter-btn">×</button>
                </div>
            `;
        } else {
            filterStatusContainer.innerHTML = `<span class="filter-placeholder">태그 클릭 시 필터가 여기에 표시됩니다.</span>`;
        }
    }

    // ▼▼▼ [수정] 키워드와 태그 필터를 모두 적용하여 보여줄 스크랩을 결정 ▼▼▼
    const keyword = keywordInput.value.toLowerCase();
    let scrapsToRender = scraps;

    if (activeScrapbookTagFilter) {
        scrapsToRender = scrapsToRender.filter(s => s.tags && s.tags.includes(activeScrapbookTagFilter));
    }

    if (keyword) {
        scrapsToRender = scrapsToRender.filter(s => s.text && s.text.toLowerCase().includes(keyword));
    }
    // ▲▲▲ 수정 완료 ▲▲▲

    if (scrapsToRender.length === 0) {
        listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">일치하는 스크랩이 없습니다.</p>';
    } else {
        listContainer.innerHTML = scrapsToRender.map(scrap => {
            const tagsHtml = scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
                ? `<div class="card-tags">${scrap.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}</div>`
                : '';
            const cleanedTitle = scrap.text ? scrap.text.replace(/\s+/g, ' ').trim() : '제목 없음';
            return `
                <div class="scrap-card ${selectedScrapId === scrap.id ? 'active' : ''}" data-id="${scrap.id}">
                  <button class="scrap-card-delete-btn" data-id="${scrap.id}"><svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg></button>
                  ${scrap.image ? `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image"></div>` : ''}
                  <div class="scrap-card-info">
                    <div class="scrap-card-title">${cleanedTitle.substring(0, 20)}...</div>
                    <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
                    ${tagsHtml}
                  </div>
                </div>
            `;
        }).join('');
    }

    // ▼▼▼ [추가] 활성화된 태그 하이라이팅 ▼▼▼
    listContainer.querySelectorAll('.card-tags .tag').forEach(tagEl => {
        if (activeScrapbookTagFilter && tagEl.textContent.replace('#', '') === activeScrapbookTagFilter) {
            tagEl.classList.add('active');
        } else {
            tagEl.classList.remove('active');
        }
    });
    
    // --- 이벤트 리스너 재연결 ---
    listContainer.querySelectorAll('.scrap-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if(e.target.closest('.scrap-card-delete-btn') || e.target.classList.contains('tag')) return;
            selectedScrapId = card.dataset.id;
            renderScrapList(scraps, container);
            renderDetailView(selectedScrapId, container);
        });
    });

    listContainer.querySelectorAll('.scrap-card-delete-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const scrapIdToDelete = button.dataset.id;
            showConfirmationToast("정말로 삭제하시겠습니까?", () => {
              chrome.runtime.sendMessage({ action: "delete_scrap", id: scrapIdToDelete }, response => {
                  if (response && response.success) {
                      requestScrapsAndRender(container);
                      if (selectedScrapId === scrapIdToDelete) {
                          renderDetailView(null, container);
                      }
                  }
              });
            });
        });
    });

    // ▼▼▼ [추가] 태그 클릭 이벤트 리스너 ▼▼▼
    listContainer.querySelectorAll('.card-tags .tag').forEach(tagEl => {
        tagEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const clickedTag = tagEl.textContent.replace('#', '');
            activeScrapbookTagFilter = (activeScrapbookTagFilter === clickedTag) ? null : clickedTag;
            renderScrapList(allScraps, container); // 필터 변경 후 목록 다시 렌더링
        });
    });

    // ▼▼▼ [추가] 필터 지우기 버튼 리스너 ▼▼▼
    const clearFilterBtn = container.querySelector('.clear-filter-btn');
    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', () => {
            activeScrapbookTagFilter = null;
            renderScrapList(allScraps, container);
        });
    }
}

// ▼▼▼ [수정] container를 인자로 받도록 변경 ▼▼▼
function renderDetailView(scrapId, container) {
    // ▼▼▼ [수정] document 대신 container에서 요소를 찾습니다. ▼▼▼
    const detailContainer = container.querySelector('#scrapbook-detail-content-area');
    if(!detailContainer) return;

    const scrap = allScraps.find(s => s.id === scrapId);
    if (!scrap) {
        detailContainer.innerHTML = `<div class="scrapbook-detail-empty">왼쪽 목록에서 스크랩을 선택하세요.</div>`;
        selectedScrapId = null; // 선택된 ID 초기화
        return;
    }

        const formatDetailText = (text) => {
        if (!text) return '내용 없음';
        // 1. 3개 이상의 연속된 줄바꿈을 2개(하나의 빈 줄)로 줄입니다.
        let cleaned = text.replace(/(\r\n|\n|\r){3,}/g, '\n\n');
        // 2. 각 줄의 양 끝 불필요한 공백을 제거하고, 중간의 여러 공백은 하나로 합칩니다.
        cleaned = cleaned.split('\n').map(line => line.trim().replace(/\s+/g, ' ')).join('\n');
        return cleaned.trim();
    };

    const detailText = formatDetailText(scrap.text);
    const detailTitle = (scrap.text || '제목 없음').replace(/\s+/g, ' ').trim().substring(0, 50);


    detailContainer.innerHTML = `
        <div class="scrapbook-detail-card">
            ${scrap.image ? `<img src="${scrap.image}" class="scrapbook-detail-img" alt="detail image" referrerpolicy="no-referrer">` : ''}
            <div class="scrapbook-detail-title">${detailTitle}</div>
            <div class="scrapbook-detail-meta"><span>URL: <a href="${scrap.url}" target="_blank">${shortenLink(scrap.url)}</a></span></div>
            <p class="scrapbook-detail-desc">${detailText}</p>
        </div>
    `;
}

// background.js로부터 실시간 업데이트 수신 (이제 Shadow DOM 내부를 찾도록 수정)
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'cp_scraps_updated') {
        const host = document.getElementById("content-pilot-host");
        if (host && host.shadowRoot) {
            const container = host.shadowRoot.querySelector('#cp-main-area');
            if (container && container.querySelector('.scrapbook-root')) {
                requestScrapsAndRender(container);
            }
        }
    }
});