/**
 * 結果取得（A6）まわりの Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関数の組み立て）。
 * plan.md §4.1・§3.6、tasks.md T4b-02-2・T4b-05-1・T4b-05-2。
 *
 *   createResultSlotHandler   api/cron/result.js     結果のスロット（発走+5分〜+90分）を1件ずつ処理する
 *   createResultOnTick        api/cron/result.js     毎分、発走+90分を超えて結果の無いレースを、中止・順延「確定」にする
 *   createResultCatchupRun    api/cron/result-catchup.js  当日 expired になった結果の再取得・的中フラグの補完・確定の取りこぼしの補填
 *   createKFileSyncRun        api/cron/kfile-sync.js Kファイル同期（進入コース・rank4〜6）を、直近4日について1回のダウンロードで処理する
 *
 * 取得・解析・書き込みの本体は、既存の scripts/daily/scrape-results.js（runForRaces・syncKFileForDate 等）を再利用する
 * （二重実装しない。GitHub Actions・CLIの入口 run()・scrapeAndSaveResults と、解析・行の組み立て・書き込みを共有する）。
 * shadow のとき、データテーブルへは一切書かない（runForRaces・syncKFileForDate が、mode/dryRun でそれを守る。
 * ここで呼ぶ書き込み系の処理も、live のときだけ）。
 *
 * 依存（runForRaces 等）は引数で差し替えられる（scripts/maintenance/verify-scrape-result-job.js が、DB・取得先なしで検証する）。
 */
import {
  KFILE_SYNC_LOOKBACK_DAYS,
  confirmCancellationsForRaceIds,
  fetchRaceResultHtml,
  fixMissingHitFlags,
  runForRaces,
  syncKFileForDate,
} from "../../daily/scrape-results.js";
import { fetchKFileText, parseKFileRankings } from "../kfileParser.js";
import { raceStartInstant } from "./time.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

/** 結果ページの取得先の、この分数を超えても結果の無いレースを、中止・順延「確定」とみなす（BOA-254 FR2、ADR 0040） */
export const CANCELLATION_CONFIRM_AFTER_MIN = 90;

/**
 * onTick が、「発走+90分を超えたばかり」のレースを探す範囲（分）。毎分の起動で、各レースが約15回見られる。
 * 起動の未配信がこれより長く続いた場合の取りこぼしは、result-catchup（日次）が、当日の全レースについて補う
 */
export const CANCELLATION_LOOKBACK_MIN = 15;

/** race_id（YYYY-MM-DD-VV-RR）から、runForRaces に渡すレースの情報を作る。形式が不正なら例外 */
export function parseRaceId(raceId) {
  const m = RACE_ID_RE.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  return {
    race_id: raceId,
    date: m[1],
    venue_code: Number(m[2]),
    race_number: Number(m[3]),
  };
}

