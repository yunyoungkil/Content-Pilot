import { Logger } from '../utils.js';

// Builds the AI briefing content HTML for the workspace right panel.
export function buildAiBriefingHtml(ideaData = {}) {
  try {
    const mainKeywordsHtml =
      ideaData.mainKeywords?.length > 0
        ? ideaData.mainKeywords.map((k) => `<span class="tag main-keyword-tag interactive-tag">🔑 ${k}</span>`).join('')
        : (ideaData.tags?.length > 0
          ? ideaData.tags.filter((t) => t !== '#AI-추천').map((k) => `<span class="tag interactive-tag">${k}</span>`).join('')
          : '<span>주요 키워드 없음</span>');

    const longTailHtml =
      ideaData.longTailKeywords?.length > 0
        ? ideaData.longTailKeywords.map((k) => `<span class="tag long-tail-keyword interactive-tag">${k}</span>`).join('')
        : '<span>롱테일 키워드 없음</span>';

    // Also include outline summary when available
    const outlineHtml = ideaData.outline?.length > 0
      ? `<ul class="briefing-outline">${ideaData.outline.map((item, i) => `<li data-index="${i}">${item}</li>`).join('')}</ul>`
      : '<div class="briefing-outline-empty">추천 목차가 없습니다.</div>';

    const panelHtml = `
      <div class="ai-briefing-panel">
        <div class="ai-briefing-section ai-main-keywords">
          <div style="font-weight:600; font-size:13px; margin-bottom:6px;">🔑 주요 키워드</div>
          <div class="keyword-list">${mainKeywordsHtml}</div>
        </div>
        <div style="height:8px"></div>
        <div class="ai-briefing-section ai-longtail">
          <div style="font-weight:600; font-size:13px; margin-bottom:6px;">🔎 롱테일 키워드</div>
          <div class="keyword-list">${longTailHtml}</div>
        </div>
        <div style="height:8px"></div>
        <div class="ai-briefing-section ai-outline">
          <div style="font-weight:600; font-size:13px; margin-bottom:6px;">📄 추천 목차</div>
          ${outlineHtml}
        </div>
      </div>`;

    return panelHtml;
  } catch (e) {
    Logger.warn('[AI-Briefing-Panel] build failed:', e && e.message ? e.message : e);
    return '';
  }
}

export default { buildAiBriefingHtml };
