/**
 * /today の X 投稿の型 b（v2「今日走る選手のコース別1着率」）の本文と、その機械の検査（純関数）。
 * 正本は hq drafts/x-today-type-20261027.md §8 案 A と §11（r5 の直し: 「コース別1着率を1枚に」、名前の空白を画像にそろえる）。
 * 中身（行・注目の1人・K・線）は src/utils/todayCourseWin.js の buildCourseWinSheet が決める。撮影用のページも同じ関数を使う。
 *
 * /today の X 投稿は機械の検査が通れば自動で送る（.claude/CLAUDE.md「確認のバッチ化」の例外(2)）。
 * この検査が1つでも通らなければ、計画は型 b を出さずに型 a で送る（理由は content_type.fallback_reason）。
 */
import twitterText from "twitter-text";
import { X_POST_MAX } from "../../api/_lib/snsXLength.js";

/** 本文の最後の免責とタグ（「#競艇」は付けない、hq §6） */
// 進入の一言（wording-editor P2-3）は本文に足すと加重280を超える日がある（長い名前・言い切りの日で 286）ので、
// 画像の注だけに置く。本文は「1コースに入ったときに」の条件で書く
export const COURSE_WIN_FOOT = "※過去の数字です #ボートレース";
export const COURSE_WIN_LINK_LEAD = "全レースの一覧 → ";

/**
 * 本文。差（「上回る」）を書くのは sheet.claim の日だけ。それ以外は2つの値を並べる（hq 10/27 の統計の決まり）
 * @param {object} sheet buildCourseWinSheet の ok の値
 * @param {{venueName: (code: number) => string, url: string}} options
 */
export function buildCourseWinPost(sheet, { venueName, url }) {
  const f = sheet.featured;
  const baseline = sheet.claim
    ? // 「大きく」は差の幅の語で、線（有意）を通っても幅は小さい日がある。幅は言わない（wording-editor P2-1）
      `${f.grade}級の全国平均 ${f.baseline_pct}% を上回る。`
    : `${f.grade}級の全国平均は${f.baseline_pct}%。`;
  return [
    `${f.runs}回中${f.wins}回。`,
    "",
    `今日の${venueName(f.venue_code)}${f.race_number}R、1号艇 ${f.racer_name}が`,
    "1コースに入ったときに1着になった数。",
    baseline,
    "",
    "今日走る選手のコース別1着率を1枚に。",
    "締切前に見返すなら保存を。",
    "",
    `${COURSE_WIN_LINK_LEAD}${url}`,
    COURSE_WIN_FOOT,
  ].join("\n");
}

/** X の加重の文字数（全角2・URL 23、twitter-text） */
export const xWeightedLength = (text) =>
  twitterText.parseTweet(text).weightedLength;

/**
 * 機械の検査。返り値は通らなかった項目の理由の配列（空なら通った）
 * @param {string} text 本文
 * @param {object} sheet buildCourseWinSheet の ok の値（計画が作った物）
 * @param {{imageKey: string|null, url: string, venueName?: (code: number) => string}} options imageKey は撮影用のページが画面に出した指紋（撮れた画像と同じ行か）
 */
export function checkCourseWinPost(text, sheet, { imageKey, url, venueName }) {
  const problems = [];
  const f = sheet.featured;
  // 本文の人が画像の1コースの段の1行目か（同じ行・同じ窓から作ったか）
  const c1 = sheet.sections.find((s) => s.key === "c1");
  if (!c1 || c1.rows[0] !== f) problems.push("featured_not_first_c1_row");
  if (imageKey !== sheet.key) problems.push("image_key_mismatch");
  // 未取得の印・空の値が残っていないか
  if (/[◯○]|undefined|NaN|null|\{|\}/.test(text))
    problems.push("placeholder_left");
  for (const value of [f.runs, f.wins, f.baseline_pct, f.race_number])
    if (!Number.isInteger(value) || value < 0) problems.push("value_invalid");
  if (!(f.wins <= f.runs)) problems.push("value_invalid");
  if (!f.racer_name || !text.includes(`1号艇 ${f.racer_name}が`))
    problems.push("name_mismatch");
  // 半角の空白1つだけ（全角の空白・連続した空白・タブ等は画像とずれる）
  if (/\s{2,}|[^\S ]/.test(f.racer_name)) problems.push("name_spacing");
  // 語の検査は選手名・会場名を除いた文に掛ける（名前に「高」等が入ると誤って型 a に落ちる。wording-editor P3-4）
  const fixed = text
    .replaceAll(f.racer_name, "")
    .replaceAll(venueName ? venueName(f.venue_code) : "\u0000", "");
  // 順位の言い切りは書かない（線を通っても「1位」「いちばん」は使わない）
  if (/1位|一位|いちばん|一番|トップ/.test(fixed)) problems.push("rank_claim");
  // 差を書くのは線を通った日だけ
  const saysDiff = /上回|下回|高い|低い|ポイント|pt|倍/.test(fixed);
  if (saysDiff && !sheet.claim) problems.push("diff_without_line");
  if (!text.includes(url)) problems.push("link_missing");
  if (!text.endsWith(COURSE_WIN_FOOT)) problems.push("foot_missing");
  if (xWeightedLength(text) > X_POST_MAX) problems.push("too_long");
  return [...new Set(problems)];
}
