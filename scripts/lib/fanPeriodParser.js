/**
 * 公式「レーサー期別成績」ファイル（fan）の全項目パーサー（純関数。ネットワーク・DB・fsに触れない）
 *
 * 設計: docs/design/racer-period-stats/plan.md（全データ設計 N13・N21・N22。選手系の取得元を
 *       選手別スクレイピング（B6）からfanへ置き換える。ユーザー承認Q2、2026-09-20）
 *
 * データ仕様（公式ダウンロードページ extra/data/download.html、レイアウト extra/data/layout.html）:
 *   URL: https://www.boatrace.jp/static_extra/pc_static/download/data/kibetsu/fan{YYMM}.lzh
 *        2001年10月（fan0110）〜。年2回（04月・10月）。2026-09-21時点で50ファイル
 *   中身: Shift_JIS(cp932) の固定長テキスト。1レコード=1選手（CRLF区切り）。LZH(LH5)圧縮
 *         1レコード416バイト（2014年4月分 fan1404 以降）。〜2013年10月分は410バイト（出身地6バイトが無い）
 *   1ファイル=全選手の1期分（約1,550〜1,650人）。約170〜185KB。
 *
 * ⚠️ 固定長は「バイト幅」。全角が2バイトのため、文字列に直してから桁で切ると位置がずれる。
 *    バイト列のまま項目を切り出し、項目ごとにデコードする。
 *
 * 出力は「今DBに入れる項目」に絞らず、レイアウトの全項目を保持する中間形式（fan-period/v1）。
 * 生のLZHを保管しているため、項目を増やす・解釈を直すときは parse をやり直すだけでよい（再取得不要）。
 * 想定外の値（数字でない桁、未知の年号、期間の不一致等）は握りつぶさず anomalies に残す。
 * DBへ入れる列の選択は scripts/lib/fanPeriodRows.js が中間形式から行う。
 */

export const FAN_SCHEMA = "fan-period/v1";
export const FAN_BASE_URL =
  "https://www.boatrace.jp/static_extra/pc_static/download/data/kibetsu";
export const FAN_DOWNLOAD_PAGE_URL =
  "https://www.boatrace.jp/owpc/pc/extra/data/download.html";
export const FAN_LAYOUT_PAGE_URL =
  "https://www.boatrace.jp/owpc/pc/extra/data/layout.html";
export const FAN_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

/** 公式が提供する最古のファイル（2026-09-21確認） */
export const FAN_EARLIEST_ID = "fan0110";

export const FAN_RECORD_BYTES = 416;
/** 出身地（6バイト）が無い旧レイアウト（fan0110〜fan1310で確認。fan1404以降は416） */
export const FAN_RECORD_BYTES_NO_HOMETOWN = 410;

// ---------------------------------------------------------------------------
// ファイル名（fan{YYMM}）
// ---------------------------------------------------------------------------

/** fan{YYMM} → {year(西暦), month}。04・10 以外は不正（年2回のみ） */
export function parseFanId(id) {
  const m = /^fan(\d{2})(\d{2})$/.exec(id ?? "");
  if (!m) throw new Error(`ファイル名の形式が不正です（fanYYMM）: ${id}`);
  const month = Number(m[2]);
  if (month !== 4 && month !== 10)
    throw new Error(`ファイル名の月は 04 か 10 です: ${id}`);
  return { year: 2000 + Number(m[1]), month };
}

/** 西暦・月 → fan{YYMM} */
export function fanIdOf(year, month) {
  return `fan${String(year % 100).padStart(2, "0")}${String(month).padStart(2, "0")}`;
}

export function buildFanUrl(id) {
  parseFanId(id);
  return `${FAN_BASE_URL}/${id}.lzh`;
}

/** アーカイブ内の相対パス。公式のURL構造（kibetsu/）に揃える */
export function fanArchiveRelPath(id) {
  parseFanId(id);
  return `kibetsu/${id}.lzh`;
}

/**
 * from〜to（fan{YYMM}、両端含む）の全ファイル名を古い順に返す。年2回（04・10）で、
 * 2001年10月（fan0110）から2026年4月（fan2604）まで50ファイル。
 */
