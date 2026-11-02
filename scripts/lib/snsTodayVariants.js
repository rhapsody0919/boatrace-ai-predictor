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
import { createHash } from "node:crypto";

export const TODAY_HEADING_BUILTIN = "本日のデータ一覧（{date}）";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_ID = /^[a-z0-9_-]{1,32}$/;
// 見出しは1行・80字まで・日付の差し込み（{date}）が必須。日付が消えると、投稿のどこにも「いつのデータか」が出ない（x-channel の指摘、2026-10-20）
const headingOk = (v) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= 80 &&
  !/[\r\n]/.test(v) &&
  v.includes("{date}") &&
  // {date} のほかの差し込み・波かっこは、送る直前の検査（unresolved_placeholder）で止まるので受けない（/code-review の指摘）
  !/[{}]|\$\{/.test(v.replaceAll("{date}", ""));

/** リンクの置き場: 見出しの直後（今の型、2026-10-22〜）・本文の末尾・自分への返信（PD02、型の列だけが選べる） */
export const TODAY_LINK_POSITIONS = ["after_heading", "end", "reply"];
const TYPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** 型の列の post に書ける項目（ほかの項目は作れない型として捨てる） */
export const TODAY_POST_FIELDS = ["heading", "link_lead", "link_position"];
/** config の案に型の id が無いときの既定（hq の today 群の最初の基準の型） */
export const TODAY_BASE_TYPE_ID = "today-a";
/**
 * 本文の作り方。null は今の型（見出し＋一覧）。course_win は型 b（v2「今日走る選手のコース別1着率」、hq 2026-10-27 オーナー決定。
 * 本文は scripts/lib/snsTodayCourseWinPost.js、画像は撮影用のページ1枚。見出しは画像の上の行に使う）
 */
export const TODAY_BODIES = ["course_win"];

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
        (v.body == null || TODAY_BODIES.includes(v.body)) &&
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
          body: v.body ?? null,
          ...n.post,
        }))
      : [],
    experiment: normalizeTodayExperiment(config?.experiment),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (date) =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);

/**
 * 比べの設定（config.experiment）。連続2日を1組にし、組の中でどちらの日を b にするかを乱数で決める（hq §6・§10-5）。
 * start（組の1日目）が null・壊れているときは比べをしない（全部 a）。pairs は組の数（既定 10。5組で組の中の SD を見直し、
 * 1.0 を超えたら hq が 20 に上げる）。乱数は seed と組の番号の SHA-256 で、日付と設定だけから決まる（作り直しても変わらない。覗き見で変えない）
 * mode "all_b"（2026-10-28 オーナー決定）は組を作らず、start から days 日（既定 10）を毎日 b、その後は a にする（比べは過去の a の日との前後比べ）。
 * mode が無い・知らない値は "pairs"（上の組の方式）
 * 返り値: null（config に experiment が無い＝前からの日替わり）か { id, mode, start, pairs, seed }（all_b は pairs の代わりに days。start は null もある）
 */
export function normalizeTodayExperiment(experiment) {
  if (experiment === undefined) return null;
  const e = experiment && typeof experiment === "object" ? experiment : {};
  const start =
    typeof e.start === "string" &&
    DATE.test(e.start) &&
    Number.isFinite(dayNumber(e.start))
      ? e.start
      : null;
  const count = (v) => (Number.isInteger(v) && v > 0 && v <= 100 ? v : 10);
  const id = typeof e.id === "string" && TYPE_ID.test(e.id) ? e.id : "today-ab";
  if (e.mode === "all_b")
    return { id, mode: "all_b", start, days: count(e.days) };
  return {
    id,
    mode: "pairs",
    start,
    pairs: count(e.pairs),
    seed: typeof e.seed === "string" && e.seed ? e.seed : "today-ab",
  };
}

/**
 * その日が比べのどの組のどちらか（純粋関数）。比べの外（start が無い・start より前・組の数を過ぎた）は side a・pair null
 * mode "all_b" は start から days 日が side b（day に start からの日数 0〜days-1）、その外は a
 * 返り値: { side: "a"|"b", pair: number|null, slot: 0|1|null, day?: number }
 */
