/**
 * BOATCASTのオリジナル展示（bc_oriten）の「公開マップ」（会場 × 項目）。事前に凍結した静的な設定。
 *
 * 根拠（2026-09-21の実サンプリング。docs/design/boatcast-original-exhibition/spec.md §2）:
 *   逐次・2.2秒間隔・UA BoatraceAIBot/1.0 で、全24会場に最低1件（200になった実ファイルの、項目名の行を確認）。
 *   江戸川(03)だけは、2026-09-19・09-20の3ファイルが403（2025-12の調査時点でも403）。
 *
 * このマップは、次の3つの分母を決める。観測（取得できたかどうか）から分母を作らない。
 * 分母が分子に従属して、完了の定義Aが自明に満たされるのを避けるため。
 *   1. 予定表（scrape_slots）のスロットを作る対象の会場（status='public' の会場の全レース）
 *   2. 期待件数 = 対象会場のレース数 × 艇数 × items の数（.claude/rules/data-acquisition.md A）
 *   3. 項目ラベルの照合（ファイルの項目名がマップと違えば parse_anomaly として記録する）
 *
 * status:
 *   public       公開されている（実ファイルを確認済み）。スロットを作り、期待件数の分母に入れる
 *   excluded     常時403で、公開されていない。取得しない（期待件数の分母に入れず、件数を別に報告する）
 *   unconfirmed  実ファイルを確認できていない。取得しない・分母に入れない（別扱い。確認できたら public へ移す）
 *                （2026-09-21時点では該当なし。下関・若松は実サンプリングで public に確認した）
 *
 * マップの更新は、実サンプリングまたは shadow の実測に基づいて、このファイルを変更するPRで行う
 * （実行時に観測から自動で書き換えない）。
 */

/** 項目ラベル（空白を除いた表記）と、その意味 */
export const ORITEN_LABELS = Object.freeze({
  lap: "一周",
  halfLap: "半周ラップ",
  turn: "まわり足",
  straight: "直線",
});

/** 既知のラベルの集合（これ以外のラベルは parse_anomaly の警告になる） */
export const KNOWN_ORITEN_LABELS = Object.freeze(Object.values(ORITEN_LABELS));

const THREE = [ORITEN_LABELS.lap, ORITEN_LABELS.turn, ORITEN_LABELS.straight];
const TWO = [ORITEN_LABELS.lap, ORITEN_LABELS.turn];
const HALF = [
  ORITEN_LABELS.halfLap,
  ORITEN_LABELS.turn,
  ORITEN_LABELS.straight,
];

const pub = (name, items) => ({ name, status: "public", items });

/**
 * 会場コード（2桁）→ 定義。項目の順序はファイル内の列の順（照合は位置ではなくラベルで行う）。
 * 一周が `--.--`（欠測）になる日・レースがある会場（津・三国・常滑）も、items には一周を含める
 * （行は存在し、値だけが欠測）。
 */
export const ORITEN_PUBLIC_MAP = Object.freeze({
  "01": pub("桐生", HALF), // 一周ではなく半周ラップ（約19秒台）
  "02": pub("戸田", THREE),
  "03": {
    name: "江戸川",
    status: "excluded",
    items: [],
    reason:
      "常時403（2026-09-19・09-20の3ファイル、および2025-12の調査時点）。BOATCAST上に公開されていない",
  },
  "04": pub("平和島", THREE),
  "05": pub("多摩川", THREE),
  "06": pub("浜名湖", THREE),
  "07": pub("蒲郡", THREE),
  "08": pub("常滑", THREE),
  "09": pub("津", THREE),
  10: pub("三国", THREE),
  11: pub("びわこ", THREE),
  12: pub("住之江", TWO), // 直線なし
  13: pub("尼崎", TWO), // 直線なし
  14: pub("鳴門", THREE),
  15: pub("丸亀", THREE),
  16: pub("児島", THREE),
  17: pub("宮島", THREE),
  18: pub("徳山", TWO), // 直線なし
  19: pub("下関", THREE),
  20: pub("若松", THREE),
  21: pub("芦屋", THREE),
  22: pub("福岡", THREE),
  23: pub("唐津", THREE),
  24: pub("大村", THREE),
});

/** 全24会場のコード（bc_mst＝モーター使用開始日は、全24会場の存在を実サンプリングで確認済み） */
export const ALL_VENUE_CODES = Object.freeze(
  Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, "0")),
);

/** 会場コード（"01"〜"24"）から定義を引く。範囲外・未登録は null */
export function venueEntry(jo, map = ORITEN_PUBLIC_MAP) {
  return map[jo] ?? null;
}

/** 取得の対象（status='public'）の会場コードの一覧 */
export function publicVenueCodes(map = ORITEN_PUBLIC_MAP) {
  return Object.entries(map)
    .filter(([, v]) => v.status === "public")
    .map(([jo]) => jo)
    .sort();
}

/** 会場が取得の対象か */
export function isPublicVenue(jo, map = ORITEN_PUBLIC_MAP) {
  return map[jo]?.status === "public";
}

/** race_id（YYYY-MM-DD-VV-RR）から会場コード（2桁）を取り出す。形式が不正なら null */
export function venueOfRaceId(raceId) {
  const m = /^\d{4}-\d{2}-\d{2}-(\d{2})-\d{2}$/.exec(String(raceId));
  return m ? m[1] : null;
}

/**
 * 期待する行数（レース単位の値の行）。艇数 × 項目数。欠場艇は差し引かない（欠場艇の除外件数は別に報告する）
 * @param {string} jo
 * @param {number} [boats]
 */
export function expectedValueRows(jo, boats = 6, map = ORITEN_PUBLIC_MAP) {
  const entry = map[jo];
  if (!entry || entry.status !== "public") return 0;
  return boats * entry.items.length;
}