export function listFanIds(fromId = FAN_EARLIEST_ID, toId) {
  const from = parseFanId(fromId);
  const to = parseFanId(toId);
  const ids = [];
  let { year, month } = from;
  while (year < to.year || (year === to.year && month <= to.month)) {
    ids.push(fanIdOf(year, month));
    if (month === 4) month = 10;
    else {
      month = 4;
      year += 1;
    }
  }
  return ids;
}

/**
 * 公開済みのはずの最新ファイル名（暦の上での期待。実在は取得して確認する）。
 * 4月分は4月中に、10月分は10月中に公開されるとは限らない（Last-Modifiedの実測:
 * fan2510=2025-11-15、fan2604=2026-06-29、fan2404=2024-05-29）。そのため、期待するファイルは
 * 「その月の1日以降」に現れるものとして、取得を試み、404なら未公開として翌日以降に再試行する。
 * @param {Date} now
 */
export function latestExpectedFanId(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  if (m >= 10) return fanIdOf(y, 10);
  if (m >= 4) return fanIdOf(y, 4);
  return fanIdOf(y - 1, 10);
}

// ---------------------------------------------------------------------------
// レイアウト（layout.html）。バイト幅。パーサーはこの表から項目を読む（幅を別の場所に書かない）
// ---------------------------------------------------------------------------

// [キー, バイト幅, 型, 項目名（異常の報告用）]。レイアウトの順序どおり。
// 型: int=整数（空白のみはnull）、text=文字列（前後の空白を除く）、raw=そのまま、d1/d2=整数を10または100で割る
const HEAD_FIELDS = [
  ["racer_id", 4, "int", "登番"],
  ["name", 16, "text", "名前漢字"],
  ["name_kana", 15, "text", "名前カナ"],
  ["branch", 4, "text", "支部"],
  ["grade", 2, "text", "級"],
  ["era", 1, "raw", "年号"],
  ["birth", 6, "raw", "生年月日"],
  ["sex", 1, "int", "性別"],
  ["age", 2, "int", "年齢"],
  ["height_cm", 3, "int", "身長"],
  ["weight_kg", 2, "int", "体重"],
  ["blood_type", 2, "text", "血液型"],
  ["win_rate", 4, "d2", "勝率"],
  ["top2_rate", 4, "d1", "複勝率"],
  ["first_count", 3, "int", "1着回数"],
  ["second_count", 3, "int", "2着回数"],
  ["starts", 3, "int", "出走回数"],
  ["finals", 2, "int", "優出回数"],
  ["wins", 2, "int", "優勝回数"],
  ["avg_st", 3, "d2", "平均スタートタイミング"],
];
// 進入コース1〜6の順に、コースごとに繰り返す
const COURSE_SUMMARY_FIELDS = [
  ["entries", 3, "int", "進入回数"],
  ["top2_rate", 4, "d1", "複勝率"],
  ["avg_st", 3, "d2", "平均スタートタイミング"],
  ["avg_start_rank", 3, "d2", "平均スタート順位"],
];
const TAIL_FIELDS = [
  ["grade_prev", 2, "text", "前期級"],
  ["grade_prev2", 2, "text", "前々期級"],
  ["grade_prev3", 2, "text", "前々々期級"],
  ["ability_prev", 4, "d2", "前期能力指数"],
  ["ability_now", 4, "d2", "今期能力指数"],
  ["period_year", 4, "int", "年"],
  ["period_no", 1, "int", "期"],
  ["calc_from", 8, "raw", "算出期間（自）"],
  ["calc_to", 8, "raw", "算出期間（至）"],
  ["training_term", 3, "int", "養成期"],
];
const COURSE_DETAIL_PLACES = 6; // 1〜6着回数（各3バイト）
const COURSE_DETAIL_MARKS = ["f", "l0", "l1", "k0", "k1", "s0", "s1", "s2"]; // 各2バイト
const NO_COURSE_MARKS = ["l0", "l1", "k0", "k1"]; // 各2バイト
const PLACE_BYTES = 3;
const MARK_BYTES = 2;
const HOMETOWN_BYTES = 6;

