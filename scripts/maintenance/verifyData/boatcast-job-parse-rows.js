/**
 * verify-boatcast-job.js の検査の続き（boatcast-job-parse-rows.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { HALF, HTML_ERROR, MISSING, MST, THREE, TWO, UNMEASURABLE, same, show } from "./boatcast-job-fixtures.js";

// ---------------------------------------------------------------------------
// (a) 解析と (b) 行の組み立て・公開マップ を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
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
  const three = m.parseOritenText(THREE);
  expect(
    "3項目: status=measured・計測あり",
    three.status === "measured" && three.measureFlag === 1,
  );
  expect(
    "3項目: 項目名は空白（全角スペース）を除く（一　周→一周、直　線→直線）",
    same(three.labels, ["一周", "まわり足", "直線"]),
  );
  expect(
    "3項目: 6艇・艇番順・値",
    three.rows.length === 6 &&
      same(
        three.rows.map((r) => r.boatNumber),
        [1, 2, 3, 4, 5, 6],
      ) &&
      same(three.rows[0].values, [37.24, 6.04, 6.8]),
  );
  expect(
    "選手名の空白（全角スペース）を除く",
    three.rows[0].racerName === "長尾章平",
  );
  const two = m.parseOritenText(TWO);
  expect(
    "2項目（直線なし）: 項目名で解釈する",
    same(two.labels, ["一周", "まわり足"]) &&
      same(two.rows[0].values, [37.47, 11.51]),
  );
  const half = m.parseOritenText(HALF);
  expect(
    "半周ラップ: 一周ではなく半周ラップとして解釈する",
    same(half.labels, ["半周ラップ", "まわり足", "直線"]) &&
      half.rows[0].values[0] === 18.91,
  );
  const missing = m.parseOritenText(MISSING);
  expect(
    "欠測（--.--）は null。他の項目の値は読める",
    missing.status === "measured" &&
      missing.rows.every((r) => r.values[0] === null && r.values[1] !== null),
  );
  const unmeasurable = m.parseOritenText(UNMEASURABLE);
  expect(
    "計測不可（状態2）: 項目名のみ・選手の行なし",
    unmeasurable.status === "unmeasurable" &&
      unmeasurable.measureFlag === 2 &&
      unmeasurable.rows.length === 0 &&
      unmeasurable.labels.length === 3,
  );
  // 位置ではなくラベル: 項目の順序が違っても、ラベルに対応した値になる
  const reordered = m.parseOritenText(
    "data=\n1\t3\n直　線\t一　周\tまわり足\n1\t選手　　名\t7.00\t37.00\t5.50\n",
  );
  expect(
    "項目の順序が違っても、ラベルで対応する（位置に依存しない）",
    same(reordered.labels, ["直線", "一周", "まわり足"]) &&
      same(reordered.rows[0].values, [7, 37, 5.5]),
  );
  // 未知のラベル
  const unknown = m.parseOritenText(
    "data=\n1\t2\n一　周\tフライング\n1\t選手　　名\t37.00\t1.23\n",
  );
  expect(
    "未知の項目名は unknownLabels に出し、値は読む（取りこぼさない）",
    same(unknown.unknownLabels, ["フライング"]) &&
      unknown.status === "measured" &&
      same(unknown.rows[0].values, [37, 1.23]),
  );
  return { failed, expect };
}

export function evaluateParserPart2(m, failed, expect) {
  // 構造の異常
  const bad = (label, text, needle) => {
    const p = m.parseOritenText(text);
    expect(
      `異常: ${label}`,
      p.status === "unrecognized" &&
        p.anomalies.length > 0 &&
        (needle === undefined || p.anomalies.join(" ").includes(needle)),
    );
  };
  bad("HTMLのエラーページ（先頭が data= ではない）", HTML_ERROR, "data=");
  bad("空", "");
  bad("計測状態の行が壊れている", "data=\nx\ty\n一　周\n");
  bad("計測状態が1・2以外", "data=\n3\t1\n一　周\n1\t選手\t37.00\n");
  bad(
    "項目名の数が項目数と違う",
    "data=\n1\t3\n一　周\tまわり足\n1\t選手\t37.00\t5.00\t7.00\n",
  );
  bad("項目名が重複", "data=\n1\t2\n一　周\t一　周\n1\t選手\t37.00\t37.00\n");
  bad(
    "選手の行の列数が違う",
    "data=\n1\t2\n一　周\tまわり足\n1\t選手\t37.00\n",
    "列数",
  );
  bad(
    "値が数値でも欠測でもない",
    "data=\n1\t1\n一　周\n1\t選手\tabc\n",
    "数値",
  );
  bad("枠番が範囲外", "data=\n1\t1\n一　周\n7\t選手\t37.00\n", "枠番");
  bad(
    "枠番が重複",
    "data=\n1\t1\n一　周\n1\t選手\t37.00\n1\t選手\t37.10\n",
    "重複",
  );
  bad("計測ありなのに選手の行がない", "data=\n1\t1\n一　周\n", "選手の行");
  bad(
    "計測不可なのに選手の行がある",
    "data=\n2\t1\n一　周\n1\t選手\t37.00\n",
    "計測不可",
  );
  // 改行コード・末尾の改行
  const crlf = m.parseOritenText(THREE.replace(/\n/g, "\r\n"));
  expect(
    "CRLF でも解析できる",
    crlf.status === "measured" && crlf.rows.length === 6,
  );
  // bc_mst
  expect(
    "bc_mst: YYYYMMDD → YYYY-MM-DD",
    m.parseMotorStartDate(MST) === "2026-03-23" &&
      m.parseMotorStartDate("20260806") === "2026-08-06",
  );
  expect(
    "bc_mst: 不正な日付・HTMLは null",
    m.parseMotorStartDate("20261340") === null &&
      m.parseMotorStartDate("20260231") === null &&
      m.parseMotorStartDate(HTML_ERROR) === null &&
      m.parseMotorStartDate("") === null &&
      m.parseMotorStartDate("2026-03-23") === null,
  );
  return failed;
}

export function evaluateRows(mRows, mParser) {
  const { failed, expect } = evaluateRowsPart1(mRows, mParser);
  const { d } = evaluateRowsPart2(mRows, expect);
  return evaluateRowsPart3(failed, expect, d);
}

export function evaluateRowsPart1(mRows, mParser) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const RID = "2026-09-21-05-01";
  const three = mParser.parseOritenText(THREE);
  const built = mRows.buildOritenRows(three, {
    raceId: RID,
    lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
  });
  expect(
    "行: 6艇×3項目=18行の縦持ち",
    built.values.length === 18 &&
      built.values.every((v) => v.race_id === RID) &&
      built.values.filter((v) => v.kind === "一周").length === 6,
  );
  expect(
    "行: 艇1の値（項目名で対応）",
    same(
      built.values
        .filter((v) => v.boat_number === 1)
        .map((v) => [v.kind, v.value]),
      [
        ["一周", 37.24],
        ["まわり足", 6.04],
        ["直線", 6.8],
      ],
    ),
  );
  expect(
    "レース単位の行: 状態・項目数・項目名・ハッシュ・公開時刻（Last-Modified）",
    built.report.measure_status === 1 &&
      built.report.item_count === 3 &&
      built.report.item_labels === "一周|まわり足|直線" &&
      built.report.content_hash.length === 64 &&
      built.report.source_last_modified === "2026-09-21T01:16:32.000Z" &&
      built.report.parser_version === three.parserVersion,
  );
  const missing = mRows.buildOritenRows(mParser.parseOritenText(MISSING), {
    raceId: RID,
  });
  expect(
    "欠測は value=null の行として残す（行は存在する）",
    missing.values.length === 18 &&
      missing.values
        .filter((v) => v.kind === "一周")
        .every((v) => v.value === null),
  );
  const unmeasurable = mRows.buildOritenRows(
    mParser.parseOritenText(UNMEASURABLE),
    { raceId: RID },
  );
  expect(
    "計測不可: 値の行なし・状態2のレース単位の行だけ",
    unmeasurable.values.length === 0 &&
      unmeasurable.report.measure_status === 2,
  );
  expect(
    "想定外の構造は行を作らない",
    mRows.buildOritenRows(mParser.parseOritenText(HTML_ERROR), {
      raceId: RID,
    }) === null,
  );
  expect(
    "Last-Modified が無い・不正なら null",
    mRows.buildOritenRows(three, { raceId: RID }).report
      .source_last_modified === null &&
      mRows.parseLastModified("不正") === null,
  );
  // ハッシュ
  const h = (text) => mRows.computeOritenHash(mParser.parseOritenText(text));
  expect(
    "ハッシュ: 同じ内容は同じ",
    h(THREE) === h(THREE.replace(/\n/g, "\r\n")),
  );
  expect(
    "ハッシュ: 選手名の表記が変わっても変わらない（保存しないため）",
    h(THREE) === h(THREE.replace("長尾　　章平", "長尾　　彰平")),
  );
  expect(
    "ハッシュ: 値が変わると変わる",
    h(THREE) !== h(THREE.replace("37.24", "37.25")),
  );
  expect(
    "ハッシュ: 欠測と値ありは違う",
    h(MISSING) !== h(MISSING.replace("--.--", "37.00")),
  );
  return { failed, expect };
}

export function evaluateRowsPart2(mRows, expect) {
  // 公開マップとの照合
  const cmp = mRows.compareLabelsToMap(
    ["一周", "まわり足", "フライング"],
    ["一周", "まわり足", "直線"],
  );
  expect(
    "マップとの照合: マップに無い項目名・ファイルに無い項目名",
    same(cmp, { unexpected: ["フライング"], missing: ["直線"] }) &&
      same(mRows.compareLabelsToMap(["直線", "一周"], ["一周", "直線"]), {
        unexpected: [],
        missing: [],
      }),
  );
  // 403の再試行の判断
  const d = mRows.decideNotPublished;
  expect(
    "403: 窓の中（発走20分前〜8分前の取得。6.5分より前）は2分後に再試行（古い5分・8分の規則を使わない）",
    same(d(20), { final: false, retrySec: 120 }) &&
      same(d(19.9), { final: false, retrySec: 120 }) &&
      same(d(8), { final: false, retrySec: 120 }) &&
      same(d(7), { final: false, retrySec: 120 }) &&
      same(d(6.6), { final: false, retrySec: 120 }),
  );
  expect(
    "403: 窓の最後（6分前の取得）の後は、後段の規則: 5分後に再試行、4分前〜-4分は8分後、-4分以降は打ち切り",
    same(d(6), { final: false, retrySec: 300 }) &&
      same(d(5), { final: false, retrySec: 300 }) &&
      same(d(3), { final: false, retrySec: 480 }) &&
      same(d(0), { final: false, retrySec: 480 }) &&
      same(d(-3.9), { final: false, retrySec: 480 }) &&
      same(d(-4), { final: true }) &&
      same(d(-7), { final: true }),
  );
  expect(
    "403: 発走時刻が不明・過去日（バックフィル）は、打ち切り（待たない）",
    same(d(undefined), { final: true }) &&
      same(d(Number.NEGATIVE_INFINITY), { final: true }) &&
      same(d(NaN), { final: true }),
  );
  return { d };
}

export function evaluateRowsPart3(failed, expect, d) {
  // 通常の進行で、取得は最大10回（窓の8回＋後段の2回）
  {
    let m = 20; // 1回目: 発走の20分前
    const seen = [m];
    for (;;) {
      const r = d(m);
      if (r.final) break;
      m -= r.retrySec / 60;
      seen.push(m);
      if (seen.length > 12) break;
    }
    expect(
      `403の通常の進行（20分前から）は 20,18,…,6 分前・1分前・発走7分後の10回で打ち切り（実際: ${show(seen)}）`,
      same(seen, [20, 18, 16, 14, 12, 10, 8, 6, 1, -7]),
    );
  }
  return failed;
}
