/**
 * verify-thinking-assist-summary.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-thinking-assist-summary.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { winFollowers, axisMarks, formSummary, exactaList } from "../../../src/utils/assistSummary.js";
import { ASSIST_COPY } from "../../../src/data/thinkingAssistCopy.js";

let fx, check, nc;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const vaSc = fx.scenario["VA:18"].scenario;
  const f1 = winFollowers(vaSc, 1);
  const f4 = winFollowers(vaSc, 4);
  const pctOf = (f) => f.second.map((k) => Math.round((k / f.n) * 100)).join();
  check(
    "軸の2着: 範囲は会場の全レース。1号艇が1着の10,910件で2着 38・27・19・10・6%（承認モック v3 の値）",
    f1?.n === 10910 && pctOf(f1) === "0,38,27,19,10,6" && f1.few === false,
    pctOf(f1),
  );
  check(
    "軸の2着: 4号艇が1着の1,326件で2着は1号艇 37%・2号艇 20%・3号艇 13%・5号艇 18%・6号艇 13%、よく出た3連単 4-1-2・4-1-5・4-1-3",
    f4?.n === 1326 &&
      pctOf(f4) === "37,20,13,0,18,13" &&
      f4.topTrifecta.map(([x]) => x.join("-")).join() === "4-1-2,4-1-5,4-1-3",
    pctOf(f4),
  );
  check(
    "印（q_nw 基準・5pt・95%区間・件数300以上）: 4号艇を軸にすると 2号艇↓・3号艇↓・5号艇↑・6号艇↑、1号艇は印なし（基準 q だと付いていた）。統計検証 boa845-axis-place.md の徳山の例と同じ",
    JSON.stringify(axisMarks(vaSc, f4, 4)) ===
      JSON.stringify([null, "down", "down", null, "up", "up"]),
    JSON.stringify(axisMarks(vaSc, f4, 4)),
  );
  check(
    "印: 2号艇を軸にすると1号艇↑だけ。件数300未満の軸には付けない（6号艇 388件は付く、仮に299件なら付かない）",
    JSON.stringify(axisMarks(vaSc, winFollowers(vaSc, 2), 2)) ===
      JSON.stringify(["up", null, null, null, null, null]) &&
      axisMarks(vaSc, { ...winFollowers(vaSc, 6), n: 299 }, 6).every(
        (m) => m === null,
      ) &&
      // 1号艇を軸にしたときは統計検証の範囲外（軸 2〜6号艇の600組）なので出さない
      axisMarks(vaSc, f1, 1).every((m) => m === null),
  );
  check(
    "軸の2着: その艇が1着の組が無ければ null、30件未満は few（割合を出さない）。範囲の組が無ければ印も無し",
    winFollowers({
      cells: { all: { forms: { any: { tri: { "2-1-3": 5 } } } } },
    }) === null &&
      winFollowers({
        cells: { all: { forms: { any: { tri: { "1-2-3": 5 } } } } },
      })?.few === true &&
      axisMarks(null, f4, 4).every((m) => m === null),
  );
  const ex = formSummary(nc, "d2")?.topExacta;
  check(
    "案2: 2コース凹みのよく出た2連単 1-3（24件）・1-4（17件）・1-2（14件）・3-1（13件）・3-4（12件）",
    JSON.stringify(ex) ===
      "[[[1,3],24],[[1,4],17],[[1,2],14],[[3,1],13],[[3,4],12]]",
    JSON.stringify(ex),
  );
  check(
    "2連単: 3連単を1着-2着でまとめ、同数は組み合わせの昇順",
    JSON.stringify(
      exactaList({ "1-2-3": 2, "1-2-4": 1, "2-1-3": 3, "1-3-2": 3 }),
    ) === "[[[1,2],3],[[1,3],3],[[2,1],3]]",
  );
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2() {
  check(
    "軸の2着の言葉: 札・結論・印",
    ASSIST_COPY.followScope(ASSIST_COPY.followVenueAll("徳山"), 4, 1326) ===
      "徳山の全レース 4号艇が1着の1,326件" &&
      ASSIST_COPY.followConcl(4, 1, 37).join("") ===
        "4号艇が1着なら、2着は1号艇 37%" &&
      ASSIST_COPY.followMark.up === "↑多め" &&
      ASSIST_COPY.followMark.down === "↓少なめ",
  );
}

function scene3() {
  {
    scene1();
    scene2();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（fx・check・nc） */
export function runThinkingAssistSummaryScenes3(env) {
  ({ fx, check, nc } = env);
  scene3();
}
