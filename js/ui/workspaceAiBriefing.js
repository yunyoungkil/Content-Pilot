import { Logger, showToast } from '../utils.js';

// Lightweight helper module for AI briefing UI and request logic.
// Extracted from workspaceMode so it can be lazy-loaded when needed.

function _hasBriefing(ideaData) {
  if (!ideaData) return false;
  return (
    (Array.isArray(ideaData.outline) && ideaData.outline.length > 0) ||
    (Array.isArray(ideaData.mainKeywords) && ideaData.mainKeywords.length > 0) ||
    (Array.isArray(ideaData.longTailKeywords) && ideaData.longTailKeywords.length > 0) ||
    (Array.isArray(ideaData.tags) && ideaData.tags.length > 1)
  );
}

export async function ensureBriefingForIdea(ideaData = {}) {
  try {
    const isTrackingOnly = ideaData.origin?.type === 'tracking_only';
    const hasBriefing = _hasBriefing(ideaData);

    if (isTrackingOnly || !ideaData.title || hasBriefing || (ideaData.tags && ideaData.tags.length > 1)) {
      Logger.debug('[AI-Briefing] skipping request — isTrackingOnly:', isTrackingOnly, 'hasBriefing:', hasBriefing);
      return false;
    }

    Logger.debug(`[AI-Briefing] request - cardId: ${ideaData.id}, title: ${ideaData.title}`);
    try {
      const sm = chrome.runtime.sendMessage({
        action: 'generate_idea_briefing',
        data: {
          cardId: ideaData.id,
          title: ideaData.title,
          description: ideaData.description || '',
          generateMainKeywords: true,
          generateOutline: true,
          generateKeywords: true,
          generateLongTail: true,
        },
      });
      if (sm && typeof sm.catch === 'function') sm.catch((err) => Logger.warn('[AI-Briefing] request failed:', err));
    } catch (e) {
      // tests may use callback-style sendMessage — ignore synchronous exceptions
      Logger.debug('[AI-Briefing] sendMessage threw (ignored):', e?.message || e);
    }

    return true;
  } catch (e) {
    Logger.warn('[AI-Briefing] ensureBriefingForIdea error:', e && e.message ? e.message : e);
    return false;
  }
}

export function buildBriefingMetaHtml(ideaData = {}) {
  // Build the short badge / status HTML for the workspace right-panel.
  // Keep the structure compatible with existing tests and allow richer rendering
  // inside the lazy module if needed in the future.
  try {
    const draftObj = ideaData.workspace?.draft || ideaData.draft || null;
    const cardLevelStatus = ideaData.briefingStatus ?? null;
    const cardLevelProgress = typeof ideaData.briefingProgress === 'number' ? ideaData.briefingProgress : null;
    const bs = cardLevelStatus ?? (draftObj && draftObj.briefingStatus);
    const progressValue = cardLevelProgress ?? (draftObj && draftObj.briefingProgress);

    if (!bs) return '';

    let bsHtml = '';
    switch (bs) {
      case 'queued':
        bsHtml = `<span class="briefing-status-badge queued" title="AI 브리핑 대기 중">⏳ 브리핑 대기</span>`;
        break;
      case 'processing':
        if (progressValue !== null && typeof progressValue === 'number') {
          bsHtml = `
            <span class="briefing-status-badge processing" title="AI 브리핑 생성 중 - ${progressValue}%">
              <span class="briefing-spinner">🔄</span>
              <span class="briefing-progress-label">브리핑 생성 중 (${progressValue}%)</span>
              <div class="briefing-progress-wrap"><div class="briefing-progress-bar" style="width: ${progressValue}%"></div></div>
            </span>`;
        } else {
          bsHtml = `<span class="briefing-status-badge processing" title="AI 브리핑 생성 중">🔄 브리핑 생성 중...</span>`;
        }
        break;
      case 'done':
        bsHtml = `<span class="briefing-status-badge done" title="AI 브리핑 완료">✅ 브리핑 완료</span>`;
        break;
      case 'failed': {
        const errMsg = (draftObj?.briefingError || ideaData.briefingError || '브리핑 실패');
        bsHtml = `<span class="briefing-status-badge failed" title="${errMsg}">❌ 브리핑 실패</span>`;
        bsHtml += ` <button class="workspace-briefing-retry-btn" data-card-id="${ideaData.id || ''}" data-status="${ideaData.status || 'ideas'}">↻ 재시도</button>`;
        break;
      }
      default:
        break;
    }

    if (bsHtml) return `<div class="workspace-briefing-meta">${bsHtml}</div>`;
    return '';
  } catch (e) {
    Logger.warn('[AI-Briefing] buildBriefingMetaHtml failed:', e && e.message ? e.message : e);
    return '';
  }
}

export default {
  ensureBriefingForIdea,
  buildBriefingMetaHtml,
};
