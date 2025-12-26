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
      <input id="migration-dryrun" type="checkbox" checked /> <label for="migration-dryrun">Dry-run (시뮬레이션)</label>
      <input id="migration-debug" type="checkbox" style="margin-left:8px;" checked /> <label for="migration-debug">디버그 로깅</label>
    </div>
    <div style="margin-bottom:12px;">
      <label style="display:block; margin-bottom:6px; font-weight:500;">마이그레이션 대상 컬렉션</label>
      <div style="display:flex; gap:8px; flex-wrap:wrap; font-size:13px;">
        <label><input type="checkbox" class="migration-collection" value="ideas" checked /> 아이디어</label>
        <label><input type="checkbox" class="migration-collection" value="kanban_inprogress" checked /> 기획/작성 중</label>
        <label><input type="checkbox" class="migration-collection" value="kanban_done" checked /> 발행</label>
        <label><input type="checkbox" class="migration-collection" value="scraps" checked /> 스크랩</label>
        <label><input type="checkbox" class="migration-collection" value="channel_content" checked /> 채널콘텐츠</label>
      </div>
      <div style="font-size:12px; color:#666; margin-top:6px;">선택하지 않으면 전체 컬렉션이 적용됩니다.</div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button id="migration-cancel" class="cp-btn cp-btn-secondary">취소</button>
      <button id="migration-run" class="cp-btn cp-btn-primary">실행</button>
    </div>
    <div id="migration-result" style="margin-top:12px; color:#333; font-size:13px; display:none; white-space:pre-wrap; max-height:360px; overflow:auto; word-break:break-word;"></div>
  `;

  modalWrap.appendChild(modal);
  // root가 ShadowRoot면 그곳에 붙이고, Document면 body에 붙입니다.
  // 항상 최상단 body에 붙여서 z-index/스태킹 컨텍스트 문제를 피합니다.
  try {
    document.body.appendChild(modalWrap);
  } catch (err) {
    console.error(
      '[ChannelMigrationModal] 모달 삽입 실패, 대체로 document.body에 추가합니다:',
      err
    );
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
  const debugEl = modal.querySelector('#migration-debug');
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

    const collectionEls = modal.querySelectorAll('.migration-collection');
    const selectedCollections = Array.from(collectionEls)
      .filter((el) => el.checked)
      .map((el) => el.value);

    const payload = {
      action: 'migrate_channel',
      channelId: channel.id,
      targetPlatform: targetSelect.value,
      dryRun: !!dryRunEl.checked,
      options: { collections: selectedCollections, debug: !!debugEl?.checked },
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
        const truncate = (str, n = 120) =>
          typeof str === 'string' && str.length > n ? str.slice(0, n) + '…' : str;
        // Build a concise multiline summary with collection header and counts
        const readableMap = {
          channel_content: '채널콘텐츠',
          ideas: '아이디어',
          kanban: '칸반',
          scraps: '스크랩',
        };
        // We intentionally do not show per-collection counts or '없음' (null/undefined) entries.
        // Present only the distribution of actual channel IDs (non-null) for the filtered candidates
        const distLines = [];
        if (r.distribution) {
          const oDist = r.distribution || {};
          const oChannelContent = oDist.channel_content || {};
          const oCcKeys = Object.keys(oChannelContent).filter(
            (k) => k !== 'null' && k !== 'undefined'
          );
          if (oCcKeys.length > 0) {
            distLines.push('대상 채널콘텐츠 분포:');
            oCcKeys.forEach((k) => distLines.push(`- ${k}: ${oChannelContent[k]}`));
          }
          const oScraps = oDist.scraps || {};
          const oScrapKeys = Object.keys(oScraps).filter((k) => k !== 'null' && k !== 'undefined');
          if (oScrapKeys.length > 0) {
            distLines.push('대상 스크랩 분포:');
            oScrapKeys.forEach((k) => distLines.push(`- ${k}: ${oScraps[k]}`));
          }
          // Keep other actual distributions if present (ideas, kanban statuses)
          const oIdeas = oDist.ideas || {};
          const oIdeaKeys = Object.keys(oIdeas).filter((k) => k !== 'null' && k !== 'undefined');
          if (oIdeaKeys.length > 0) {
            distLines.push('대상 아이디어 분포:');
            oIdeaKeys.forEach((k) => distLines.push(`- ${k}: ${oIdeas[k]}`));
          }

          const oKanIn = oDist.kanban_inprogress || {};
          const oKanInKeys = Object.keys(oKanIn).filter((k) => k !== 'null' && k !== 'undefined');
          if (oKanInKeys.length > 0) {
            distLines.push('대상 기획/작성 중 분포:');
            oKanInKeys.forEach((k) => distLines.push(`- ${k}: ${oKanIn[k]}`));
          }

          const oKanDone = oDist.kanban_done || {};
          const oKanDoneKeys = Object.keys(oKanDone).filter(
            (k) => k !== 'null' && k !== 'undefined'
          );
          if (oKanDoneKeys.length > 0) {
            distLines.push('대상 발행 분포:');
            oKanDoneKeys.forEach((k) => distLines.push(`- ${k}: ${oKanDone[k]}`));
          }
        }
        resultEl.textContent = [
          `Dry-run 결과: 총 ${r.totalItems}개 항목이 마이그레이션 후보입니다.`,
          ...distLines,
        ].join('\n');
        showToast('🔎 Dry-run 결과가 표시되었습니다.');
        // show distribution (channelId counts) if present
        // no-op: distribution already included above
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
