/**
 * 場面8「展示後に見るところ」の材料（型: 契約「場面8」、オーナー 10/16・10/17）。まとめカードだけ（約5秒、読む時間の検査の対象外）。
 * 文言は型で固定（変えない）。行の頭の艇番はその行に関係する艇だけ（風・前付けの行は付けない）。橙の艇番は鍵の艇（場面4〜6）。
 * カドは4コース、外の艇は5・6号艇（枠なりの前提）。
 */
import { keyBoatsOf } from "./scene4.mjs";

const IN = [
  { look: "展示進入が枠なり（前付けなし）", mean: "前提どおりイン", boats: [] },
  { look: "1号艇の一周・まわり足が上位", mean: "逃げやすい", boats: [1] },
  { look: "カドの艇の展示STが内より遅い", mean: "カドは攻めにくい", boats: [4] },
  { look: "風が弱く波が小さい", mean: "内から残りやすい", boats: [] },
];
const OUT = [
  { look: "カドの艇の展示ST・展示タイムが内より上", mean: "カドまくり", boats: [4] },
  { look: "カドが攻めそうなら隣の外の艇", mean: "まくり差し", boats: [5] },
  { look: "外の艇の一周・まわり足が上位", mean: "まくり差し傾向", boats: [5, 6] },
  { look: "外の艇がチルトを上げた", mean: "伸びで一発", boats: [5, 6] },
  { look: "強い向かい風・追い風4m以上", mean: "インの1着率が下がる", boats: [] },
  { look: "前付けで進入が乱れた", mean: "展開を選び直す", boats: [] },
];

/** @param {object} m 材料 JSON */
export function buildScene8(m) {
  const { boats: keys } = keyBoatsOf(m);
  const rows = (list) => list.map((r) => ({ ...r, keys }));
  return {
    id: "scene8",
    steps: [
      {
        id: "s8-summary",
        question: "展示後はどこを見る？",
        page: {
          kind: "summary",
          groups: [
            { title: "インが残るサイン", color: "#42a5f5", rows: rows(IN) },
            { title: "外が来るサイン", color: "#ff8a1f", rows: rows(OUT) },
          ],
          footer: "このレースの材料は龍神レーダーで。展示後も更新",
        },
        press: null,
        frames: [],
        len: 150,
        facts: { kind: "summary", keys },
        lines: [],
      },
    ],
    omitted: [],
  };
}
