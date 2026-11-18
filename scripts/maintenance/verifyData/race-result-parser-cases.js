// verify-race-result-parser.js の試験の部品（越えの単位を分けるため移した。verify ではない）
// evaluateCase*: 解析の結果の比べ（expect は verify の evaluate の物を受け取り、失敗の集計は evaluate に残す）
import { legacyParseRaceResultHtml } from "../../lib/__fixtures__/raceresult/legacyParseRaceResultHtml.js";

const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);
const NEW_LEGACY_ONLY_KEYS = new Set(["full"]);

/** マイグレーション079のCHECK制約（chk_race_payouts_*）と同じ意味。DDL案の文言との一致は (f) で確認する */
export function payoutRowSatisfiesDdl(r) {
  const betOk = [
    "win",
    "place",
    "2tan",
    "2fuku",
    "wide",
    "3tan",
    "3fuku",
  ].includes(r.bet_type);
  const seqOk = Number.isInteger(r.seq) && r.seq >= 1;
  const statusOk = ["paid", "special", "no_amount", "no_race"].includes(
    r.payout_status,
  );
  const consistent =
    (r.payout_status === "paid" &&
      r.payout !== null &&
      r.combination !== null) ||
    (r.payout_status === "special" && r.payout !== null) ||
    (r.payout_status === "no_amount" &&
      r.payout === null &&
      r.combination !== null) ||
    (r.payout_status === "no_race" &&
      r.payout === null &&
      r.combination === null);
  return betOk && seqOk && statusOk && consistent;
}

export function evaluateCaseParse(m, c, expect, { full, name }) {
  expect(
    `${name}: 着順表の枠番の並び`,
    same(
      full.boats.map((b) => b.boat_number),
      c.boats,
    ),
  );
  expect(
    `${name}: 着欄の生表記`,
    same(
      full.boats.map((b) => b.finish_mark),
      c.marks,
    ),
  );
  expect(
    `${name}: 完走の着（数字の着欄だけ。同着は同じ値）`,
    same(
      full.boats.map((b) => b.finish_rank),
      c.marks.map((mark) => (/^[1-6]$/.test(mark) ? Number(mark) : null)),
    ),
  );
  // 公式の行の順（BOA-667）: c.boats は公式の着順表の上からの並び。非完走艇が記号の種類ごとに並ぶ例
  // （＿→F、エ→沈→欠、落→転→F、落→妨）を含む
  expect(
    `${name}: 公式の行の順(official_row)が、着順表の上からの並びと一致`,
    same(
      c.boats.map(
        (n) => full.boats.find((b) => b.boat_number === n)?.official_row,
      ),
      c.boats.map((_, i) => i + 1),
    ),
  );
  // フライング・出遅れ・レースタイム（秒）は、着欄・レースタイムの表記から独立に計算して比べる
  expect(
    `${name}: フライング(is_flying)は着欄F、出遅れ(is_late_start)は着欄Lの艇だけ`,
    full.boats.every(
      (b) =>
        b.is_flying === (b.finish_mark === "F") &&
        b.is_late_start === (b.finish_mark === "L"),
    ),
  );
  expect(
    `${name}: レースタイム(race_seconds)が、表記（分'秒"十分の一秒）から計算した秒と一致`,
    full.boats.every((b) => {
      const t = /^(\d+)'(\d{2})"(\d)$/.exec(b.race_time ?? "");
      return t
        ? b.race_seconds ===
            Number(t[1]) * 60 + Number(t[2]) + Number(t[3]) / 10
        : b.race_seconds === null;
    }),
  );
  // 実進入: 艇Nの進入コース（スタート情報の行順）が、本番DBの actual_course_N と一致
  const byBoat = new Map(
    full.boats.map((b) => [b.boat_number, b.entry_course]),
  );
  expect(
    `${name}: 進入コースが本番DBの actual_course（Kファイル由来）と一致`,
    same(
      [1, 2, 3, 4, 5, 6].map((n) => byBoat.get(n) ?? null),
      c.course,
    ),
  );
  expect(`${name}: 返還艇`, same(full.refund_boats, c.refund));
  expect(`${name}: レースの状態`, full.race_status === c.status);
  expect(`${name}: 備考`, full.remark === c.remark);
  expect(
    `${name}: 不成立の勝式`,
    same(
      [
        ...new Set(
          full.payouts
            .filter((p) => p.payout_status === "no_race")
            .map((p) => p.bet_type),
        ),
      ].sort(),
      [...c.noRace].sort(),
    ),
  );
  expect(
    `${name}: 想定外の表記（anomalies）が無い`,
    full.anomalies.length === 0,
  );
}

