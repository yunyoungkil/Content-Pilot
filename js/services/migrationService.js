// js/services/migrationService.js
// 데이터 마이그레이션 관련 서비스

import { getDb } from './firebaseService.js';
import { ref, get, update, set, remove } from './firebaseService.js';
import { Logger } from '../utils.js';
import { getValidToken } from './authService.js';

/**
 * 데이터 마이그레이션 함수 (REST API 버전)
 * channelId가 없는 기존 데이터를 안전하게 마이그레이션합니다.
 *
 * @param {string} userId - 사용자 ID
 * @param {string|null} targetChannelId - 타겟 채널 ID (null이면 자동 결정)
 * @returns {Promise<{success: boolean, message: string, updatedCount?: number}>}
 */
export async function runDataMigration(userId, targetChannelId = null) {
  Logger.info('🚀 [Migration] 데이터 마이그레이션 시작...');

  // 백업 경로 생성 (타임스탬프 기반)
  const timestamp = Date.now();
  const backupPath = `backup/${timestamp}`;
  let backupData = {};
  let rollbackNeeded = false;

  try {
    const token = await getValidToken(false);
    if (!token) {
      Logger.warn('[Migration] 인증 토큰이 없어 마이그레이션을 건너뜁니다.');
      return { success: false, message: 'Authentication required', updatedCount: 0 };
    }
    // 1-1. 내 채널 목록 확인
    const channelsSnap = await get(ref(getDb(), `channels/${userId}/myChannels/blogs`));
    const myBlogs = channelsSnap?.val() || [];

    // 채널이 하나도 없으면 마이그레이션 불가능 (공용으로 처리하거나 중단)
    if (myBlogs.length === 0) {
      Logger.info('[Migration] 등록된 채널이 없어 마이그레이션을 건너뜁니다.');
      return { success: true, message: '등록된 채널이 없어 마이그레이션을 건너뜁니다.' };
    }

    // 1-2. 타겟 채널 결정
    // targetChannelId가 제공되지 않았을 때만 자동 결정
    let finalTargetChannelId = targetChannelId;
    if (finalTargetChannelId === null) {
      if (myBlogs.length === 1) {
        const blog = myBlogs[0];
        finalTargetChannelId =
          blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, '') : null);
        Logger.info(`[Migration] 단일 채널 감지. 타겟 ID: ${finalTargetChannelId}`);
      } else {
        // 다중 채널이고 사용자 선택이 없으면 공용으로 처리
        Logger.info(
          "[Migration] 다중 채널 감지. 사용자 선택 없음. 기존 데이터는 '공용'으로 유지합니다."
        );
        finalTargetChannelId = null;
      }
    } else {
      Logger.info(`[Migration] 사용자 선택 채널 ID: ${finalTargetChannelId}`);
    }

    // ========== [백업 단계] ==========
    Logger.info(`📦 [Backup] 데이터 백업 시작... (경로: ${backupPath})`);

    // 칸반 데이터 백업
    const kanbanSnap = await get(ref(getDb(), `kanban/${userId}`));
    const kanban = kanbanSnap?.val() || {};
    if (kanban && Object.keys(kanban).length > 0) {
      backupData.kanban = kanban;
    }

    // 스크랩 데이터 백업
    const scrapsSnap = await get(ref(getDb(), `scraps/${userId}`));
    const scraps = scrapsSnap?.val() || {};
    if (scraps && Object.keys(scraps).length > 0) {
      backupData.scraps = scraps;
    }

    // 백업 데이터를 Firebase에 저장
    if (Object.keys(backupData).length > 0) {
      await set(ref(getDb(), backupPath), backupData);
      Logger.info(`📦 [Backup] 데이터 백업 완료 (경로: ${backupPath})`);
      rollbackNeeded = true;
    } else {
      Logger.info('[Backup] 백업할 데이터가 없습니다.');
    }

    // ========== [마이그레이션 단계] ==========
    // 먼저 총 데이터 수 계산 (진행률 계산용)
    let totalItems = 0;
    const itemsToMigrate = [];

    // 칸반 데이터 카운트 및 수집
    for (const status in kanban) {
      for (const id in kanban[status]) {
        const card = kanban[status][id];
        if (card.channelId === undefined || card.channelId === null) {
          itemsToMigrate.push({ type: 'kanban', status, id, card });
          totalItems++;
        }
      }
    }

    // 스크랩 데이터 카운트 및 수집
    for (const id in scraps) {
      const scrap = scraps[id];
      if (scrap.channelId === undefined || scrap.channelId === null) {
        itemsToMigrate.push({ type: 'scraps', id, scrap });
        totalItems++;
      }
    }

    Logger.info(`[Migration] 총 ${totalItems}개 데이터 마이그레이션 예정`);

    if (totalItems === 0) {
      Logger.info('[Migration] 마이그레이션할 데이터가 없습니다.');
      // 백업 데이터 정리 (마이그레이션 불필요 시)
      if (rollbackNeeded) {
        await remove(ref(getDb(), backupPath));
        Logger.info('[Backup] 마이그레이션 불필요로 백업 데이터 정리 완료');
      }
      return { success: true, message: '마이그레이션할 데이터가 없습니다.', updatedCount: 0 };
    }

    // 1-3. 칸반 데이터 마이그레이션
    let updatedCount = 0;
    let processedCount = 0;

    for (const item of itemsToMigrate) {
      try {
        if (item.type === 'kanban') {
          await update(ref(getDb(), `kanban/${userId}/${item.status}/${item.id}`), {
            channelId: finalTargetChannelId,
          });
        } else if (item.type === 'scraps') {
          await update(ref(getDb(), `scraps/${userId}/${item.id}`), {
            channelId: finalTargetChannelId,
          });
        }

        updatedCount++;
        processedCount++;

        // 진행률 계산 및 로그 출력
        const progress = Math.round((processedCount / totalItems) * 100);
        if (processedCount % 10 === 0 || processedCount === totalItems) {
          Logger.info(`[Migration] 진행률: ${progress}% (${processedCount}/${totalItems})`);
        }
      } catch (itemError) {
        Logger.error(`[Migration] 개별 항목 처리 실패:`, itemError);
        // 개별 항목 실패는 계속 진행하되, 전체 롤백을 위해 플래그 설정
        throw new Error(`마이그레이션 중 오류 발생: ${itemError.message}`);
      }
    }

    Logger.info(`✅ [Migration] 완료: 총 ${updatedCount}개 데이터 처리됨`);

    // 마이그레이션 완료 상태 저장 (일회성 실행 보장)
    await chrome.storage.local.set({ migration_completed: true });

    // 성공 시 백업 데이터는 유지 (수동 복구 가능하도록)
    Logger.info(`[Backup] 마이그레이션 성공. 백업 데이터는 ${backupPath}에 보관됩니다.`);

    return {
      success: true,
      message: `마이그레이션 완료: 총 ${updatedCount}개 데이터 처리됨`,
      updatedCount,
      backupPath,
    };
  } catch (error) {
    Logger.error('❌ [Migration] 오류 발생:', error);

    // ========== [롤백 단계] ==========
    if (rollbackNeeded) {
      try {
        Logger.info('🔄 [Rollback] 롤백 시작...');
        const backupSnap = await get(ref(getDb(), backupPath));
        const backup = backupSnap?.val();

        if (backup) {
          // 칸반 데이터 롤백
          if (backup.kanban) {
            await set(ref(getDb(), `kanban/${userId}`), backup.kanban);
            Logger.info('[Rollback] 칸반 데이터 롤백 완료');
          }

          // 스크랩 데이터 롤백
          if (backup.scraps) {
            await set(ref(getDb(), `scraps/${userId}`), backup.scraps);
            Logger.info('[Rollback] 스크랩 데이터 롤백 완료');
          }

          Logger.info('✅ [Rollback] 롤백 완료');
        }
      } catch (rollbackError) {
        Logger.error('❌ [Rollback] 롤백 실패:', rollbackError);
        throw new Error(`마이그레이션 실패 및 롤백 실패: ${error.message}`);
      }
    }

    throw error;
  }
}

