import { showToast } from '../utils.js';

/**
 * 채널 단건 마이그레이션 모달 표시
 * @param {ShadowRoot|Document} root
 * @param {Object} channel - 채널 객체 (id, inputUrl, platformType ...)
 */
export function showChannelMigrationModal(root, channel) {
  const existing = root.querySelector('#channel-migration-modal');
  if (existing) existing.remove();

  const modalWrap = document.createElement('div');
  modalWrap.id = 'channel-migration-modal';
  modalWrap.className = 'cp-modal-wrap';
  modalWrap.style.cssText = `position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.45); z-index:2147483647;`;

  const modal = document.createElement('div');
  modal.className = 'cp-modal';
  modal.style.cssText = `background:#fff; border-radius:10px; padding:20px; max-width:560px; width:90%; box-sizing:border-box;`;

  modal.innerHTML = `
    <div style="margin-bottom:12px;">
      <h3 style="margin:0 0 6px 0;">🔁 채널 데이터 마이그레이션</h3>
      <div style="color:#666; font-size:13px;">채널 ID: <strong>${channel.id}</strong><br>${channel.inputUrl || ''}</div>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block; margin-bottom:6px; font-weight:500;">대상 플랫폼 선택</label>
      <select id="migration-target-select" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:6px;">
        <option value="naver">네이버</option>
        <option value="tistory">티스토리</option>
        <option value="wordpress">워드프레스</option>
        <option value="external">External JSON</option>
      </select>
    </div>
    <div style="margin-bottom:12px; display:flex; align-items:center; gap:8px;">
      <input id="migration-dryrun" type="checkbox" /> <label for="migration-dryrun">Dry-run (시뮬레이션)</label>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button id="migration-cancel" class="cp-btn cp-btn-secondary">취소</button>
      <button id="migration-run" class="cp-btn cp-btn-primary">실행</button>
    </div>
    <div id="migration-result" style="margin-top:12px; color:#333; font-size:13px; display:none; white-space:pre-wrap;"></div>
  `;

  modalWrap.appendChild(modal);
  // root가 ShadowRoot면 그곳에 붙이고, Document면 body에 붙입니다.
  // 항상 최상단 body에 붙여서 z-index/스태킹 컨텍스트 문제를 피합니다.
  try {
    document.body.appendChild(modalWrap);
  } catch (err) {
    console.error('[ChannelMigrationModal] 모달 삽입 실패, 대체로 document.body에 추가합니다:', err);
    // fallback: 최종적으로 root에 붙입니다.
    try {
      root.appendChild(modalWrap);
    } catch (e) {
      console.error('[ChannelMigrationModal] fallback으로 root에 추가도 실패했습니다:', e);
    }
  }

  const cancelBtn = modal.querySelector('#migration-cancel');
  const runBtn = modal.querySelector('#migration-run');
  const dryRunEl = modal.querySelector('#migration-dryrun');
  const targetSelect = modal.querySelector('#migration-target-select');
  const resultEl = modal.querySelector('#migration-result');

  // 기본값: 채널의 platformType을 우선 사용
  try {
    if (channel && channel.platformType && targetSelect) targetSelect.value = channel.platformType;
  } catch (e) {
    // ignore
  }

  cancelBtn.addEventListener('click', () => modalWrap.remove());
  modalWrap.addEventListener('click', (e) => {
    if (e.target === modalWrap) modalWrap.remove();
  });

  runBtn.addEventListener('click', () => {
    runBtn.disabled = true;
    runBtn.textContent = '처리 중...';
    resultEl.style.display = 'none';

    const payload = {
      action: 'migrate_channel',
      channelId: channel.id,
      targetPlatform: targetSelect.value,
      dryRun: !!dryRunEl.checked,
      options: {},
    };

    chrome.runtime.sendMessage(payload, (res) => {
      runBtn.disabled = false;
      runBtn.textContent = '실행';
      if (!res) {
        showToast('⚠️ 응답이 없습니다. 콘솔을 확인하세요.');
        return;
      }

      if (res.success && res.dryRunResult) {
        resultEl.style.display = 'block';
        const r = res.dryRunResult;
        const g = r.groups || {};
        // Build a friendly multiline summary
        let lines = [];
        lines.push(`Dry-run 결과: 총 ${r.totalItems}개 항목이 마이그레이션 후보입니다.`);
        Object.keys(g).forEach((type) => {
          const group = g[type];
          if (group.count && group.count > 0) {
            const readableName = type === 'kanban' ? '칸반' : type === 'scraps' ? '스크랩' : type;
            lines.push(`- ${readableName}: ${group.count}개`);
            if (group.sample && Array.isArray(group.sample) && group.sample.length > 0) {
              lines.push(`  샘플:`);
              group.sample.slice(0, 5).forEach((s) => {
                lines.push(`    - ${s}`);
              });
            }
          }
        });
        resultEl.textContent = lines.join('\n');
        showToast('🔎 Dry-run 결과가 표시되었습니다.');
      } else if (res.success && res.jobId) {
        resultEl.style.display = 'block';
        resultEl.textContent = '작업이 예약되었습니다. 작업 ID: ' + res.jobId;
        showToast('✅ 마이그레이션 작업이 예약되었습니다.');
      } else {
        resultEl.style.display = 'block';
        resultEl.textContent = '오류: ' + (res.error || '알 수 없는 오류');
        showToast('❌ 마이그레이션에 실패했습니다.');
      }
    });
  });
}
