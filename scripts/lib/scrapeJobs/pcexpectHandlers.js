/**
 * 公式コンピュータ予想（B1、external_predictions）の Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関数の
 * 組み立て）。plan.md §4.2(c)・§3.6、tasks.md T4b-08-1・T4b-08-2。
 *
 *   createPcexpectSlotHandler   api/cron/pcexpect.js   公式予想のスロット（発走の12時間前〜30分前）を1件ずつ処理する
 *
 * 従来は、朝の初期化（morning-init.js）の中で、scrape-pcexpect.js を execSync で全レース分（実測約27分）実行していた。
 * 予定表のスロットにして、1レース1本（許容幅690分＝発走12時間前〜30分前。失敗・未公開は600秒おきに再試行）を、
 * 5分ごとの起動で最大20件（3並列）ずつ消化する。取得・解析・書き込みの本体は、既存の
 * scripts/daily/scrape-pcexpect.js（runForRaces）を再利用する（CLIと解析・行の組み立てを共有）。
 * shadow のとき、external_predictions へは一切書かず、payload のダイジェストを予定表の result_digest に記録する
 * （既存基盤が書いた payload から同じ関数で計算した値と比べる。scripts/maintenance/check-morning-init-shadow.js）。
 *
 * 依存（runForRaces・発走時刻の読み取り）は引数で差し替えられる
 * （scripts/maintenance/verify-morning-init-jobs.js が、DB・取得先なしで検証する）。
 */
import { runForRaces } from "../../daily/scrape-pcexpect.js";
import { makeFetchHtml } from "./htmlFetch.js";
import { raceStartInstant } from "./time.js";

const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

/** race_id（YYYY-MM-DD-VV-RR）から、日付・会場・レース番号を取り出す。形式が不正なら例外 */
export function parsePcexpectRaceId(raceId) {
  const m = RACE_ID_RE.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  return { date: m[1], venue_code: Number(m[2]), race_number: Number(m[3]) };
}

/** races.start_time（発走時刻）を読み、external_predictions.race_start_at 用の Date にする。無ければ null */
async function defaultLoadStartTime(client, raceId, date) {
  const { data, error } = await client
    .from("races")
    .select("start_time")
    .eq("race_id", raceId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `発走時刻の読み取りに失敗しました（${raceId}）: ${error.message}`,
    );
  }
  return data?.start_time ? raceStartInstant(date, data.start_time) : null;
}

/**
 * 公式予想のスロットのハンドラー。1スロット＝1レースの公式コンピュータ予想を、取得・解析し、live なら書き込む。
 *
 * ctx.politeFetch（タイムアウト・429/503のバックオフ・ブレーカー込み）で取得する。
 * outcome は runForRaces の語彙（ok / no_values / error / breaker_open）。ok は完了、それ以外は、
 * 次の再試行（retrySec）まで pending に戻る（許容幅＝発走30分前まで）。
 */
export function createPcexpectSlotHandler({
  run = runForRaces,
  loadStartTime = defaultLoadStartTime,
} = {}) {
  return async function handleSlot(slot, ctx) {
    const race = parsePcexpectRaceId(slot.race_id);
    // 発走時刻の読み取りの失敗は、取得の失敗と同じく、このスロットの再試行にする（共通ラッパが error として記録する）
    const startTime =
      ctx.mode === "live"
        ? await loadStartTime(ctx.client, slot.race_id, race.date)
        : null;
    const [result] = await run(
      [
        {
          race_id: slot.race_id,
          venue_code: race.venue_code,
          race_number: race.race_number,
          start_time: startTime,
        },
      ],
      {
        date: race.date,
        mode: ctx.mode,
        fetchHtml: makeFetchHtml(ctx.politeFetch),
        client: ctx.client,
        concurrency: 1,
        now: ctx.now,
      },
    );
    if (!result) {
      return { outcome: "error", error: "公式予想の処理結果が空でした" };
    }
    // payload は、スロットの記録に不要（ダイジェストを resultDigest に持つ）
    const { race_id: _raceId, payload: _payload, ...slotResult } = result;
    return slotResult;
  };
}
