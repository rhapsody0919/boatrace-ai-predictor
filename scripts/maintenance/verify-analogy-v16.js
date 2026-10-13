/**
 * BOA-271 アナロジー・ファインダー v16 の夜の確認（tasks T5-3・T3-3。plan「夜の確認」、data-acquisition.md の完了の定義）。
 * Nightly DB Verify（JST 3:00）が実行し、失敗を Slack に流す。本番 DB は読み取りだけ（--cleanup のときだけ Storage を消す）。
 *
 * 前日（JST）の開催レース（中止を除く）について数える:
 *   - 出走表の段: racecard の snapshot があり、締切前に作られた割合（閾値 99%）。欠場が分かったレースは分母から除く
 *   - 展示後の段: 6艇の展示タイムがそろったレースのうち、exhibition の snapshot が締切前に作られた割合（閾値 95%）、
 *     並べ直しが厳密だった割合（参考）
 * まだ一度も snapshot が無い（公開前・朝のバッチの起動前）ときは「未稼働」として通す（毎晩の誤報を出さない）。
 * 展示後の段の Cron がまだ一度も書いていないときは、展示後の段の閾値を見ない。
 *
 * --cleanup: Storage の非公開のバケット analogy-v16 の、7日より前の日付の similar/（候補ファイル）と、前日より前の
 *   similar-display/（候補の表示用の値。展示後の段がその日のうちに1回読むだけ）と pool/（母集団の展示の値。同じ）を消す
 *   （plan「Storage」）。龍神ソナーの表示用のファイル（SONAR_KINDS）と STEP4 の元のレースの一覧（BOA-823・833）は
 *   2年（SONAR_KEEP_DAYS）より前を消す（BOA-807）。消したあと、全バケットの容量の合計を1行出し、
 *   STORAGE_WARN_BYTES（80GB）を超えたら失敗にして Slack に流す
 * --date YYYY-MM-DD: 数える日（省略時は前日）
 *
 * 使い方: node --env-file=.env.local scripts/maintenance/verify-analogy-v16.js [--date 2026-10-05] [--cleanup]
 */
import {
  deadlineOf,
  deleteObjects,
  BUCKET,
  listBuckets,
  listObjects,
  readObject,
  rest,
  UpstreamError,
  writeObject,
} from "../../api/_lib/analogyV16.js";
import { SONAR_KEEP_DAYS } from "../../src/utils/analogyRetention.js";

export const RACECARD_MIN = 0.99;
export const EXHIBITION_MIN = 0.95;
export const KEEP_SIMILAR_DAYS = 7;
/**
 * 龍神ソナーの表示用のファイルと STEP4 の元のレースの一覧は2年（SONAR_KEEP_DAYS）で消す（BOA-807、2026-10-13 オーナー決定）。
 * 画面の「この日の龍神ソナーはもう無い」の判定も同じ定数（src/utils/analogyRetention.js）
 */
export const SONAR_KINDS = [
  "facts",
  "today",
  "today-exhibition",
  "scenario",
  "scenario-boat",
  "similar-racecard",
  "similar-exhibition",
  "layer",
  "scenario-races",
  "scenario-boat-races",
];
/** 消すフォルダと残す日数 */
export const CLEANUP = [
  ["similar", KEEP_SIMILAR_DAYS],
  ["similar-display", 1],
  ["pool", 1],
  ...SONAR_KINDS.map((kind) => [kind, SONAR_KEEP_DAYS]),
];
/** 毎晩見るのは、残す日数の境目から前のこの日数だけ（消し終えた古い日を毎晩見直さない。休んだ夜があっても拾える長さ） */
export const CLEANUP_LOOKBACK_DAYS = 30;
/** Storage の合計がこれを超えたら失敗にして Slack に流す（Supabase Pro の 100GB の手前、BOA-807） */
export const STORAGE_WARN_BYTES = 80e9;
/** analogy-v16 の日ごとの大きさの控え（毎晩全部を数え直すと、2年分で数万回の一覧の取得になるため） */
const USAGE_LEDGER = "_usage/days.json.gz";
/** 日ごとの大きさは、この日数より新しい日だけ毎晩数え直す（similar・similar-display が消えて小さくなる間） */
export const USAGE_RECOUNT_DAYS = 9;
/** 1回の削除の要求に入れるパスの数（scenario-boat-races は1日 1,000個を超える） */
const DELETE_CHUNK = 500;

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const jstDate = (d) =>
  new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (date, n) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

/**
 * 1日分の数（純粋関数）
 * @returns {{eligible:number, racecard:number, racecardOnTime:number, exhEligible:number, exhibition:number,
 *   exhibitionOnTime:number, exact:number, missingRacecard:string[], missingExhibition:string[]}}
 */
