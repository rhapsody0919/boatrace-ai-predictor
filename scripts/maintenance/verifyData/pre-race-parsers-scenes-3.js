/**
 * verify-pre-race-parsers.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-pre-race-parsers.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as cheerio from "cheerio";
import * as realListParser from "../../lib/raceListParser.js";
import { run as runRaceInfo } from "../../daily/update-race-info.js";
import { createDb, withFetch } from "./pre-race-parsers-fakes.js";
import { BEFORE_FILES } from "./pre-race-parsers-scenes-1.js";
import { NEW_ENTRY_KEYS, NEW_CONDITION_KEYS, LEGACY_ENTRY_KEYS, jstDate, hmOf } from "./pre-race-parsers-scenes-2.js";

let check, show, same, readFixture, LIST_FILES;

/** 元の verify の1つの塊 { } を割った 1/4 */
function scene1() {
  const listHtml = readFixture("raceInfo", LIST_FILES.absent);
  const beforeHtml = readFixture("beforeinfo", BEFORE_FILES.absent);
  const fixtureTimes = realListParser
    .parseRaceListPage(listHtml)
    .deadlines.map((d) => d.time);
  const RACE_IDS = fixtureTimes.map(
    (_, i) => `2026-09-16-23-${String(i + 1).padStart(2, "0")}`,
  );
  /** DBの状態（races の start_time）から、getRaceSchedule() と同じ形のスケジュールを作る。12Rは発走60分前 */
  const buildSchedule = (db, nowMs) =>
    db.state.tables.races.map((r, i) => ({
      race_id: r.race_id,
      venue_code: 23,
      race_no: i + 1,
      start_time:
        i === 11
          ? new Date(nowMs + 60 * 60 * 1000)
          : jstDate(r.start_time.slice(0, 5)),
    }));
  const seedRaces = (nowMs) =>
    RACE_IDS.map((race_id, i) => ({
      race_id,
      // 朝の値。8Rだけ、公式の締切予定時刻（12:05）と1分違う（12:04）
      start_time:
        i === 11
          ? `${hmOf(new Date(nowMs + 60 * 60 * 1000))}:00`
          : `${i === 7 ? "12:04" : fixtureTimes[i]}:00`,
      cancellation_status: null,
      cancellation_check_streak: 0,
      race_grade: "ippan",
    }));
  /** 出走表のHTMLは、締切予定時刻の行を「12Rは今から60分後、8Rだけ公式が朝より1分遅い」に書き換える */
  const nowMs = Date.now();
  const listWithDeadlines = (() => {
    const $ = cheerio.load(listHtml);
    const times = fixtureTimes.map((t, i) =>
      i === 11 ? hmOf(new Date(nowMs + 60 * 60 * 1000)) : t,
    );
    $(".table1")
      .filter((_, el) =>
        $(el).find("tbody td").first().text().includes("締切予定時刻"),
      )
      .find("tbody tr")
      .first()
      .find("td")
      .slice(1)
      .each((i, td) => $(td).text(times[i]));
    return $.html();
  })();
  const handler = (url) =>
    url.includes("/racelist?")
      ? listWithDeadlines
      : url.includes("/beforeinfo?")
        ? beforeHtml
        : null;
  const keysOf = (db, table) =>
    db.state.upserts
      .filter((u) => u.table === table)
      .flatMap((u) => u.rows.map((r) => Object.keys(r)));
  const runA1 = (db, options = {}) =>
    withFetch(handler, () =>
      runRaceInfo(buildSchedule(db, nowMs), "2026-09-16", {
        client: db,
        ...options,
      }),
    );
  return { seedRaces, nowMs, keysOf, runA1 };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
async function scene2({ seedRaces, nowMs, keysOf, runA1 }) {
  // 未適用（081なし）: 旧実装と同じ列だけを書き、壊れない
  {
    const db = createDb({
      tables: { races: seedRaces(nowMs) },
      missing: {
        race_entries: NEW_ENTRY_KEYS,
        race_conditions: NEW_CONDITION_KEYS,
      },
    });
    const result = await runA1(db);
    const entryKeys = keysOf(db, "race_entries");
    const allowed = new Set([...LEGACY_ENTRY_KEYS, "updated_at"]);
    check(
      "A1（081未適用）: race_entries に旧実装と同じ列だけを書く（新しい列を含めない）",
      result.updated === true &&
        entryKeys.length === 6 &&
        entryKeys.every((keys) => keys.every((k) => allowed.has(k))),
      show(entryKeys[0]),
    );
    check(
      "A1（081未適用）: race_conditions に距離・ラベルを含めない",
      keysOf(db, "race_conditions").every(
        (keys) => !keys.some((k) => NEW_CONDITION_KEYS.includes(k)),
      ) && keysOf(db, "race_conditions").length > 0,
    );
    check(
      "A1（081未適用）: 締切予定時刻が違うレース（8R: 12:04→12:05）だけ races.start_time を更新する",
      same(
        db.state.updates.filter(
          (u) => u.table === "races" && "start_time" in u.values,
        ),
        [
          {
            table: "races",
            values: { start_time: "12:05:00" },
            column: "race_id",
            value: "2026-09-16-23-08",
          },
        ],
      ) && result.deadlineUpdates === 1,
      show(db.state.updates),
    );
    // 再実行: 変更なし → 書き込み0件
    const before = db.state.upserts.length;
    const beforeUpdates = db.state.updates.length;
    await runA1(db);
    check(
      "A1（081未適用）: 再実行は書き込み0件（変更の無い行は書かない。start_time も更新済み）",
      db.state.upserts.length === before &&
        db.state.updates.length === beforeUpdates,
      `upserts +${db.state.upserts.length - before}`,
    );
  }
  return { seedRaces, nowMs, keysOf, runA1 };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
async function scene3({ seedRaces, nowMs, keysOf, runA1 }) {
  // 適用済み: 新しい列も書く。再実行は0件
  {
    const db = createDb({ tables: { races: seedRaces(nowMs) } });
    await runA1(db);
    const entryRows = db.state.upserts
      .filter((u) => u.table === "race_entries")
      .flatMap((u) => u.rows);
    check(
      "A1（081適用済み）: race_entries に登録体重・支部・出身地・F数・L数・欠場を書く",
      entryRows.length === 6 &&
        NEW_ENTRY_KEYS.every((k) => entryRows.every((r) => k in r)) &&
        same(
          entryRows.map((r) => [
            r.weight_kg,
            r.branch,
            r.hometown,
            r.f_count,
            r.l_count,
            r.is_absent,
          ]),
          [
            [55.2, "福岡", "福岡", 0, 0, true],
            [55.1, "愛知", "愛知", 1, 0, false],
            [52.2, "大阪", "大阪", 0, 0, false],
            [52.9, "兵庫", "兵庫", 0, 0, false],
            [52.5, "東京", "千葉", 0, 0, false],
            [55.6, "兵庫", "兵庫", 0, 0, false],
          ],
        ),
      show(entryRows[0]),
    );
    const cond = db.state.upserts
      .filter((u) => u.table === "race_conditions")
      .flatMap((u) => u.rows);
    check(
      "A1（081適用済み）: race_conditions に距離・ラベルを書く（ラベルなしは空配列）",
      cond.length === 1 &&
        cond[0].race_distance_m === 1800 &&
        same(cond[0].race_labels, []),
      show(cond[0]),
    );
    const before = db.state.upserts.length;
    await runA1(db);
    check(
      "A1（081適用済み）: 再実行は書き込み0件（配列・数値の比較も変更なしと判定する）",
      db.state.upserts.length === before,
      `upserts +${db.state.upserts.length - before}`,
    );
  }
  // 片方だけ適用（race_conditions の列のみ未適用）
  {
    const db = createDb({
      tables: { races: seedRaces(nowMs) },
      missing: { race_conditions: NEW_CONDITION_KEYS },
    });
    await runA1(db);
    const entryKeys = keysOf(db, "race_entries");
    check(
      "A1（race_entries の列だけ適用済み）: race_entries は新しい列を書き、race_conditions は書かない",
      entryKeys.every((keys) =>
        NEW_ENTRY_KEYS.every((k) => keys.includes(k)),
      ) &&
        keysOf(db, "race_conditions").every(
          (keys) => !keys.some((k) => NEW_CONDITION_KEYS.includes(k)),
        ),
    );
  }
  // 適用状況の確認が通信エラー → 旧形式で書く（安全側）
  {
    const db = createDb({
      tables: { races: seedRaces(nowMs) },
      throwOnProbe: true,
    });
    await runA1(db);
    const entryKeys = keysOf(db, "race_entries");
    check(
      "A1: 適用状況の確認が失敗したときは、旧形式で書く（安全側）",
      entryKeys.length === 6 &&
        entryKeys.every((keys) =>
          keys.every((k) => !NEW_ENTRY_KEYS.includes(k)),
        ),
    );
  }
  return { seedRaces, nowMs, runA1 };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
async function scene4({ seedRaces, nowMs, runA1 }) {
  // dry-run・syncDeadlines=false
  {
    const db = createDb({ tables: { races: seedRaces(nowMs) } });
    await runA1(db, { dryRun: true });
    check(
      "A1: dry-run は、DBへ書き込まない（upsert・update とも0件）",
      db.state.upserts.length === 0 && db.state.updates.length === 0,
    );
    const db2 = createDb({ tables: { races: seedRaces(nowMs) } });
    await runA1(db2, { syncDeadlines: false });
    check(
      "A1: syncDeadlines=false は、start_time を更新しない",
      db2.state.updates.every((u) => !("start_time" in u.values)),
    );
  }
}

async function scene5() {
  {
    const s1 = scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    await scene4(s3);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・readFixture・LIST_FILES） */
export async function runPreRaceParsersScenes3(env) {
  ({ check, show, same, readFixture, LIST_FILES } = env);
  await scene5();
}
