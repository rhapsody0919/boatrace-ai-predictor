/**
 * verify-motor-pretest.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-motor-pretest.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  parseMotorPretestHtml,
  competitionRanks,
  MOTOR_PRETEST_STATUSES,
  readHeaderLabels,
  buildMotorPretestUrl,
} from "../../lib/motorPretestParser.js";
import * as cheerio from "cheerio";

let check, show, same, TODA, TOKUYAMA, TOKUYAMA_BY_TIME, SALADPAN, TOKONAME, OMURA, NO_DATA;

function scene1() {
  // ===========================================================================
  // (a) パーサー
  // ===========================================================================
  {
    const p = parseMotorPretestHtml(TODA);
    check(
      "パーサー 戸田(2026-09-21): 会場・日付・開催名・46人を読む",
      p.status === "ok" &&
        p.venueCode === 2 &&
        p.date === "2026-09-21" &&
        p.seriesTitle === "BOATBoyカップ" &&
        p.rows.length === 46 &&
        p.anomalies.length === 0,
      show({ status: p.status, v: p.venueCode, d: p.date, n: p.rows.length }),
    );
    check(
      "パーサー 荒井翔伍(4608): 級別A2・モーター43(66.6%)・ボート55(0.0%)・前検タイム6.65",
      same(p.rows[0], {
        racer_id: 4608,
        racer_class: "A2",
        motor_number: 43,
        motor_2rate: 66.6,
        boat_number: 55,
        boat_2rate: 0,
        pretest_time: 6.65,
        pretest_rank: 22,
      }),
      show(p.rows[0]),
    );
    check(
      "パーサー 開催名の全角は、NFKCで正規化する（ＢＯＡＴＢｏｙカップ → BOATBoyカップ）",
      p.seriesTitle === "BOATBoyカップ",
    );
  }
  {
    // 前検順位: 前検タイムの昇順のページの「順位」（公式）と、本パーサーが計算する前検順位が、全員で一致する
    const $ = cheerio.load(TOKUYAMA_BY_TIME);
    const official = new Map();
    $(".table1 tbody tr").each((_, tr) => {
      const tds = $(tr)
        .children("td")
        .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
        .get();
      official.set(Number(tds[1]), Number(tds[0]));
    });
    const sorted = parseMotorPretestHtml(TOKUYAMA_BY_TIME);
    const defaultPage = parseMotorPretestHtml(TOKUYAMA);
    const mismatched = sorted.rows.filter(
      (r) => official.get(r.racer_id) !== r.pretest_rank,
    );
    check(
      "前検順位: 前検タイム昇順のページの公式の「順位」と、前検タイムから計算した順位が、45人全員で一致する（同タイムは同順位・次は飛ぶ）",
      sorted.rows.length === 45 &&
        official.size === 45 &&
        mismatched.length === 0,
      show(mismatched.slice(0, 3)),
    );
    // 既定の並び（モーター2連対率）のページでも、同じ選手・同じ前検順位になる（ページの「順位」列を読んでいない）
    const byId = (rows) => new Map(rows.map((r) => [r.racer_id, r.pretest_rank]));
    const a = byId(sorted.rows);
    const b = byId(defaultPage.rows);
    check(
      "前検順位: 並び順（sort）に依らない（既定のページと前検タイム昇順のページで、同じ選手は同じ前検順位）",
      [...a.entries()].every(([id, rank]) => b.get(id) === rank),
    );
    const first = defaultPage.rows.find((r) => r.racer_id === 4529);
    check(
      "前検順位: 既定のページで「順位1」の嶋義信(4529)の前検順位は2（ページの「順位」＝モーター2連対率の順位を、前検順位にしない）",
      first?.pretest_rank === 2 && first?.motor_2rate === 50.9,
      show(first),
    );
    check(
      "competitionRanks: 同じ値は同順位・次は飛ぶ・nullは順位なし",
      same(competitionRanks([6.7, 6.65, 6.65, null, 7]), [3, 1, 1, null, 4]),
    );
  }
}

function scene2() {
  {
    const nd = parseMotorPretestHtml(NO_DATA);
    check(
      "パーサー 開催の無い日・会場（データがありません）は no_data・0行",
      nd.status === MOTOR_PRETEST_STATUSES.noData && nd.rows.length === 0,
      show(nd),
    );
    const mid = parseMotorPretestHtml(TOKONAME);
    const past = parseMotorPretestHtml(OMURA);
    const noClass = parseMotorPretestHtml(SALADPAN);
    check(
      "パーサー 過去日（常滑2025-12-05・52人、大村2025-12-04・45人）・グレード表示の無い開催（びわこ）も読める",
      mid.status === "ok" &&
        mid.rows.length === 52 &&
        past.status === "ok" &&
        past.rows.length === 45 &&
        past.date === "2025-12-04" &&
        noClass.status === "ok" &&
        noClass.rows.length === 45,
      show([mid.rows.length, past.rows.length, noClass.rows.length]),
    );
    check(
      "パーサー 全フィクスチャで、選手は重複せず、2連対率は0〜100・前検タイムは6〜8の範囲",
      [TODA, TOKUYAMA, SALADPAN, TOKONAME, OMURA].every((html) => {
        const rows = parseMotorPretestHtml(html).rows;
        return (
          new Set(rows.map((r) => r.racer_id)).size === rows.length &&
          rows.every(
            (r) =>
              r.motor_2rate >= 0 &&
              r.motor_2rate <= 100 &&
              r.boat_2rate >= 0 &&
              r.boat_2rate <= 100 &&
              r.pretest_time >= 6 &&
              r.pretest_time <= 8,
          )
        );
      }),
    );
    const $ = cheerio.load(TODA);
    check(
      "readHeaderLabels: 2段の見出しを、rowspan・colspan を展開して「親/子」のラベルにする",
      same(readHeaderLabels($, $(".table1 thead")), [
        "順位",
        "登録番号",
        "ボートレーサー",
        "級別",
        "モーター/番号",
        "モーター/2連対率",
        "ボート/番号",
        "ボート/2連対率",
        "前検タイム",
      ]),
    );
  }
}

function scene3() {
  {
    // 位置ではなくラベルで解釈する: 「前検タイム」の列を、見出しも各行のセルも、級別の右（列の途中）へ移した版でも、
    // 同じ選手・同じ値を読む（位置決め打ちなら、値が別の項目に入る）
    const $ = cheerio.load(TODA);
    const headRow = $(".table1 thead tr").first();
    const timeTh = headRow.children("th").last();
    timeTh.insertAfter(headRow.children("th").eq(3));
    $(".table1 tbody tr").each((_, tr) => {
      const cells = $(tr).children("td");
      cells.last().insertAfter(cells.eq(3));
    });
    const moved = parseMotorPretestHtml($.html());
    check(
      "パーサー ラベルの解釈: 前検タイムの列を級別の右へ移した版（列の位置が違う）でも、同じ結果を読む",
      moved.status === "ok" && same(moved.rows, parseMotorPretestHtml(TODA).rows),
      show({ status: moved.status, anomalies: moved.anomalies }),
    );
    const unknownHeader = TODA.replaceAll("前検タイム", "前検タイム（参考）");
    const u = parseMotorPretestHtml(unknownHeader);
    check(
      "パーサー 未知のラベルは unrecognized（unknown_header）。行は返さない",
      u.status === "unrecognized" &&
        u.rows.length === 0 &&
        u.anomalies.some((a) => a.startsWith("unknown_header:")),
      show(u.anomalies),
    );
    const missingHeader = TODA.replace(">級別<", ">階級<");
    const m = parseMotorPretestHtml(missingHeader);
    check(
      "パーサー 必須のラベルの欠落（級別が階級に変わった）は unrecognized（missing_header:racer_class）",
      m.status === "unrecognized" &&
        m.anomalies.includes("missing_header:racer_class"),
      show(m.anomalies),
    );
    const badCell = TODA.replace(/<td>6\.65\s*<\/td>/, "<td>abc</td>");
    const b = parseMotorPretestHtml(badCell);
    check(
      "パーサー 想定外のセル（前検タイム=abc）は unrecognized（bad_cell）。一部の行だけ返さない",
      b.status === "unrecognized" &&
        b.rows.length === 0 &&
        b.anomalies.some((a) => a.startsWith("bad_cell:")),
      show(b.anomalies),
    );
    const dup = TODA.replace(">3647<", ">4608<").replace(
      /toban=3647/g,
      "toban=4608",
    );
    const d = parseMotorPretestHtml(dup);
    check(
      "パーサー 選手の重複は unrecognized（duplicate_racer）",
      d.status === "unrecognized" &&
        d.anomalies.some((a) => a.startsWith("duplicate_racer:")),
      show(d.anomalies),
    );
    const blankTime = TODA.replace(/<td>6\.65\s*<\/td>/, "<td>-</td>");
    const bt = parseMotorPretestHtml(blankTime);
    check(
      "パーサー 前検タイムが「-」の選手（前検を受けていない）は、前検タイム・前検順位ともNULLで、他の順位に影響しない",
      bt.status === "ok" &&
        bt.rows[0].pretest_time === null &&
        bt.rows[0].pretest_rank === null &&
        bt.rows.filter((r) => r.pretest_rank !== null).length === 45,
      show(bt.rows[0]),
    );
    const noTable = "<html><body><main><p>何かのページ</p></main></body></html>";
    const nt = parseMotorPretestHtml(noTable);
    check(
      "パーサー 表もメッセージも無いページは unrecognized（table_not_found）。「開催なし」に化けさせない",
      nt.status === "unrecognized" && nt.anomalies.includes("table_not_found"),
      show(nt),
    );
    check(
      "buildMotorPretestUrl: 会場コード2桁・日付8桁。不正な入力は例外",
      buildMotorPretestUrl(2, "2026-09-21") ===
        "https://www.boatrace.jp/owpc/pc/race/rankingmotor?jcd=02&hd=20260921" &&
        (() => {
          try {
            buildMotorPretestUrl(25, "2026-09-21");
            return false;
          } catch {
            return true;
          }
        })() &&
        (() => {
          try {
            buildMotorPretestUrl(2, "20260921");
            return false;
          } catch {
            return true;
          }
        })(),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・TODA・TOKUYAMA・TOKUYAMA_BY_TIME・SALADPAN・TOKONAME・OMURA・NO_DATA） */
export function runMotorPretestScenes1(env) {
  ({ check, show, same, TODA, TOKUYAMA, TOKUYAMA_BY_TIME, SALADPAN, TOKONAME, OMURA, NO_DATA } = env);
  scene1();
  scene2();
  scene3();
}
