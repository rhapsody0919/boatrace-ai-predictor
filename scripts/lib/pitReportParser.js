/**
 * 公式のピットレポート（boatrace.jp race/pitreport）のパーサー（純関数。DB・取得先に接続しない）
 *
 * 目的: 選手コメント（自由記述）・コメント自信度（★）・前走を、そのまま取り出す（BOA-379、
 * docs/design/pit-comments/spec.md）。コメントは要約・改変せず、本文をそのまま保持する。
 *
 * ページの構造（2026-09-21に実ページで確認。fixtures は scripts/lib/__fixtures__/pitreport/）:
 *   - 見出し: `.heading2_title` の class にグレード（is-SGa / is-G1b / is-G2b / is-G3b / is-ippan）、
 *     `h2.heading2_titleName` に開催名。日付タブ（`.tab2_tabs` の `.is-active2`）に「9月18日」「３日目」
 *   - レース選択（thead の R1〜R12）と、「締切予定時刻」行（12レース分の HH:MM）
 *   - 艇ごとの行（`tbody` 6つ。各 `tr` にセル5つ）: 枠 / 写真 / 登録番号・級別・氏名・支部/出身地・年齢/体重 /
 *     コメント本文（`td.is-alignL`。末尾に「（コメント自信度・・★★☆）」。括弧は全角・半角の両方がある）/
 *     前走（`raceresult?rno=N` へのリンク。「7R」）
 *   - レポーター名（`.text p.h-floatR`。「レポーター：八王子　スゴ六」）。ページ単位
 *
 * コメントが無いページの種類（`.title12_title` のメッセージで区別できる。2026-09-21の実測）:
 *   - 「※ ピットレポートの表示対象レースではありません。」= そのレース（グレード）は対象外（G3・一般戦）
 *   - 「※ ピットレポートは7Rから12Rまでが表示対象レースになります。」= 対象グレード（G1・G2）だが、そのレース番号は対象外
 *     （SGは1Rから表示される）
 *   - 「データがありません。」= レース自体が無い（開催が無い日・会場）
 *   - 対象レースなのにコメントが未公開のとき（発走前）の表記は、status = "target_pending"（表もメッセージも無い、
 *     または表があるがコメントが全て空）で表す。実ページでの確認結果は spec.md の「公開時刻」を参照
 *
 * 想定外の構造（メッセージも表も無い）は status = "unrecognized" とし、呼び出し側が parse_anomaly として扱う
 * （黙って「コメント無し」にしない）。
 */

import * as cheerio from "cheerio";

export const PIT_REPORT_PARSER_VERSION = "pitreport/v1";

/** status の一覧（ページの状態。scrape_slots の outcome へは呼び出し側が写す） */
export const PIT_REPORT_STATUSES = Object.freeze({
  /** 1艇以上のコメントがある */
  comments: "comments",
  /** 対象グレードだが、このレース番号は対象外（G1・G2 の 1R〜6R） */
  notTargetRace: "not_target_race",
  /** このレースは対象外（G3・一般戦） */
  notTarget: "not_target",
  /** データがありません（レースが存在しない） */
  noData: "no_data",
  /** 対象レースだが、コメントがまだ無い（未公開） */
  targetPending: "target_pending",
  /** 想定外の構造 */
  unrecognized: "unrecognized",
});

const nfkc = (s) => (s ?? "").normalize("NFKC");
const squash = (s) => (s ?? "").replace(/[\s　]+/g, " ").trim();

/**
 * セルのテキストを、ブラウザの表示と同じ空白の扱いで取り出す。`<br>` は改行（本文の改行を保持する）、ソースの整形用の
 * 改行・連続した空白（ASCIIの空白・タブ・改行）は1つの空白にする。全角の空白（U+3000）・全角記号は、そのまま残す。
 */
function textWithBreaks($, el) {
  const clone = $(el).clone();
  clone.find("br").replaceWith("\u0001");
  return clone
    .text()
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/ ?\u0001 ?/g, "\n");
}

/**
 * 「（コメント自信度・・★★☆）」の末尾を、本文から分離する。
 * 括弧は全角・半角の両方、区切りの「・」の数・空白は揺れる。★＝塗り、☆＝空。
 *
 * @returns {{text: string, stars: number|null, starsMax: number|null}}
 *   text: 末尾の自信度を除いた本文（末尾の空白のみ除去。中身は変更しない）
 */
