// js/ui/adminMode.js
// 시스템 진단 모드 UI

const CHECK_ITEMS = [
  { id: 'db_conn', label: 'Firebase 데이터베이스 연결', category: '연결 및 인증' },
  { id: 'db_write', label: 'Firebase 쓰기 권한', category: '연결 및 인증' },
  { id: 'auth_token', label: 'Google 계정 토큰 유효성', category: '연결 및 인증' },
  { id: 'api_youtube', label: 'YouTube API 키', category: '연결 및 인증' },
  { id: 'api_gemini', label: 'Gemini API 키', category: '연결 및 인증' },
  { id: 'data_active_channel', label: '활성 채널 상태', category: '데이터 무결성' },
  { id: 'data_orphan', label: '고아 데이터 감지', category: '데이터 무결성' },
  { id: 'data_structure', label: '채널 데이터 구조', category: '데이터 무결성' },
  { id: 'scheduler', label: '스케줄러 등록 상태', category: '백그라운드 로직' },
  { id: 'data_freshness', label: '데이터 최신성', category: '백그라운드 로직' },
  { id: 'offscreen_parser', label: '오프스크린 DOM 파서', category: '백그라운드 로직' },
  { id: 'automation_renewal', label: '재활용 자동화 테스트', category: 'AI 및 자동화' },
  { id: 'ai_draft', label: 'AI 초안 생성', category: 'AI 및 자동화' },
  { id: 'ga4_access', label: 'GA4 속성 접근 권한', category: '외부 API 연동' },
  { id: 'adsense_access', label: 'AdSense 계정 접근 권한', category: '외부 API 연동' },
  { id: 'url_filtering', label: 'URL 필터링 테스트', category: '외부 API 연동' },
];

const CATEGORY_ICONS = {
  '연결 및 인증': '🔌',
  '데이터 무결성': '💾',
  '백그라운드 로직': '⚙️',
  'AI 및 자동화': '🧠',
  '외부 API 연동': '📊',
};

export function renderAdminMode(container) {
  container.innerHTML = `
    <div style="padding: 24px; max-width: 1200px; margin: 0 auto; height: 100%; overflow-y: auto;">
      <div style="margin-bottom: 24px;">
        <h1 style="font-size: 28px; font-weight: 700; color: #222; margin-bottom: 8px;">
          🛠️ 시스템 진단 모드
        </h1>
        <p style="color: #666; font-size: 14px;">
          시스템의 5가지 핵심 영역(20개 검사 항목)을 점검합니다.
        </p>
      </div>

      <!-- 시작 버튼 -->
      <div style="margin-bottom: 32px; text-align: center;">
        <button id="diagnosis-start-btn" 
          style="padding: 16px 48px; font-size: 18px; font-weight: 600; 
                 background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                 color: white; border: none; border-radius: 12px; 
                 cursor: pointer; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
                 transition: transform 0.2s, box-shadow 0.2s;">
          ▶ 전체 점검 시작
        </button>
      </div>

      <!-- 검사 항목 리스트 -->
      <div id="diagnosis-checklist" style="margin-bottom: 32px;">
        ${renderChecklist()}
      </div>

      <!-- 로그 영역 -->
      <div style="background: #1e1e1e; border-radius: 12px; padding: 20px; max-height: 400px; overflow-y: auto;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin: 0;">
            📋 상세 기술 로그
          </h3>
          <button id="clear-logs-btn" 
            style="padding: 6px 12px; font-size: 12px; background: #333; color: #fff; 
                   border: 1px solid #555; border-radius: 6px; cursor: pointer;">
            로그 지우기
          </button>
        </div>
        <div id="diagnosis-logs" style="font-family: 'Courier New', monospace; font-size: 12px; color: #d4d4d4; line-height: 1.6;">
          <div style="color: #888;">진단을 시작하려면 위의 '전체 점검 시작' 버튼을 클릭하세요.</div>
        </div>
      </div>
    </div>
  `;

  addAdminEventListeners(container);
}

