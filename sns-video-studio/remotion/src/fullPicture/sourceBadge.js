/**
 * 出どころの札（完全版の C2、hq 契約 10/24 C1・C2。ファン役4人・デザイナー役の審査）。純粋関数と定数だけ。
 * 札の中身は「機能名｜中身」の対。場面と機能の対応はこの表で固定する（契約の表と同じ）。表に無い拍（場面1・3②・6①②・8）は札を出さない。
 * 札を出すかと置き場は版ごとの印（FullPicture の props.badgePlace）で切り替える。入口版（X・Shorts）は印を渡さないので出さない。
 */

/** 拍の id の頭 → 札。上から順に最初に当たったもの。scene2 は重ね図とカード（kind scene2）の全体 */
export const SOURCE_BADGES = [
  { prefix: "scene2", feature: "龍神ソナー", item: "差がつく材料" },
  { prefix: "s2b-", feature: "龍神ソナー", item: "類似レース" },
  { prefix: "s3-rough", feature: "思考アシスト", item: "堅い？荒れる？" },
  { prefix: "s4-", feature: "龍神ソナー", item: "展開" },
  { prefix: "s5-", feature: "思考アシスト", item: "相手" },
  { prefix: "s6-deep", feature: "思考アシスト", item: "深掘り" },
];

/** 初めて札が出る拍だけに添える機能の1行説明（ふつうは場面2） */
export const FEATURE_NOTE = {
  龍神ソナー: "レース詳細のソナータブ。6艇の差・類似レース・展開",
  思考アシスト: "レースの別ページ。軸・相手を問いに沿って読む",
};

/** 置き場（印の値）。band＝上帯の中央 y64〜132、字40px（オレンジの飾り線の代わり）。16:9 に移すときはここに足す */
export const BADGE_PLACES = {
  band: { top: 64, height: 68, fontSize: 40, maxWidth: 1040, noteTop: 142, noteSize: 36 },
};
/** 札が替わるときのフェード（0.2秒） */
export const BADGE_FADE = 6;

const badgeOf = (id) => {
  const b = SOURCE_BADGES.find((x) => String(id).startsWith(x.prefix));
  return b ? { feature: b.feature, item: b.item, text: `${b.feature}｜${b.item}` } : null;
};

/**
 * 場面に札を付ける（新しい配列。元を変えない）。step の場面は拍ごとに step.badge、scene2 は data.badge。
 * 初めて札が付いた拍だけ note（機能の1行説明）を持つ。データが無くて省いた場面は拍が無いので、次に札が出る拍が初めてになる
 * @param {{id: string, kind: string, data: object|null}[]} scenes
 */
export function withSourceBadges(scenes) {
  let first = true;
  const mark = (b) => {
    if (!b) return null;
    const out = first ? { ...b, note: FEATURE_NOTE[b.feature] ?? null } : b;
    first = false;
    return out;
  };
  return scenes.map((x) => {
    if (!x.data) return x;
    if (x.kind === "scene2") return x.data.radar?.axes?.length ? { ...x, data: { ...x.data, badge: mark(badgeOf(x.id)) } } : x;
    return { ...x, data: { ...x.data, steps: (x.data.steps ?? []).map((s) => ({ ...s, badge: mark(badgeOf(s.id)) })) } };
  });
}
