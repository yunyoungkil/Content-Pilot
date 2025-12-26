// js/services/migrationService.js
// 데이터 마이그레이션 관련 서비스

import { getDb, getCurrentUserId } from './firebaseService.js';
import { ref, get, update, set, remove } from './firebaseService.js';
import { Logger } from '../utils.js';
import { performanceOptimizer } from './performanceOptimizer.js';

/**
 * 데이터 마이그레이션 함수 (REST API 버전)
 * channelId가 없는 기존 데이터를 안전하게 마이그레이션합니다.
 *
 * @param {string} userId - 사용자 ID
 * @param {string|null} targetChannelId - 타겟 채널 ID (null이면 자동 결정)
 * @returns {Promise<{success: boolean, message: string, updatedCount?: number}>}
 */
export async function runDataMigration(userId, targetChannelId = null, options = {}) {
  const { dryRun = false, collections = null, debug = false } = options;
  const collectionsDesc = Array.isArray(collections)
    ? collections.length === 0
      ? 'ALL (empty array -> all)'
      : collections.join(',')
    : 'ALL (no filter)';
  Logger.info(`[Migration] collections filter: ${collectionsDesc}`);
  Logger.info(
    `🔁 [Migration] runDataMigration 호출 (dryRun=${dryRun}) - userId: ${userId}, targetChannelId: ${targetChannelId}`
  );

  // 백업 경로 생성 (타임스탬프 기반)
  const timestamp = Date.now();
  const backupPath = `backup/${timestamp}`;
  let backupData = {};
  let rollbackNeeded = false;

  try {
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

    // Determine target channel object and host (for host-based classification)
    let targetChannelObj = null;
    if (finalTargetChannelId) {
      let blogList = myBlogs || [];
      if (!Array.isArray(blogList) && typeof blogList === 'object') {
        blogList = Object.values(blogList);
      }
      for (const b of blogList) {
        const genId =
          b?.id ||
          (b?.apiUrl ? btoa((b.apiUrl || b.inputUrl).replace(/\/$/, '')).replace(/=/g, '') : null);
        if (genId === finalTargetChannelId) {
          targetChannelObj = b;
          break;
        }
      }
    }
    const targetChannelHost = (() => {
      try {
        const url = targetChannelObj?.inputUrl || targetChannelObj?.apiUrl || null;
        if (!url) return null;
        const u = new URL(url);
        return u.host;
      } catch (e) {
        return null;
      }
    })();

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

    // 백업 데이터를 Firebase에 저장 (dryRun이면 저장하지 않음)
    if (Object.keys(backupData).length > 0) {
      if (!dryRun) {
        await set(ref(getDb(), backupPath), backupData);
        Logger.info(`📦 [Backup] 데이터 백업 완료 (경로: ${backupPath})`);
        rollbackNeeded = true;
      } else {
        Logger.info('[Backup] Dry-run 모드: 백업을 생성하지 않습니다.');
      }
    } else {
      Logger.info('[Backup] 백업할 데이터가 없습니다.');
    }

    // ========== [마이그레이션 단계] ==========
    // 먼저 총 데이터 수 계산 (진행률 계산용)
    let totalItems = 0;
    const itemsToMigrate = [];
    // distribution: record current channelId counts per group
    const distribution = {
      kanban: {},
      kanban_inprogress: {},
      kanban_done: {},
      scraps: {},
      ideas: {},
      channel_content: {},
    };
    const distributionAll = {
      kanban: {},
      kanban_inprogress: {},
      kanban_done: {},
      scraps: {},
      ideas: {},
      channel_content: {},
    };

    // 헬퍼: 객체에서 채널 ID를 재귀적으로 탐색해 반환
    const findChannelIdInObject = (obj, depth = 0) => {
      if (!obj || depth > 8) return null;
      if (typeof obj !== 'object') return null;

      // direct channelId
      if (Object.prototype.hasOwnProperty.call(obj, 'channelId')) {
        const v = obj.channelId;
        if (v !== undefined && v !== null && v !== '') return v;
      }

      // channel can be an object with id or a plain id value
      if (Object.prototype.hasOwnProperty.call(obj, 'channel')) {
        const c = obj.channel;
        if (typeof c === 'string' && c) return c;
        if (c && typeof c === 'object') {
          if (c.id) return c.id;
        }
      }

      // publishInfo.channelId common path
      if (obj.publishInfo && obj.publishInfo.channelId) return obj.publishInfo.channelId;

      // nested search
      for (const key of Object.keys(obj)) {
        try {
          const value = obj[key];
          if (!value) continue;
          if (typeof value === 'object') {
            const sub = findChannelIdInObject(value, depth + 1);
            if (sub) return sub;
          }
          // arrays
          if (Array.isArray(value)) {
            for (const item of value) {
              if (typeof item === 'object') {
                const found = findChannelIdInObject(item, depth + 1);
                if (found) return found;
              }
            }
          }
        } catch (e) {
          // ignore circular or unexpected data
        }
      }
      return null;
    };

    const extractUrlsFromObject = (obj, depth = 0, found = []) => {
      if (!obj || depth > 8) return found;
      try {
        if (typeof obj === 'string') {
          const s = obj.trim();
          if (/^https?:\/\//i.test(s)) found.push(s);
        } else if (Array.isArray(obj)) {
          for (const item of obj) extractUrlsFromObject(item, depth + 1, found);
        } else if (typeof obj === 'object') {
          for (const k of Object.keys(obj)) extractUrlsFromObject(obj[k], depth + 1, found);
        }
      } catch (e) {
        // ignore
      }
      return found;
    };

    const getHostFromUrlString = (urlStr) => {
      try {
        const u = new URL(urlStr);
        return u.host;
      } catch (e) {
        return null;
      }
    };

    // 칸반 데이터 카운트 및 수집
    const addedScrapIds = new Set(); // prevent duplicate counting for scraps referenced from kanban
    for (const status in kanban) {
      for (const id in kanban[status]) {
        const card = kanban[status][id];
        const chId = findChannelIdInObject(card);
        const distKey = status === 'ideas' ? 'ideas' : 'kanban';
        // overall distribution - counts for all kanban items
        distributionAll[distKey][String(chId)] = (distributionAll[distKey][String(chId)] || 0) + 1;

        // Track specific statuses in overall distribution as well
        if (status === 'in-progress') {
          distributionAll.kanban_inprogress[String(chId)] =
            (distributionAll.kanban_inprogress[String(chId)] || 0) + 1;
        } else if (status === 'done') {
          distributionAll.kanban_done[String(chId)] =
            (distributionAll.kanban_done[String(chId)] || 0) + 1;
        }

        if (!chId) {
          // status가 'ideas'인 경우 별도 타입으로 분류하여 보고
          const type = status === 'ideas' ? 'ideas' : 'kanban';

          // Only include when collections not supplied or this type is selected
          let isSelected = false;
          if (!Array.isArray(collections) || collections.length === 0) {
            isSelected = true;
          } else {
            if (collections.includes(type)) isSelected = true;
            if (type === 'kanban') {
              if (status === 'in-progress' && collections.includes('kanban_inprogress'))
                isSelected = true;
              if (status === 'done' && collections.includes('kanban_done')) isSelected = true;
            }
          }

          if (isSelected) {
            itemsToMigrate.push({ type, status, id, card });
            // Count distribution only for candidates
            distribution[distKey][String(chId)] = (distribution[distKey][String(chId)] || 0) + 1;
            // also track by status-specific distribution
            if (status === 'in-progress') {
              distribution.kanban_inprogress[String(chId)] =
                (distribution.kanban_inprogress[String(chId)] || 0) + 1;
            } else if (status === 'done') {
              distribution.kanban_done[String(chId)] =
                (distribution.kanban_done[String(chId)] || 0) + 1;
            }
            totalItems++;
          } else {
            // collection not selected -> skip adding as itemToMigrate
          }
          // linkedScraps resolution: if this card links to scraps by ID, resolve them and include them
          try {
            const linked = card?.linkedScraps || card?.workspace?.linkedScraps || null;
            let links = [];
            if (linked) {
              if (Array.isArray(linked)) links = linked;
              else if (typeof linked === 'object') links = Object.keys(linked);
            }
            for (const scrapId of links) {
              if (!scrapId) continue;
              if (addedScrapIds.has(scrapId)) continue;
              const linkedScrap = scraps[scrapId];
              if (!linkedScrap) continue;
              const linkedChannelId = findChannelIdInObject(linkedScrap) ?? null;
              // overall distribution for linked scraps
              distributionAll.scraps[String(linkedChannelId)] =
                (distributionAll.scraps[String(linkedChannelId)] || 0) + 1;
              if (!linkedChannelId) {
                if (
                  !Array.isArray(collections) ||
                  collections.length === 0 ||
                  collections.includes('scraps') ||
                  (targetChannelHost &&
                    extractUrlsFromObject(linkedScrap).some(
                      (u) => getHostFromUrlString(u) === targetChannelHost
                    ))
                ) {
                  itemsToMigrate.push({
                    type: 'scraps',
                    id: scrapId,
                    scrap: linkedScrap,
                    viaKanban: `${status}/${id}`,
                  });
                  distribution.scraps[String(linkedChannelId)] =
                    (distribution.scraps[String(linkedChannelId)] || 0) + 1;
                  totalItems++;
                  addedScrapIds.add(scrapId);
                }
              } else if (debug) {
                Logger.debug(
                  `[Migration] Skipping linked scrap: scraps/${userId}/${scrapId} - channelId: ${linkedChannelId}`
                );
              }
            }
          } catch (e) {
            // ignore resolution errors
          }
        } else {
          // Item already has a channelId. If finalTargetChannelId is specified and differs,
          // include the item as a re-assignment candidate so admin can migrate from
          // one channel to another.
          if (finalTargetChannelId && chId !== finalTargetChannelId) {
            // [Modified] Only include if host matches target channel host
            const hasMatchingHost =
              targetChannelHost &&
              extractUrlsFromObject(card).some(
                (u) => getHostFromUrlString(u) === targetChannelHost
              );

            if (hasMatchingHost) {
              const type = status === 'ideas' ? 'ideas' : 'kanban';
              let isSelected = false;
              if (!Array.isArray(collections) || collections.length === 0) {
                isSelected = true;
              } else {
                if (collections.includes(type)) isSelected = true;
                if (type === 'kanban') {
                  if (status === 'in-progress' && collections.includes('kanban_inprogress'))
                    isSelected = true;
                  if (status === 'done' && collections.includes('kanban_done')) isSelected = true;
                }
              }

              if (isSelected) {
                itemsToMigrate.push({ type, status, id, card, currentChannelId: chId });
                distribution[distKey][String(chId)] =
                  (distribution[distKey][String(chId)] || 0) + 1;
                if (status === 'in-progress') {
                  distribution.kanban_inprogress[String(chId)] =
                    (distribution.kanban_inprogress[String(chId)] || 0) + 1;
                } else if (status === 'done') {
                  distribution.kanban_done[String(chId)] =
                    (distribution.kanban_done[String(chId)] || 0) + 1;
                }
                totalItems++;
              }
            }
          } else if (debug) {
            Logger.debug(
              `[Migration] Skipping kanban item: kanban/${userId}/${status}/${id} - channelId: ${chId}`
            );
          }
        }
      }
    }

    // 스크랩 데이터 카운트 및 수집
    for (const id in scraps) {
      if (addedScrapIds.has(id)) continue; // skip scraps already included from linkedScraps
      const scrap = scraps[id];
      const scrapChannelId = findChannelIdInObject(scrap) ?? null;
      // overall distribution for scraps
      distributionAll.scraps[String(scrapChannelId)] =
        (distributionAll.scraps[String(scrapChannelId)] || 0) + 1;
      if (!scrapChannelId) {
        // [Fix] Only include if host matches target channel host (even for unassigned scraps)
        const hasMatchingHost =
          targetChannelHost &&
          extractUrlsFromObject(scrap).some((u) => getHostFromUrlString(u) === targetChannelHost);

        if (hasMatchingHost) {
          if (
            !Array.isArray(collections) ||
            collections.length === 0 ||
            collections.includes('scraps')
          ) {
            itemsToMigrate.push({ type: 'scraps', id, scrap });
            distribution.scraps[String(scrapChannelId)] =
              (distribution.scraps[String(scrapChannelId)] || 0) + 1;
            totalItems++;
          }
        }
      } else {
        // If the scrap already has a channelId but differs from target, include as candidate
        if (finalTargetChannelId && scrapChannelId !== finalTargetChannelId) {
          // [Modified] Only include if host matches target channel host
          const hasMatchingHost =
            targetChannelHost &&
            extractUrlsFromObject(scrap).some((u) => getHostFromUrlString(u) === targetChannelHost);

          if (hasMatchingHost) {
            if (
              !Array.isArray(collections) ||
              collections.length === 0 ||
              collections.includes('scraps')
            ) {
              itemsToMigrate.push({
                type: 'scraps',
                id,
                scrap,
                currentChannelId: scrapChannelId,
              });
              distribution.scraps[String(scrapChannelId)] =
                (distribution.scraps[String(scrapChannelId)] || 0) + 1;
              totalItems++;
            }
          }
        } else if (debug) {
          Logger.debug(
            `[Migration] Skipping scrap: scraps/${userId}/${id} - channelId: ${scrapChannelId}`
          );
        }
      }
    }

    // channel_content 데이터 카운트 및 수집 (nested collections like blogs)
    const contentSnap = await get(ref(getDb(), `channel_content/${userId}`));
    const channelContent = contentSnap?.val() || {};
    // channelContent may be nested like { blogs: { id1: {...}, id2: {...} }, youtubes: {...} }
    for (const collectionKey of Object.keys(channelContent)) {
      const collectionVal = channelContent[collectionKey];
      if (collectionVal && typeof collectionVal === 'object' && !Array.isArray(collectionVal)) {
        // Determine if this is a nested collection (mapping of id->item)
        const candidateKeys = Object.keys(collectionVal);
        const looksLikeMap =
          candidateKeys.length > 0 &&
          candidateKeys.every((k) => typeof collectionVal[k] === 'object');
        if (looksLikeMap) {
          // It's a nested collection (e.g., blogs: { ct1: {...} })
          for (const cid of Object.keys(collectionVal)) {
            const contentItem = collectionVal[cid];
            const contentChannelId = findChannelIdInObject(contentItem) ?? null;
            // overall distribution for channel_content (nested)
            distributionAll.channel_content[String(contentChannelId)] =
              (distributionAll.channel_content[String(contentChannelId)] || 0) + 1;
            if (!contentChannelId) {
              // [Fix] Only include if host matches target channel host
              const hasMatchingHost =
                targetChannelHost &&
                extractUrlsFromObject(contentItem).some(
                  (u) => getHostFromUrlString(u) === targetChannelHost
                );

              if (hasMatchingHost) {
                if (
                  !Array.isArray(collections) ||
                  collections.length === 0 ||
                  collections.includes('channel_content')
                ) {
                  itemsToMigrate.push({
                    type: 'channel_content',
                    collection: collectionKey,
                    id: cid,
                    contentItem,
                  });
                  distribution.channel_content[String(contentChannelId)] =
                    (distribution.channel_content[String(contentChannelId)] || 0) + 1;
                  totalItems++;
                }
              } else if (debug) {
                Logger.debug(
                  `[Migration] Skipping channel_content (no host match): channel_content/${userId}/${collectionKey}/${cid}`
                );
              }
            } else {
              // contentItem already has channelId; include if it differs from final target
              if (debug)
                Logger.debug(
                  `[Migration] nested content: target=${finalTargetChannelId}, contentChannelId=${contentChannelId}`
                );
              if (finalTargetChannelId && contentChannelId !== finalTargetChannelId) {
                // [Modified] Only include if host matches target channel host
                const hasMatchingHost =
                  targetChannelHost &&
                  extractUrlsFromObject(contentItem).some(
                    (u) => getHostFromUrlString(u) === targetChannelHost
                  );

                if (hasMatchingHost) {
                  if (
                    !Array.isArray(collections) ||
                    collections.length === 0 ||
                    collections.includes('channel_content')
                  ) {
                    itemsToMigrate.push({
                      type: 'channel_content',
                      collection: collectionKey,
                      id: cid,
                      contentItem,
                      currentChannelId: contentChannelId,
                    });
                    distribution.channel_content[String(contentChannelId)] =
                      (distribution.channel_content[String(contentChannelId)] || 0) + 1;
                    totalItems++;
                  }
                }
              } else {
                // host-match fallback removed to respect collection filter
                if (debug) {
                  Logger.debug(
                    `[Migration] Skipping channel_content: channel_content/${userId}/${collectionKey}/${cid} - channelId: ${contentChannelId}`
                  );
                }
              }
            }
          }
          // end for (cid)
        } else {
          // It's a single content item object — treat collectionKey as id
          const contentItem = collectionVal;
          const contentChannelId = findChannelIdInObject(contentItem) ?? null;
          // overall distribution for channel_content (single)
          distributionAll.channel_content[String(contentChannelId)] =
            (distributionAll.channel_content[String(contentChannelId)] || 0) + 1;
          if (!contentChannelId) {
            // [Fix] Only include if host matches target channel host
            const hasMatchingHost =
              targetChannelHost &&
              extractUrlsFromObject(contentItem).some(
                (u) => getHostFromUrlString(u) === targetChannelHost
              );

            if (hasMatchingHost) {
              if (
                !Array.isArray(collections) ||
                collections.length === 0 ||
                collections.includes('channel_content')
              ) {
                itemsToMigrate.push({
                  type: 'channel_content',
                  collection: null,
                  id: collectionKey,
                  contentItem,
                });
                distribution.channel_content[String(contentChannelId)] =
                  (distribution.channel_content[String(contentChannelId)] || 0) + 1;
                totalItems++;
              }
            }
          } else if (finalTargetChannelId && contentChannelId !== finalTargetChannelId) {
            // item already has channelId but differs from the final target, include as reassignment candidate
            if (
              !Array.isArray(collections) ||
              collections.length === 0 ||
              collections.includes('channel_content')
            ) {
              itemsToMigrate.push({
                type: 'channel_content',
                collection: null,
                id: collectionKey,
                contentItem,
                currentChannelId: contentChannelId,
              });
              distribution.channel_content[String(contentChannelId)] =
                (distribution.channel_content[String(contentChannelId)] || 0) + 1;
              totalItems++;
            }
          } else if (debug) {
            Logger.debug(
              `[Migration] Skipping channel_content: channel_content/${userId}/${collectionKey} - channelId: ${contentChannelId}`
            );
          } else {
            if (targetChannelHost) {
              const urls = extractUrlsFromObject(contentItem);
              const matched = urls.some((u) => getHostFromUrlString(u) === targetChannelHost);
              if (matched) {
                itemsToMigrate.push({
                  type: 'channel_content',
                  collection: null,
                  id: collectionKey,
                  contentItem,
                });
                totalItems++;
              }
            }
          }
        }
      } else {
        // Primitive or non-object value, treat collectionKey as id
        const contentItem = collectionVal;
        const contentChannelId = findChannelIdInObject(contentItem) ?? null;
        // overall distribution should track all items for channel_content
        distributionAll.channel_content[String(contentChannelId)] =
          (distributionAll.channel_content[String(contentChannelId)] || 0) + 1;
        if (!contentChannelId) {
          if (!Array.isArray(collections) || collections.includes('channel_content')) {
            itemsToMigrate.push({
              type: 'channel_content',
              collection: null,
              id: collectionKey,
              contentItem,
            });
            totalItems++;
          }
        } else if (finalTargetChannelId && contentChannelId !== finalTargetChannelId) {
          if (!Array.isArray(collections) || collections.includes('channel_content')) {
            itemsToMigrate.push({
              type: 'channel_content',
              collection: null,
              id: collectionKey,
              contentItem,
              currentChannelId: contentChannelId,
            });
            distribution.channel_content[String(contentChannelId)] =
              (distribution.channel_content[String(contentChannelId)] || 0) + 1;
            totalItems++;
          }
        } else {
          // host-match fallback removed to respect collection filter
          if (debug) {
            Logger.debug(
              `[Migration] Skipping channel_content: channel_content/${userId}/${collectionKey} - channelId: ${contentChannelId}`
            );
          }
        }
      }
    }

    Logger.info(`[Migration] 총 ${totalItems}개 데이터 마이그레이션 예정`);
    Logger.info(`[Migration] 분포: ${JSON.stringify(distribution)}`);

    if (totalItems === 0) {
      Logger.info('[Migration] 마이그레이션할 데이터가 없습니다.');
      // Prepare groups for dry-run response even when totalItems==0
      const groupsEmpty = {
        kanban: { count: 0, sample: [] },
        scraps: { count: 0, sample: [] },
        ideas: { count: 0, sample: [] },
        channel_content: { count: 0, sample: [] },
      };
      if (dryRun) {
        return {
          success: true,
          message: '마이그레이션할 데이터가 없습니다.',
          updatedCount: 0,
          dryRunResult: {
            totalItems: 0,
            groups: groupsEmpty,
            distribution,
            overallDistribution: distributionAll,
          },
        };
      }
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
    let failedCount = 0;

    for (const item of itemsToMigrate) {
      // dryRun인 경우는 변환 대상만 수집하고 DB 변경은 하지 않음
      if (dryRun) {
        processedCount++;
        updatedCount++;
        continue;
      }
      try {
        if (item.type === 'kanban' || item.type === 'ideas') {
          const updates = {
            channelId: finalTargetChannelId,
          };
          // [Fix] publishInfo가 있는 경우 내부 channelId도 함께 업데이트 (스키마 일관성)
          if (item.card && item.card.publishInfo) {
            updates['publishInfo/channelId'] = finalTargetChannelId;
          }
          await update(ref(getDb(), `kanban/${userId}/${item.status}/${item.id}`), updates);
        } else if (item.type === 'scraps') {
          await update(ref(getDb(), `scraps/${userId}/${item.id}`), {
            channelId: finalTargetChannelId,
          });
        } else if (item.type === 'channel_content') {
          const updates = {
            channelId: finalTargetChannelId,
          };
          if (item.contentItem && item.contentItem.publishInfo) {
            updates['publishInfo/channelId'] = finalTargetChannelId;
          }
          // support nested collection path if provided
          if (item.collection) {
            await update(
              ref(getDb(), `channel_content/${userId}/${item.collection}/${item.id}`),
              updates
            );
          } else {
            await update(ref(getDb(), `channel_content/${userId}/${item.id}`), updates);
          }
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
        failedCount++;
        processedCount++;
        // 개별 항목 실패는 계속 진행 (throw 제거)
      }
    }

    Logger.info(`✅ [Migration] 완료: 총 ${updatedCount}개 성공, ${failedCount}개 실패`);

    // 마이그레이션 완료 상태 저장 (일회성 실행 보장)
    if (!dryRun) {
      await chrome.storage.local.set({ migration_completed: true });
      // [Fix] 마이그레이션 후 칸반 캐시 무효화 (UI 즉시 반영)
      try {
        await performanceOptimizer.invalidateCache('kanban');
        Logger.info('[Migration] 칸반 캐시 무효화 완료');
      } catch (e) {
        Logger.warn('[Migration] 칸반 캐시 무효화 실패:', e);
      }
    }

    // 성공 시 백업 데이터는 유지 (수동 복구 가능하도록)
    Logger.info(`[Backup] 마이그레이션 성공. 백업 데이터는 ${backupPath}에 보관됩니다.`);

    // dryRun인 경우 결과를 각 항목 표본과 함께 반환
    if (dryRun) {
      // group counts and sample ids by type
      const groups = {
        kanban: { count: 0, statuses: { 'in-progress': 0, done: 0 } },
        scraps: { count: 0 },
        ideas: { count: 0 },
        channel_content: { count: 0 },
      };
      itemsToMigrate.forEach((it) => {
        if (!groups[it.type]) groups[it.type] = { count: 0, sample: [] };
        groups[it.type].count += 1;
        if (it.type === 'kanban' && it.status) {
          groups.kanban.statuses[it.status] = (groups.kanban.statuses[it.status] || 0) + 1;
        }
      });

      return {
        success: true,
        message: `Dry-run: 총 ${totalItems}개 항목이 마이그레이션 후보입니다.`,
        updatedCount: totalItems,
        dryRunResult: {
          totalItems,
          groups,
          distribution,
          overallDistribution: distributionAll,
        },
      };
    }

    return {
      success: true,
      message: `마이그레이션 완료: 총 ${updatedCount}개 성공, ${failedCount}개 실패`,
      updatedCount,
      failedCount,
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
export async function checkMigrationNeeded(_userId) {
  // 체크 로직은 제거 — 마이그레이션은 비활성화된 상태
  return {
    success: true,
    needsMigration: false,
    needed: false,
    count: 0,
    reason: 'migration_disabled',
  };
}

/**
 * 채널 ID 변경에 따른 연관 데이터(칸반, 스크랩) 일괄 마이그레이션
 * @param {string} oldId - 변경 전 채널 ID
 * @param {string} newId - 변경 후 채널 ID
 */
export async function migrateChannelIdCascade(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;

  const userId = await getCurrentUserId();
  Logger.info(
    `[Migration] 채널 ID 변경 감지: ${oldId} -> ${newId}. 연관 데이터 이관을 시작합니다.`
  );

  try {
    const updates = {};
    let migrationCount = 0;

    // 1. 칸반 데이터 스캔 (ideas, in-progress, done)
    const kanbanStatuses = ['ideas', 'in-progress', 'done'];

    for (const status of kanbanStatuses) {
      const path = `kanban/${userId}/${status}`;
      const snapshot = await get(ref(getDb(), path));
      const data = snapshot.val() || {};

      Object.entries(data).forEach(([cardId, card]) => {
        // channelId가 oldId와 일치하는 카드 찾기
        if (card.channelId === oldId) {
          // Firebase Multi-location Update 문법 사용
          updates[`kanban/${userId}/${status}/${cardId}/channelId`] = newId;
          migrationCount++;
        }
      });
    }

    // 2. 스크랩 데이터 스캔
    const scrapPath = `scraps/${userId}`;
    const scrapSnapshot = await get(ref(getDb(), scrapPath));
    const scrapData = scrapSnapshot.val() || {};

    Object.entries(scrapData).forEach(([scrapId, scrap]) => {
      // channelId가 oldId와 일치하는 스크랩 찾기
      if (scrap.channelId === oldId) {
        updates[`scraps/${userId}/${scrapId}/channelId`] = newId;
        migrationCount++;
      }
    });

    // 3. channel_content 데이터 스캔 (support nested collections like blogs)
    const contentPath = `channel_content/${userId}`;
    const contentSnapshot = await get(ref(getDb(), contentPath));
    const contentData = contentSnapshot.val() || {};
    Object.keys(contentData).forEach((key) => {
      const val = contentData[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        // nested collection (e.g., blogs)
        Object.keys(val).forEach((cid) => {
          const content = val[cid];
          if (content && content.channelId === oldId) {
            updates[`channel_content/${userId}/${key}/${cid}/channelId`] = newId;
            migrationCount++;
          }
        });
      } else {
        // direct content entry
        const content = val;
        if (content && content.channelId === oldId) {
          updates[`channel_content/${userId}/${key}/channelId`] = newId;
          migrationCount++;
        }
      }
    });

    // 3. 일괄 업데이트 실행
    if (migrationCount > 0) {
      // 루트 경로에서 업데이트 실행 (매우 효율적)
      await update(ref(getDb(), '/'), updates);
      Logger.biz(
        `✅ [Migration] 채널 데이터 이관 완료: 총 ${migrationCount}개의 항목이 업데이트되었습니다.`
      );
      return { success: true, count: migrationCount };
    } else {
      Logger.info('[Migration] 이관할 연관 데이터가 없습니다.');
      return { success: true, count: 0 };
    }
  } catch (error) {
    Logger.error('[Migration] 데이터 이관 중 오류 발생:', error);
    return { success: false, error: error.message };
  }
}
