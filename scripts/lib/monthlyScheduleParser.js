/**
 * 月間スケジュール（boatrace.jp race/monthlyschedule）の全項目パーサー（純関数。ネットワーク・DB・fsに触れない）
 *
 * 設計: docs/design/racer-period-stats/plan.md（全データ設計 N16: 節メタ。ユーザー承認Q3）
 *
 * ページ仕様（2026-09-21に、2019-04・2026-09の実ページと、データ確認用に追加取得した数ページで確認）:
 *   URL: https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym=YYYYMM（選択肢は2016年〜）
 *   構造: 5つの地区表（table.is-spritedNone1）。表の見出し行（thead）が日付（「28 金」「1 火」…）で、
 *         対象月の前後4日ずつを含む（30日の月で38列。前月28日〜翌月4日）。
 *         会場ごとに1つのtbody（th内のリンクの jcd= が会場コード）。td が1日、colspan=N が N日間の節。
 *         td の class（is-gradeColor…）が節の色分け: SG / G1 / G2 / G3 / Lady（オールレディース）/
 *         Venus（ヴィーナスシリーズ）/ Rookie（ルーキーシリーズ）/ Takumi（マスターズリーグ）/ Ippan（一般）
 *         節名は td 内のリンク（a）の文字。リンクの hd= は「現在まで進行した節は最終日または当日、
 *         未来の節（race/assen）は初日」で、節の初日ではない（使わない）。
 *   ⚠️ 表の左端・右端に接する節は、窓の外へ続く可能性があり、節名のリンクが無い（実ページで、リンクの無い
 *      節は全て端に接していた）。開始日・終了日が確定できないため、隣の月のページと突き合わせて確定する
 *      （mergeMonthlySchedules）。節は最長でも7日程度で、前後4日の余白があるため、隣の月のページで必ず全体が見える。
 *
 * 出力（monthly-schedule/v1）は、DBに入れる項目に絞らず、ページの全項目（色分けの原文・リンクの種別・
 * 列位置）を保持する。想定外の構造（日付の不一致、端以外でリンクの無い節、未知の色分け）は
 * 握りつぶさず anomalies に残す。
 */

import * as cheerio from "cheerio";

export const MS_SCHEMA = "monthly-schedule/v1";
export const MS_BASE_URL =
  "https://www.boatrace.jp/owpc/pc/race/monthlyschedule";
export const MS_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

/** 公式の選択肢の最古（2016年）。取得できる最古は未確認（2019-04は確認済み） */
export const MS_EARLIEST_YM = "201601";

export function buildMonthlyScheduleUrl(ym) {
  parseYm(ym);
  return `${MS_BASE_URL}?ym=${ym}`;
}