export function splitConfidence(raw) {
  const source = raw ?? "";
  const m = source.match(/[（(]\s*コメント自信度[・･.\s]*([★☆]+)\s*[）)]\s*$/u);
  if (!m)
    return { text: source.replace(/\s+$/u, ""), stars: null, starsMax: null };
  const marks = m[1];
  return {
    text: source.slice(0, m.index).replace(/\s+$/u, ""),
    stars: [...marks].filter((c) => c === "★").length,
    starsMax: [...marks].length,
  };
}

const GRADE_CLASS = /^is-(SG|PG1|G1|G2|G3|ippan)[a-z]?$/i;

function parseGrade($) {
  const cls = $(".heading2_title").first().attr("class") ?? "";
  for (const c of cls.split(/\s+/)) {
    const m = c.match(GRADE_CLASS);
    if (m) return m[1].toLowerCase() === "ippan" ? "ippan" : m[1].toUpperCase();
  }
  return null;
}

function parseRaceNumber($) {
  // 同ページ内の各タブのリンクは、表示中のレース番号（rno）を持つ
  const href = $("a[href*='race/beforeinfo?rno=']").first().attr("href") ?? "";
  const m = href.match(/rno=(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseDeadlines($) {
  const cells = $("tbody tr")
    .filter((_, tr) =>
      nfkc($(tr).find("td").first().text()).includes("締切予定時刻"),
    )
    .first()
    .find("td");
  const times = [];
  cells.each((i, td) => {
    if (i === 0) return;
    const t = squash($(td).text());
    if (/^\d{1,2}:\d{2}$/.test(t)) times.push(t);
  });
  return times;
}

function parseBoatRow($, tr) {
  const tds = $(tr).children("td");
  if (tds.length < 5) return null;
  const boatNumber = Number(nfkc($(tds[0]).text()).trim());
  if (!(boatNumber >= 1 && boatNumber <= 6)) return null;

  const info = $(tds[2]);
  const fs11 = info.find(".is-fs11");
  const idLine = squash(nfkc($(fs11[0]).text())); // 「4371 / A1」
  const idMatch = idLine.match(/^(\d{4})\s*\/\s*([A-Za-z0-9]+)$/);
  const attrLine = squash(
    nfkc(textWithBreaks($, fs11[1] ?? "")).replace(/\n/g, " "),
  ); // 「福岡/福岡 39歳/52.0kg」
  const attrMatch = attrLine.match(/^(.*?)\/(.*?)\s+(\d+)歳\/([\d.]+)kg$/);

  const rawComment = textWithBreaks($, tds[3]);
  const { text, stars, starsMax } = splitConfidence(rawComment);
  // 本文が空（コメント無しの艇）は null。自信度だけが残る場合は本文を空文字ではなく null にする
  const commentText = text.trim() === "" ? null : text;

  const prevLink = $(tds[4]).find("a").first();
  const prevHref = prevLink.attr("href") ?? "";
  const prevMatch = prevHref.match(/raceresult\?rno=(\d+)/);
  const prevText = squash(nfkc($(tds[4]).text()));

  return {
    boatNumber,
    racerNumber: idMatch ? Number(idMatch[1]) : null,
    racerClass: idMatch ? idMatch[2] : null,
    name: squash($(info).find(".is-fs18").first().text()) || null,
    branch: attrMatch ? attrMatch[1].trim() : null,
    hometown: attrMatch ? attrMatch[2].trim() : null,
    age: attrMatch ? Number(attrMatch[3]) : null,
    weightKg: attrMatch ? Number(attrMatch[4]) : null,
    commentText,
    confidenceStars: commentText === null ? null : stars,
    confidenceMax: commentText === null ? null : starsMax,
    previousRaceNumber: prevMatch ? Number(prevMatch[1]) : null,
    previousRaceText: prevText || null,
  };
}

/**
 * @param {string} html
 * @returns {{
 *   parserVersion: string,
 *   status: string,
 *   message: string|null,
 *   targetRange: {from: number, to: number}|null,
 *   grade: string|null,
 *   raceNumber: number|null,
 *   eventName: string|null,
 *   dayLabel: string|null,
 *   raceTitle: string|null,
 *   deadline: string|null,
 *   reporterName: string|null,
 *   boats: Array<Object>,
 *   anomalies: string[],
 * }}
 */
export function parsePitReportHtml(html) {
  const $ = cheerio.load(html ?? "");
  const anomalies = [];
  const grade = parseGrade($);
  const raceNumber = parseRaceNumber($);
  const deadlines = parseDeadlines($);
  const eventName = squash($("h2.heading2_titleName").first().text()) || null;
  const dayLabel =
    squash(nfkc($(".tab2_tabs .is-active2").first().text())) || null;
  const raceTitle =
    squash($("h3.title16_titleDetail__add2020").first().text()) || null;
  const reporterRaw = squash(
    $(".text.h-clear p.h-floatR")
      .first()
      .text()
      .replace(/^\s*レポーター[：:]/u, ""),
  );
  const message = squash($(".title12_title").first().text()) || null;

  const base = {
    parserVersion: PIT_REPORT_PARSER_VERSION,
    message,
    targetRange: null,
    grade,
    raceNumber,
    eventName,
    dayLabel,
    raceTitle,
    deadline:
      raceNumber !== null && deadlines[raceNumber - 1]
        ? deadlines[raceNumber - 1]
        : null,
    reporterName: reporterRaw || null,
    boats: [],
    anomalies,
  };

  // 艇ごとの行
  const rows = [];
  $("tbody tr").each((_, tr) => {
    if ($(tr).children("td").first().is("[class*='is-boatColor']")) {
      const boat = parseBoatRow($, tr);
      if (boat) rows.push(boat);
      else anomalies.push("艇の行を解析できませんでした");
    }
  });

  if (rows.length > 0) {
    if (rows.length !== 6)
      anomalies.push(`艇の行が${rows.length}件です（6件のはず）`);
    const numbers = rows.map((r) => r.boatNumber);
    if (new Set(numbers).size !== numbers.length)
      anomalies.push("枠番が重複しています");
    for (const r of rows) {
      if (r.racerNumber === null)
        anomalies.push(`${r.boatNumber}号艇の登録番号を解析できません`);
      // コメント自信度は、「【取材者寸評】」のコメントには付かない（null で正常）。前走は、その日まだ走っていない選手では
      // リンクの中身が空（`<a href="/owpc/pc/race/raceresult"></a>`）で、null が正常。リンクに rno があるのに読めないときだけ異常
      if (r.previousRaceText !== null && r.previousRaceNumber === null)
        anomalies.push(`${r.boatNumber}号艇の前走を解析できません: ${r.previousRaceText}`);
    }
    const hasComment = rows.some((r) => r.commentText !== null);
    return {
      ...base,
      status: hasComment
        ? PIT_REPORT_STATUSES.comments
        : PIT_REPORT_STATUSES.targetPending,
      boats: rows,
    };
  }

  // 表が無い: メッセージで区別する
  if (message) {
    const text = nfkc(message);
    // 「7Rから12Rまでが表示対象レースになります」「12Rが表示対象レースになります」（最終日）の両方がある
    const range = text.match(/(\d+)R(?:\s*から\s*(\d+)R\s*まで|\s*が)?.*表示対象レースになります/);
    if (range) {
      const from = Number(range[1]);
      return {
        ...base,
        status: PIT_REPORT_STATUSES.notTargetRace,
        targetRange: { from, to: range[2] ? Number(range[2]) : from },
      };
    }
    if (text.includes("表示対象レースではありません")) {
      return { ...base, status: PIT_REPORT_STATUSES.notTarget };
    }
    anomalies.push(`未知のメッセージです: ${message}`);
    return { ...base, status: PIT_REPORT_STATUSES.unrecognized };
  }
  if (nfkc($.root().text()).includes("データがありません")) {
    return { ...base, status: PIT_REPORT_STATUSES.noData };
  }
  // 見出し・レース選択はあるが表もメッセージも無い: 対象レースの未公開の可能性（実測で確認。spec.md）
  if (grade !== null && raceNumber !== null) {
    return { ...base, status: PIT_REPORT_STATUSES.targetPending };
  }
  anomalies.push("ピットレポートの表・メッセージのいずれも見つかりません");
  return { ...base, status: PIT_REPORT_STATUSES.unrecognized };
}
