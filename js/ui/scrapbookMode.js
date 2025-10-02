// js/ui/scrapbookMode.js (최종 통합본)
import { shortenLink, showConfirmationToast } from "../utils.js";


let selectedScrapId = null;
let allScraps = [];

// --- ▼▼▼ 실시간 업데이트 리스너를 이 파일로 가져옴 ▼▼▼ ---
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'cp_scraps_updated') {
        allScraps = msg.data;
        // 현재 스크랩북 모드가 활성화 상태일 때만 목록을 다시 그림
        if(document.querySelector('.scrapbook-root')) {
            const listContainer = document.querySelector('.scrapbook-list-cards');
            const keyword = document.getElementById('scrapbook-keyword-input')?.value || '';
            const filteredScraps = keyword ? allScraps.filter(s => s.text.includes(keyword)) : allScraps;
            renderScrapList(filteredScraps);
        }
    }
});

// 스크랩북 모드 UI 렌더링 함수
export function renderScrapbook(container) {
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
  requestScrapsAndRender();

  // 검색창 이벤트 리스너 추가
  const keywordInput = document.getElementById('scrapbook-keyword-input');
  keywordInput.addEventListener('keyup', () => {
      const keyword = keywordInput.value;
      const filteredScraps = allScraps.filter(s => s.text && s.text.toLowerCase().includes(keyword.toLowerCase()));
      renderScrapList(filteredScraps);
  });
}

function requestScrapsAndRender() {
    chrome.runtime.sendMessage({ action: "cp_get_firebase_scraps" }, (response) => {
        if (response && response.data) {
            allScraps = response.data;
            renderScrapList(allScraps);
        } else {
            const listContainer = document.querySelector('.scrapbook-list-cards');
            if(listContainer) listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
        }
    });
}

// 이 파일에 있는 renderScrapList가 항상 호출되도록 보장
function renderScrapList(scraps) {
    const listContainer = document.querySelector('.scrapbook-list-cards');
    if (!listContainer) return;
    const sortedScraps = [...scraps].sort((a, b) => b.timestamp - a.timestamp);
    if (sortedScraps.length === 0) {
        listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
        return;
    }
    listContainer.innerHTML = sortedScraps.map(scrap => {
        // --- ▼▼▼ [G-8] 태그 표시 UI 추가 ▼▼▼ ---
        const tagsHtml = scrap.tags && scrap.tags.length > 0
            ? `<div class="card-tags">${scrap.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}</div>`
            : '';
        // --- ▲▲▲ UI 추가 완료 ▲▲▲ ---

        return `
            <div class="scrap-card ${selectedScrapId === scrap.id ? 'active' : ''}" data-id="${scrap.id}">
              ...
              <div class="scrap-card-info">
                <div class="scrap-card-title">${scrap.text ? scrap.text.substring(0, 20) : '제목 없음'}...</div>
                <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
                ${tagsHtml} {/* 태그 삽입 */}
              </div>
            </div>
        `;
    }).join('');
    
    listContainer.querySelectorAll('.scrap-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if(e.target.closest('.scrap-card-delete-btn')) return;
            selectedScrapId = card.dataset.id;
            renderScrapList(sortedScraps);
            renderDetailView(selectedScrapId);
        });
    });

// 삭제 버튼 클릭 이벤트 리스너
listContainer.querySelectorAll('.scrap-card-delete-btn').forEach(button => {
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const scrapIdToDelete = button.dataset.id;

    showConfirmationToast("정말로 삭제하시겠습니까?", () => {
      // "삭제"를 눌렀을 때 실행될 로직
      chrome.runtime.sendMessage({ action: "delete_scrap", id: scrapIdToDelete });

      // --- ▼▼▼ 이 부분이 핵심입니다 ▼▼▼ ---
      // 만약 현재 상세 정보에 보고 있는 스크랩이 지금 삭제한 것이라면,
      // 상세 정보 창을 즉시 비웁니다.
      if (selectedScrapId === scrapIdToDelete) {
        const detailContainer = document.getElementById('scrapbook-detail-content-area');
        if (detailContainer) {
          detailContainer.innerHTML = `<div class="scrapbook-detail-empty">왼쪽 목록에서 스크랩을 선택하세요.</div>`;
        }
        // 선택된 ID도 초기화
        selectedScrapId = null;
      }
    });
  });
});
}

function renderDetailView(scrapId) {
    const detailContainer = document.getElementById('scrapbook-detail-content-area');
    if(!detailContainer) return;
    const scrap = allScraps.find(s => s.id === scrapId);
    if (!scrap) {
        detailContainer.innerHTML = `<div class="scrapbook-detail-empty">스크랩을 찾을 수 없습니다.</div>`;
        return;
    }
    detailContainer.innerHTML = `
        <div class="scrapbook-detail-card">
            ${scrap.image ? `<img src="${scrap.image}" class="scrapbook-detail-img" alt="detail image">` : ''}
            <div class="scrapbook-detail-title">${scrap.text ? scrap.text.substring(0, 50) : '제목 없음'}</div>
            <div class="scrapbook-detail-meta"><span>URL: <a href="${scrap.url}" target="_blank">${shortenLink(scrap.url)}</a></span></div>
            <p class="scrapbook-detail-desc">${scrap.text || '내용 없음'}</p>
        </div>
    `;
}