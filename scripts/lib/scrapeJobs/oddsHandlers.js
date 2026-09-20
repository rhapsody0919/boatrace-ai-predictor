/**
 * オッズ取得（A3）の Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関数の組み立て）。
 * plan.md §3.6・§4.1、tasks.md T4b-04-1・T4b-04-2。
 *
 *   createOddsSlotHandler   api/cron/odds.js   オッズのスロット（発走の60/30/15/10/5/0分前から許容幅3分）を1件ずつ処理する
 *
 * 取得・解析・書き込みの本体は、既存の scripts/daily/scrape-odds.js（runForRaces）を再利用する
 * （二重実装しない。GitHub Actions・CLIの入口 run() と、解析・行の組み立て・0分窓の補完を共有する）。
 * shadow のとき、race_odds へは一切書かない（runForRaces が mode で守る）。
 *
 * 依存（runForRaces）は引数で差し替えられる（scripts/maintenance/verify-scrape-odds-job.js が、DB・取得先なしで検証する）。
 */
import { runForRaces } from "../../daily/scrape-odds.js";

const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

/**
 * race_id（YYYY-MM-DD-VV-RR）から、runForRaces に渡すレースの情報を作る。形式が不正なら例外。
 * （結果取得の parseRaceId と同じ形式。scrape-results.js の重い依存を api/cron/odds.js に持ち込まないため、ここで持つ）
 */
export function parseOddsRaceId(raceId) {
  const m = RACE_ID_RE.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  return { date: m[1], venue_code: Number(m[2]), race_number: Number(m[3]) };
}

/**
 * オッズのスロットのハンドラー。1スロット＝1レース×1窓のオッズを、取得・解析し、live なら書き込む。
 * shadow は、取得・解析のみで、resultDigest（構造のダイジェスト）を返す（race_odds へは書かない）。
 *
 * ctx.politeFetch（タイムアウト・429/503のバックオフ・ブレーカー込み）で、1レース5ページを並列に取得する。
 * outcome は runForRaces の語彙（ok / partial / no_values / skipped_have_data / error / breaker_open）。
 * ok・skipped_have_data は完了、それ以外は、次の再試行（retrySec）まで pending に戻る。
 * slot.offset_min（-60〜0）が、race_odds.window_min になる。
 */
export function createOddsSlotHandler({ run = runForRaces } = {}) {
  return async function handleSlot(slot, ctx) {
    const race = parseOddsRaceId(slot.race_id);
    const [result] = await run(
      [
        {
          race_id: slot.race_id,
          venue_code: race.venue_code,
          race_number: race.race_number,
          window_min: slot.offset_min,
          attempts: slot.attempts,
        },
      ],
      {
        date: race.date,
        mode: ctx.mode,
        fetchFn: (url) => ctx.politeFetch(url),
        client: ctx.client,
        concurrency: 1,
        now: ctx.now,
      },
    );
    if (!result) {
      return { outcome: "error", error: "オッズの処理結果が空でした" };
    }
    const { race_id: _raceId, ...slotResult } = result;
    return slotResult;
  };
}
