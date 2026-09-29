/**
 * 締切時オッズ（公式）の取り直し（BOA-496）の Vercel Cron ハンドラー。api/cron/odds-final.js から使う。
 *
 * 締切の後、公式のオッズページは「オッズ更新時間」の代わりに「締切時オッズ」（`.tab4_time`）を出す。発売中に
 * 取ったスナップショット（race_odds）は、公式の更新が数分遅れるため、0分窓の行でも締切時オッズと一致しない
 * （BOA-496 の観測: 0分窓の行の勝ち艇の単勝が、確定払戻と±50%以上ずれる・null が約17%）。そこで締切の後に
 * 1回、5ページ（単勝・複勝／3連単／3連複／2連単・2連複／拡連複）を取り直し、race_odds_final（マイグレーション108）に
 * 保存する。オッズ一覧タブが、締切後の表と推移の最後の点に使う。
 *
 * race_odds に窓（window_min）を足さず、別テーブルにした理由: race_odds を「レースごとの最新の行」で読む読み手が
 * 多い（latestByRaceId・予測の再計算・Moriarty・バックテスト・複勝バッジ・prediction_odds の導出）。締切後の行を
 * 同じテーブルに入れると、これらが黙って締切後の値を読むようになる。票0（0.0）を 0 のまま残す（keepZero）ため、
 * 1/オッズ を計算する読み手では 0 除算にもなる。
 *
 * 1スロット（予定表 scrape_slots の job='odds_final'、発走（締切）の5分後が期限、許容幅55分）の処理:
 *   1. live なら、既に保存した券種を読む（再試行で取れた券種を取り直さない）。全券種がそろっていれば skipped_have_data
 *   2. 未取得のページの1つ目だけを取得し、締切時オッズ（isFinalOdds）かを確かめる。まだなら、他のページを取らずに
 *      no_values（次の起動で再試行。公式へのアクセスを1ページに抑える）
 *   3. 締切時オッズなら、残りのページを並列に取る。ページごとに成否を判定し、取れた券種だけを保存する
 *      （取れなかった券種は、次の再試行で取り直す。最後まで取れなければ、画面はその券種だけ今の表示に戻る）
 *   4. 全券種がそろえば ok、一部なら partial（再試行）
 *
 * 票0（公式の「0.0」）は 0 のまま保存する（liveOdds.js の parseLiveOddsPage と同じ keepZero）。
 * shadow のときは race_odds_final へ一切書かず、既存行も読まない（取得・解析だけ）。
 *
 * 依存（取得・DB）は引数・ctx で差し替えられる（scripts/maintenance/verify-final-odds-job.js が、フィクスチャで検証する）。
 */
import { createHash } from "node:crypto";
import { parseLiveOddsPage, liveOddsUrl } from "../liveOdds.js";
import { BreakerOpenError } from "./circuitBreaker.js";

const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

export const FINAL_ODDS_TABLE = "race_odds_final";

/**
 * 公式のページ（liveOdds.js の LIVE_ODDS_PAGES のキー）→ 保存する列と、parseLiveOddsPage の data のキー。
 * 並びは、最初に取るページ（締切時オッズかの確認）を先頭にする（単勝・複勝は1番軽い）
 */
export const FINAL_ODDS_PAGES = Object.freeze([
  { page: "tf", columns: { win_all: "win", place_all: "place" } },
  { page: "3t", columns: { trifecta_all: "trifectaAll" } },
  { page: "3f", columns: { trio_all: "trioAll" } },
  {
    page: "2tf",
    columns: { exacta_all: "exactaAll", quinella_all: "quinellaAll" },
  },
  { page: "k", columns: { wide_all: "wideAll" } },
]);

// ページの成否の判定に使う列（全て空でなければ、そのページは取れた）。複勝は発売されない場合があるため、判定に使わない
const REQUIRED_COLUMNS = {
  tf: ["win_all"],
  "3t": ["trifecta_all"],
  "3f": ["trio_all"],
  "2tf": ["exacta_all", "quinella_all"],
  k: ["wide_all"],
};

export const FINAL_ODDS_COLUMNS = Object.freeze(
  FINAL_ODDS_PAGES.flatMap((p) => Object.keys(p.columns)),
);

const isNonEmptyObject = (v) =>
  v !== null && typeof v === "object" && Object.keys(v).length > 0;

/** race_id（YYYY-MM-DD-VV-RR）→ {date, venue, raceNo}。形式が不正なら例外 */
export function parseFinalOddsRaceId(raceId) {
  const m = RACE_ID_RE.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  return { date: m[1], venue: Number(m[2]), raceNo: Number(m[3]) };
}

/**
 * 既存の行から、保存済みのページを求める（必要な列が全て空でないページ）
 * @param {Record<string, unknown>|null} row
 * @returns {Set<string>}
 */
export function savedPagesOf(row) {
  const saved = new Set();
  if (!row) return saved;
  for (const { page } of FINAL_ODDS_PAGES) {
    if (REQUIRED_COLUMNS[page].every((c) => isNonEmptyObject(row[c]))) {
      saved.add(page);
    }
  }
  return saved;
}

/**
 * 1ページのHTMLを解析し、保存する列（パッチ）と状態を返す（純粋関数）。
 *
 *   status: "final"      締切時オッズで、必要な列が取れた（patch に列）
 *           "not_final"  オッズはあるが、まだ締切時オッズではない（発売中）
 *           "unpublished" オッズのセルが無い（中止・順延・発売前）
 *           "empty"      締切時オッズだが、必要な列が解析できなかった（ページの構造の変化の疑い）
 *
 * @param {string} page FINAL_ODDS_PAGES の page
 * @param {string} html
 * @returns {{status: "final"|"not_final"|"unpublished"|"empty", patch: Record<string, Object>}}
 */
