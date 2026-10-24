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

/** リンクの置き場: 見出しの直後（今の型、2026-10-22〜）・本文の末尾・自分への返信（PD02、型の列だけが選べる） */
export const TODAY_LINK_POSITIONS = ["after_heading", "end", "reply"];
const TYPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** 型の列の post に書ける項目（ほかの項目は作れない型として捨てる） */
export const TODAY_POST_FIELDS = ["heading", "link_lead", "link_position"];
/** config の案に型の id が無いときの既定（hq の today 群の最初の基準の型） */
export const TODAY_BASE_TYPE_ID = "today-a";

/**
 * 投稿の型の中身（見出し・リンクの前の文・リンクの置き場）を検査する（純粋関数）。
 * link_lead はリンクと同じ行の前に置く文（空なら「今日の一覧はこちら：」）。返り値 { post } か { reason }
 */
export function normalizeTodayPost(post, { allowReply = true } = {}) {
  if (!headingOk(post?.heading)) return { reason: "heading_invalid" };
  const lead = post.link_lead ?? null;
  if (
    lead !== null &&
    (typeof lead !== "string" ||
      !lead.trim() ||
      lead.length > 80 ||
      /[\r\n{}]/.test(lead))
  )
    return { reason: "link_lead_invalid" };
  const position = post.link_position ?? "after_heading";
  if (!TODAY_LINK_POSITIONS.includes(position))
    return { reason: "link_position_invalid" };
  if (position === "reply" && !allowReply)
    return { reason: "reply_not_allowed" };
  return {
    post: { heading: post.heading, link_lead: lead, link_position: position },
  };
}

/** 設定を検査して使える形にする（純粋関数）。壊れた部分は捨てる。config の案は返信（reply）を選べない（いつでも送れる形に保つ） */
export function normalizeTodayVariants(config) {
  const fallback = headingOk(config?.default)
    ? config.default
    : TODAY_HEADING_BUILTIN;
  const variants = Array.isArray(config?.variants) ? config.variants : [];
  const checked = variants.map((v) => ({
    v,
    n: normalizeTodayPost(v, { allowReply: false }),
  }));
  const valid =
    variants.length === 2 &&
    checked.every(
      ({ v, n }) =>
        v &&
        n.post &&
        VARIANT_ID.test(v.id ?? "") &&
        (v.uuid == null || v.uuid === "" || UUID.test(v.uuid)) &&
        (v.type_id == null || TYPE_ID.test(v.type_id)),
    ) &&
    variants[0].id !== variants[1].id;
  return {
    fallback,
    variants: valid
      ? checked.map(({ v, n }) => ({
          id: v.id,
          uuid: v.uuid || null,
          type_id: v.type_id ?? TODAY_BASE_TYPE_ID,
          ...n.post,
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

/**
 * 型の列（sns_today_type_schedule）の1行を検査する（純粋関数）。返り値 { type_id, post } か { reason }。
 * 作れない項目（post に TODAY_POST_FIELDS 以外）は type_unsupported:<項目>
 */
export function normalizeTypeScheduleRow(
  row,
  date,
  { allowReply = true } = {},
) {
  if (!row || typeof row !== "object") return { reason: "row_invalid" };
  if (row.day !== date) return { reason: "day_mismatch" };
  if (!TYPE_ID.test(row.type_id ?? "")) return { reason: "type_id_invalid" };
  if (!row.post || typeof row.post !== "object" || Array.isArray(row.post))
    return { reason: "post_invalid" };
  const extra = Object.keys(row.post).find(
    (k) => !TODAY_POST_FIELDS.includes(k),
  );
  if (extra) return { reason: `type_unsupported:${extra}` };
  const n = normalizeTodayPost(row.post, { allowReply });
  return n.post ? { type_id: row.type_id, post: n.post } : n;
}

/**
 * その日の投稿の型（純粋関数）。a・b は今までどおり日の偶奇（pickTodayHeading）。型の列にその日の行があれば、その中身で送る
 * （a・b どちらの日も。hq が基準の型を変えたときに config の PR を待たない）。行が無い・壊れている・読めない（scheduleError）・
 * 返信が選べない（allowReply=false）ときは config の案で送り、理由を content_type.fallback_reason に残す（止めない）。
 * 返り値: { heading, link_lead, link_position, variant: {id, uuid}, content_type: {id, side, source, fallback_reason?} }
 */
export function pickTodayPost(
  config,
  date,
  { row = null, scheduleError = null, allowReply = true } = {},
) {
  const { fallback, variants } = normalizeTodayVariants(config);
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const side = variants.length ? (day % 2 === 0 ? "a" : "b") : "default";
  const base = variants.length
    ? variants[day % 2]
    : {
        id: "default",
        uuid: null,
        type_id: TODAY_BASE_TYPE_ID,
        heading: fallback,
        link_lead: null,
        link_position: "after_heading",
      };
  const variant = { id: base.id, uuid: base.uuid };
  const checked = row
    ? normalizeTypeScheduleRow(row, date, { allowReply })
    : null;
  // 列の型の日は、見出しの a・b の札（today_variant・template_variant_id）を付けない。札と実際の文面が食い違い、
  // a・b の比較の母数を汚すため（x-channel の審査 P1）。型の比較は content_type で行う
  if (checked?.post)
    return {
      ...checked.post,
      variant: { id: "schedule", uuid: null },
      content_type: { id: checked.type_id, side, source: "schedule" },
    };
  const reason = scheduleError ?? checked?.reason ?? "no_schedule_row";
  return {
    heading: base.heading,
    link_lead: base.link_lead,
    link_position: base.link_position,
    variant,
    content_type: {
      id: base.type_id,
      side,
      source: "config",
      fallback_reason: reason,
    },
  };
}

/** 見出しの文に日付の表示を差し込む */
export const renderTodayHeading = (heading, dateLine) =>
  heading.includes("{date}") ? heading.replaceAll("{date}", dateLine) : heading;
