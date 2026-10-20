/**
 * /today の X 投稿の見出し（本文の1行目）を2案で日替わりに出す（2026-10-20 オーナー承認、hq 経由）。
 * 案は config/today-variants.json（hq が機械の検査を通して入れ替える）。変えるのは見出しだけで、数字・区分・締切の順は機械が作る。
 *
 * - 日付の偶奇で案を選ぶ。1週が7日（奇数）なので、週ごとに順が逆になり、同じ曜日に同じ案が続かない
 * - 案の札は下書きの source_data.today_variant に必ず残す。案の uuid（sns_template_variants の行）が入っていれば
 *   sns_post_tracking.template_variant_id にも入れる。空・null の間は null
 * - 設定が無い・壊れているときは既定の文に戻す
 */
import { readFileSync } from "node:fs";

export const TODAY_HEADING_BUILTIN = "本日のデータ一覧（{date}）";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_ID = /^[a-z0-9_-]{1,32}$/;
// 見出しは1行・80字まで・日付の差し込み（{date}）が必須。日付が消えると、投稿のどこにも「いつのデータか」が出ない（x-channel の指摘、2026-10-20）
const headingOk = (v) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= 80 &&
  !/[\r\n]/.test(v) &&
  v.includes("{date}");

/** 設定を検査して使える形にする（純粋関数）。壊れた部分は捨てる */
export function normalizeTodayVariants(config) {
  const fallback = headingOk(config?.default)
    ? config.default
    : TODAY_HEADING_BUILTIN;
  const variants = Array.isArray(config?.variants) ? config.variants : [];
  const valid =
    variants.length === 2 &&
    variants.every(
      (v) =>
        v &&
        VARIANT_ID.test(v.id ?? "") &&
        headingOk(v.heading) &&
        (v.uuid == null || v.uuid === "" || UUID.test(v.uuid)),
    ) &&
    variants[0].id !== variants[1].id;
  return {
    fallback,
    variants: valid
      ? variants.map((v) => ({
          id: v.id,
          uuid: v.uuid || null,
          heading: v.heading,
        }))
      : [],
  };
}

/** 設定のファイルを読む。無い・読めない・JSON でなければ null（既定の文に戻る） */
export function loadTodayVariants(
  readText = () =>
    readFileSync(
      new URL("../../config/today-variants.json", import.meta.url),
      "utf8",
    ),
) {
  try {
    return JSON.parse(readText());
  } catch (error) {
    console.error(
      `/today の見出しの設定を読めない（既定の文を使う）: ${error.message}`,
    );
    return null;
  }
}

/**
 * その日の見出し（純粋関数）。返り値: { heading（{date} を差し込む前の文）, variant: { id, uuid } }
 * 日の番号（1970-01-01 からの日数）の偶奇で選ぶ（週ごとに順が逆になるのは、1週が7日で奇数のため）。案が無ければ既定の文（id "default"）
 */
export function pickTodayHeading(config, date) {
  const { fallback, variants } = normalizeTodayVariants(config);
  if (!variants.length)
    return { heading: fallback, variant: { id: "default", uuid: null } };
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  // 日ごとに交互。1週は7日（奇数）なので、週が変わると最初の案が入れ替わり、同じ曜日の案も週ごとに逆になる
  const choice = variants[day % 2];
  return {
    heading: choice.heading,
    variant: { id: choice.id, uuid: choice.uuid },
  };
}

/** 見出しの文に日付の表示を差し込む */
export const renderTodayHeading = (heading, dateLine) =>
  heading.includes("{date}") ? heading.replaceAll("{date}", dateLine) : heading;
