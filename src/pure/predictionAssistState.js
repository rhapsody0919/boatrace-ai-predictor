/**
 * 思考アシストのページの状態（useReducer の初期値と操作）と、画面の部品に依らない取り出し。
 * src/pages/ThinkingAssistPage.jsx から本文を変えずに移した（振る舞いは変えない）。
 * src/pure の根なので src/pure の外を読まない。「選んだ艇でボックス」の組み（utils/assistModel の boxBets・assistBetType）は
 * createAssistReducer の deps で受ける
 */
export const initialState = {
  lens: "axis",
  stage: null, // null＝DB の展示から決める既定（spec D-36 (1)）
  deep: null,
  // 軸の要約の入口から開いたとき、深掘りの「全部の材料」を開いて渡す（▲が無い日。2026-10-11 ユーザー決定 案D）
  deepAll: false,
  // 入口から開くたびに深掘りを作り直して、開いている艇でも材料の位置まで送る
  deepNonce: 0,
  metric: null,
  // 展開レンズの平均ST（BOA-815 案A。展示後も、spec D-47 (1)）
  stBasis: "course",
  // 展開レンズで選んだスリットの形（形が2つ以上当てはまるとき。null＝率が一番高い形。承認モック v2 ④）
  flowForm: null,
  // 相手レンズで選んだ軸の艇（BOA-845、spec D-48 (6)）。null＝まだ選んでいない（1着の候補が1艇ならその艇、無ければ1号艇）
  placeAxis: null,
  // 買い目の着順（1＝1着・2＝2着以内・3＝3着以内。BOA-831、spec D-44・D-46）。ページ内だけ
  target: 1,
  bets: { 1: new Set(), 2: new Set(), 3: new Set() },
  // 買い目の券種（BOA-990）。候補の段は券種をまたいで共有する
  betType: "trifecta",
  // 「選んだ艇でボックス」を押す前の候補（押した直後だけ「元に戻す」を出す）。保存しない
  boxUndo: null,
  budget: "1000",
  mode: "equalPayout",
  // "mark" | "rough" | "venue" | {type: "theory", id, boat} | {type: "term", term}
  sheet: null,
  guide: null, // ガイドの段（0〜4）。null は閉じている
};

const withMetricReset = (state, patch) => ({
  ...state,
  ...patch,
  metric: null,
});
const withBoxUndoReset = (state, patch) => ({
  ...state,
  ...patch,
  boxUndo: null,
});

function reduceDeep(state, action) {
  return withMetricReset(state, {
    deep: state.deep === action.boat ? null : action.boat,
    deepAll: false,
  });
}

// 軸の要約の入口1行。押し直しでも閉じない（艇の丸と違い、いつも開く）
function reduceOpenFacts(state, action) {
  return withMetricReset(state, {
    deep: action.boat,
    deepAll: action.all,
    deepNonce: state.deepNonce + 1,
  });
}

// 値を押したら図を6艇比較に変えるだけ。深掘りは開かない（開くと深掘りへ送られて比べた図が見えない。BOA-808 1）
function reduceMetric(state, action) {
  return {
    ...state,
    metric: state.metric === action.metric ? null : action.metric,
  };
}

function reduceToggleBet(state, action) {
  const next = new Set(state.bets[action.pos]);
  if (next.has(action.boat)) next.delete(action.boat);
  else next.add(action.boat);
  return {
    ...state,
    bets: { ...state.bets, [action.pos]: next },
    boxUndo: null,
  };
}

function reduceBox(state, { boxBets, assistBetType }) {
  return {
    ...state,
    bets: boxBets(state.bets, assistBetType(state.betType).legs),
    boxUndo: state.bets,
  };
}

function reduceUndoBox(state) {
  return state.boxUndo
    ? { ...state, bets: state.boxUndo, boxUndo: null }
    : state;
}

// ガイドの段に合わせてレンズを切り替え、深掘りを閉じる。閉じても買い目・レンズは残す（FR-10）
function reduceGuide(state, action) {
  return action.step == null
    ? { ...state, guide: null }
    : {
        ...state,
        guide: action.step,
        lens: action.lens,
        deep: null,
        metric: null,
      };
}

