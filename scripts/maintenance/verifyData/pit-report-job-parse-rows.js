/**
 * verify-pit-report-job.js の検査の続き（pit-report-job-parse-rows.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { FINAL_DAY, G3, IPPAN, NOT_TARGET_RACE, NO_DATA, PENDING, PENDING_REAL, R10, R12, same, show } from "./pit-report-job-fixtures.js";

// ---------------------------------------------------------------------------
// (a) 解析と (b) 行の組み立て を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
// ---------------------------------------------------------------------------
/** @returns {string[]} 失敗した項目のラベル */
export function evaluateParser(m) {
  const { failed, expect } = evaluateParserPart1(m);
  return evaluateParserPart2(m, failed, expect);
}

export function evaluateParserPart1(m) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const r12 = m.parsePitReportHtml(R12);
  expect("R12: status=comments", r12.status === "comments");
  expect(
    "R12: グレード・レース番号・締切・レポーター",
    r12.grade === "G1" &&
      r12.raceNumber === 12 &&
      r12.deadline === "16:30" &&
      r12.reporterName === "八王子 スゴ六",
  );
  expect(
    "R12: 登録番号",
    same(
      r12.boats.map((b) => b.racerNumber),
      [4371, 4335, 4573, 4264, 4095, 4500],
    ),
  );
  expect(
    "R12: ★の数",
    same(
      r12.boats.map((b) => b.confidenceStars),
      [1, 2, 2, 2, 2, 2],
    ),
  );
  expect(
    "R12: 前走",
    same(
      r12.boats.map((b) => b.previousRaceNumber),
      [7, 2, 5, 3, 6, 4],
    ),
  );
  expect(
    "R12: コメント本文（末尾の自信度を除き、表記そのまま。全角の括弧）",
    r12.boats[0].commentText ===
      "整備をしたけど、前半レースは良くなかった。急いでリングを外します。",
  );
  expect(
    "R12: コメント本文（半角の括弧の自信度）",
    r12.boats[1].commentText.endsWith(
      "スタートはフライング一本持ちだし気をつけたいです。",
    ) && !r12.boats[1].commentText.includes("コメント自信度"),
  );
  expect(
    "R12: 艇の属性（級別・年齢・体重・支部）",
    r12.boats[0].racerClass === "A1" &&
      r12.boats[0].age === 39 &&
      r12.boats[0].weightKg === 52 &&
      r12.boats[0].branch === "福岡" &&
      r12.boats[0].hometown === "福岡",
  );
  expect("R12: 異常なし", r12.anomalies.length === 0);

  const r10 = m.parsePitReportHtml(R10);
  expect(
    "R10: 自信度の無いコメント（【取材者寸評】）は★NULL・本文はそのまま",
    r10.boats[2].confidenceStars === null &&
      r10.boats[2].commentText.startsWith("【取材者寸評】"),
  );
  expect(
    "R10: ★の数（自信度なしの艇はnull）",
    same(
      r10.boats.map((b) => b.confidenceStars),
      [2, 2, null, 2, 1, 1],
    ),
  );
  expect(
    "R10: その日まだ走っていない艇の前走はnull（空のリンクは異常にしない）",
    same(
      r10.boats.map((b) => b.previousRaceNumber),
      [null, 5, 3, 4, 2, 1],
    ) && r10.anomalies.length === 0,
  );

  const ntr = m.parsePitReportHtml(NOT_TARGET_RACE);
  expect(
    "G1 1R: not_target_race・対象は7〜12",
    ntr.status === "not_target_race" &&
      same(ntr.targetRange, { from: 7, to: 12 }) &&
      ntr.boats.length === 0,
  );
  const fin = m.parsePitReportHtml(FINAL_DAY);
  expect(
    "G1最終日 7R: not_target_race・対象は12のみ",
    fin.status === "not_target_race" &&
      same(fin.targetRange, { from: 12, to: 12 }) &&
      fin.dayLabel.includes("最終日"),
  );
  return { failed, expect };
}