/** 'YYYYMM' → {year, month} */
export function parseYm(ym) {
  const m = /^(\d{4})(\d{2})$/.exec(ym ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12)
    throw new Error(`年月の形式が不正です（YYYYMM）: ${ym}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** from〜to（YYYYMM、両端含む）の年月を古い順に返す */
export function listYms(from, to) {
  const a = parseYm(from);
  const b = parseYm(to);
  const out = [];
  let { year, month } = a;
  while (year < b.year || (year === b.year && month <= b.month)) {
    out.push(`${year}${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** 色分けの原文 → 種別。グレード（SG/G1/G2/G3/一般）が確定するのは SG・G1・G2・G3・Ippan のみ */
export const CLASS_CODES = Object.freeze({
  SG: { grade: "SG", kind: "sg" },
  G1: { grade: "G1", kind: "g1" },
  G2: { grade: "G2", kind: "g2" },
  G3: { grade: "G3", kind: "g3" },
  Ippan: { grade: "ippan", kind: "ippan" },
  // 特別なシリーズ。色分けは1色で、グレード（G3相当か一般か）は色分けからは分からない
  Lady: { grade: null, kind: "lady" }, // オールレディース
  Venus: { grade: null, kind: "venus" }, // ヴィーナスシリーズ
  Rookie: { grade: null, kind: "rookie" }, // ルーキーシリーズ
  Takumi: { grade: null, kind: "masters" }, // マスターズリーグ
});

const DAY_MS = 24 * 60 * 60 * 1000;
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso, n) => isoOf(msOf(iso) + n * DAY_MS);
export const daysBetween = (fromIso, toIso) =>
  Math.round((msOf(toIso) - msOf(fromIso)) / DAY_MS);

/**
 * 月間スケジュールのHTMLを解析する。
 * @param {string} html
 * @param {string} ym 取得した月（YYYYMM）。ページの選択中の年月と突き合わせる
 */
export function parseMonthlySchedule(html, ym) {
  const { year, month } = parseYm(ym);
  const $ = cheerio.load(html);
  const anomalies = [];

  // ページ自身が示す年月（選択中の option。年→月の順に2つ）と、要求した ym の一致
  const selected = $("select option[selected]")
    .map((_, e) => $(e).attr("value"))
    .get()
    .filter((v) => /^\d+$/.test(v ?? ""));
  if (
    selected.length >= 2 &&
    `${selected[0]}${selected[1].padStart(2, "0")}` !== ym
  )
    anomalies.push({
      problem: `ページの年月 ${selected[0]}-${selected[1]} が要求（${ym}）と一致しません`,
    });

  const tables = $("table.is-spritedNone1");
  if (tables.length === 0)
    throw new Error("月間スケジュールの表が見つかりません（構造の変更の疑い）");

  // 列の日付。見出しの日の数字から、対象月の1日の列を特定し、他の列は日数の差で決める
  const heads = tables
    .first()
    .find("thead th")
    .map((_, e) => $(e).text().trim())
    .get()
    .slice(1)
    .map((t) => Number.parseInt(t, 10));
  if (heads.length === 0 || heads.some((d) => !Number.isInteger(d)))
    throw new Error("月間スケジュールの見出し（日付）を読めません");
  const firstOfMonth = heads.indexOf(1);
  if (firstOfMonth < 0)
    throw new Error("月間スケジュールの見出しに1日の列がありません");
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const columnDates = heads.map((_, i) =>
    addDays(monthStart, i - firstOfMonth),
  );
  // 検証: 全列の日の数字が、計算した日付の日と一致する
  columnDates.forEach((d, i) => {
    if (Number(d.slice(8, 10)) !== heads[i])
      anomalies.push({
        problem: `見出しの日 ${heads[i]} が計算した日付 ${d} と一致しません（列 ${i + 1}）`,
      });
  });
  const totalCols = heads.length;

  const venues = [];
  tables.each((_, table) => {
    $(table)
      .find("tbody")
      .each((__, tb) => {
        const jcd = /jcd=(\d+)/.exec(
          $(tb).find("th a").attr("href") ?? "",
        )?.[1];
        if (!jcd) {
          anomalies.push({ problem: "会場コードを読めない行があります" });
          return;
        }
        const segments = [];
        let col = 1;
        $(tb)
          .find("td")
          .each((___, td) => {
            const span = Number($(td).attr("colspan") ?? 1);
            const cls = ($(td).attr("class") ?? "").match(
              /is-gradeColor(\w+)/,
            )?.[1];
            if (cls) {
              const a = $(td).find("a").first();
              const href = a.attr("href") ?? "";
              const seg = {
                col_start: col,
                col_end: col + span - 1,
                start_date: columnDates[col - 1] ?? null,
                end_date: columnDates[col + span - 2] ?? null,
                class_code: cls,
                title: a.length ? a.text().trim() : null,
                link_kind: /race\/(\w+)\?/.exec(href)?.[1] ?? null,
                edge_left: col === 1,
                edge_right: col + span - 1 === totalCols,
              };
              if (!CLASS_CODES[cls])
                anomalies.push({
                  venue_code: Number(jcd),
                  problem: `未知の色分け ${cls}（列 ${col}）`,
                });
              if (!a.length && !seg.edge_left && !seg.edge_right)
                anomalies.push({
                  venue_code: Number(jcd),
                  problem: `端以外の節に節名のリンクがありません（列 ${col}〜${seg.col_end}）`,
                });
              if (seg.start_date === null || seg.end_date === null)
                anomalies.push({
                  venue_code: Number(jcd),
                  problem: `列 ${col}〜${seg.col_end} が見出しの範囲外です`,
                });
              segments.push(seg);
            }
            col += span;
          });
        if (col - 1 !== totalCols)
          anomalies.push({
            venue_code: Number(jcd),
            problem: `列数 ${col - 1} が見出しの列数 ${totalCols} と一致しません`,
          });
        venues.push({ venue_code: Number(jcd), segments });
      });
  });

  return {
    schema: MS_SCHEMA,
    ym,
    window: { from: columnDates[0], to: columnDates[totalCols - 1] },
    venues,
    anomalies,
  };
}

/**
 * 複数の月のページ（parseMonthlySchedule の出力）から、節（会場×開始日）を確定する。
 * 端に接する節（節名のリンクが無い）は、隣の月のページで全体が見えるものと日付が重なるため、
 * 同じ会場で日付が重なる節を1つに束ねて、開始日の最小・終了日の最大を採る。
 * 指定した月の範囲の両端（最初の月の前端・最後の月の後端）で、隣のページが無いために確定できない節は
 * unresolved に返す（呼び出し側が、範囲を前後1か月広げて再取得する）。
 * @param {Array<ReturnType<typeof parseMonthlySchedule>>} pages
 * @returns {{series: object[], unresolved: object[], anomalies: object[]}}
 */
export function mergeMonthlySchedules(pages) {
  const anomalies = [];
  const perVenue = new Map();
  for (const page of pages) {
    for (const v of page.venues) {
      for (const s of v.segments) {
        const list = perVenue.get(v.venue_code) ?? [];
        list.push({ ...s, ym: page.ym, window: page.window });
        perVenue.set(v.venue_code, list);
      }
    }
  }
  const series = [];
  const unresolved = [];
  for (const [venue_code, segs] of [...perVenue.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    segs.sort((a, b) => a.start_date.localeCompare(b.start_date));
    // 日付が重なる節を束ねる（同じ会場の別の節は、日付が重ならない）
    const groups = [];
    for (const s of segs) {
      const g = groups.at(-1);
      if (g && s.start_date <= g.maxEnd) {
        g.items.push(s);
        if (s.end_date > g.maxEnd) g.maxEnd = s.end_date;
      } else groups.push({ items: [s], maxEnd: s.end_date });
    }
    for (const g of groups) {
      // 確定した端: 左端に接していない節の開始日、右端に接していない節の終了日
      const starts = g.items
        .filter((i) => !i.edge_left)
        .map((i) => i.start_date);
      const ends = g.items.filter((i) => !i.edge_right).map((i) => i.end_date);
      const titles = [...new Set(g.items.map((i) => i.title).filter(Boolean))];
      const classes = [...new Set(g.items.map((i) => i.class_code))];
      const dates = {
        min: g.items.map((i) => i.start_date).sort()[0],
        max: g.maxEnd,
      };
      if (titles.length > 1)
        anomalies.push({
          venue_code,
          problem: `同じ節に複数の節名: ${JSON.stringify(titles)}（${dates.min}〜${dates.max}）`,
        });
      if (classes.length > 1)
        anomalies.push({
          venue_code,
          problem: `同じ節に複数の色分け: ${JSON.stringify(classes)}（${dates.min}〜${dates.max}）`,
        });
      if (starts.length === 0 || ends.length === 0) {
        unresolved.push({
          venue_code,
          seen_from: dates.min,
          seen_to: dates.max,
          class_code: classes[0],
          title: titles[0] ?? null,
          reason:
            starts.length === 0
              ? "開始日が窓の外（隣の月のページが必要）"
              : "終了日が窓の外（隣の月のページが必要）",
        });
        continue;
      }
      const start_date = starts.sort()[0];
      const end_date = ends.sort().at(-1);
      if (start_date > end_date) {
        anomalies.push({
          venue_code,
          problem: `開始日 ${start_date} が終了日 ${end_date} より後です`,
        });
        continue;
      }
      // 端の節が、確定した節の範囲を超えていないこと（束ねた節の整合）
      if (dates.min < start_date || dates.max > end_date) {
        // 端に接した断片は確定した節の範囲内に収まるはず。超えるなら別の節が重なっている
        anomalies.push({
          venue_code,
          problem: `束ねた節の範囲（${dates.min}〜${dates.max}）が確定した範囲（${start_date}〜${end_date}）を超えています`,
        });
      }
      const cls = classes[0];
      series.push({
        venue_code,
        start_date,
        end_date,
        total_days: daysBetween(start_date, end_date) + 1,
        title: titles[0] ?? null,
        class_code: cls,
        grade: CLASS_CODES[cls]?.grade ?? null,
        kind: CLASS_CODES[cls]?.kind ?? null,
        source_yms: [...new Set(g.items.map((i) => i.ym))].sort(),
      });
    }
  }
  series.sort(
    (a, b) =>
      a.start_date.localeCompare(b.start_date) || a.venue_code - b.venue_code,
  );
  return { series, unresolved, anomalies };
}

/** 集計（ログ・検証用） */
export function summarizeMonthlySchedule(page) {
  return {
    ym: page.ym,
    window: page.window,
    venues: page.venues.length,
    segments: page.venues.reduce((a, v) => a + v.segments.length, 0),
    anomalies: page.anomalies.length,
  };
}