const REDUCERS = {
  lens: (state, action) => withMetricReset(state, { lens: action.lens }),
  stage: (state, action) => withMetricReset(state, { stage: action.stage }),
  target: (state, action) => ({ ...state, target: action.target }),
  deep: reduceDeep,
  openFacts: reduceOpenFacts,
  metric: reduceMetric,
  back: (state) => withMetricReset(state, {}),
  stBasis: (state, action) => withMetricReset(state, { stBasis: action.basis }),
  flowForm: (state, action) => ({ ...state, flowForm: action.form }),
  placeAxis: (state, action) => ({ ...state, placeAxis: action.boat }),
  closeDeep: (state) => withMetricReset(state, { deep: null }),
  toggleBet: reduceToggleBet,
  betType: (state, action) =>
    withBoxUndoReset(state, { betType: action.betType }),
  undoBox: reduceUndoBox,
  budget: (state, action) => withBoxUndoReset(state, { budget: action.budget }),
  mode: (state, action) => withBoxUndoReset(state, { mode: action.mode }),
  sheet: (state, action) => withBoxUndoReset(state, { sheet: action.sheet }),
  guide: reduceGuide,
};

/**
 * 思考アシストの reducer。deps は utils/assistModel の { boxBets, assistBetType }（src/pure から utils を読まないため受ける）
 */
export function createAssistReducer(deps) {
  const reducers = { ...REDUCERS, box: (state) => reduceBox(state, deps) };
  return function reducer(state, action) {
    if (!Object.hasOwn(reducers, action.type))
      throw new Error(`思考アシスト: 知らない操作 ${action.type}`);
    return reducers[action.type](state, action);
  };
}

/** 候補から欠場の艇を外す（表示と点数用。状態の候補は残し、外したことを知らせる。D-38） */
export const withoutBoats = (bets, boats) =>
  boats.length
    ? Object.fromEntries(
        [1, 2, 3].map((k) => [
          k,
          new Set([...bets[k]].filter((b) => !boats.includes(b))),
        ]),
      )
    : bets;

/** 深掘りの走の取得状態。選手の登録番号が無い艇は走を取れない。読み込み中に残さない */
export function deepRunsOf(data, racers, deepBoat, deepRunsReady) {
  if (racers[deepBoat - 1]?.racerId == null)
    return { status: "none", data: null };
  return deepRunsReady ? data.runs : { status: "loading", data: null };
}

// 最初に選ばれている軸の艇と、自動で決めたか（spec D-48 (6)）
export function placeAxisOf(state, absentBoats) {
  const firstPicks = [...state.bets[1]].filter((b) => !absentBoats.includes(b));
  const placeAuto = state.placeAxis == null && firstPicks.length === 1;
  const placeAxis = state.placeAxis ?? (placeAuto ? firstPicks[0] : 1);
  return { placeAuto, placeAxis };
}

// 艇ごとの展示コース（整備の行が無ければ null）
export function courseByBoatOf(maintenanceRows) {
  return maintenanceRows
    ? [1, 2, 3, 4, 5, 6].map(
        (b) =>
          maintenanceRows.find((r) => r.boat_number === b)?.exhibition_course ??
          null,
      )
    : null;
}

export function buildBetSummary({
  tickets,
  betOdds,
  typeOdds,
  betType,
  data,
  state,
  betOddsAt,
  oddsNote,
  race,
  dispatch,
}) {
  return {
    tickets,
    odds: betOdds ?? {},
    oddsRange: typeOdds?.range ?? null,
    betType: betType.id,
    oddsFinal: typeOdds?.final === true,
    oddsFinalFailed: data.odds.data?.finalFailed === true,
    budget: state.budget,
    mode: state.mode,
    oddsAt: betOddsAt,
    oddsNote,
    finished: Boolean(race?.result?.finished),
    onBudget: (budget) => dispatch({ type: "budget", budget }),
    onMode: (mode) => dispatch({ type: "mode", mode }),
  };
}

// v16 の状態から見た値（hooks なし）
export function assistV16Of(data) {
  const today = data.facts.data?.today ?? null;
  const v16Status = data.facts.data?.status ?? null;
  // 欠場は v16 の状態と DB の展示の両方で見る（どちらかで分かれば v16 の部分を出さない。screens「欠場があった」、Codex 依頼27 F03）
  const absentKnown = v16Status === "absent" || data.absentBoats.length > 0;
  const v16Off = absentKnown || v16Status === "not_saved";
  const factsAll = v16Off ? null : (data.facts.data?.facts ?? null);
  const v16Exhibition = data.facts.data?.exhibition ?? null;
  const ncScenario = v16Off ? null : (data.scenario.nc.data?.scenario ?? null);
  return {
    today,
    v16Status,
    absentKnown,
    v16Off,
    factsAll,
    v16Exhibition,
    ncScenario,
  };
}
