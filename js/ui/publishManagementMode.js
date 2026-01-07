// js/ui/publishManagementMode.js
// "발행 관리" 탭: DataTables로 발행 콘텐츠 및 성과 표시

import { showToast, Logger } from '../utils.js';
import { showSnsPostModal } from './snsPostModal.js';
import $ from 'jquery';
import 'datatables.net';

// jQuery를 window에 노출 (DataTables가 window.jQuery를 참조하는 경우를 위해)
window.jQuery = $;
window.$ = $;

// DataTables CSS를 Shadow Root에 주입하는 함수
function injectDataTablesCss(shadowRoot) {
  return new Promise((resolve) => {
    // 이미 주입되었는지 확인
    const existing = shadowRoot.querySelector('link[data-datatables-css]');
    if (existing) {
      // 이미 로드되었으면 바로 resolve
      if (existing.sheet) {
        console.log('[PublishManagement] DataTables CSS already loaded');
        resolve();
        return;
      }
    }

    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.dataset.datatablesCss = 'true';
    cssLink.href = 'https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css';

    cssLink.onload = () => {
      console.log('[PublishManagement] DataTables CSS loaded successfully');
      resolve();
    };

    cssLink.onerror = () => {
      console.error('[PublishManagement] Failed to load DataTables CSS');
      resolve(); // 실패해도 계속 진행
    };

    shadowRoot.appendChild(cssLink);
    console.log('[PublishManagement] DataTables CSS injected into Shadow Root');
  });
}

export function renderPublishManagement(container) {
  container.innerHTML = '';

  // 테이블 새로고침 함수를 container에 등록 (snsPostModal에서 사용)
  container.__refreshPublishTable = () => renderPublishManagement(container);

  container.innerHTML = `
    <div class="publish-management-container">
      <div class="pm-header" style="display:flex;justify-content:space-between;align-items:center;">
        <h2>📚 발행 관리</h2>
        <div>
          <button id="pm-refresh-btn" class="pm-btn">🔄 새로고침</button>
        </div>
      </div>

      <div id="pm-content" class="pm-content">
        <div class="pm-loading">발행된 콘텐츠를 불러오는 중...</div>
      </div>
    </div>
  `;

  // Shadow Root에 DataTables CSS 주입 (비동기)
  const shadowRoot = container.getRootNode();
  if (shadowRoot instanceof ShadowRoot) {
    injectDataTablesCss(shadowRoot).then(() => {
      // CSS가 완전히 렌더링될 때까지 약간 대기
      setTimeout(() => {
        loadPublishedData(container);
      }, 300);
    });
  } else {
    // Shadow Root가 아니면 바로 로드
    loadPublishedData(container);
  }

  // 기존 이벤트 리스너 제거 후 재등록
  const oldHandler = container.__publishManagementHandler;
  if (oldHandler) {
    container.removeEventListener('click', oldHandler);
  }

  const newHandler = async (e) => {
    // SNS 공유 버튼 처리
    const shareBtn = e.target.closest('.pm-share-btn:not(.pm-share-copy)');
    if (shareBtn) {
      e.preventDefault();
      e.stopPropagation();

      const shareDiv = e.target.closest('.pm-share-buttons');
      const url = shareDiv?.dataset.url;
      const title = shareDiv?.dataset.title;
      const itemId = shareDiv?.dataset.itemId;
      const platform = shareBtn.dataset.platform;

      if (!url || !platform) return;

      console.log('[PublishManagement] Opening SNS modal for platform:', platform);

      // 기존 모달이 있으면 제거
      const existingModal = document.querySelector('.sns-post-modal-overlay');
      if (existingModal) {
        existingModal.remove();
        console.log('[PublishManagement] Removed existing modal');
      }

      // AI 게시글 생성 모달 표시
      showSnsPostModal(platform, title, url, itemId, container);
      return;
    }

    if (e.target.closest('.pm-share-copy')) {
      const shareDiv = e.target.closest('.pm-share-buttons');
      const url = shareDiv?.dataset.url;
      if (url) {
        navigator.clipboard
          .writeText(url)
          .then(() => {
            showToast('✅ 링크가 클립보드에 복사되었습니다.');
          })
          .catch(() => {
            showToast('⚠️ 링크 복사에 실패했습니다.');
          });
      }
      return;
    }

    if (e.target.closest('#pm-refresh-btn')) {
      // Force-refresh visible published items' performance metrics
      const contentEl = container.querySelector('#pm-content');
      if (!contentEl) return;

      const refreshBtn = container.querySelector('#pm-refresh-btn');
      refreshBtn.disabled = true;
      refreshBtn.textContent = '🔄 새로고침 중...';

      // Fetch all published items (single large page) then request force refresh for them
      chrome.runtime.sendMessage(
        { action: 'get_paginated_performance_data', page: 1, pageSize: 10000 },
        (resp) => {
          if (resp && resp.success) {
            const allItems = resp.data || [];
            const items = allItems.map((it) => ({
              id: it.id,
              status: it.status,
              forceRefresh: true,
            }));

            // Request background to refresh metrics for these cards
            chrome.runtime.sendMessage({ action: 'get_performance_for_cards', items }, (res2) => {
              refreshBtn.disabled = false;
              refreshBtn.textContent = '🔄 새로고침';
              if (res2 && res2.success) {
                showToast('✅ 발행 성과가 최신화되었습니다.');
                // Re-render table to reflect refreshed metrics
                renderPublishManagement(container);
              } else {
                showToast('⚠️ 발행 성과 갱신에 실패했습니다. (부분적 오류)');
                renderPublishManagement(container);
              }
            });
          } else {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 새로고침';
            showToast('⚠️ 발행 목록을 가져오지 못했습니다.');
          }
        }
      );

      return;
    }
  };

  // 새 핸들러 저장 및 등록
  container.__publishManagementHandler = newHandler;
  container.addEventListener('click', newHandler);
}

