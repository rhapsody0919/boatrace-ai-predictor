// 選手プロフィール・期別成績の取得の、選手ごとの処理・同時の着手・結果の要約（racerProfileSync.js の runRacerProfileSync から分けた）。
// 取得・保存の関数は run.io で受け取る（racerProfileSync.js を import すると循環になるため）。
//
// run（runRacerProfileSync が作る、1回の実行の状態）:
//   client・options・log・logError・sleep・now・shouldStop・startedAt・fetchOptions・maxMs
//   population（登録番号の昇順）・registered（登録済みの Map）
//   profile・season（数え。createSyncCounters）
//   state（連続失敗・中断の旗・再開位置。createSyncState）
//   io: { scrapeProfile, saveNewProfile, scrapeSeasonStatsWithRetry, saveSeasonStats, toSeasonStatsRow,
//         isSeasonRowUnchanged, notFound（RACER_PAGE_NOT_FOUND）, abortAfter（ABORT_AFTER_CONSECUTIVE_FAILURES） }

/** プロフィール・期別成績の数え（初期値） */
export function createSyncCounters() {
  return {
    profile: {
      successCount: 0,
      failCount: 0,
      saveErrorCount: 0, // 取得・解析はできたがDBへの保存に失敗した件数（常に異常として扱う）
      failedRacerIds: [],
    },
    season: {
      successCount: 0, // 書き込んだ件数（dry-runでは書く予定の件数）
      unchangedCount: 0, // 既存値と同じため書かなかった件数
      noDataCount: 0, // ページはあるが集計期間内データが無い（新人選手等）
      notFoundCount: 0, // 公式サイトがこの登録番号のページ自体が存在しないと返した（引退・登録抹消等と推定。BOA-376）
      failCount: 0,
      failedRacerIds: [],
    },
  };
}

/** 連続失敗・中断の旗・再開位置（初期値） */
export function createSyncState() {
  return {
    consecutiveSeasonFailures: 0,
    stoppedEarly: false,
    aborted: false,
    nextOffset: null,
    nextIndex: 0,
    stopped: false,
    deadlineStopped: false,
  };
}

/** 対象の選手数の行 */
export function populationLogLine(options, population, registered, recentIds) {
  return (
    `対象racer_id数: ${population.length}件` +
    `（登録済み${registered.size}件・直近${options.recentDays}日の出走${recentIds.size}件` +
    `${options.racerIds ? "・racer-ids指定" : ""}${options.limit ? `・limit=${options.limit}` : ""}` +
    `${options.offset ? `・offset=${options.offset}` : ""}）`
  );
}

function recordSeasonFailure(run, racerId, progress, message) {
  run.season.failCount++;
  run.season.failedRacerIds.push(racerId);
  run.logError(`${progress} racer_id=${racerId} [season] 失敗: ${message}`);
}

// 新規選手のプロフィールの取得・保存の結果を数えて出す。プロフィールを持てたら true
// （scraped が null なら取得失敗。saveError は保存したときのエラー。dry-run・保存の成功は null）
function recordProfileResult(run, racerId, progress, result) {
  const { profile, log } = run;
  const { scraped, failureMessage, saveError } = result;
  if (!scraped) {
    profile.failCount++;
    profile.failedRacerIds.push(racerId);
    log(
      `${progress} racer_id=${racerId} [profile] 取得失敗（スキップ）: ${failureMessage}`,
    );
    return false;
  }
  if (run.options.dryRun) {
    profile.successCount++;
    log(
      `${progress} racer_id=${racerId} [profile] → ${scraped.name} 生年月日=${scraped.birthDate} (dry-run)`,
    );
    return true;
  }
  if (saveError) {
    profile.failCount++;
    profile.saveErrorCount++;
    profile.failedRacerIds.push(racerId);
    run.logError(
      `${progress} racer_id=${racerId} [profile] 保存エラー: ${saveError.message}`,
    );
    return false;
  }
  profile.successCount++;
  log(
    `${progress} racer_id=${racerId} [profile] → ${scraped.name} 生年月日=${scraped.birthDate}`,
  );
  return true;
}