const sumWidths = (fields) => fields.reduce((a, [, w]) => a + w, 0);
const HEAD_BYTES = sumWidths(HEAD_FIELDS); // 82
const COURSE_SUMMARY_BYTES = sumWidths(COURSE_SUMMARY_FIELDS) * 6; // 78
const TAIL_BYTES = sumWidths(TAIL_FIELDS); // 38
const COURSE_DETAIL_BYTES =
  (COURSE_DETAIL_PLACES * PLACE_BYTES +
    COURSE_DETAIL_MARKS.length * MARK_BYTES) *
  6; // 204
const NO_COURSE_BYTES = NO_COURSE_MARKS.length * MARK_BYTES; // 8
/** 出身地を除く、レコードの長さ（旧レイアウト。410） */
export const FAN_RECORD_BYTES_EXPECTED_NO_HOMETOWN =
  HEAD_BYTES +
  COURSE_SUMMARY_BYTES +
  TAIL_BYTES +
  COURSE_DETAIL_BYTES +
  NO_COURSE_BYTES;

// ---------------------------------------------------------------------------
// 項目のデコード
// ---------------------------------------------------------------------------

const sjis = new TextDecoder("shift_jis");
const decode = (bytes) => sjis.decode(bytes);

/**
 * 数字だけの桁 → 整数。全て空白なら null（値なし）。数字以外が混ざれば undefined を返す（呼び出し側が anomaly にする）
 */
function intOf(text) {
  const t = text.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number.parseInt(t, 10) : undefined;
}

const ERAS = { T: 1911, S: 1925, H: 1988, R: 2018 };

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return undefined;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'。空白のみ → null。不正 → undefined */
function ymd8(text) {
  const t = text.trim();
  if (t === "") return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
}

