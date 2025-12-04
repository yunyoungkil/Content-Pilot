// js/ui/draftMode.js (스토리지 관리자로 변경됨)
import { showToast, showConfirmationToast } from '../utils.js';

// [수정 완료] renderDraftingMode -> renderDraftMode 로 변경 (필수!)
export function renderDraftMode(container) {
  // 기존 패널 제거 및 초기화
  const prev = document.getElementById('cp-draft-mode-root');
  if (prev) prev.remove();

  const root = document.createElement('div');
  root.id = 'cp-draft-mode-root';
  root.style.cssText = `
    position: fixed; top: 60px; right: 20px; z-index: 9999;
    width: 360px; height: 600px; background: #fff;
    border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: -apple-system, sans-serif;
  `;

  // 헤더
  const header = document.createElement('div');
  header.style.cssText =
    'padding: 16px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #f8f9fa;';
  header.innerHTML = `
    <h3 style="margin:0; font-size:16px; color:#333;">☁️ 스토리지 관리</h3>
    <button id="close-storage-btn" style="border:none; background:none; cursor:pointer; font-size:18px; color:#666;">×</button>
  `;
  root.appendChild(header);

  // 컨텐츠 영역 (리스트)
  const content = document.createElement('div');
  content.className = 'storage-list-content';
  content.style.cssText = 'flex: 1; overflow-y: auto; padding: 12px;';
  content.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">로딩 중...</div>';
  root.appendChild(content);

  // 푸터 (업로드 버튼)
  const footer = document.createElement('div');
  footer.style.cssText = 'padding: 12px; border-top: 1px solid #eee; background: #fff;';
  footer.innerHTML = `
    <label style="display:block; width:100%; padding:10px; background:#4285f4; color:white; text-align:center; border-radius:6px; cursor:pointer; font-weight:500; transition:background 0.2s;">
      + 이미지 업로드
      <input type="file" id="storage-upload-input" accept="image/*" style="display:none;">
    </label>
  `;
  root.appendChild(footer);

  container.appendChild(root);

  // 이벤트 연결
  root.querySelector('#close-storage-btn').onclick = () => root.remove();

  // 데이터 로드 및 렌더링
  loadStorageImages(content);

  // 업로드 핸들러
  root.querySelector('#storage-upload-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showToast('업로드 시작...');

    const reader = new FileReader();
    reader.onload = (evt) => {
      chrome.runtime.sendMessage(
        {
          action: 'upload_thumbnail_to_storage',
          data: { dataUrl: evt.target.result, filename: file.name },
        },
        (res) => {
          if (res && res.success) {
            showToast('✅ 업로드 완료');
            loadStorageImages(content); // 목록 새로고침
          } else {
            showToast('❌ 업로드 실패: ' + (res?.error || 'Unknown error'), 'error');
          }
        }
      );
    };
    reader.readAsDataURL(file);
  };
}

function loadStorageImages(container) {
  // 통합 갤러리 API 재사용 (필터: STORAGE)
  chrome.runtime.sendMessage({ action: 'get_unified_gallery', filter: '#Storage' }, (res) => {
    if (!res || !res.success) {
      container.innerHTML =
        '<div style="text-align:center; padding:20px; color:#e33;">데이터 로드 실패</div>';
      return;
    }

    if (res.images.length === 0) {
      container.innerHTML =
        '<div style="text-align:center; padding:40px; color:#888;">저장된 이미지가 없습니다.<br>아래 버튼으로 업로드해보세요.</div>';
      return;
    }

    container.innerHTML = `<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
      ${res.images
        .map(
          (img) => `
        <div class="storage-item" id="storage-${img.id}" style="position:relative; border:1px solid #eee; border-radius:8px; overflow:hidden; aspect-ratio:1;">
          <img src="${img.url}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">
          <div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.5); color:white; font-size:10px; padding:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${new Date(img.timestamp).toLocaleDateString()}
          </div>
          <button class="delete-storage-btn" data-id="${img.id}" data-path="${img.originData.storagePath}" 
            style="position:absolute; top:4px; right:4px; width:24px; height:24px; background:rgba(255,255,255,0.9); border:none; border-radius:50%; color:#ea4335; cursor:pointer; display:flex; align-items:center; justify-content:center; font-weight:bold; box-shadow:0 1px 3px rgba(0,0,0,0.2);">
            ×
          </button>
        </div>
      `
        )
        .join('')}
    </div>`;

    // 삭제 버튼 이벤트
    container.querySelectorAll('.delete-storage-btn').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const path = btn.dataset.path;

        showConfirmationToast('정말 삭제하시겠습니까? (복구 불가)', () => {
          // 낙관적 업데이트
          const item = document.getElementById(`storage-${id}`);
          if (item) item.style.opacity = '0.5';

          chrome.runtime.sendMessage(
            {
              action: 'delete_storage_image',
              data: { id, storagePath: path },
            },
            (delRes) => {
              if (delRes && delRes.success) {
                if (item) item.remove();
                showToast('삭제되었습니다.');
              } else {
                if (item) item.style.opacity = '1';
                showToast('삭제 실패', 'error');
              }
            }
          );
        });
      };
    });
  });
}