export function evaluateParserPart2(m, failed, expect) {
  const g3 = m.parsePitReportHtml(G3);
  expect(
    "G3: not_target（対象グレードではない）",
    g3.status === "not_target" && g3.targetRange === null && g3.grade === "G3",
  );
  const ippan = m.parsePitReportHtml(IPPAN);
  expect(
    "一般戦: not_target",
    ippan.status === "not_target" && ippan.grade === "ippan",
  );
  const nodata = m.parsePitReportHtml(NO_DATA);
  expect("レースが無い: no_data", nodata.status === "no_data");
  const pending = m.parsePitReportHtml(PENDING);
  expect(
    "対象レースで表が空: target_pending（対象外・データなしと区別できる）",
    pending.status === "target_pending" &&
      pending.boats.length === 0 &&
      pending.grade === "G1",
  );
  const pendingReal = m.parsePitReportHtml(PENDING_REAL);
  expect(
    "未公開の実ページ（表はあるがコメント欄が空）: target_pending・艇6行・レポーター名は取れる・異常なし",
    pendingReal.status === "target_pending" &&
      pendingReal.boats.length === 6 &&
      pendingReal.boats.every((b) => b.commentText === null) &&
      pendingReal.reporterName === "八王子 スゴ六" &&
      pendingReal.anomalies.length === 0 &&
      pendingReal.raceNumber === 12,
  );
  const junk = m.parsePitReportHtml("<html><body><p>x</p></body></html>");
  expect(
    "想定外の構造は unrecognized（黙って「コメント無し」にしない）",
    junk.status === "unrecognized" && junk.anomalies.length > 0,
  );
  const unknownMsg = m.parsePitReportHtml(
    R12.replace(
      /<tbody>\s*<tr>\s*<td class="is-boatColor[\s\S]*?<\/tbody>/g,
      "",
    ).replace(
      "</main>",
      '<div class="title12"><h3 class="title12_title is-type1">※ 別の文言です。</h3></div></main>',
    ),
  );
  expect(
    "未知のメッセージは unrecognized",
    unknownMsg.status === "unrecognized",
  );

  const brHtml = R12.replace(
    "整備をしたけど、前半レースは良くなかった。急いでリングを外します。（コメント自信度・・★☆☆）",
    "一行目<br />二行目\n改行を含む　全角空白（コメント自信度・・★★★）",
  );
  const br = m.parsePitReportHtml(brHtml);
  expect(
    "<br>は改行、ソースの整形の改行は空白、全角空白は残す",
    br.boats[0].commentText === "一行目\n二行目 改行を含む　全角空白" &&
      br.boats[0].confidenceStars === 3,
    show(br.boats[0].commentText),
  );
  const split = (s) => m.splitConfidence(s);
  expect(
    "自信度: 半角括弧・空白の揺れ",
    same(split("本文(コメント自信度・・★★☆)"), {
      text: "本文",
      stars: 2,
      starsMax: 3,
    }) &&
      same(split("本文 （コメント自信度・・☆☆☆）"), {
        text: "本文",
        stars: 0,
        starsMax: 3,
      }),
  );
  expect(
    "自信度なし: 本文はそのまま",
    same(split("【取材者寸評】だけ"), {
      text: "【取材者寸評】だけ",
      stars: null,
      starsMax: null,
    }),
  );
  return failed;
}

/** 行の組み立て・outcome・ハッシュ・突合（rows モジュールと parser モジュールの組で評価する） */
export function evaluateRows(rows, parser) {
  const { failed, expect } = evaluateRowsPart1(rows);
  evaluateRowsPart2(rows, parser, expect);
  return evaluateRowsPart3(rows, failed, expect);
}

export function evaluateRowsPart1(rows) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const cand = (raceGrade, raceNumber) =>
    rows.isPitReportCandidate({ raceGrade, raceNumber });
  expect(
    "候補: SGは全レース",
    [1, 6, 12].every((n) => cand("SG", n)),
  );
  expect(
    "候補: G1・G2は7R以降のみ",
    cand("G1", 7) && cand("G2", 12) && !cand("G1", 6) && !cand("G2", 1),
  );
  expect(
    "候補: G3・一般戦・NULLは対象外",
    !cand("G3", 12) && !cand("ippan", 12) && !cand(null, 12) && !cand("", 12),
  );
  expect(
    "候補: レース番号の範囲外",
    !cand("SG", 0) && !cand("SG", 13) && !cand("SG", null),
  );
  const o = rows.outcomeForStatus;
  expect(
    "status→outcome",
    o("comments") === "ok" &&
      o("not_target") === "skipped_not_target" &&
      o("not_target_race") === "skipped_not_target" &&
      o("target_pending") === "no_values" &&
      o("no_data") === "no_values" &&
      o("unrecognized") === "error",
  );
  return { failed, expect };
}