// 페이징된 성과 데이터를 모두 받아와서 테이블 초기화
function loadPublishedData(container, page = 1, pageSize = 50, accum = []) {
  const contentEl = container.querySelector('#pm-content');
  if (!contentEl) return;

  if (page === 1) {
    contentEl.innerHTML = '<div class="pm-loading">발행된 콘텐츠를 불러오는 중...</div>';
  }

  chrome.runtime.sendMessage(
    { action: 'get_paginated_performance_data', page, pageSize },
    async (response) => {
      console.log('[PublishManagement] Response received:', response);

      if (response && response.success) {
        const { data, hasMore } = response;
        accum = accum.concat(data);

        console.log(
          '[PublishManagement] Page',
          page,
          '- data length:',
          data.length,
          'hasMore:',
          hasMore,
          'total accum:',
          accum.length
        );

        if (hasMore) {
          setTimeout(() => loadPublishedData(container, page + 1, pageSize, accum), 100);
          return;
        }

        // 모든 데이터 수신 완료
        console.log('[PublishManagement] All data loaded, total items:', accum.length);

        if (accum.length === 0) {
          contentEl.innerHTML = `
          <div class="pm-empty" style="text-align:center;padding:40px;">
            <div style="font-size:28px;">📭</div>
            <h3>발행된 콘텐츠가 없습니다</h3>
            <p>발행된 콘텐츠가 있으면 여기서 성과를 확인할 수 있습니다.</p>
          </div>
        `;
          return;
        }

        // 테이블 마크업 생성
        contentEl.innerHTML = `
        <div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:13px;color:#666">총 ${accum.length}개</div>
          <div></div>
        </div>
        <table id="publish-management-table" class="display" style="width:100%">
          <thead>
            <tr>
              <th>SNS</th>
              <th>발행날짜</th>
              <th>SEO 제목</th>
              <th>순위</th>
              <th>참여율</th>
              <th>노출</th>
              <th>클릭률</th>
              <th>체류</th>
              <th>기기분포</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      `;

        // 데이터 준비
        const rows = accum.map((item, index) => {
          const publishedAt = item.createdAt ? new Date(item.createdAt) : null;
          const publishedDate = publishedAt
            ? publishedAt.toLocaleDateString('ko-KR').replace(/\.$/, '')
            : '-'; // 마지막 점 제거

          // SEO 제목 우선, 없으면 아이디어 제목 표시
          const seoTitle = item.seoTitle || item.title || '제목 없음';
          const url = item.publishedUrl || '#';
          const perf = item.performance || {};

          // 홍보 횟수 가져오기
          const shareCount = item.shareCount || {};
          const totalShares =
            (shareCount.twitter || 0) +
            (shareCount.threads || 0) +
            (shareCount.facebook || 0) +
            (shareCount.pinterest || 0) +
            (shareCount.linkedin || 0) +
            (shareCount.reddit || 0);

          // SNS 공유 버튼 생성
          const shareButtons =
            url && url !== '#'
              ? `
          <div class="pm-share-buttons" data-url="${escapeHtml(url)}" data-title="${escapeHtml(seoTitle)}" data-item-id="${item.id || ''}">
            <button class="pm-share-btn pm-share-twitter" title="트위터 공유" data-platform="twitter">
              X${shareCount.twitter ? `<span style="font-size:10px;margin-left:2px;">(${shareCount.twitter})</span>` : ''}
            </button>
            <button class="pm-share-btn pm-share-threads" title="쓰레드 공유" data-platform="threads">
              ⓪${shareCount.threads ? `<span style="font-size:10px;margin-left:2px;">(${shareCount.threads})</span>` : ''}
            </button>
            <button class="pm-share-btn pm-share-facebook" title="페이스북 공유" data-platform="facebook">
              f${shareCount.facebook ? `<span style="font-size:10px;margin-left:2px;">(${shareCount.facebook})</span>` : ''}
            </button>
            <button class="pm-share-btn pm-share-pinterest" title="핌터레스트 공유" data-platform="pinterest">
              P${shareCount.pinterest ? `<span style="font-size:10px;margin-left:2px;">(${shareCount.pinterest})</span>` : ''}
            </button>
            <button class="pm-share-btn pm-share-linkedin" title="링크드인 공유" data-platform="linkedin">
              in${shareCount.linkedin ? `<span style="font-size:10px;margin-left:2px;">(${shareCount.linkedin})</span>` : ''}
            </button>
            <button class="pm-share-btn pm-share-reddit" title="레딧 공유" data-platform="reddit">
              R${shareCount.reddit ? `<span style="font-size:10px;margin-left:2px;">(${shareCount.reddit})</span>` : ''}
            </button>
            <button class="pm-share-btn pm-share-copy" title="링크 복사">🔗</button>
            ${totalShares > 0 ? `<span style="font-size:11px;color:#666;margin-left:4px;">총 ${totalShares}회</span>` : ''}
          </div>
        `
              : '-';

          // 순위 (1부터 시작)
          const rank = index + 1;

          // 참여율
          const engagementRate = (perf.engagementRate || 0) * 100;

          // 노출 (impressions)
          const impressions = perf.impressions || 0;

          // 클릭률 (CTR)
          const clicks = perf.clicks || 0;
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

          // 체류 (평균 체류 시간, 초 단위)
          const avgTimeOnPage = perf.avgTimeOnPage || perf.averageSessionDuration || 0;
          const dwellTimeFormatted = avgTimeOnPage > 0 ? formatDuration(avgTimeOnPage) : '-';

          // 기기분포 (desktop, mobile, tablet)
          const deviceMetrics = perf.deviceMetrics || {};
          const desktop = deviceMetrics.desktop || 0;
          const mobile = deviceMetrics.mobile || 0;
          const tablet = deviceMetrics.tablet || 0;
          const total = desktop + mobile + tablet;

          let deviceDist = '-';
          if (total > 0) {
            const dPct = ((desktop / total) * 100).toFixed(0);
            const mPct = ((mobile / total) * 100).toFixed(0);
            const tPct = ((tablet / total) * 100).toFixed(0);
            deviceDist = `🖥️${dPct}% 📱${mPct}% 📲${tPct}%`;
          }

          return [
            shareButtons,
            publishedDate,
            `<a href="${url}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(seoTitle)}">${escapeHtml(seoTitle)}</a>`,
            rank,
            engagementRate ? engagementRate.toFixed(1) + '%' : '-',
            impressions.toLocaleString(),
            ctr ? ctr.toFixed(2) + '%' : '-',
            dwellTimeFormatted,
            deviceDist,
          ];
        });

        // 기존 인스턴스가 있으면 제거
        if (window.__cp_publish_dt) {
          try {
            window.__cp_publish_dt.destroy();
          } catch (e) {}
          window.__cp_publish_dt = null;
        }

        // DataTable 초기화
        try {
          console.log('[PublishManagement] Initializing DataTable with', rows.length, 'rows');
          console.log('[PublishManagement] jQuery version:', $.fn.jquery);
          console.log('[PublishManagement] DataTables available:', typeof $.fn.DataTable);

          // Shadow Root 컨텍스트에서 테이블 찾기
          const shadowRoot = contentEl.getRootNode();
          const tableElement = shadowRoot.querySelector('#publish-management-table');
          console.log('[PublishManagement] Shadow Root:', shadowRoot);
          console.log('[PublishManagement] Table element:', tableElement);
          console.log('[PublishManagement] First 3 rows:', rows.slice(0, 3));

          if (!tableElement) {
            throw new Error('Table element not found in Shadow Root');
          }

          // jQuery를 Shadow Root 컨텍스트로 호출
          const table = $(tableElement).DataTable({
            data: rows,
            columns: [
              { title: 'SNS', orderable: false },
              { title: '발행날짜' },
              { title: 'SEO 제목' },
              { title: '순위' },
              { title: '참여율' },
              { title: '노출' },
              { title: '클릭률' },
              { title: '체류' },
              { title: '기기분포' },
            ],
            order: [[1, 'desc']], // 발행날짜 기준 정렬
            pageLength: 20,
            lengthMenu: [10, 20, 50, 100],
            columnDefs: [
              { className: 'dt-center', targets: [0, 3, 4, 5, 6, 7, 8] }, // SNS와 숫자/통계 컬럼 가운데 정렬
            ],
            language: {
              lengthMenu: '_MENU_ 페이지당 항목',
              search: '검색:',
              info: '_TOTAL_개 중 _START_-_END_ 표시',
              infoEmpty: '항목 없음',
              infoFiltered: '(전체 _MAX_개 중 필터링)',
              paginate: {
                first: '처음',
                last: '마지막',
                next: '다음',
                previous: '이전',
              },
              zeroRecords: '검색 결과가 없습니다',
              emptyTable: '데이터가 없습니다',
            },
          });

          window.__cp_publish_dt = table;

          console.log('[PublishManagement] DataTable initialized successfully');
          console.log('[PublishManagement] Table rows count:', table.rows().count());
          console.log('[PublishManagement] Table data count:', table.data().length);

          // tbody가 비어있는지 확인
          const tbody = shadowRoot.querySelector('#publish-management-table tbody');
          console.log(
            '[PublishManagement] tbody children count:',
            tbody ? tbody.children.length : 'tbody not found'
          );

          if (tbody && tbody.children.length === 0) {
            console.error('[PublishManagement] DataTable initialized but tbody is empty!');
            // 폴백: 간단한 표 렌더링
            renderSimpleTable(contentEl, accum);
            showToast('⚠️ 데이터 테이블 렌더링에 실패했습니다. 간단한 표로 표시합니다.');
          }
        } catch (error) {
          console.error('[PublishManagement] DataTable initialization failed:', error);
          Logger.error('[PublishManagement] DataTable 초기화 실패:', error);
          // 폴백: 간단한 표 렌더링
          renderSimpleTable(contentEl, accum);
          showToast('⚠️ 데이터 테이블 초기화에 실패했습니다. 간단한 표로 표시합니다.');
        }
      } else {
        contentEl.innerHTML = '<div class="pm-loading">데이터를 불러올 수 없습니다.</div>';
      }
    }
  );
}

