// js/ui/scrapbookMode.js
import { showToast, shortenLink } from "../utils.js";
import { filterAndSortScraps } from "../core/scrapbook.js";

let selectedScrapId = null;
let allScraps = [];

// background.js로부터 실시간 업데이트를 받기 위한 리스너 추가
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'cp_scraps_updated') {
        allScraps = msg.data;
        // 현재 스크랩북 모드가 활성화 상태일 때만 목록을 다시 그림
        if(document.querySelector('.scrapbook-root')) {
            renderScrapList(allScraps);
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

function renderScrapList(scraps) {
  const listContainer = document.querySelector('.scrapbook-list-cards');
  if (!listContainer) return;

  const sortedScraps = [...scraps].sort((a, b) => b.timestamp - a.timestamp);

  if (sortedScraps.length === 0) {
    listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
    return;
  }

  listContainer.innerHTML = sortedScraps.map(scrap => `
    <div class="scrap-card ${selectedScrapId === scrap.id ? 'active' : ''}" data-id="${scrap.id}">
      ${scrap.image ? 
        `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image"></div>` :
        `<div class="scrap-card-img-wrap" style="font-size: 24px;">📝</div>`
      }
      <div class="scrap-card-info">
        <div class="scrap-card-title">${scrap.text ? scrap.text.substring(0, 20) : '제목 없음'}...</div>
        <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
      </div>
    </div>
  `).join('');

  listContainer.querySelectorAll('.scrap-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedScrapId = card.dataset.id;
      renderScrapList(sortedScraps);
      renderDetailView(selectedScrapId);
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