export function pickExperimentSide(experiment, date) {
  if (!experiment?.start) return { side: "a", pair: null, slot: null };
  const offset = dayNumber(date) - dayNumber(experiment.start);
  if (experiment.mode === "all_b")
    return offset >= 0 && offset < experiment.days
      ? { side: "b", pair: null, slot: null, day: offset }
      : { side: "a", pair: null, slot: null };
  if (!(offset >= 0) || offset >= experiment.pairs * 2)
    return { side: "a", pair: null, slot: null };
  const pair = Math.floor(offset / 2);
  const slot = offset % 2;
  const coin =
    createHash("sha256").update(`${experiment.seed}:${pair}`).digest()[0] & 1;
  // coin=1 なら組の1日目が b、0 なら2日目が b
  return { side: (slot === 0) === (coin === 1) ? "b" : "a", pair, slot };
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
  // 偶奇の選び方は pickTodayPost の1か所だけに置く（型の列なしのときと同じ）
  const { heading, variant } = pickTodayPost(config, date);
  return { heading, variant };
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
  const { fallback, variants, experiment } = normalizeTodayVariants(config);
  const day = dayNumber(date);
  // 比べの設定があれば組と乱数で選ぶ（比べの外は a）。無ければ前からの日の偶奇
  const ab = experiment ? pickExperimentSide(experiment, date) : null;
  const index = ab ? (ab.side === "a" ? 0 : 1) : day % 2;
  const side = variants.length ? (index === 0 ? "a" : "b") : "default";
  const base = variants.length
    ? variants[index]
    : {
        id: "default",
        uuid: null,
        type_id: TODAY_BASE_TYPE_ID,
        heading: fallback,
        link_lead: null,
        link_position: "after_heading",
        body: null,
      };
  const variant = { id: base.id, uuid: base.uuid };
  // 返信は X の投稿が1日1本増え、月の予約も URL つきの額で2本分引く（158 の thread_index=0）。費用の線はオーナーの判断なので、
  // config の reply_enabled が true の間だけ選べる（既定は false。system-architect の審査 P1-1）
  const replyOn = config?.reply_enabled === true;
  // 比べの日（組の日・all_b の b の日）は型の列を使わない（列の型が入ると a・b の束が別の型で汚れる）。理由は fallback_reason に残す
  const inPair = Boolean(ab && (ab.pair !== null || ab.day !== undefined));
  const checked =
    row && !inPair
      ? normalizeTypeScheduleRow(row, date, {
          allowReply: allowReply && replyOn,
        })
      : null;
  if (checked?.reason === "reply_not_allowed" && !replyOn)
    checked.reason = "reply_disabled";
  // 列の型の日は、見出しの a・b の札（today_variant・template_variant_id）を付けない。札と実際の文面が食い違い、
  // a・b の比較の母数を汚すため（x-channel の審査 P1）。型の比較は content_type で行う
  // 比べの組（hq が数える）。比べの外は付けない
  // mode を残す（pairs は組の中の比べ、all_b は過去の a の日との前後比べ。読み方が違う）
  const pairTag = !inPair
    ? {}
    : ab.pair !== null
      ? {
          experiment: experiment.id,
          mode: experiment.mode,
          pair: ab.pair,
          slot: ab.slot,
        }
      : { experiment: experiment.id, mode: experiment.mode, day: ab.day };
  if (checked?.post)
    return {
      ...checked.post,
      body: null,
      variant: { id: "schedule", uuid: null },
      content_type: {
        id: checked.type_id,
        side,
        source: "schedule",
        ...pairTag,
      },
    };
  const reason =
    row && inPair
      ? ab.pair !== null
        ? "experiment_pair"
        : "experiment_all_b"
      : (scheduleError ?? checked?.reason ?? "no_schedule_row");
  return {
    heading: base.heading,
    link_lead: base.link_lead,
    link_position: base.link_position,
    body: base.body ?? null,
    variant,
    content_type: {
      id: base.type_id,
      side,
      source: "config",
      fallback_reason: reason,
      ...pairTag,
    },
  };
}

/** 見出しの文に日付の表示を差し込む */
export const renderTodayHeading = (heading, dateLine) =>
  heading.includes("{date}") ? heading.replaceAll("{date}", dateLine) : heading;