// 간단한 표 렌더링 폴백
function renderSimpleTable(containerEl, items) {
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #eee">SNS</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #eee">발행날짜</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #eee">SEO 제목</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #eee">순위</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #eee">참여율</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #eee">노출</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #eee">클릭률</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #eee">체류</th>
        <th style="text-align:center;padding:8px;border-bottom:1px solid #eee">기기분포</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');
  items.forEach((item, index) => {
    const publishedAt = item.createdAt ? new Date(item.createdAt) : null;
    const publishedDate = publishedAt ? publishedAt.toLocaleDateString('ko-KR') : '-';
    const seoTitle = item.seoTitle || item.title || '제목 없음';
    const url = item.publishedUrl || '#';
    const perf = item.performance || {};

    const rank = index + 1;
    const engagementRate = (perf.engagementRate || 0) * 100;
    const impressions = perf.impressions || 0;
    const clicks = perf.clicks || 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const avgTimeOnPage = perf.avgTimeOnPage || perf.averageSessionDuration || 0;
    const dwellTimeFormatted = avgTimeOnPage > 0 ? formatDuration(avgTimeOnPage) : '-';

    const deviceMetrics = perf.deviceMetrics || {};
    const desktop = deviceMetrics.desktop || 0;
    const mobile = deviceMetrics.mobile || 0;
    const tablet = deviceMetrics.tablet || 0;
    const total = desktop + mobile + tablet;

    let deviceDist = '-';
    if (total > 0) {
      const dPct = ((desktop / total) * 100).toFixed(0);
      const mPct = ((mobile / total) * 100).toFixed(0);
      const tPct = ((tablet / total) * 100).toFixed(0);
      deviceDist = `🖥️${dPct}% 📱${mPct}% 📲${tPct}%`;
    }

    // SNS 공유 버튼
    const shareButtonsHtml =
      url && url !== '#'
        ? `
      <div class="pm-share-buttons" data-url="${escapeHtml(url)}" data-title="${escapeHtml(seoTitle)}" style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">
        <button class="pm-share-btn pm-share-twitter" title="트위터 공유" style="cursor:pointer;border:none;background:#000;color:white;border-radius:4px;width:32px;height:32px;font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;">X</button>
        <button class="pm-share-btn pm-share-threads" title="쓰레드 공유" style="cursor:pointer;border:none;background:#000;color:white;border-radius:4px;width:32px;height:32px;font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;">⓪</button>
        <button class="pm-share-btn pm-share-facebook" title="페이스북 공유" style="cursor:pointer;border:none;background:#1877F2;color:white;border-radius:4px;width:32px;height:32px;font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;">f</button>
        <button class="pm-share-btn pm-share-pinterest" title="핀터레스트 공유" style="cursor:pointer;border:none;background:#E60023;color:white;border-radius:4px;width:32px;height:32px;font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;">P</button>
        <button class="pm-share-btn pm-share-linkedin" title="링크드인 공유" style="cursor:pointer;border:none;background:#0077B5;color:white;border-radius:4px;width:32px;height:32px;font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;">in</button>
        <button class="pm-share-btn pm-share-reddit" title="레딧 공유" style="cursor:pointer;border:none;background:#FF4500;color:white;border-radius:4px;width:32px;height:32px;font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;">R</button>
        <button class="pm-share-btn pm-share-copy" title="링크 복사" style="cursor:pointer;border:none;background:#6c757d;color:white;border-radius:4px;width:32px;height:32px;font-size:16px;display:flex;align-items:center;justify-content:center;">🔗</button>
      </div>
    `
        : '-';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:8px;border-bottom:1px solid #f1f1f1">${shareButtonsHtml}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f1f1">${publishedDate}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f1f1"><a href="${url}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(seoTitle)}" style="display:block;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(seoTitle)}</a></td>
      <td style="padding:8px;text-align:center;border-bottom:1px solid #f1f1f1">${rank}</td>
      <td style="padding:8px;text-align:center;border-bottom:1px solid #f1f1f1">${
        engagementRate ? engagementRate.toFixed(1) + '%' : '-'
      }</td>
      <td style="padding:8px;text-align:center;border-bottom:1px solid #f1f1f1">${impressions.toLocaleString()}</td>
      <td style="padding:8px;text-align:center;border-bottom:1px solid #f1f1f1">${ctr ? ctr.toFixed(2) + '%' : '-'}</td>
      <td style="padding:8px;text-align:center;border-bottom:1px solid #f1f1f1">${dwellTimeFormatted}</td>
      <td style="padding:8px;text-align:center;border-bottom:1px solid #f1f1f1">${deviceDist}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  containerEl.innerHTML = '';
  containerEl.appendChild(table);
}

function formatCurrency(num) {
  if (typeof num !== 'number') num = Number(num) || 0;
  return '$' + num.toFixed(2);
}

// 체류 시간 포맷팅 (초 단위를 분:초 형태로 변환)
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}분 ${secs}초`;
  }
  return `${secs}초`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
