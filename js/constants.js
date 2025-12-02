// 상수 관리 파일
// 예: 모드 이름, CSS 클래스, 이벤트 이름 등

export const MODES = {
  SCRAPBOOK: 'scrapbook',
  KANBAN: 'kanban',
  DRAFT: 'draft',
};

// Firebase 데이터베이스 컬렉션 경로
export const COLLECTIONS = {
  KANBAN: 'kanban',
  SCRAPS: 'scraps',
  CHANNELS: 'channels',
  CHANNEL_CONTENT: 'channel_content',
  CHANNEL_META: 'channel_meta',
  THUMBNAIL_TEMPLATES: 'thumbnail_templates',
  AFFILIATE_LINKS: 'affiliate_links',
  THUMBNAILS_STORAGE: 'thumbnails', // Storage 경로
};

// 칸반 보드 상태 (컬럼)
export const KANBAN_STATUS = {
  IDEAS: 'ideas',
  IN_PROGRESS: 'in-progress',
  DONE: 'done',
  PUBLISHED: 'published',
};

// AI 모델 버전 (중앙 관리)
export const AI_MODELS = {
  TEXT: 'gemini-2.0-flash', // 텍스트 생성용 최신 모델
  // [수정] 이미지 생성 가능한 최신 Gemini 2.0 모델로 변경
  IMAGE: 'gemini-2.0-flash-exp',
  VISION: 'gemini-2.0-flash', // 이미지 분석용 멀티모달 모델
};

// 뷰 모드
export const VIEW_MODES = {
  DASHBOARD: 'dashboard',
  KANBAN: 'kanban',
  SCRAPBOOK: 'scrapbook',
  CHANNELS: 'channels',
  PERFORMANCE: 'performance',
  ADMIN: 'admin',
};

export const CLASSNAMES = {
  PANEL: 'content-pilot-panel',
  HEADER: 'content-pilot-header',
  // ...추가
};

export const EVENTS = {
  TOGGLE_PANEL: 'cp-toggle-panel',
  // ...추가
};

// 사용자 관련 상수
export const USER_ID = 'default_user';

// 앱 기본 정보
export const APP_CONFIG = {
  APP_NAME: 'Content Pilot',
  VERSION: '1.0.0',
  USER_ID: 'yunyoungkil', // 개발/테스트용 고정 ID (배포 시 동적 처리 필요)
};

// 제한 설정
export const LIMITS = {
  MAX_SCRAPS: 100,
  MAX_HISTORY: 50,
  ITEMS_PER_PAGE: 5, // 대시보드 페이지네이션용
};
