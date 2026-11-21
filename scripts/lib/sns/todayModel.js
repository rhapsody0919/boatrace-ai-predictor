/**
 * /today のモデル（人の画面の部分集合）の組み立て。api/_lib/botToday.js から字のまま下ろした物（scripts/lib から api/ を読まない、
 * lib-no-entry）。api/_lib/botToday.js（ボット向け HTML）と scripts/lib/snsTodayPlanner.js（SNS の今日の投稿）が読む。
 * api/_lib/botToday.js が同じ名で再 export する。検証: scripts/maintenance/verify-bot-today-function.js
 */
import { NIGASHI_LIST_COURSE } from "../../../src/utils/digestMetrics.js";
import {
  GLOSSARY_KEY_VOLATILITY,
  MORNING_DIGEST_GLOSSARY,
  MORNING_DIGEST_META,
  MORNING_DIGEST_SECTION_BY_KEY,
  glossaryBodyToText,
} from "../../../src/data/morningDigestCopy.js";

// 人の DigestSection の既定の0件の文言
const DEFAULT_EMPTY_MESSAGE = "本日、条件に該当するレースはありません";
// 人の画面の「未生成」（本日分）の文言
export const NOT_GENERATED_TEXT =
  "本日ぶんはまだ公開されていません（毎朝更新しています。しばらくしてからお試しください）。";

// 人の DigestCardGrid の初期表示の枚数（previewCount の既定値）。残りは「もっと見る」を押すまで描かれないので、
// ボット向けも初期表示の分だけ出す（決定3）。一致は verify-bot-today-function.js で固定する
export const CARD_PREVIEW_COUNT = 6;

// 人の画面の formatJaDate と同じ
function formatJaDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}月${d}日（${weekday}）`;
}

// 人の画面の用語「イン崩れ指数」に足す時刻と同じ書式
const volatilityTime = (generatedAt) =>
  new Date(generatedAt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const deadlineText = (startTime) =>
  startTime ? `締切 ${String(startTime).slice(0, 5)}` : null;

// 人の DigestSection の件数の表示
const countText = (count, total) =>
  total !== null && total > count
    ? `上位${count}件 / ${total}件`
    : `${count}件`;

// 行をセクションごとに分ける
function groupTodayRows(rows) {
  const bySection = {};
  for (const row of rows) {
    // 逃がしは人の画面の一覧と同じく2号艇だけ。3号艇は折りたたみの中なので出さない（2026-10-15）
    if (row.section === "nigashi" && row.course !== NIGASHI_LIST_COURSE) continue;
    (bySection[row.section] ??= []).push(row);
  }
  return bySection;
}

// 日付と開催数の行
const todayDateLine = (day, date) =>
  day
    ? `${formatJaDate(date)}\u3000${day.venue_count}会場 ${day.race_count}レース`
    : formatJaDate(date);

// 期間の行
const todayWindow = (day) =>
  day?.window_start
    ? `${day.window_start} 〜 ${day.window_end}（${day.window_days}日）／ 調子は直近90日`
    : null;

// 用語（イン崩れ指数には時刻を足す）
const todayGlossary = (day) =>
  MORNING_DIGEST_GLOSSARY.map((entry) => ({
    term: entry.term,
    body:
      glossaryBodyToText(entry.body) +
      (entry.key === GLOSSARY_KEY_VOLATILITY && day?.generated_at
        ? `この数値は ${volatilityTime(day.generated_at)} 時点のものです。`
        : ""),
  }));

/**
 * /today のモデル（人の画面の部分集合）
 *
 * @param {{day: object|null, rows: object[]}} digest
 * @param {{date: string, t: (key: string) => string}} options
 */
export function buildTodayModel(digest, { date, t }) {
  const { day, rows } = digest;
  const generated = Boolean(day?.generated_at);
  const bySection = groupTodayRows(rows);
  const race = (row) => ({
    race: `${t(`venues.${row.venue_code}`)} ${row.race_number}R`,
    deadline: deadlineText(row.start_time),
    href: `/race/${row.race_id}`,
  });
  const raceSection = (key, total = null) => {
    const copy = MORNING_DIGEST_SECTION_BY_KEY[key];
    const list = bySection[key] ?? [];
    return {
      title: copy.title,
      count: countText(list.length, total),
      description: copy.description ?? null,
      notice: copy.notice ?? null,
      empty: list.length === 0 ? (copy.emptyMessage ?? DEFAULT_EMPTY_MESSAGE) : null,
      races: list.slice(0, CARD_PREVIEW_COUNT).map(race),
    };
  };
  const racerSection = (key) => {
    const copy = MORNING_DIGEST_SECTION_BY_KEY[key];
    const n = (bySection[key] ?? []).length;
    return {
      title: copy.title,
      count: countText(n, null),
      description: copy.description ?? null,
      notice: null,
      // 選手の一覧は出さない。0件のときの文言だけ（人の画面も0件ならこの文言だけ）
      empty: n === 0 ? (copy.emptyMessage ?? DEFAULT_EMPTY_MESSAGE) : null,
      races: [],
    };
  };
  const featuredRow = bySection.featured?.[0] ?? null;

  return {
    meta: {
      title: MORNING_DIGEST_META.title,
      description: MORNING_DIGEST_META.description,
      canonical: MORNING_DIGEST_META.canonical,
    },
    h1: MORNING_DIGEST_META.h1,
    dateLine: todayDateLine(day, date),
    window: todayWindow(day),
    generated,
    notGeneratedText: generated ? null : NOT_GENERATED_TEXT,
    featured:
      generated && featuredRow
        ? { ...race(featuredRow), reason: featuredRow.reason || null }
        : null,
    sections: generated
      ? [
          raceSection(
            "nige",
            day?.notes?.sectionCounts?.nigeCandidates ?? null,
          ),
          raceSection("makuri"),
          raceSection("nigashi"),
          racerSection("flying"),
          racerSection("returned"),
        ]
      : [],
    glossary: generated ? todayGlossary(day) : [],
  };
}
