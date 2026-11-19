/**
 * snsTodayDigestV3.js から移した、型 v3 の定数・文言・小さな道具（純粋）。値・文字は元のまま。
 * snsTodayDigestV3.js が公開の名前を再 export する。
 */
import { addDaysToDateString, parseDateInfo } from "./dateUtils.js";

export const V3_BODY = "digest_v3";
export const V3_FINAL = "優勝戦";
export const V3_SEMI = "準優勝戦";
/** 走数の足切り（目安、根拠なし。起票の下書き）。該当が無ければ朝の一覧の MIN_RUNS=10 まで下げる */
export const V3_MIN_RUNS = 30;
export const V3_MIN_RUNS_FALLBACK = 10;
/** 優勝戦は🏆を含めて3つ、準優勝戦は3場まで書き、残りは「ほか◯場」 */
export const V3_MAX_FINALS = 3;
export const V3_MAX_SEMI_VENUES = 3;
export const V3_RULE = "━━━━━━━━━━";
/**
 * 脚注（BOA-1315、オーナー 2026-11-04 承認。文は hq の起票のとおり）。期間は率の窓（racer_course_technique_stats の window_start〜window_end、
 * 2025/12/2 から）。終わりは窓の実際の終わりを書く: 率の集計（api/cron/racer-course-technique-stats.js）は 13:00 JST に前日まで進むので、
 * 7:00 の投稿では前々日になる（起票の「前日」は 13:00 より後の値。前日と偽らない）。率の塊が無い日は1・2行目を出さず、逃し率の行は【逃し率が高い選手】の塊がある日だけ
 */
export const v3PeriodNote = (from, to) =>
  `※率は ${slashDate(from)}〜${slashDate(to)} の全国の成績（そのコースに入ったとき）`;
export const V3_RATE_NOTE = "※逃げ率・まくり率＝逃げ・まくりで1着になった割合";
export const V3_NIGASHI_NOTE =
  "※逃し率＝2コースに入ったとき、1コースの艇の逃げで決まった割合";
export const V3_TAG = "#ボートレース";
export const V3_LINK_LEAD = "全レースの一覧 → ";

/** "2025-12-02" → "2025/12/2" */
function slashDate(date) {
  const { year, month, day } = parseDateInfo(date);
  return `${year}/${month}/${day}`;
}
/** 暦にある YYYY-MM-DD か（"2026-00-99" や Date の文字列を受けない） */
export const isIsoDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  addDaysToDateString(v, 0) === v;
/**
 * 逃し率の塊の見出し（BOA-1324、オーナー 2026-11-04 選択）。旧【1号艇が逃げやすいレース】は、逃し率の高低で1号艇の1着が
 * 56.0% 対 56.0% で差が無く（PR #2243、BOA-1280）事実に反する向きになるため差し替えた
 */
export const V3_NIGASHI_HEADING = "【逃し率が高い選手】";
/** 逃し率の高低は1号艇の1着と関係しない（PR #2243）ので、1号艇が勝つ向きの言い方を本文のどこにも書かない */
export const V3_BANNED_PHRASES = /逃げやすい|鉄板|決まりやすい/;

export const GRADE_ORDER = ["SG", "G1", "G2", "G3"];
export const gradeRank = (g) =>
  GRADE_ORDER.includes(g) ? GRADE_ORDER.indexOf(g) : GRADE_ORDER.length;
export const LADY_KINDS = ["lady", "venus"];
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export const PAGE = 1000;

/** 「11月5日（水）」（文字列の年月日をそのまま使う。実行環境のタイムゾーンに左右されない） */
export function v3DateLine(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}月${d}日（${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

export const hm = (startTime) => String(startTime).slice(0, 5);
export const hmShort = (startTime) => hm(startTime).replace(/^0/, "");
export const nameOf = (name) =>
  String(name ?? "")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
export const nfkc = (s) =>
  typeof s === "string" && s.trim() ? s.normalize("NFKC").trim() : null;