export function evaluateRowsPart2(rows, parser, expect) {
  const p12 = parser.parsePitReportHtml(R12);
  const built = rows.buildPitReportRows(p12, { raceId: "2026-09-18-05-12" });
  expect(
    "published の行: レース単位・艇ごと",
    built.report.status === "published" &&
      built.report.comment_count === 6 &&
      built.comments.length === 6 &&
      built.report.reporter_name === "八王子 スゴ六" &&
      built.report.parser_version === "pitreport/v1",
  );
  expect(
    "艇ごとの行の値（★・前走・登録番号・本文）",
    built.comments[0].confidence_stars === 1 &&
      built.comments[0].previous_race_number === 7 &&
      built.comments[0].racer_id === 4371 &&
      built.comments[0].comment_text.startsWith("整備をしたけど"),
  );
  const built10 = rows.buildPitReportRows(parser.parsePitReportHtml(R10), {
    raceId: "2026-09-18-05-10",
  });
  expect(
    "自信度なし・前走なしは NULL で保存",
    built10.comments[2].confidence_stars === null &&
      built10.comments[0].previous_race_number === null,
  );
  const nt = rows.buildPitReportRows(parser.parsePitReportHtml(FINAL_DAY), {
    raceId: "2026-09-21-05-07",
  });
  expect(
    "not_target の行: 範囲を持ち、コメントは無い",
    nt.report.status === "not_target" &&
      nt.report.target_from === 12 &&
      nt.report.target_to === 12 &&
      nt.comments.length === 0 &&
      nt.report.comment_count === 0,
  );
  expect(
    "未公開・データなしは行を作らない",
    rows.buildPitReportRows(parser.parsePitReportHtml(PENDING), {
      raceId: "x",
    }) === null &&
      rows.buildPitReportRows(parser.parsePitReportHtml(NO_DATA), {
        raceId: "x",
      }) === null,
  );
  const h1 = rows.computeContentHash(p12);
  const noisy = parser.parsePitReportHtml(
    R12.replace("</body>", "<!-- ad -->  <div>広告</div></body>").replace(
      /<title>[^<]*<\/title>/,
      "<title>別のタイトル</title>",
    ),
  );
  expect(
    "内容ハッシュ: HTMLの体裁（広告・タイトル）が変わっても同じ",
    rows.computeContentHash(noisy) === h1,
  );
  const edited = parser.parsePitReportHtml(
    R12.replace("急いでリングを外します。", "急いでリングを交換します。"),
  );
  expect(
    "内容ハッシュ: コメントの本文が変わると変わる",
    rows.computeContentHash(edited) !== h1,
  );
  const starEdited = parser.parsePitReportHtml(
    R12.replace("（コメント自信度・・★☆☆）", "（コメント自信度・・★★☆）"),
  );
  expect(
    "内容ハッシュ: ★が変わると変わる",
    rows.computeContentHash(starEdited) !== h1,
  );
  const mm = rows.findRacerMismatches(p12.boats, [
    { boat_number: 1, racer_id: 4371 },
    { boat_number: 2, racer_id: 9999 },
    { boat_number: 3, racer_id: null },
  ]);
  expect(
    "突合: 登録番号が違う艇だけ不一致（出走表が無い・NULLの艇は突合しない）",
    mm.length === 1 && mm[0].startsWith("2号艇"),
  );
}

export function evaluateRowsPart3(rows, failed, expect) {
  const pr = rows.pendingRetrySec;
  expect(
    "未公開の再試行の間隔: 発走30分より前は10分・30分前〜発走後10分は5分・それ以降は20分",
    pr(150) === 600 &&
      pr(31) === 600 &&
      pr(30) === 300 &&
      pr(0) === 300 &&
      pr(-10) === 300 &&
      pr(-11) === 1200 &&
      pr(Number.NaN) === 300,
  );
  return failed;
}
