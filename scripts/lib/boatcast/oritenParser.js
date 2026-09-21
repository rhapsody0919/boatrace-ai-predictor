/**
 * BOATCASTのオリジナル展示（bc_oriten）ファイルの解析（純関数。DB・取得先に接続しない）。
 *
 * ファイルは、レース単位のTSVテキスト（UTF-8、Content-Type: text/plain）。2026-09-21の実測:
 *
 *   data=
 *   1<TAB>3                        ← 計測状態（1=計測あり / 2=計測不可）<TAB>項目数
 *   一(U+3000)周<TAB>まわり足<TAB>直(U+3000)線   ← 項目名（会場により異なる。全角スペース U+3000 を含む）
 *   1<TAB>泉(U+3000)(U+3000)具巳<TAB>37.73<TAB>5.63<TAB>6.07   ← 枠番<TAB>選手名<TAB>各項目の値（秒）
 *   ...
 *
 * 計測不可（状態2）のファイルは、項目名の行までで、選手の行が無い（下関 2026-09-16 6R で確認）。
 * 値が `--.--` の項目は欠測（津・三国の一周など）。
 *
 * 項目は「位置」ではなく「ラベル」で解釈する（会場・日によって、項目の構成が異なりうるため）。
 * ラベルは、空白（全角スペースを含む）を全て除いた表記に正規化する（一(U+3000)周 → 一周）。
 *
 * 異常の扱い（2段階）:
 *   anomalies       構造の異常（書き込まない）。想定外の形式・列数の不一致・数値でない値など
 *   unknownLabels   既知でないラベル（値は保存し、parse_anomalyとして通知する。取りこぼさない）
 */
import { KNOWN_ORITEN_LABELS } from "./publicMap.js";

export const ORITEN_PARSER_VERSION = "boatcast-oriten-1";

export const ORITEN_STATUSES = Object.freeze({
  /** 計測あり（値の行がある） */
  measured: "measured",
  /** 計測不可（項目名の行のみ） */
  unmeasurable: "unmeasurable",
  /** 想定外の構造（書き込まない） */
  unrecognized: "unrecognized",
});

/** 計測状態（1行目の1列目）→ 保存する値 */
export const MEASURE_STATUS = Object.freeze({ measured: 1, unmeasurable: 2 });

const NUMERIC_RE = /^\d{1,3}\.\d{2}$/;
// 欠測の表記。実測は `--.--`。ハイフンだけの近い表記（`-.--`、`--.-` 等）も欠測として受ける
const MISSING_RE = /^-+\.-+$/;

/** 全ての空白（全角スペースを含む）を除く */
export function normalizeLabel(text) {
  return String(text).replace(/[\s\u3000]+/g, "");
}

/**
 * @param {string} text ファイルの本文
 * @returns {{
 *   status: string,
 *   measureFlag: number|null,
 *   declaredItemCount: number|null,
 *   labels: string[],
 *   rows: Array<{boatNumber: number, racerName: string, values: Array<number|null>}>,
 *   unknownLabels: string[],
 *   anomalies: string[],
 *   parserVersion: string,
 * }}
 */
export function parseOritenText(text) {
  const result = {
    status: ORITEN_STATUSES.unrecognized,
    measureFlag: null,
    declaredItemCount: null,
    labels: [],
    rows: [],
    unknownLabels: [],
    anomalies: [],
    parserVersion: ORITEN_PARSER_VERSION,
  };
  const fail = (message) => {
    result.anomalies.push(message);
    return result;
  };

  if (typeof text !== "string" || text.length === 0) {
    return fail("本文が空です");
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // 末尾の改行による空要素だけを除く（途中の空行は、列数の不一致として下で構造の異常になる）
  if (lines[lines.length - 1] === "") lines.pop();

  if (lines[0]?.trim() !== "data=") {
    return fail(
      `先頭の行が data= ではありません（HTMLのエラーページ等の可能性）: ${lines[0]?.slice(0, 40) ?? ""}`,
    );
  }
  const head = (lines[1] ?? "").split("\t");
  const flag = Number(head[0]);
  const count = Number(head[1]);
  if (
    head.length !== 2 ||
    !/^\d+$/.test(head[0]) ||
    !/^\d+$/.test(head[1]) ||
    ![1, 2].includes(flag)
  ) {
    return fail(
      `計測状態・項目数の行を解釈できません: ${lines[1] ?? "(なし)"}`,
    );
  }
  result.measureFlag = flag;
  result.declaredItemCount = count;
  if (count < 1 || count > 6) {
    return fail(`項目数が想定外です: ${count}`);
  }

  const rawLabels = (lines[2] ?? "").split("\t");
  result.labels = rawLabels.map(normalizeLabel);
  if (rawLabels.length !== count || result.labels.some((l) => l === "")) {
    return fail(
      `項目名の数(${rawLabels.length})が項目数(${count})と一致しないか、空の項目名があります: ${lines[2] ?? "(なし)"}`,
    );
  }
  if (new Set(result.labels).size !== result.labels.length) {
    return fail(`項目名が重複しています: ${result.labels.join(",")}`);
  }
  result.unknownLabels = result.labels.filter(
    (l) => !KNOWN_ORITEN_LABELS.includes(l),
  );

  const bodyLines = lines.slice(3);
  if (flag === 2) {
    // 計測不可: 選手の行が無い。行があれば、意味が分からないため書かない
    if (bodyLines.length > 0) {
      return fail(`計測不可なのに選手の行があります（${bodyLines.length}行）`);
    }
    result.status = ORITEN_STATUSES.unmeasurable;
    return result;
  }

  if (bodyLines.length === 0) {
    return fail("計測ありなのに選手の行がありません");
  }
  const seen = new Set();
  for (const line of bodyLines) {
    const cols = line.split("\t");
    if (cols.length !== 2 + count) {
      return fail(
        `選手の行の列数(${cols.length})が想定(${2 + count})と一致しません: ${line.slice(0, 60)}`,
      );
    }
    const [boat, name, ...rawValues] = cols;
    const boatNumber = Number(boat);
    if (!/^[1-6]$/.test(boat)) {
      return fail(`枠番が1〜6ではありません: ${boat}`);
    }
    if (seen.has(boatNumber)) {
      return fail(`枠番が重複しています: ${boatNumber}`);
    }
    seen.add(boatNumber);
    const values = [];
    for (const raw of rawValues) {
      const v = raw.trim();
      if (NUMERIC_RE.test(v)) values.push(Number(v));
      else if (MISSING_RE.test(v)) values.push(null);
      else return fail(`値が数値でも欠測表記でもありません: ${raw}`);
    }
    result.rows.push({
      boatNumber,
      racerName: normalizeLabel(name),
      values,
    });
  }
  result.rows.sort((a, b) => a.boatNumber - b.boatNumber);
  result.status = ORITEN_STATUSES.measured;
  return result;
}

/** bc_mst（モーター使用開始日）の本文（`YYYYMMDD` の1行）を解釈する。不正なら null */
export function parseMotorStartDate(text) {
  const m = /^(\d{4})(\d{2})(\d{2})\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(mo) ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}