export function evaluateCaseLegacy(m, c, expect, { full, name, html }) {
  // 旧解析との互換
  const oldR = legacyParseRaceResultHtml(html);
  const newR = m.toLegacyResult(full);
  const diffKeys = Object.keys(oldR).filter(
    (k) => !NEW_LEGACY_ONLY_KEYS.has(k) && show(oldR[k]) !== show(newR[k]),
  );
  expect(
    `${name}: 旧解析との差が、想定の項目だけ（想定=${c.legacyDiff.join("・") || "なし"}、実際=${diffKeys.join("・") || "なし"}）`,
    same([...diffKeys].sort(), [...c.legacyDiff].sort()),
  );
  // 旧解析にあった項目のうち、差の無い項目は、値まで同一（rank1〜3・時間・進入・ST・決まり手・気象）
  expect(
    `${name}: rank1〜3・レースタイム・進入・ST・決まり手・気象が旧解析と同じ`,
    [
      "rank1",
      "rank2",
      "rank3",
      "raceTime1",
      "raceTime2",
      "raceTime3",
      "raceTime4",
      "raceTime5",
      "raceTime6",
      "courseInfo",
      "startTimings",
      "winningTechnique",
      "weather",
    ].every((k) => show(oldR[k]) === show(newR[k])),
  );
  // 非完走艇は rank4〜6 に入らない（完走した艇だけが着順の位置に入る）
  const finishers = full.boats
    .filter((b) => b.finish_rank !== null)
    .map((b) => b.boat_number);
  if (finishers.length >= 3) {
    expect(
      `${name}: rank4〜6 は完走艇の4〜6着だけ`,
      same(
        [newR.rank4, newR.rank5, newR.rank6],
        [3, 4, 5].map((i) => finishers[i] ?? null),
      ),
    );
  }
  return { oldR, newR };
}

export function evaluateCaseRows(m, c, expect, { full, name, newR, oldR }) {
  // 行の組み立て
  const legacyRows = m.buildTimingRows("R", newR, { extended: false });
  const extRows = m.buildTimingRows("R", newR, { extended: true });
  expect(
    `${name}: 旧形式の艇別の行は、STを読めた艇だけ（旧実装と同じ）`,
    same(
      legacyRows,
      oldR.startTimings.map((st) => ({ race_id: "R", ...st })),
    ),
  );
  expect(
    `${name}: 拡張の艇別の行は6艇分（欠場艇を含む）`,
    extRows.length === c.boats.length,
  );
  expect(
    `${name}: 拡張の艇別の行の着欄・進入が、パーサーの出力と同じ`,
    extRows.every((r) => {
      const b = full.boats.find((x) => x.boat_number === r.boat_number);
      return (
        b &&
        r.finish_mark === b.finish_mark &&
        r.finish_rank === b.finish_rank &&
        r.entry_course === b.entry_course &&
        r.race_seconds === b.race_seconds
      );
    }),
  );
  const officialRows = m.buildTimingRows("R", newR, {
    extended: true,
    officialRow: true,
  });
  expect(
    `${name}: 119適用済みの艇別の行に、公式の行の順(official_row)が入る。未適用なら列を含まない`,
    officialRows.every(
      (r) => r.official_row === c.boats.indexOf(r.boat_number) + 1,
    ) && extRows.every((r) => !("official_row" in r)),
  );
  const payoutRows = m.buildPayoutRows("R", newR);
  expect(
    `${name}: 払戻明細の行がDDL案(079)のCHECKの意味に合う`,
    payoutRows.length > 0 && payoutRows.every(payoutRowSatisfiesDdl),
  );
  expect(
    `${name}: 払戻明細の(勝式,seq)が重複しない（主キー）`,
    new Set(payoutRows.map((r) => `${r.bet_type}/${r.seq}`)).size ===
      payoutRows.length,
  );
}
