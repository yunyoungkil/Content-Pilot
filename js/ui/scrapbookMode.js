// js/ui/scrapbookMode.js
import { showToast, shortenLink } from "../utils.js";
import { filterAndSortScraps } from "../core/scrapbook.js";

// 현재 선택된 스크랩 ID를 저장할 변수
let selectedScrapId = null;
let allScraps = []; // 모든 스크랩 데이터를 저장할 배열

// 스크랩북 모드 UI 렌더링 함수
export function renderScrapbook(container) {
  // 초기 UI 구조 렌더링
  container.innerHTML = `
    <div class="scrapbook-root">
      <div class="scrapbook-list-section">
        <div class="scrapbook-list-header">
          <div class="scrapbook-list-title">스크랩 목록</div>
        </div>
        <div class="scrapbook-sort-group">
          <input type="text" id="scrapbook-keyword-input" class="scrapbook-keyword-input" placeholder="키워드 검색...">
        </div>
        <div class="scrapbook-list-cards">
          <p style="text-align:center;color:#888;margin-top:20px;">스크랩을 불러오는 중...</p>
        </div>
      </div>
      <div class="scrapbook-detail-section">
        <div class="scrapbook-detail-header">상세 정보</div>
        <div class="scrapbook-detail-content" id="scrapbook-detail-content-area">
            <div class="scrapbook-detail-empty">왼쪽 목록에서 스크랩을 선택하세요.</div>
        </div>
      </div>
    </div>
  `;
  
  // 데이터 요청 및 렌더링
  requestScrapsAndRender();
}

// background.js에 데이터를 요청하고 받은 데이터로 목록을 렌더링하는 함수
function requestScrapsAndRender() {
    chrome.runtime.sendMessage({ action: "cp_get_firebase_scraps" }, (response) => {
        if (response && response.data) {
            allScraps = response.data;
            renderScrapList(allScraps); // 처음엔 필터 없이 전체 목록 렌더링
        } else {
            const listContainer = document.querySelector('.scrapbook-list-cards');
            if(listContainer) listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">스크랩이 없습니다.</p>';
        }
    });
}


// 스크랩 목록 부분만 다시 그리는 함수
function renderScrapList(scraps) {
  const listContainer = document.querySelector('.scrapbook-list-cards');
  if (!listContainer) return;

  if (scraps.length === 0) {
    listContainer.innerHTML = '<p style="text-align:center;color:#888;margin-top:20px;">일치하는 스크랩이 없습니다.</p>';
    return;
  }

  // --- ▼▼▼ 1. 삭제 버튼 HTML 추가 ▼▼▼ ---
  listContainer.innerHTML = scraps.map(scrap => `
    <div class="scrap-card ${selectedScrapId === scrap.id ? 'active' : ''}" data-id="${scrap.id}">

      <button class="scrap-card-delete-btn" data-id="${scrap.id}">
        <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
      </button>

      ${scrap.image ? 
        `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image"></div>` :
        `<div class="scrap-card-img-wrap" style="font-size: 24px;">📝</div>`
      }
      <div class="scrap-card-info">
        <div class="scrap-card-title">${scrap.text ? scrap.text.substring(0, 20) : '제목 없음'}</div>
        <div class="scrap-card-snippet">${scrap.text ? scrap.text.substring(0, 30) : ''}...</div>
        <div class="scrap-card-source">${shortenLink(scrap.url, 25)}</div>
      </div>
    </div>
  `).join('');

  // --- ▼▼▼ 2. 이벤트 리스너 추가 ▼▼▼ ---
  // 기존 카드 클릭 이벤트 (상세보기)
  listContainer.querySelectorAll('.scrap-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedScrapId = card.dataset.id;
      renderScrapList(scraps);
      renderDetailView(selectedScrapId);
    });
  });

  // 삭제 버튼 클릭 이벤트
  listContainer.querySelectorAll('.scrap-card-delete-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // 중요: 카드 전체가 클릭되는 것을 방지

      const scrapId = button.dataset.id;
      if (confirm("정말로 이 스크랩을 삭제하시겠습니까?")) {
        chrome.runtime.sendMessage({ action: "delete_scrap", id: scrapId }, (response) => {
          if (response && response.success) {
            // 성공 시 background.js가 알아서 목록을 갱신해줍니다.
          } else {
            alert("삭제에 실패했습니다.");
          }
        });
      }
    });
  });
}

// 상세 뷰를 렌더링하는 함수
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
            <div class="scrapbook-detail-meta">
                <span>URL: <a href="${scrap.url}" target="_blank">${shortenLink(scrap.url)}</a></span>
            </div>
            <p class="scrapbook-detail-desc">${scrap.text || '내용 없음'}</p>
        </div>
    `;
}