export function parseFinalOddsPage(page, html) {
  const def = FINAL_ODDS_PAGES.find((p) => p.page === page);
  if (!def) throw new Error(`未知のページ: ${page}`);
  const parsed = parseLiveOddsPage(page, html);
  if (!parsed.published) return { status: "unpublished", patch: {} };
  if (!parsed.final) return { status: "not_final", patch: {} };
  const patch = {};
  for (const [column, dataKey] of Object.entries(def.columns)) {
    const value = parsed.data[dataKey];
    if (isNonEmptyObject(value)) patch[column] = value;
  }
  const ok = REQUIRED_COLUMNS[page].every((c) => c in patch);
  return ok ? { status: "final", patch } : { status: "empty", patch: {} };
}

/** shadow の result_digest: 取れた列と、列ごとの組み合わせの数（値は含めない） */
export function computeFinalOddsDigest(patch) {
  const canonical = JSON.stringify(
    FINAL_ODDS_COLUMNS.map((c) =>
      isNonEmptyObject(patch[c]) ? Object.keys(patch[c]).length : null,
    ),
  );
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}

async function defaultLoadExisting(client, raceId) {
  const { data, error } = await client
    .from(FINAL_ODDS_TABLE)
    .select(FINAL_ODDS_COLUMNS.join(", "))
    .eq("race_id", raceId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `締切時オッズの既存行の取得に失敗しました（${raceId}）: ${error.message}`,
    );
  }
  return data ?? null;
}

async function defaultSave(client, row) {
  // 1行の upsert。送った列だけが更新される（取れなかった券種の列は送らないので、前回の値を消さない）
  const { error } = await client
    .from(FINAL_ODDS_TABLE)
    .upsert(row, { onConflict: "race_id" });
  if (error) {
    throw new Error(
      `締切時オッズの書き込みに失敗しました（${row.race_id}）: ${error.message}`,
    );
  }
}

/**
 * 1ページを取得して解析する。取得の失敗は status "error"（ブレーカーは例外のまま投げる。共通ラッパが retryAt を付ける）
 */
async function fetchPage(politeFetch, target, page) {
  let response;
  try {
    response = await politeFetch(liveOddsUrl({ ...target, page }));
  } catch (error) {
    if (error instanceof BreakerOpenError) throw error;
    return { page, status: "error", patch: {}, error: error.message };
  }
  if (!response.ok) {
    return {
      page,
      status: "error",
      patch: {},
      error: `HTTP ${response.status}`,
    };
  }
  return { page, ...parseFinalOddsPage(page, await response.text()) };
}

/**
 * 締切時オッズのスロットのハンドラー。
 *
 * @param {Object} [options]
 * @param {typeof defaultLoadExisting} [options.loadExisting]
 * @param {typeof defaultSave} [options.save]
 */
export function createFinalOddsSlotHandler({
  loadExisting = defaultLoadExisting,
  save = defaultSave,
} = {}) {
  return async function handleSlot(slot, ctx) {
    const target = parseFinalOddsRaceId(slot.race_id);
    const live = ctx.mode === "live";
    const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 1 };

    const saved = live
      ? savedPagesOf(await loadExisting(ctx.client, slot.race_id))
      : new Set();
    const pending = FINAL_ODDS_PAGES.map((p) => p.page).filter(
      (p) => !saved.has(p),
    );
    if (pending.length === 0) return { ...base, outcome: "skipped_have_data" };

    // 1ページ目で、締切時オッズになっているかを確かめる（まだなら他のページを取らない）
    const first = await fetchPage(ctx.politeFetch, target, pending[0]);
    if (first.status === "error") {
      return {
        ...base,
        outcome: "error",
        error: `${first.page}: ${first.error}`,
      };
    }
    if (first.status === "not_final" || first.status === "unpublished") {
      return {
        ...base,
        outcome: "no_values",
        error:
          first.status === "not_final"
            ? "まだ締切時オッズになっていません（発売中の表示）"
            : "オッズがありません（中止・順延・発売前の可能性）",
      };
    }
    const rest = await Promise.all(
      pending.slice(1).map((page) => fetchPage(ctx.politeFetch, target, page)),
    );
    const results = [first, ...rest];

    const patch = Object.assign(
      {},
      ...results.filter((r) => r.status === "final").map((r) => r.patch),
    );
    const failed = results.filter((r) => r.status !== "final");
    const parsedPages = results.length - failed.length;

    if (live && parsedPages > 0) {
      await save(ctx.client, {
        race_id: slot.race_id,
        ...patch,
        captured_at: ctx.now().toISOString(),
      });
    }

    const common = {
      ...base,
      rowsParsed: parsedPages > 0 ? 1 : 0,
      rowsWritten: live && parsedPages > 0 ? 1 : 0,
      resultDigest: computeFinalOddsDigest(patch),
    };
    if (failed.length === 0) return { ...common, outcome: "ok" };
    return {
      ...common,
      outcome: parsedPages > 0 ? "partial" : "error",
      error: `締切時オッズが取れなかったページ: ${failed
        .map((r) => `${r.page}(${r.status}${r.error ? ` ${r.error}` : ""})`)
        .join(", ")}`,
    };
  };
}
