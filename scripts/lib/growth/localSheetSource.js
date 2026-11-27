/**
 * seo-morning-sheet の「手元の JSON」の読み口（--local-dir）。Supabase の鍵を置かずに回すための入口。
 * 読むのは google-detail-collect.js の日別の出力（gsc_daily.json・gsc_page_daily.json。{meta, rows} か行の配列）と、
 * 任意の race_series の写し（--series。[{venue_code,start_date,end_date,title,grade}]）だけ。DB・API には触れない。
 * URL 検査は <dir>/url_inspection.json（google-detail-collect.js の URL ごとの最新の行の写し）。無いか0行なら「表が無い」注記（必須でないので緑を妨げない）。
 */
import fs from "node:fs";
import path from "node:path";

/** JSON の中身を行の配列にする。{meta, rows} も行の配列もよい。形が違えば投げる */
export function parseRows(data, label) {
  const rows = Array.isArray(data) ? data : data?.rows;
  if (!Array.isArray(rows)) throw new Error(`${label} は行の配列か { rows: [...] } でない`);
  return rows;
}

/** ファイルを読んで行の配列にする。無ければ null */
export function readRowsFile(file) {
  if (!fs.existsSync(file)) return null;
  return parseRows(JSON.parse(fs.readFileSync(file, "utf8")), file);
}

const maxDate = (rows) => rows.reduce((m, r) => (r.date > m ? r.date : m), "");
const between = (rows, from, to) => rows.filter((r) => r.date >= from && r.date <= to);
const byDate = (rows) => [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** ディレクトリ（と任意の series のファイル）から読み口を作る */
export function localSource(dir, seriesFile = null) {
  const daily = readRowsFile(path.join(dir, "gsc_daily.json"));
  if (daily === null) throw new Error(`${path.join(dir, "gsc_daily.json")} が無い（google-detail-collect.js の出力の置き場を渡す）`);
  const series = seriesFile ? readRowsFile(seriesFile) : [];
  if (series === null) throw new Error(`${seriesFile} が無い`);
  return sourceFromRows({
    daily,
    pageDaily: readRowsFile(path.join(dir, "gsc_page_daily.json")),
    series,
    inspections: readRowsFile(path.join(dir, "url_inspection.json")),
  });
}

/** seo-morning-sheet の読み口（Supabase の版と同じ口）。行は読み済みの配列（pageDaily・inspections は無ければ null）。試験はこちらにメモリの行を渡す */
export function sourceFromRows({ daily, pageDaily = null, series = [], inspections = null }) {
  const insp = inspections ?? [];
  const maxInspected = insp.reduce((m, r) => (r.inspected_on > m ? r.inspected_on : m), "");
  return {
    tableStats({ table, required }) {
      if (table === "growth_gsc_daily") return { table, required, rowCount: daily.length, maxDate: maxDate(daily) || null };
      if (table === "growth_gsc_page_daily" && pageDaily) return { table, required, rowCount: pageDaily.length, maxDate: maxDate(pageDaily) || null };
      if (table === "growth_url_inspection" && insp.length > 0) return { table, required, rowCount: insp.length, maxDate: maxInspected };
      return { table, required, missing: true };
    },
    daily: async (from, to) => byDate(between(daily, from, to)),
    series: async (from, to) => series.filter((s) => s.start_date <= to && s.end_date >= from),
    // inspected_on の昇順（呼び手は最後の行を最新として扱う）
    inspections: async () => [...insp].sort((a, b) => (a.inspected_on < b.inspected_on ? -1 : a.inspected_on > b.inspected_on ? 1 : 0)),
    pageDaily: async (from) => byDate((pageDaily ?? []).filter((r) => r.date >= from)),
  };
}
