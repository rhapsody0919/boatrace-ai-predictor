
import { addDays } from "./racerCareerSeries.js";
import {
  computeCounts,
  kbFingerprint,
  loadJudgeInputs,
  sameKbFingerprint,
  writeMeta,
} from "./racerCareerDb.js";
import { MAIN_TABLES_START } from "./kbArchiveBoundary.js";
import {
  RULE_VERSION,
  mergeCareerResult,
  chunk,
  writeCareerRows,
  laterRaceDate,
} from "./racerCareerCore.js";

export {
  computeCounts,
  existingChunkSize,
  fetchExistingKeys,
  kbFingerprint,
  loadJudgeInputs,
  OTHER_ERA_MAX_ROWS,
  PAGE_ROWS,
  sameKbFingerprint,
  writeMeta,
} from "./racerCareerDb.js";
export {
  finalStagesOf,
  gradeOverridesOf,
  halfMonthRanges,
  SERIES_GAP_DAYS,
  SPECIAL_SERIES_RULES,
  specialSeriesGroups,
  splitByRacerLinks,
  venueDayIdOf,
} from "./racerCareerSeries.js";

/**
 * main 層を計算し直す。racerIds が null なら直近（activeFrom 以降）に出た選手。
 * @param {{client: object, today: string, dryRun: boolean, racerIds?: number[]|null, activeDays?: number,
 *   batchSize?: number, shouldStop?: () => boolean, allowMassDelete?: boolean, log?: (s: string) => void}} opts
 */
export async function runMainEra({
  client,
  today,
  dryRun,
  all = false,
  activeDays = 3,
  batchSize = 50,
  shouldStop = () => false,
  allowMassDelete = false,
  resume = null,
  log = console.log,
}) {
  const startedAt = new Date().toISOString();
  const to = addDays(today, 1);
  const activeFrom = all ? MAIN_TABLES_START : addDays(today, -activeDays);
  const inputs = await loadJudgeInputs({
    client,
    era: "main",
    ranges: [{ from: MAIN_TABLES_START, to }],
    activeFrom,
  });
  const racerIds = inputs.activeRacerIds;
  log(
    `main: 対象の選手 ${racerIds.length}人（${activeFrom} 以降に出走表に載った）、優勝戦の種別 ${inputs.finalStages.length}/${inputs.stageCount}、グレードの補正 ${inputs.overrides.raceIds.length}レース`,
  );
  if (racerIds.length === 0)
    throw new Error(
      `main: ${activeFrom} 以降に出走表に載った選手が0人（出走表の取り込みが止まっている可能性）`,
    );

  const resumeAfter = mainResumeAfter(resume, today, dryRun);
  const todo = resumeAfter === null ? racerIds : racerIds.filter((id) => id > resumeAfter);
  const totals = await computeMainBatches(client, {
    todo,
    to,
    inputs,
    batchSize,
    shouldStop,
    dryRun,
    allowMassDelete,
    lastRacerId: resumeAfter,
  });
  const complete = totals.done === todo.length;
  if (complete) {
    await writeMainMeta(client, {
      startedAt,
      all,
      activeFrom,
      racerCount: racerIds.length,
      inputs,
      totals,
      dryRun,
    });
  }
  return {
    racers: racerIds.length,
    resumedAfter: resumeAfter,
    cursor: complete ? null : { date: today, dryRun, lastRacerId: totals.lastRacerId },
    done: totals.done,
    complete,
    written: totals.written,
    deleted: totals.deleted,
    rows: totals.rows,
    boatRows: totals.boatRows,
    maxRaceDate: totals.maxRaceDate,
  };
}

/** 同じ日・同じモード（shadow と live を混ぜない）の前の起動が時間切れで止まっていたら、その続きの位置（無ければ null） */
function mainResumeAfter(resume, today, dryRun) {
  return resume &&
    resume.date === today &&
    resume.dryRun === dryRun &&
    Number.isFinite(resume.lastRacerId)
    ? resume.lastRacerId
    : null;
}

/** main の選手を batchSize 人ずつ計算し直して書く。shouldStop が true になったら次の組に着手しない */
async function computeMainBatches(
  client,
  { todo, to, inputs, batchSize, shouldStop, dryRun, allowMassDelete, lastRacerId },
) {
  const totals = {
    written: 0,
    deleted: 0,
    rows: 0,
    boatRows: 0,
    maxRaceDate: null,
    done: 0,
    lastRacerId,
  };
  for (const ids of chunk(todo, batchSize)) {
    if (shouldStop()) break;
    const result = await computeCounts(client, {
      era: "main",
      from: MAIN_TABLES_START,
      to,
      racerIds: ids,
      inputs,
    });
    const acc = mergeCareerResult(new Map(), result, "main");
    const res = await writeCareerRows(client, {
      era: "main",
      acc,
      racerIds: ids,
      dryRun,
      allowMassDelete,
    });
    totals.written += res.written;
    totals.deleted += res.deleted;
    totals.rows += res.rows;
    totals.boatRows += Number(result.boat_rows ?? 0);
    totals.maxRaceDate = laterRaceDate(totals.maxRaceDate, result.max_race_date);
    totals.done += ids.length;
    totals.lastRacerId = ids.at(-1);
  }
  return totals;
}