export function summarizeDay(races, snaps, exh, entries) {
  const absent = new Set(
    [...exh, ...entries].filter((r) => r.is_absent).map((r) => r.race_id),
  );
  const timed = new Map();
  for (const r of exh)
    if (r.exhibition_time !== null && !r.is_absent)
      timed.set(r.race_id, (timed.get(r.race_id) ?? 0) + 1);
  const snap = new Map(snaps.map((s) => [`${s.race_id}|${s.stage}`, s]));
  const onTime = (s, race) => {
    const d = deadlineOf(race);
    return s && d !== null && new Date(s.computed_at).getTime() < d.getTime();
  };
  const out = {
    eligible: 0,
    racecard: 0,
    racecardOnTime: 0,
    exhEligible: 0,
    exhibition: 0,
    exhibitionOnTime: 0,
    exact: 0,
    missingRacecard: [],
    missingExhibition: [],
  };
  for (const race of races) {
    if (race.cancellation_status || absent.has(race.race_id)) continue;
    out.eligible += 1;
    const rc = snap.get(`${race.race_id}|racecard`);
    if (rc) out.racecard += 1;
    else out.missingRacecard.push(race.race_id);
    if (onTime(rc, race)) out.racecardOnTime += 1;
    if (timed.get(race.race_id) === 6 && rc) {
      out.exhEligible += 1;
      const ex = snap.get(`${race.race_id}|exhibition`);
      if (ex) out.exhibition += 1;
      else out.missingExhibition.push(race.race_id);
      if (onTime(ex, race)) out.exhibitionOnTime += 1;
      if (ex?.exact) out.exact += 1;
    }
  }
  return out;
}