// 期別成績の取得の結果を数えて出す。書く行があれば返す（無ければ null）
function recordSeasonStats(
  run,
  racerId,
  progress,
  seasonStats,
  failureMessage,
) {
  const { season, options, log } = run;
  if (!seasonStats) {
    recordSeasonFailure(run, racerId, progress, failureMessage);
    return null;
  }
  if (seasonStats === run.io.notFound) {
    // 公式サイトが「この登録番号は存在しない」ページを返した（引退・登録抹消等と推定。
    // BOA-376）。取得・解析の失敗ではないため recordSeasonFailure は呼ばない
    season.notFoundCount++;
    if (options.verbose)
      log(
        `${progress} racer_id=${racerId} [season] 公式サイトにページが存在しない（引退・登録抹消等と推定）`,
      );
    return null;
  }
  if (seasonStats.abilityIndex === null && seasonStats.starts === null) {
    season.noDataCount++;
    if (options.verbose)
      log(
        `${progress} racer_id=${racerId} [season] 集計期間内データ無し（新人選手等）`,
      );
    return null;
  }
  const row = run.io.toSeasonStatsRow(
    seasonStats,
    new Date(run.now()).toISOString(),
  );
  if (run.io.isSeasonRowUnchanged(run.registered.get(racerId), row)) {
    season.unchangedCount++;
    if (options.verbose)
      log(
        `${progress} racer_id=${racerId} [season] 変更なし（書き込みスキップ）`,
      );
    return null;
  }
  if (options.dryRun) {
    season.successCount++;
    log(
      `${progress} racer_id=${racerId} [season] 能力指数=${seasonStats.abilityIndex} F=${seasonStats.flyingCount} 期=${seasonStats.periodLabel} (dry-run、書き込みなし)`,
    );
    return null;
  }
  return row;
}

// 期別成績の保存の結果を数えて出す
function recordSeasonSave(run, racerId, progress, seasonStats, error) {
  if (error) {
    recordSeasonFailure(run, racerId, progress, `保存エラー: ${error.message}`);
    return;
  }
  run.season.successCount++;
  if (run.options.verbose)
    run.log(
      `${progress} racer_id=${racerId} [season] 能力指数=${seasonStats.abilityIndex} F=${seasonStats.flyingCount}`,
    );
}

// 選手1人分の処理。同時数（options.concurrency）が1なら、従来の逐次の処理と同じ順序・同じ待機。
// await はこの関数の中だけに置く（同時の処理の交互の順を、分ける前と同じにするため）
async function processRacer(run, i) {
  const { population, profile, season, state, options, io } = run;
  const racerId = population[i];
  const progress = `[${i + 1}/${population.length}]`;
  const isNewProfile = !run.registered.has(racerId);
  let hasProfile = !isNewProfile;

  // 1. 新規選手のみ: 基本プロフィール取得（FR-5）
  if (isNewProfile) {
    let scraped = null;
    let failureMessage =
      "プロフィールページが存在しない、または生年月日が取得できない";
    try {
      scraped = await io.scrapeProfile(racerId, run.fetchOptions);
    } catch (err) {
      failureMessage = err.message;
    }
    let saveError = null;
    if (scraped && !options.dryRun) {
      const { error } = await io.saveNewProfile(run.client, scraped);
      saveError = error;
    }
    hasProfile = recordProfileResult(run, racerId, progress, {
      scraped,
      failureMessage,
      saveError,
    });
    await run.sleep(options.delayMs);
  }

  // 2. 全選手（プロフィールが存在する場合のみ）: 期別成績取得（FR-2）
  //    無効なracer_idへの無駄なリクエストを避けるため、プロフィール未確認の選手はスキップする
  if (hasProfile) {
    const failuresBefore = season.failCount;
    let seasonStats = null;
    let failureMessage = "期別成績ページを取得・解析できない";
    try {
      seasonStats = await io.scrapeSeasonStatsWithRetry(
        racerId,
        run.fetchOptions,
      );
    } catch (err) {
      failureMessage = err.message;
    }
    const row = recordSeasonStats(
      run,
      racerId,
      progress,
      seasonStats,
      failureMessage,
    );
    if (row) {
      const { error } = await io.saveSeasonStats(run.client, racerId, row);
      recordSeasonSave(run, racerId, progress, seasonStats, error);
    }

    await run.sleep(options.delayMs);

    // 成功・変更なし・データ無しのいずれかで連続失敗はリセットする
    state.consecutiveSeasonFailures =
      season.failCount > failuresBefore
        ? state.consecutiveSeasonFailures + 1
        : 0;
    if (state.consecutiveSeasonFailures >= io.abortAfter) {
      state.aborted = true;
      state.nextOffset = options.offset + i + 1;
      return;
    }
  }

  if ((i + 1) % 50 === 0 || i === population.length - 1) {
    run.log(
      `${progress} profile成功: ${profile.successCount}件/失敗: ${profile.failCount}件, ` +
        `season書込: ${season.successCount}件/変更なし: ${season.unchangedCount}件/データ無し: ${season.noDataCount}件/ページ不在: ${season.notFoundCount}件/失敗: ${season.failCount}件`,
    );
  }
}