/** 全選手を終えた main の計算の記録を書く */
async function writeMainMeta(
  client,
  { startedAt, all, activeFrom, racerCount, inputs, totals, dryRun },
) {
  // 全選手を計算し直した時刻（初回の CLI --all）は、毎晩の部分の計算で消さずに持ち越す。
  // 画面は full_computed_at が無い main 層を「未計算」として扱う
  const { data: prevMeta, error: prevErr } = await client
    .from("racer_career_meta")
    .select("report")
    .eq("era", "main")
    .maybeSingle();
  if (prevErr)
    throw new Error(`racer_career_meta の読み取りに失敗: ${prevErr.message}`);
  const fullComputedAt = all
    ? startedAt
    : (prevMeta?.report?.full_computed_at ?? null);
  await writeMeta(
    client,
    {
      era: "main",
      computed_at: startedAt,
      rule_version: RULE_VERSION,
      source_from: MAIN_TABLES_START,
      source_to: totals.maxRaceDate,
      source_rows: totals.boatRows,
      fingerprint: { racers: racerCount, all, active_from: activeFrom },
      report: {
        full_computed_at: fullComputedAt,
        overrides: inputs.overrides.report,
        final_stages: inputs.finalStages.length,
      },
    },
    { dryRun },
  );
}

/**
 * main 層の毎晩の実行（api/cron/racer-career-main.js）。共通ラッパ（cronWrapper.js）の run() の契約で返す。
 * @param {{client: object, today: string, dryRun: boolean, shouldStop?: () => boolean, log?: (s: string) => void}} opts
 */
export async function runRacerCareerMainJob({
  client,
  today,
  dryRun,
  resume = null,
  shouldStop = () => false,
  log = console.log,
}) {
  if (!client) throw new Error("Supabase のクライアントが無い");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today)))
    throw new Error(`対象日が YYYY-MM-DD ではない: ${today}`);

  const res = await runMainEra({ client, today, dryRun, shouldStop, resume, log });

  // kb 層の指紋の見張り（kb 層がまだ計算されていなければ、知らせるだけで失敗にしない）
  const { data: kbMeta, error } = await client
    .from("racer_career_meta")
    .select("fingerprint, computed_at")
    .eq("era", "kb")
    .maybeSingle();
  if (error)
    throw new Error(`racer_career_meta の読み取りに失敗: ${error.message}`);
  const now = await kbFingerprint(client);
  const kbState = !kbMeta
    ? "not_computed"
    : sameKbFingerprint(kbMeta.fingerprint, now)
      ? "same"
      : "changed";

  const report = {
    racers: res.racers,
    done: res.done,
    rows: res.rows,
    deleted: res.deleted,
    boatRows: res.boatRows,
    maxRaceDate: res.maxRaceDate,
    kb: { state: kbState, now, computedAt: kbMeta?.computed_at ?? null },
  };
  log(`racer_career_main: ${JSON.stringify(report)}`);

  if (kbState === "changed") {
    return {
      outcome: "error",
      error: `kb_archive が kb 層の計算（${kbMeta.computed_at}）の後に変わった（今 ${JSON.stringify(now)}、記録 ${JSON.stringify(kbMeta.fingerprint)}）。racer-career-backfill.js --era=kb を再実行する`,
      rowsWritten: res.written,
      report,
    };
  }
  return {
    outcome: "ok",
    rowsWritten: res.written,
    // 「変更なしで書き込み0件」は正常。集計の行が1行以上あるはずなので rowsExpected は定数 1
    rowsExpected: 1,
    rowsParsed: res.rows,
    // 時間切れで全選手を終えていなければ、補足の起動（01:00 JST）がもう一度処理する
    incomplete: !res.complete,
    // 時間切れのときだけ、続きの選手を共通ラッパの cursor に残す（同じ日の補足の起動が続きから始める）
    cursor: res.cursor,
    report,
  };
}

export {
  RULE_VERSION,
  COUNT_COLUMNS,
  CAREER_TABLES,
  MAX_STALE_RATIO,
  mergeCareerResult,
  staleRowsOf,
  chunk,
  writeCareerRows,
  runKbEra,
} from "./racerCareerCore.js";