/** 生年月日: 年号1桁 + YYMMDD */
function birthDate(era, yymmdd) {
  const base = ERAS[era.trim()];
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(yymmdd);
  if (base === undefined || !m) return undefined;
  return isoDate(base + Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * 1レコード（1選手）の解析。
 * @param {Uint8Array} rec CRLFを除いた1レコード
 * @returns {{record: object, problems: string[]}}
 */
export function parseFanRecord(rec) {
  const hasHometown = rec.length === FAN_RECORD_BYTES;
  if (!hasHometown && rec.length !== FAN_RECORD_BYTES_NO_HOMETOWN)
    throw new Error(
      `レコード長が想定外です（${FAN_RECORD_BYTES}または${FAN_RECORD_BYTES_NO_HOMETOWN}バイト）: ${rec.length}`,
    );
  const problems = [];
  let pos = 0;
  const take = (n) => {
    const s = decode(rec.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const int = (label, n) => {
    const raw = take(n);
    const v = intOf(raw);
    if (v === undefined) {
      problems.push(`${label}: 数字でない値 "${raw}"`);
      return null;
    }
    return v;
  };
  /** 表の1項目を読む */
  const field = ([, width, type, label], prefix = "") => {
    const name = `${prefix}${label}`;
    if (type === "text") return take(width).trim();
    if (type === "raw") return take(width);
    const v = int(name, width);
    if (v === null || type === "int") return v;
    return v / (type === "d1" ? 10 : 100);
  };
  const readAll = (fields, prefix = "") =>
    Object.fromEntries(fields.map((f) => [f[0], field(f, prefix)]));

  const head = readAll(HEAD_FIELDS);
  const birth = birthDate(head.era, head.birth);
  if (birth === undefined)
    problems.push(`生年月日: 不正な値 "${head.era}${head.birth}"`);
  head.birth_date = birth ?? null;
  delete head.era;
  delete head.birth;

  const courses = [];
  for (let c = 1; c <= 6; c++)
    courses.push({
      course: c,
      ...readAll(COURSE_SUMMARY_FIELDS, `${c}コース`),
    });

  const tail = readAll(TAIL_FIELDS);
  for (const [key, label] of [
    ["calc_from", "算出期間（自）"],
    ["calc_to", "算出期間（至）"],
  ]) {
    const raw = tail[key];
    tail[key] = ymd8(raw);
    if (tail[key] === undefined) {
      problems.push(`${label}: 不正な値 "${raw}"`);
      tail[key] = null;
    }
  }

  for (const course of courses) {
    const c = course.course;
    course.places = [];
    for (let p = 1; p <= COURSE_DETAIL_PLACES; p++)
      course.places.push(int(`${c}コース${p}着回数`, PLACE_BYTES));
    for (const mark of COURSE_DETAIL_MARKS)
      course[mark] = int(`${c}コース${mark.toUpperCase()}回数`, MARK_BYTES);
  }
  const no_course = {};
  for (const mark of NO_COURSE_MARKS)
    no_course[mark] = int(`コースなし${mark.toUpperCase()}回数`, MARK_BYTES);

  const hometown = hasHometown ? take(HOMETOWN_BYTES).trim() : null;

  if (pos !== rec.length)
    throw new Error(
      `内部エラー: 読み取り位置 ${pos} がレコード長 ${rec.length} と一致しません`,
    );
  return {
    record: { ...head, ...tail, courses, no_course, hometown },
    problems,
  };
}

/** バイト列をCRLFで分割する（末尾の空行は捨てる） */
function splitRecords(bytes) {
  const recs = [];
  let start = 0;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      recs.push(bytes.subarray(start, i));
      start = i + 2;
      i++;
    }
  }
  if (start < bytes.length) recs.push(bytes.subarray(start));
  return recs.filter((r) => r.length > 0);
}

/**
 * fanファイル（LZH展開後のバイト列）を全項目の中間形式にする。
 * @param {Uint8Array} bytes
 * @param {{id: string, source?: object}} opts id は fan{YYMM}
 */
export function parseFanFile(bytes, { id, source = null }) {
  const hint = parseFanId(id);
  const anomalies = [];
  const records = [];
  const seen = new Set();
  const layouts = new Set();
  for (const [i, rec] of splitRecords(bytes).entries()) {
    layouts.add(rec.length);
    let parsed;
    try {
      parsed = parseFanRecord(rec);
    } catch (e) {
      anomalies.push({ index: i + 1, problem: e.message });
      continue;
    }
    const { record, problems } = parsed;
    for (const p of problems)
      anomalies.push({ index: i + 1, racer_id: record.racer_id, problem: p });
    if (record.racer_id !== null && seen.has(record.racer_id))
      anomalies.push({
        index: i + 1,
        racer_id: record.racer_id,
        problem: "登番が重複しています",
      });
    seen.add(record.racer_id);
    records.push(record);
  }

  // 全レコードで年・期・算出期間が一致すること（1ファイル=1期）
  const keyOf = (r) =>
    `${r.period_year}|${r.period_no}|${r.calc_from}|${r.calc_to}`;
  const counts = new Map();
  for (const r of records)
    counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  const [mainKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [
    null,
  ];
  if (counts.size > 1)
    anomalies.push({
      problem: `期の異なるレコードが混在しています: ${JSON.stringify([...counts])}`,
    });
  const main = records.find((r) => keyOf(r) === mainKey) ?? null;
  const period = main
    ? {
        year: main.period_year,
        no: main.period_no,
        calc_from: main.calc_from,
        calc_to: main.calc_to,
      }
    : null;
  // ファイル名（公開年月）と期の対応: 04月分=その年の2期（算出 11/1〜4/30）、10月分=翌年の1期（算出 5/1〜10/31）
  if (period) {
    const expectYear = hint.month === 4 ? hint.year : hint.year + 1;
    const expectNo = hint.month === 4 ? 2 : 1;
    if (period.year !== expectYear || period.no !== expectNo)
      anomalies.push({
        problem: `ファイル名 ${id} と期が一致しません（期待 ${expectYear}年${expectNo}期、実際 ${period.year}年${period.no}期）`,
      });
  }

  return {
    schema: FAN_SCHEMA,
    id,
    source,
    layout_bytes: [...layouts].sort((a, b) => a - b),
    period,
    record_count: records.length,
    records,
    anomalies,
  };
}

/** 集計（ログ・検証用） */
export function summarizeFan(fan) {
  return {
    id: fan.id,
    period: fan.period,
    records: fan.record_count,
    layout_bytes: fan.layout_bytes,
    anomalies: fan.anomalies.length,
  };
}

export const _internal = {
  HEAD_BYTES,
  COURSE_SUMMARY_BYTES,
  TAIL_BYTES,
  COURSE_DETAIL_BYTES,
  NO_COURSE_BYTES,
  splitRecords,
  intOf,
  birthDate,
  ymd8,
};