function renderChecklist() {
  const categories = {};
  CHECK_ITEMS.forEach((item) => {
    if (!categories[item.category]) {
      categories[item.category] = [];
    }
    categories[item.category].push(item);
  });

  return Object.entries(categories)
    .map(
      ([category, items]) => `
    <div style="margin-bottom: 24px; background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
      <h3 style="font-size: 18px; font-weight: 600; color: #222; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
        ${CATEGORY_ICONS[category]} ${category}
      </h3>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${items
          .map(
            (item) => `
          <div id="check-item-${item.id}" 
            class="check-item" 
            data-check-id="${item.id}"
            style="display: flex; align-items: center; justify-content: space-between; 
                   padding: 12px 16px; background: #f8f9fa; border-radius: 8px; 
                   border: 2px solid transparent; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span class="check-status-icon" style="font-size: 20px; width: 24px; text-align: center;">⏳</span>
              <span style="font-size: 14px; font-weight: 500; color: #333;">${item.label}</span>
            </div>
            <div class="check-actions" style="display: none;">
              <button class="fix-btn" style="padding: 6px 12px; font-size: 12px; 
                     background: #ff6b6b; color: white; border: none; border-radius: 6px; 
                     cursor: pointer; display: none;">
                해결하기
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `
    )
    .join('');
}

function addAdminEventListeners(container) {
  const startBtn = container.querySelector('#diagnosis-start-btn');
  const logsContainer = container.querySelector('#diagnosis-logs');
  const clearLogsBtn = container.querySelector('#clear-logs-btn');

  let isRunning = false;
  let logEntries = [];

  // 진단 시작 버튼
  startBtn.addEventListener('click', async () => {
    if (isRunning) {
      alert('진단이 이미 실행 중입니다.');
      return;
    }

    isRunning = true;
    startBtn.disabled = true;
    startBtn.textContent = '진단 중...';
    startBtn.style.opacity = '0.6';
    startBtn.style.cursor = 'not-allowed';

    // 모든 체크 항목 초기화
    CHECK_ITEMS.forEach((item) => {
      const checkItem = container.querySelector(`#check-item-${item.id}`);
      const icon = checkItem.querySelector('.check-status-icon');
      const actions = checkItem.querySelector('.check-actions');
      const fixBtn = checkItem.querySelector('.fix-btn');

      icon.textContent = '🔄';
      icon.style.color = '#667eea';
      checkItem.style.borderColor = 'transparent';
      actions.style.display = 'none';
      fixBtn.style.display = 'none';
    });

    // 로그 초기화
    logEntries = [];
    logsContainer.innerHTML = '<div style="color: #888;">진단 시작...</div>';

    // 진단 실행
    try {
      chrome.runtime.sendMessage({ action: 'run_system_diagnosis' }, (response) => {
        if (chrome.runtime.lastError) {
          addLog('error', `메시지 전송 오류: ${chrome.runtime.lastError.message}`);
          resetButton();
          return;
        }

        if (response && response.success) {
          addLog('success', '진단이 완료되었습니다.');
          if (response.data && response.data.checks) {
            // 진단 결과를 순차적으로 표시 (실시간 효과)
            displayDiagnosisResults(response.data);
          }
        } else {
          addLog('error', `진단 실패: ${response?.error || '알 수 없는 오류'}`);
          resetButton();
        }
      });
    } catch (error) {
      addLog('error', `진단 실행 오류: ${error.message}`);
      resetButton();
    }
  });

  // 로그 지우기 버튼
  clearLogsBtn.addEventListener('click', () => {
    logEntries = [];
    logsContainer.innerHTML = '<div style="color: #888;">로그가 지워졌습니다.</div>';
  });

  function resetButton() {
    isRunning = false;
    startBtn.disabled = false;
    startBtn.textContent = '▶ 전체 점검 시작';
    startBtn.style.opacity = '1';
    startBtn.style.cursor = 'pointer';
  }

  function handleDiagnosticLog(logEntry) {
    const { id, status, message, timestamp: _timestamp } = logEntry;

    // 체크리스트 업데이트
    const checkItem = container.querySelector(`#check-item-${id}`);
    if (checkItem) {
      const icon = checkItem.querySelector('.check-status-icon');
      const actions = checkItem.querySelector('.check-actions');
      const fixBtn = checkItem.querySelector('.fix-btn');

      if (status === 'running') {
        icon.textContent = '🔄';
        icon.style.color = '#667eea';
        checkItem.style.borderColor = '#667eea';
      } else if (status === 'pass') {
        icon.textContent = '✅';
        icon.style.color = '#34a853';
        checkItem.style.borderColor = '#34a853';
      } else if (status === 'fail') {
        icon.textContent = '❌';
        icon.style.color = '#ea4335';
        checkItem.style.borderColor = '#ea4335';
        actions.style.display = 'block';
        fixBtn.style.display = 'block';
        fixBtn.textContent = getFixButtonText(id);
      } else if (status === 'warn') {
        icon.textContent = '⚠️';
        icon.style.color = '#fbbc05';
        checkItem.style.borderColor = '#fbbc05';
        actions.style.display = 'block';
        fixBtn.style.display = 'block';
        fixBtn.textContent = getFixButtonText(id);
      } else if (status === 'done') {
        icon.textContent = '✓';
        icon.style.color = '#34a853';
      }
    }

    // 로그 추가
    const logColor =
      status === 'pass' || status === 'done'
        ? '#4caf50'
        : status === 'fail'
          ? '#f44336'
          : status === 'warn'
            ? '#ff9800'
            : status === 'running'
              ? '#2196f3'
              : '#d4d4d4';

    addLog(status, `[${id}] ${message}`, logColor);
  }

  function displayDiagnosisResults(results) {
    if (!results.checks || results.checks.length === 0) {
      resetButton();
      return;
    }

    // 진단 결과를 순차적으로 표시 (실시간 효과)
    let index = 0;
    const displayNext = () => {
      if (index >= results.checks.length) {
        // 모든 결과 표시 완료
        resetButton();
        const duration = results.duration ? Math.round(results.duration / 1000) : 0;
        addLog(
          'success',
          `진단 완료 (소요 시간: ${duration}초, 오류: ${results.errors?.length || 0}개, 경고: ${results.warnings?.length || 0}개)`
        );
        return;
      }

      const check = results.checks[index];
      handleDiagnosticLog(check);
      index++;

      // 다음 결과를 약간의 지연 후 표시 (실시간 효과)
      setTimeout(displayNext, 100);
    };

    displayNext();
  }

  function addLog(type, message, color = '#d4d4d4') {
    const timestamp = new Date().toLocaleTimeString('ko-KR');
    const logEntry = document.createElement('div');
    logEntry.style.marginBottom = '8px';
    logEntry.style.color = color;
    logEntry.innerHTML = `<span style="color: #888;">[${timestamp}]</span> ${escapeHtml(message)}`;

    logsContainer.appendChild(logEntry);
    logsContainer.scrollTop = logsContainer.scrollHeight;

    logEntries.push({ type, message, timestamp });
  }

  function getFixButtonText(checkId) {
    const fixActions = {
      auth_token: '🔑 재로그인',
      api_youtube: 'API 키 설정',
      api_gemini: 'API 키 설정',
      data_active_channel: '자동 수정',
      data_orphan: '🧹 정리 실행',
      data_structure: '구조 확인',
      scheduler: '알람 재등록',
      ga4_access: '🔑 재로그인',
      adsense_access: '🔑 재로그인',
      url_filtering: '🔑 재로그인',
    };
    return fixActions[checkId] || '해결하기';
  }

  function handleAutoFix(checkId) {
    const checkItem = container.querySelector(`#check-item-${checkId}`);
    const fixBtn = checkItem?.querySelector('.fix-btn');
    const icon = checkItem?.querySelector('.check-status-icon');

    if (!fixBtn) return;

    fixBtn.disabled = true;
    fixBtn.textContent = '처리 중...';
    icon.textContent = '🔄';

    if (checkId === 'data_active_channel') {
      // 활성 채널 불일치 수정
      addLog('info', '활성 채널을 재설정하는 중...');
      chrome.runtime.sendMessage({ action: 'fix_active_channel_mismatch' }, (response) => {
        if (response && response.success) {
          const message = response.message || '활성 채널이 수정되었습니다.';
          addLog('success', `✅ ${message}`);
          addLog('info', "상단 헤더의 '글로벌 채널 선택기'에서 채널을 다시 선택할 수도 있습니다.");
          icon.textContent = '✅';
          fixBtn.style.display = 'none';
          // 진단 다시 실행하여 상태 확인
          setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'run_system_diagnosis' }, (diagResponse) => {
              if (diagResponse && diagResponse.success && diagResponse.data) {
                const check = diagResponse.data.checks?.find((c) => c.id === checkId);
                if (check) handleDiagnosticLog(check);
              }
            });
          }, 1000);
        } else {
          addLog('error', response?.error || '수정 실패');
          addLog('info', "상단 헤더의 '글로벌 채널 선택기'에서 채널을 직접 선택해주세요.");
          icon.textContent = '⚠️';
          fixBtn.disabled = false;
          fixBtn.textContent = getFixButtonText(checkId);
        }
      });
    } else if (checkId === 'data_orphan') {
      // 데이터 마이그레이션은 현재 비활성화되어 있습니다.
      addLog('warn', '데이터 마이그레이션 기능은 현재 비활성화되어 있습니다. (개발 단계 단순화)');
      icon.textContent = '⚠️';
      fixBtn.disabled = false;
      fixBtn.textContent = '비활성화됨';
    } else if (checkId === 'data_structure') {
      // 채널 데이터 구조 수정
      chrome.runtime.sendMessage({ action: 'fix_channel_structure' }, (response) => {
        if (response && response.success) {
          addLog('success', response.message || '채널 데이터 구조가 수정되었습니다.');
          icon.textContent = '✅';
          fixBtn.style.display = 'none';
          // 진단 다시 실행하여 상태 확인
          setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'run_system_diagnosis' }, (diagResponse) => {
              if (diagResponse && diagResponse.success && diagResponse.data) {
                const check = diagResponse.data.checks?.find((c) => c.id === checkId);
                if (check) handleDiagnosticLog(check);
              }
            });
          }, 1000);
        } else {
          addLog('error', response?.error || '구조 수정 실패');
          icon.textContent = '⚠️';
          fixBtn.disabled = false;
          fixBtn.textContent = getFixButtonText(checkId);
        }
      });
    } else if (checkId === 'scheduler') {
      // 알람 재등록
      chrome.runtime.sendMessage({ action: 'register_alarms' }, (response) => {
        if (response && response.success) {
          addLog('success', response.message || '알람이 재등록되었습니다.');
          icon.textContent = '✅';
          fixBtn.style.display = 'none';
          // 진단 다시 실행하여 상태 확인
          setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'run_system_diagnosis' }, (diagResponse) => {
              if (diagResponse && diagResponse.success && diagResponse.data) {
                const check = diagResponse.data.checks?.find((c) => c.id === checkId);
                if (check) handleDiagnosticLog(check);
              }
            });
          }, 1000);
        } else {
          addLog('error', response?.error || '알람 재등록 실패');
          icon.textContent = '⚠️';
          fixBtn.disabled = false;
          fixBtn.textContent = getFixButtonText(checkId);
        }
      });
    } else if (
      checkId === 'adsense_access' ||
      checkId === 'ga4_access' ||
      checkId === 'url_filtering'
    ) {
      // AdSense/GA4/URL 필터링 접근 권한 문제: Google 재로그인 필요
      addLog('info', 'Google 계정 인증이 필요합니다. 채널 관리 화면으로 이동합니다...');
      addLog('warn', '401 에러는 토큰 만료로 인한 것입니다. 재로그인 후 해결됩니다.');
      const shadowRoot =
        container.closest('#content-pilot-host')?.shadowRoot ||
        document.querySelector('#content-pilot-host')?.shadowRoot;
      if (shadowRoot) {
        // 채널 선택기를 통해 채널 관리 화면으로 이동
        const channelSelector = shadowRoot.querySelector('#global-channel-selector');
        if (channelSelector) {
          channelSelector.value = '__MANAGE__';
          channelSelector.dispatchEvent(new Event('change'));
        } else {
          // 헤더가 없으면 직접 채널 모드로 이동
          const mainArea = shadowRoot.querySelector('#cp-main-area');
          if (mainArea) {
            import('./channelMode.js').then((module) => {
              module.renderChannelMode(mainArea);
            });
            window.__cp_active_mode = 'channel';
          }
        }
      }
      fixBtn.disabled = false;
      fixBtn.textContent = getFixButtonText(checkId);
    } else if (checkId === 'api_youtube' || checkId === 'api_gemini') {
      // API 키 설정: 채널 관리 화면으로 이동
      addLog('info', '채널 관리 화면으로 이동합니다...');
      const shadowRoot =
        container.closest('#content-pilot-host')?.shadowRoot ||
        document.querySelector('#content-pilot-host')?.shadowRoot;
      if (shadowRoot) {
        // 채널 선택기를 통해 채널 관리 화면으로 이동
        const channelSelector = shadowRoot.querySelector('#global-channel-selector');
        if (channelSelector) {
          channelSelector.value = '__MANAGE__';
          channelSelector.dispatchEvent(new Event('change'));
        } else {
          // 헤더가 없으면 직접 채널 모드로 이동
          const mainArea = shadowRoot.querySelector('#cp-main-area');
          if (mainArea) {
            import('./channelMode.js').then((module) => {
              module.renderChannelMode(mainArea);
            });
            // 탭 활성화
            const adminTab = shadowRoot.querySelector('[data-key="admin"]');
            const _channelTab = shadowRoot.querySelector('[data-key="channel"]');
            if (adminTab) adminTab.classList.remove('active');
            // 채널 관리 탭이 없으면 대시보드 탭을 비활성화하고 채널 모드 표시
            window.__cp_active_mode = 'channel';
          }
        }
      }
      fixBtn.disabled = false;
      fixBtn.textContent = getFixButtonText(checkId);
    } else if (checkId === 'auth_token') {
      // Google 로그인 다시 하기: 채널 관리 화면으로 이동
      addLog('info', 'Google 계정 인증이 필요합니다. 채널 관리 화면으로 이동합니다...');
      addLog('warn', '401 에러는 토큰 만료로 인한 것입니다. 재로그인 후 해결됩니다.');
      const shadowRoot =
        container.closest('#content-pilot-host')?.shadowRoot ||
        document.querySelector('#content-pilot-host')?.shadowRoot;
      if (shadowRoot) {
        // 채널 선택기를 통해 채널 관리 화면으로 이동
        const channelSelector = shadowRoot.querySelector('#global-channel-selector');
        if (channelSelector) {
          channelSelector.value = '__MANAGE__';
          channelSelector.dispatchEvent(new Event('change'));
        } else {
          // 헤더가 없으면 직접 채널 모드로 이동
          const mainArea = shadowRoot.querySelector('#cp-main-area');
          if (mainArea) {
            import('./channelMode.js').then((module) => {
              module.renderChannelMode(mainArea);
            });
            window.__cp_active_mode = 'channel';
          }
        }
      }
      fixBtn.disabled = false;
      fixBtn.textContent = getFixButtonText(checkId);
    } else {
      fixBtn.disabled = false;
      fixBtn.textContent = getFixButtonText(checkId);
      addLog('info', `${checkId} 항목은 수동으로 해결해야 합니다.`);
    }
  }

  // 경고/실패 항목에 자동 수정 버튼 연결
  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('fix-btn')) {
      const checkItem = e.target.closest('.check-item');
      if (checkItem) {
        const checkId = checkItem.dataset.checkId;
        // 모든 fix-btn 클릭 시 handleAutoFix 호출
        handleAutoFix(checkId);
      }
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