/**
 * 마이그레이션 필요 여부 확인 (상세 버전)
 * @param {string} userId - 사용자 ID
 * @returns {Promise<{success: boolean, needsMigration: boolean, reason?: string, count?: number, channelOptions?: Array}>}
 */
export async function checkMigrationNeeded(userId) {
  try {
    const token = await getValidToken(false);
    if (!token) {
      Logger.warn('[checkMigrationNeeded] 인증 토큰이 없어 체크를 건너뜁니다.');
      return { success: false, needsMigration: false, reason: 'auth_required', count: 0 };
    }
    // 1. 채널 목록 확인
    const channelsSnap = await get(ref(getDb(), `channels/${userId}/myChannels/blogs`));
    const myBlogs = channelsSnap?.val() || [];

    if (myBlogs.length === 0) {
      return {
        success: true,
        needsMigration: false,
        reason: 'no_channels',
        needed: false,
        count: 0,
      };
    }

    // 2. 고아 데이터 확인
    const kanbanSnap = await get(ref(getDb(), `kanban/${userId}`));
    const scrapsSnap = await get(ref(getDb(), `scraps/${userId}`));
    const kanban = kanbanSnap?.val() || {};
    const scraps = scrapsSnap?.val() || {};

    let orphanCount = 0;
    for (const status in kanban) {
      for (const id in kanban[status]) {
        const card = kanban[status][id];
        if (card.channelId === undefined || card.channelId === null) {
          orphanCount++;
        }
      }
    }
    for (const id in scraps) {
      const scrap = scraps[id];
      if (scrap.channelId === undefined || scrap.channelId === null) {
        orphanCount++;
      }
    }

    if (orphanCount === 0) {
      return {
        success: true,
        needsMigration: false,
        reason: 'no_orphan_data',
        needed: false,
        count: 0,
      };
    }

    // 3. 채널 개수에 따라 응답
    const channelOptions = myBlogs.map((blog) => ({
      id: blog.id || (blog.apiUrl ? btoa(blog.apiUrl).replace(/=/g, '') : ''),
      name: blog.inputUrl || blog.url || '이름 없음',
      url: blog.apiUrl || blog.url || '',
    }));

    if (myBlogs.length === 1) {
      // 단일 채널: 자동 마이그레이션 가능
      return {
        success: true,
        needsMigration: true,
        needed: true,
        count: orphanCount,
        reason: 'single_channel_auto',
        channelOptions,
        autoMigration: true,
        targetChannelId: channelOptions[0].id,
      };
    } else {
      // 다중 채널: 사용자 선택 필요
      return {
        success: true,
        needsMigration: true,
        needed: true,
        count: orphanCount,
        reason: 'multiple_channels_manual',
        channelOptions,
        autoMigration: false,
      };
    }
  } catch (error) {
    Logger.error('[checkMigrationNeeded] 오류:', error);
    return {
      success: false,
      needsMigration: false,
      needed: false,
      count: 0,
      error: error.message,
    };
  }
}