/** 残す日数を過ぎた日付のフォルダ（`YYYY-MM-DD`）を選ぶ。境目から CLEANUP_LOOKBACK_DAYS 日前までだけ（純粋関数） */
export function datesToClean(folders, today, keepDays = KEEP_SIMILAR_DAYS) {
  const limit = addDays(today, -keepDays);
  const from = addDays(limit, -CLEANUP_LOOKBACK_DAYS);
  return folders.filter(
    (f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f < limit && f >= from,
  );
}

/** 日ごとの大きさの控えのうち、数え直す日（控えに無い日と、新しい USAGE_RECOUNT_DAYS 日）（純粋関数） */
export function datesToMeasure(ledger, folders, today) {
  const recent = addDays(today, -USAGE_RECOUNT_DAYS);
  return folders.filter(
    (f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && (!(f in ledger) || f >= recent),
  );
}

/** 控えから、もう無い日を外す（純粋関数） */
export const pruneLedger = (ledger, folders) =>
  Object.fromEntries(
    Object.entries(ledger).filter(([d]) => folders.includes(d)),
  );

/** Storage の容量の1行（純粋関数）。80GB を超えたら警告の文も返す */
export function usageLine(byBucket, warnBytes = STORAGE_WARN_BYTES) {
  const gb = (b) => (b / 1e9).toFixed(2);
  const total = Object.values(byBucket).reduce((a, b) => a + b, 0);
  const parts = Object.entries(byBucket)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${gb(v)}GB`);
  return {
    line: `💾 Storage 合計 ${gb(total)}GB（${parts.join("・")}）`,
    warn:
      total > warnBytes
        ? `Storage の合計 ${gb(total)}GB が ${gb(warnBytes)}GB を超えた（Pro の 100GB の手前）。残す日数（SONAR_KEEP_DAYS）か保存の中身を見直す`
        : null,
  };
}

const dateFolders = async () =>
  (await listObjects("")).filter((r) => r.id === null).map((r) => r.name);

/** 1つのフォルダの中で同時に潜るフォルダの数（全部を同時に潜ると Storage が HTTP 429 を返した） */
export const SIZE_PARALLEL = 8;

/** ファイルの大きさ。無ければ例外（0 と数えると合計を少なく見積もり、80GB の警告が出なくなる） */
const fileSize = (prefix, r) => {
  const n = r.metadata?.size;
  if (typeof n !== "number")
    throw new UpstreamError(`storage ${prefix}${r.name}: metadata.size が無い`);
  return n;
};

/** prefix の下のファイルの大きさの合計。フォルダは SIZE_PARALLEL 個ずつ並べて潜る（順に潜ると1日分で約80秒かかった） */
export async function sizeOf(prefix, bucket = BUCKET) {
  const rows = await listObjects(prefix, bucket);
  let sum = rows
    .filter((r) => r.id !== null)
    .reduce((a, r) => a + fileSize(prefix, r), 0);
  const dirs = rows.filter((r) => r.id === null);
  for (let i = 0; i < dirs.length; i += SIZE_PARALLEL)
    for (const n of await Promise.all(
      dirs
        .slice(i, i + SIZE_PARALLEL)
        .map((r) => sizeOf(`${prefix}${r.name}/`, bucket)),
    ))
      sum += n;
  return sum;
}

/** 全バケットの容量。analogy-v16 は日ごとの控えで数え、それ以外（小さい）は毎晩全部を数える */
async function storageUsage(today) {
  const folders = (await dateFolders()).filter((f) =>
    /^\d{4}-\d{2}-\d{2}$/.test(f),
  );
  const ledger = pruneLedger((await readObject(USAGE_LEDGER)) ?? {}, folders);
  for (const d of datesToMeasure(ledger, folders, today))
    ledger[d] = await sizeOf(`${d}/`);
  await writeObject(USAGE_LEDGER, ledger, { upsert: true });
  const byBucket = {};
  for (const id of await listBuckets())
    byBucket[id] =
      id === BUCKET
        ? Object.values(ledger).reduce((a, v) => a + v, 0)
        : await sizeOf("", id);
  return byBucket;
}

async function cleanup(today) {
  const top = await dateFolders();
  let n = 0;
  for (const [kind, keep] of CLEANUP) {
    for (const date of datesToClean(top, today, keep)) {
      for (const run of (await listObjects(`${date}/`)).filter(
        (r) => r.id === null,
      )) {
        const files = await listObjects(`${date}/${run.name}/${kind}/`);
        const paths = files
          .filter((f) => f.id !== null)
          .map((f) => `${date}/${run.name}/${kind}/${f.name}`);
        for (let i = 0; i < paths.length; i += DELETE_CHUNK)
          await deleteObjects(paths.slice(i, i + DELETE_CHUNK));
        n += paths.length;
      }
    }
  }
  return n;
}

const pct = (a, b) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`);

async function main() {
  const today = jstDate(new Date());
  const date = argOf("--date") ?? addDays(today, -1);
  const ever = await rest("analogy_v16_snapshots?select=stage&limit=1");
  if (ever.length === 0) {
    console.log("ℹ️ analogy_v16_snapshots が0行（v16 は未稼働）。数えない");
  } else {
    const like = encodeURIComponent(`${date}-*`);
    const [races, snaps, exhEver] = await Promise.all([
      rest(
        `races?race_date=eq.${date}&select=race_id,race_date,start_time,cancellation_status`,
      ),
      rest(
        `analogy_v16_snapshots?race_id=like.${like}&select=race_id,stage,status,exact,computed_at`,
      ),
      rest("analogy_v16_snapshots?stage=eq.exhibition&select=race_id&limit=1"),
    ]);
    const ids = races.map((r) => r.race_id).join(",") || "none";
    const [exh, entries] = await Promise.all([
      rest(
        `exhibition_data?race_id=in.(${ids})&select=race_id,boat_number,exhibition_time,is_absent`,
      ),
      rest(
        `race_entries?race_id=in.(${ids})&is_absent=is.true&select=race_id,is_absent`,
      ),
    ]);
    const s = summarizeDay(races, snaps, exh, entries);
    console.log(
      `${date}: 出走表の段 ${s.racecard}/${s.eligible}（${pct(s.racecard, s.eligible)}、締切前 ${pct(s.racecardOnTime, s.eligible)}）` +
        `、展示後の段 ${s.exhibition}/${s.exhEligible}（締切前 ${pct(s.exhibitionOnTime, s.exhEligible)}、厳密 ${pct(s.exact, s.exhibition)}）`,
    );
    const problems = [];
    if (s.eligible > 0 && s.racecardOnTime / s.eligible < RACECARD_MIN)
      problems.push(
        `出走表の段が締切前にそろったのは ${pct(s.racecardOnTime, s.eligible)}（閾値 ${RACECARD_MIN * 100}%）。欠け: ${s.missingRacecard.slice(0, 10).join(",")}`,
      );
    if (
      exhEver.length > 0 &&
      s.exhEligible > 0 &&
      s.exhibitionOnTime / s.exhEligible < EXHIBITION_MIN
    )
      problems.push(
        `展示後の段が締切前にそろったのは ${pct(s.exhibitionOnTime, s.exhEligible)}（閾値 ${EXHIBITION_MIN * 100}%）。欠け: ${s.missingExhibition.slice(0, 10).join(",")}`,
      );
    if (problems.length) {
      console.error(`❌ ${problems.join("\n❌ ")}`);
      process.exitCode = 1;
    }
  }
  if (argv.includes("--cleanup")) {
    console.log(
      `🧹 similar/（${KEEP_SIMILAR_DAYS}日より前）・similar-display/・pool/（前日より前）・龍神ソナーの表示用と元のレースの一覧（${SONAR_KEEP_DAYS}日より前）を ${await cleanup(today)} 件消した`,
    );
    const { line, warn } = usageLine(await storageUsage(today));
    console.log(line);
    if (warn) {
      console.error(`❌ ${warn}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("❌", e.message ?? e);
    process.exit(1);
  });
}
