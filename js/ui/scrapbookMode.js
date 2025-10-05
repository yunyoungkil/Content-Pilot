// js/ui/scrapbookMode.js (Shadow DOM 호환 수정 완료)
import { shortenLink, showConfirmationToast } from "../utils.js";

let selectedScrapId = null;
let allScraps = [];

// 스크랩북 모드 UI 렌더링 함수
export function renderScrapbook(container) {
  // container는 이제 Shadow DOM 내부의 #cp-main-area 입니다.
  container.innerHTML = `
    <div class="scrapbook-root">
      <div class="scrapbook-list-section">
        <div class="scrapbook-list-header"><div class="scrapbook-list-title">스크랩 목록</div></div>
        <div class="scrapbook-sort-group"><input type="text" id="scrapbook-keyword-input" class="scrapbook-keyword-input" placeholder="키워드 검색..."></div>
        <div class="scrapbook-list-cards"><p style="text-align:center;color:#888;margin-top:20px;">스크랩을 불러오는 중...</p></div>
      </div>
      <div class="scrapbook-detail-section">
        <div class="scrapbook-detail-header">상세 정보</div>
        <div class="scrapbook-detail-content" id="scrapbook-detail-content-area"><div class="scrapbook-detail-empty">왼쪽 목록에서 스크랩을 선택하세요.</div></div>
      </div>
    </div>
  `;
  
  // ▼▼▼ [수정] container를 인자로 넘겨줍니다. ▼▼▼
  requestScrapsAndRender(container);

  const keywordInput = container.querySelector('#scrapbook-keyword-input');
  keywordInput.addEventListener('keyup', () => {
      const keyword = keywordInput.value;
      const filteredScraps = allScraps.filter(s => s.text && s.text.toLowerCase().includes(keyword.toLowerCase()));
      // ▼▼▼ [수정] container를 인자로 넘겨줍니다. ▼▼▼
      renderScrapList(filteredScraps, container);
  });
}

// ▼▼▼ [수정] container를 인자로 받도록 변경 ▼▼▼
function requestScrapsAndRender(container) {
    chrome.runtime.sendMessage({ action: "cp_get_firebase_scraps" }, (response) => {
        if (response && response.data) {
            allScraps = response.data.sort((a, b) => b.timestamp - a.timestamp);
            // ▼▼▼ [수정] container를 인자로 넘겨줍니다. ▼▼▼
            renderScrapList(allScraps, container);
        } else {
            // ▼▼▼ [수정] document 대신 container에서 요소를 찾습니다. ▼▼▼
            const listContainer = container.querySelector('.scrapbook-list-cards');
            if(listContainer) listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
        }
    });
}

// ▼▼▼ [수정] container를 인자로 받도록 변경 ▼▼▼
function renderScrapList(scraps, container) {
    // ▼▼▼ [수정] document 대신 container에서 요소를 찾습니다. ▼▼▼
    const listContainer = container.querySelector('.scrapbook-list-cards');
    if (!listContainer) return;

    if (scraps.length === 0) {
        listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
        return;
    }

    listContainer.innerHTML = scraps.map(scrap => {
        const tagsHtml = scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
            ? `<div class="card-tags">${scrap.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}</div>`
            : '';

        return `
            <div class="scrap-card ${selectedScrapId === scrap.id ? 'active' : ''}" data-id="${scrap.id}">
              <button class="scrap-card-delete-btn" data-id="${scrap.id}">
                <span class="material-symbols-outlined" style="font-size: 18px; pointer-events: none;">delete</span>
              </button>
              ${scrap.image ? `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image"></div>` : ''}
              <div class="scrap-card-info">
                <div class="scrap-card-title">${scrap.text ? scrap.text.substring(0, 20) : '제목 없음'}...</div>
                <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
                ${tagsHtml}
              </div>
            </div>
        `;
    }).join('');
    
    listContainer.querySelectorAll('.scrap-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if(e.target.closest('.scrap-card-delete-btn')) return;
            selectedScrapId = card.dataset.id;
            // ▼▼▼ [수정] container를 재귀적으로 넘겨줍니다. ▼▼▼
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
                  // 성공적으로 삭제되면 다시 데이터를 요청하여 화면을 갱신합니다.
                  requestScrapsAndRender(container);
                  if (selectedScrapId === scrapIdToDelete) {
                      renderDetailView(null, container); // 상세 뷰 비우기
                  }
              }
          });
        });
      });
    });
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

    detailContainer.innerHTML = `
        <div class="scrapbook-detail-card">
            ${scrap.image ? `<img src="${scrap.image}" class="scrapbook-detail-img" alt="detail image" referrerpolicy="no-referrer">` : ''}
            <div class="scrapbook-detail-title">${scrap.text ? scrap.text.substring(0, 50) : '제목 없음'}</div>
            <div class="scrapbook-detail-meta"><span>URL: <a href="${scrap.url}" target="_blank">${shortenLink(scrap.url)}</a></span></div>
            <p class="scrapbook-detail-desc">${scrap.text || '내용 없음'}</p>
        </div>
    `;
}

// background.js로부터 실시간 업데이트 수신 (이제 Shadow DOM 내부를 찾도록 수정)
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'cp_scraps_updated') {
        // Shadow DOM 호스트를 먼저 찾습니다.
        const host = document.getElementById("content-pilot-host");
        // 호스트와 Shadow Root가 존재하고, 그 안에 스크랩북 UI가 있는지 확인합니다.
        if (host && host.shadowRoot) {
            const container = host.shadowRoot.querySelector('#cp-main-area');
            if (container && container.querySelector('.scrapbook-root')) {
                // container를 인자로 넘겨주어 UI를 올바르게 업데이트합니다.
                requestScrapsAndRender(container);
            }
        }
    }
});