/** YYYY-MM-DD に日数を足す（JSTの暦日として。実行環境のタイムゾーンに依存しない） */
export function addDays(dateStr, days) {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`日付の形式が不正です: ${String(dateStr)}`);
  }
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const jstParts = (ms) => {
  const iso = new Date(ms + JST_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
};

/**
 * 「発走+graceMin分を超えて、まだ lookbackMin 分以内」のレースの、JSTの日付×発走時刻の範囲。
 * 該当のレースは start_time ∈ [now−(grace+lookback), now−grace)。日付をまたぐ場合（発走22:45＋90分＝翌00:15）は
 * 前日と当日の2つに分ける。to が null なら、その日の終わりまで。純粋関数。
 *
 * @returns {Array<{date: string, from: string, to: string|null}>}
 */
export function overdueWindows(
  now,
  {
    graceMin = CANCELLATION_CONFIRM_AFTER_MIN,
    lookbackMin = CANCELLATION_LOOKBACK_MIN,
  } = {},
) {
  const upperMs = now.getTime() - graceMin * 60 * 1000;
  const lowerMs = upperMs - lookbackMin * 60 * 1000;
  const lower = jstParts(lowerMs);
  const upper = jstParts(upperMs);
  if (lower.date === upper.date) {
    return [{ date: upper.date, from: lower.time, to: upper.time }];
  }
  return [
    { date: lower.date, from: lower.time, to: null },
    { date: upper.date, from: "00:00:00", to: upper.time },
  ];
}

// races のうち、まだ中止・順延の確定になっていないもの（NULL も含める。neq だけだと NULL の行が落ちる）
const NOT_CONFIRMED =
  "cancellation_status.is.null,cancellation_status.neq.confirmed";

/**
 * 結果のスロットのハンドラー。1スロット＝1レースの結果を、取得・解析し、live なら書き込む。
 * shadow は、取得・解析のみで、resultDigest を返す（データテーブルへは書かない）。
 *
 * ctx.politeFetch（タイムアウト・429/503のバックオフ・ブレーカー込み）で取得する。
 * outcome は runForRaces の語彙（ok / partial / no_values / skipped_have_data / error / breaker_open）。
 * ok・skipped_have_data は完了、それ以外は、次の再試行（retrySec）まで pending に戻る。
 */
export function createResultSlotHandler({ run = runForRaces } = {}) {
  return async function handleSlot(slot, ctx) {
    const race = parseRaceId(slot.race_id);
    const [result] = await run(
      [
        {
          race_id: race.race_id,
          venue_code: race.venue_code,
          race_number: race.race_number,
        },
      ],
      {
        date: race.date,
        mode: ctx.mode,
        fetchHtml: (url) => fetchRaceResultHtml(url, ctx.politeFetch),
        client: ctx.client,
        concurrency: 1,
        now: ctx.now,
      },
    );
    if (!result) {
      return { outcome: "error", error: "結果の処理結果が空でした" };
    }
    const { race_id: _raceId, ...slotResult } = result;
    return slotResult;
  };
}

/**
 * 毎分の tick のフック: 発走+90分を超えたばかりのレースのうち、結果（race_results の行）が無いものを、
 * 中止・順延「確定」にする（GitHub Actions の confirmOverdueCancellations と同じ判定）。
 *
 * スロットの取得（claim）より前に呼ばれる。claim_scrape_slots は、確定中止のレースの pending を
 * cancelled_race で終端した後に、期限+許容幅（発走+90分）を過ぎたものを expired にするため、確定が先に
 * 済んでいれば、中止・順延のレースが expired（＝取得の失敗）として通知されない。
 * live のときだけ呼ばれる（races へ書くため。cronWrapper が保証する）。
 */
export function createResultOnTick({
  confirm = confirmCancellationsForRaceIds,
} = {}) {
  return async function onTick(ctx) {
    const ids = [];
    for (const w of overdueWindows(ctx.now())) {
      let query = ctx.client
        .from("races")
        .select("race_id")
        .eq("race_date", w.date)
        .not("start_time", "is", null)
        .gte("start_time", w.from);
      if (w.to) query = query.lt("start_time", w.to);
      const { data, error } = await query.or(NOT_CONFIRMED);
      if (error) {
        throw new Error(
          `中止・順延の確定: 対象レースの取得に失敗しました: ${error.message}`,
        );
      }
      ids.push(...(data ?? []).map((r) => r.race_id));
    }
    if (ids.length === 0) return { overdue: 0, confirmed: 0 };
    const { confirmed } = await confirm(ctx.client, ids);
    return { overdue: ids.length, confirmed: confirmed.length };
  };
}

/**
 * 結果のcatch-upの run（日次。対象日 ctx.targetDate＝23:50 JST の日付）。
 *
 *   1. 対象日に expired になった結果のスロットのうち、中止・順延の確定でないレースを、再取得して補填する
 *      （live は書き込み、shadow は取得・解析のみ）
 *   2. live: 発走+90分を超えて結果の無いレースを、中止・順延「確定」にする（onTick の取りこぼしの補填。
 *      1 の再取得の後に行う＝再取得で結果が取れたレースを、中止にしない）
 *   3. live: 直近10日の的中フラグの欠落を補完する（fixMissingHitFlags。従来は結果取得のたびに行っていた重い
 *      スキャンを、日次に1回へ）
 *   4. 対象日の結果のスロットに、まだ pending・running のものがあれば incomplete（対象日を処理済みにしない）
 *      にし、00:30 JST の補足の起動がもう一度処理する（最終レースの期限は発走+90分＝翌00:15）
 *
 * 期待件数（再取得の対象数）>0 なのに、1件も取得・解析できなければ、0件エラー（共通ラッパが失敗にする）。
 */
export function createResultCatchupRun({
  run = runForRaces,
  confirm = confirmCancellationsForRaceIds,
  fixHitFlags = fixMissingHitFlags,
} = {}) {
  return async function catchup(ctx) {
    const date = ctx.targetDate;
    if (!date || !DATE_RE.test(date)) {
      throw new Error(`対象日を解決できません: ${String(date)}`);
    }
    const live = ctx.mode === "live";
    const client = ctx.client;

    // 1) expired のスロット
    const expired = await client
      .from("scrape_slots")
      .select("race_id, races(cancellation_status)")
      .eq("job", "result")
      .eq("race_date", date)
      .eq("status", "expired");
    if (expired.error) {
      throw new Error(
        `結果のcatch-up: expired のスロットの取得に失敗しました: ${expired.error.message}`,
      );
    }
    const isConfirmedCancel = (row) => {
      const race = Array.isArray(row.races) ? row.races[0] : row.races;
      return race?.cancellation_status === "confirmed";
    };
    const candidateIds = [
      ...new Set(
        (expired.data ?? [])
          .filter((row) => !isConfirmedCancel(row))
          .map((row) => row.race_id),
      ),
    ];
    const races = candidateIds.map((id) => {
      const { race_id, venue_code, race_number } = parseRaceId(id);
      return { race_id, venue_code, race_number };
    });

    let results = [];
    if (races.length > 0) {
      results = await run(races, {
        date,
        mode: ctx.mode,
        fetchHtml: (url) => fetchRaceResultHtml(url, ctx.politeFetch),
        client,
        concurrency: 4,
        now: ctx.now,
      });
    }
    const outcomes = {};
    for (const r of results)
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    const obtained = results.filter((r) =>
      ["ok", "partial", "skipped_have_data"].includes(r.outcome),
    ).length;
    const rowsWritten = results.reduce(
      (sum, r) => sum + (r.rowsWritten ?? 0),
      0,
    );
    const unresolved = results
      .filter((r) => !["ok", "skipped_have_data"].includes(r.outcome))
      .map((r) => ({ race_id: r.race_id, outcome: r.outcome, error: r.error }));

    // 2) 中止・順延の確定の取りこぼし（live のみ）
    let confirmed = 0;
    if (live) {
      const rows = await client
        .from("races")
        .select("race_id, start_time")
        .eq("race_date", date)
        .not("start_time", "is", null)
        .or(NOT_CONFIRMED);
      if (rows.error) {
        throw new Error(
          `結果のcatch-up: races の取得に失敗しました: ${rows.error.message}`,
        );
      }
      const nowMs = ctx.now().getTime();
      const overdueIds = (rows.data ?? [])
        .filter(
          (r) =>
            nowMs - raceStartInstant(date, r.start_time).getTime() >
            CANCELLATION_CONFIRM_AFTER_MIN * 60 * 1000,
        )
        .map((r) => r.race_id);
      confirmed = (await confirm(client, overdueIds)).confirmed.length;
    }

    // 3) 的中フラグの補完（live のみ）
    let hitFlags = null;
    if (live) {
      hitFlags = await fixHitFlags(addDays(date, -9), date, { client });
    }

    // 4) まだ未完了のスロット（最終レースの期限は、この起動の後）
    const open = await client
      .from("scrape_slots")
      .select("race_id")
      .eq("job", "result")
      .eq("race_date", date)
      .in("status", ["pending", "running"]);
    if (open.error) {
      throw new Error(
        `結果のcatch-up: 未完了のスロットの取得に失敗しました: ${open.error.message}`,
      );
    }
    const openSlots = open.data?.length ?? 0;

    return {
      rowsWritten: live ? rowsWritten : 0,
      rowsExpected: races.length,
      rowsParsed: obtained,
      incomplete: openSlots > 0,
      report: {
        date,
        mode: ctx.mode,
        candidates: races.length,
        outcomes,
        unresolved,
        confirmedCancellations: confirmed,
        hitFlags,
        openSlots,
      },
      body: {
        candidates: races.length,
        outcomes,
        confirmedCancellations: confirmed,
        hitFlags,
        openSlots,
      },
    };
  };
}

/**
 * Kファイル同期の run（日次。対象日 ctx.targetDate＝07:00 JST の日付＝当日。当日を除く直近
 * KFILE_SYNC_LOOKBACK_DAYS 日を、新しい日から順に処理する）。
 *
 * 各日: 進入コース・rank4〜6のどちらかに未同期のレースがあれば、その日のKファイルを1回だけダウンロードして、
 * 両方を同期する（syncKFileForDate。D4の解消）。未同期が無い日は、ダウンロードしない。
 * shadow は dryRun（Kファイルの取得・解析と、書くはずの件数の集計のみ。書き込まない）。
 *
 * 結果の扱い:
 *   error       ダウンロード失敗・未同期の確認の失敗・Kファイルからレースを1件も抽出できない（0件エラー）
 *   incomplete  未同期のレースがあるのに、Kファイルが未公開（404）。対象日を処理済みにせず、12:00 JST の補足の起動が
 *               もう一度処理する
 */
export function createKFileSyncRun({
  syncDate = syncKFileForDate,
  fetchText = fetchKFileText,
  parseRankings = parseKFileRankings,
} = {}) {
  return async function kfileSync(ctx) {
    // 動作確認（probe）: ?probeDate=YYYY-MM-DD を付けた手動リクエストは、その日のKファイルを、politeFetch で
    // ダウンロード・LZH展開・解析して、レース数を返すだけ（DBへは書かない・同期もしない）。未同期のレースが無い日は
    // 通常の実行がダウンロードしないため、Vercel関数の中でLZHの展開が動くか（plan.md U15）を、任意の日で確認できる。
    // 対象日は処理済みにしない（incomplete）
    const probeDate = ctx.query?.probeDate;
    if (probeDate !== undefined) {
      if (!DATE_RE.test(String(probeDate))) {
        throw new Error(`probeDate の形式が不正です（YYYY-MM-DD）: ${String(probeDate)}`);
      }
      const text = await fetchText(probeDate, { fetchImpl: ctx.politeFetch });
      const probe = {
        date: probeDate,
        downloaded: text !== null,
        chars: text?.length ?? 0,
        races: text ? parseRankings(text, probeDate).length : 0,
      };
      return { rowsWritten: 0, incomplete: true, body: { probe } };
    }

    const base = ctx.targetDate;
    if (!base || !DATE_RE.test(base)) {
      throw new Error(`対象日を解決できません: ${String(base)}`);
    }
    const live = ctx.mode === "live";
    const days = [];
    const problems = [];
    const unpublished = [];
    let rowsWritten = 0;
    let rowsExpected = 0;
    let rowsParsed = 0;

    for (let i = 1; i <= KFILE_SYNC_LOOKBACK_DAYS; i++) {
      const date = addDays(base, -i);
      const r = await syncDate(date, {
        dryRun: !live,
        client: ctx.client,
        fetchImpl: ctx.politeFetch,
      });
      const parts = [
        ["進入コース", r.actualCourse],
        ["rank4〜6", r.rank456],
      ];
      for (const [label, part] of parts) {
        if (
          part.status === "kfile_error" ||
          part.status === "pending_check_failed"
        ) {
          problems.push(
            `${date} ${label}: ${part.status}（${part.error ?? "理由不明"}）`,
          );
        } else if (part.status === "no_races_parsed") {
          problems.push(
            `${date} ${label}: Kファイルからレースを抽出できませんでした`,
          );
        } else if (part.status === "kfile_unavailable") {
          if (!unpublished.includes(date)) unpublished.push(date);
        }
      }
      // 0件エラーの判定: Kファイルをダウンロードできた日（synced・no_races_parsed）を期待に数え、
      // レースを抽出できた日（synced）を解析に数える
      const downloaded = parts.some(([, p]) =>
        ["synced", "no_races_parsed"].includes(p.status),
      );
      if (downloaded) {
        rowsExpected++;
        if (parts.some(([, p]) => p.status === "synced")) rowsParsed++;
      }
      if (live)
        rowsWritten += (r.actualCourse.updated ?? 0) + (r.rank456.updated ?? 0);
      days.push({
        date,
        downloads: r.downloads,
        actualCourse: {
          status: r.actualCourse.status,
          updated: r.actualCourse.updated,
        },
        rank456: {
          status: r.rank456.status,
          updated: r.rank456.updated,
          pending: r.rank456.pending,
        },
      });
    }

    const report = { base, mode: ctx.mode, days, unpublished, problems };
    if (problems.length > 0) {
      return {
        outcome: "error",
        error:
          `Kファイル同期に失敗した日があります: ${problems.join(" / ")}`.slice(
            0,
            480,
          ),
        rowsWritten,
        report,
      };
    }
    return {
      rowsWritten,
      rowsExpected,
      rowsParsed,
      incomplete: unpublished.length > 0,
      report,
      body: { days: days.length, unpublished },
    };
  };
}