// 対象を、登録番号の昇順に、同時 options.concurrency で処理する。次の1人に着手する前に、中断の条件
// （時間予算・ソフトデッドライン・連続失敗）を確認する。着手は昇順で、着手した選手は、中断の後も最後まで処理する
// （途中で捨てない）ため、処理した選手は、常に「先頭から nextIndex 人」の欠けのない範囲になる。
// これを、チャンクの再開位置（processedPrefix・lastProcessedRacerId）にする
async function worker(run) {
  const { state, options, population } = run;
  for (;;) {
    if (state.stopped || state.aborted) return;
    const i = state.nextIndex;
    if (i >= population.length) return;
    if (run.maxMs !== null && run.now() - run.startedAt > run.maxMs) {
      state.stoppedEarly = true;
      state.nextOffset = options.offset + i;
      state.stopped = true;
      run.log(`時間予算（${options.maxMinutes}分）に達したため中断します。`);
      return;
    }
    if (run.shouldStop()) {
      state.deadlineStopped = true;
      state.stopped = true;
      return;
    }
    state.nextIndex++;
    await processRacer(run, i);
  }
}

/** 同時 options.concurrency で全員を処理する */
export async function runSyncWorkers(run) {
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          Math.max(1, run.options.concurrency),
          run.population.length,
        ),
      },
      () => worker(run),
    ),
  );
}

/** 実行の要約（last_report・レポートの JSON） */
export function buildSyncSummary(run, eligibleCount) {
  const { options, population, state, profile, season } = run;
  const processedPrefix = state.nextIndex;
  return {
    executedAt: new Date(run.now()).toISOString(),
    durationSeconds: Math.round((run.now() - run.startedAt) / 1000),
    mode: options.racerIds ? "racer_ids" : "all",
    options: {
      racerIds: options.racerIds,
      limit: options.limit,
      offset: options.offset,
      recentDays: options.recentDays,
    },
    targetCount: population.length,
    registeredCount: run.registered.size,
    resumed: options.afterRacerId !== null,
    stoppedEarly: state.stoppedEarly,
    deadlineStopped: state.deadlineStopped,
    aborted: state.aborted,
    nextOffset: state.nextOffset,
    // チャンク処理の再開位置: 先頭から連続して処理を終えた選手数と、その最後の登録番号。
    // remaining は、このチャンクの後にまだ処理していない選手数（0なら最後まで処理済み）
    processedPrefix,
    lastProcessedRacerId:
      processedPrefix > 0 ? population[processedPrefix - 1] : null,
    remaining: Math.max(0, eligibleCount - processedPrefix),
    profile,
    season,
  };
}

/** 完了の行を出す */
export function logSyncCompletion(run, verdict) {
  const { profile, season, log } = run;
  log("");
  log("=== 完了 ===");
  log(
    `[profile] 成功: ${profile.successCount}件, 失敗（除外）: ${profile.failCount}件`,
  );
  log(
    `[season] 書き込み: ${season.successCount}件, 変更なし: ${season.unchangedCount}件, データ無し: ${season.noDataCount}件, ページ不在: ${season.notFoundCount}件, 失敗: ${season.failCount}件`,
  );
  if (season.failedRacerIds.length > 0)
    log(`[season] 失敗した登録番号: ${season.failedRacerIds.join(",")}`);
  if (!verdict.ok) {
    run.logError(`実行を失敗として扱います: ${verdict.reasons.join(" / ")}`);
  }
}
