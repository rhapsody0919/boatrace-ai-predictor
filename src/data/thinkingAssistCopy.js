/**
 * 思考アシスト（BOA-430、/race/:raceId/assist）の文言。ja 専用なので t() を通さずここにまとめる
 * （plan「i18n」。morningDigestCopy.js と同じ方式）。画面に直書きせず必ずここから読む。
 * 名前は「思考アシスト」（2026-10-08 ユーザー決定、spec D-39）。
 *
 * 使わない語: 「似たレース」「いつも」「競艇」「鉄板」「大本線」（spec 位置づけ・N-7、受け入れ E2E の禁止語）
 */

export const ASSIST_COPY = Object.freeze({
  title: "思考アシスト",
  disclaimer:
    "過去レースの傾向と公式のデータを並べています。結果を保証するものではありません。舟券の購入は20歳以上・自己責任で。",
  loading: "読み込み中…",
  fetchFailed: "表示できませんでした。時間をおいて開き直してください",
  // 一部の取得の失敗（FR-11、screens「取得の失敗」）。その部分に出し、ほかは描く
  partFailed: (part) =>
    `${part}は表示できませんでした。時間をおいて開き直してください`,
  partExhibition: "展示",
  partRates: "フライング（F）の数",
  partOdds: "オッズ",
  partSimilar: "類似レース",
  raceNotFound: "このレースは表示できるデータがありません",
  retry: "もう一度読み込む",

  // ヘッダー（screens S-1 A）
  deadline: (time) => `締切 ${time}`,
  stageGroup: "時点",
  stagePre: "展示前",
  stagePost: "展示後",
  weatherAfterExhibition: "風・波・天候は展示の後に出る",
  observedAt: (time) => `${time}観測`,
  oddsAt: (time) => `オッズ ${time}時点`,
  oddsNone: "オッズは発売後に出る",
  sonarLink: "もっと詳しく見る（龍神ソナー）",

  // 堅い？荒れる？（FW-22、D-21・D-37）
  roughTitle: "このレースは堅い？荒れる？",
  roughButton: "堅い？荒れる？の材料",
  roughB1: "1号艇の1着",
  roughManshu: "万舟",
  roughBase: (pct) => `全国${pct}%`,
  roughFew: "件数少なめ",
  // 優勝戦・準優勝戦に絞った値のときは、数えた範囲が分かるようラウンドを添える（D-37）
  roughCount: (n, round) =>
    `${round ? `${round} ` : ""}${n.toLocaleString("ja-JP")}件 ›`,
  verdict: { high: "↑ 高め", low: "↓ 低め", unclear: "差ははっきりしない" },
  verdictArrow: { high: "↑", low: "↓", unclear: "→" },
  roughSheetLead: "全国の全レースと比べる",
  baseLegend: "太い点線＝全国の全レース",
  baseLegendRef: (venue) =>
    `太い点線＝全国の全レース、細い点線＝${venue}の全レース（参考）`,
  venueAll: (venue, b1, manshu) =>
    `${venue}の全レース: 1号艇の1着 ${b1}%・万舟 ${manshu}%`,
  baseMore: (base, diff, k, n, lo, hi) =>
    `全国の全レース ${base}%より ${diff >= 0 ? "+" : ""}${diff}ポイント（${k}/${n}、ぶれ幅${lo}〜${hi}%）`,
  withoutRound: (pct, n) => `予選も含めると ${pct}%（${n}件）`,
  similarLabel: (n, all) =>
    all ? `類似レース${n}件（条件が合う全件）` : `今日に近い類似レース${n}件`,
  similarRacecardStage: "出走表の時点",
  roughNoPick: "どちらに見るかは自分で決める",

  // 数え方は2つ（D-26・D-32）
  scopeToggle: "数え方は2つ",
  scopeHead: ["そろえた条件", "全国・級の並びが同じ", "類似レース"],
  scopeRefund: ["返還のあったレース", "除く", "含む"],
  scopeCount: "件数",
  scopeNotes: [
    "ラウンドは優勝戦・準優勝戦の日だけそろえる",
    "類似レースは条件が多いぶん少なく、ぶれ幅が広い",
  ],

  // 級の並びの絵（D-31）
  classFixed: (boat) => `${boat}号艇 固定`,
  classRest: "入れ替わってもOK",
  classAria: (boat, cls, rest) =>
    `${boat}号艇は${cls}で固定、残り5艇は${rest.join("・")}で並びは問わない`,

  // レンズ（FR-4）
  lensList: "見方",
  lenses: Object.freeze({
    axis: { label: "軸", q: "1号艇は逃げる？", sub: "誰が1着候補か" },
    flow: { label: "展開", q: "スタートでどこが出る？", sub: "誰が攻めるか" },
    power: { label: "機力", q: "足が良いのは？", sub: "モーターと展示" },
    bet: {
      label: "買い目",
      q: "オッズに見合う？",
      sub: "組んだ買い目を確かめる",
    },
  }),
  hint: "艇・数字をタップ→詳しく",
  hintClose: "この案内を閉じる",

  // レースの図（FR-3）
  figure: (lens) => `レースの図（${lens}）`,
  good: "良い",
  noRecord: "記録なし",
  bestHidden: "（6艇で一番）",
  compareAria: (label, value) => `${label} ${value}、6艇で比べる`,
  backToFigure: "図を戻す",
  absent: "欠場",
  absentRemoved: (boats, k) =>
    `${boats.join("・")}号艇の欠場で${k}点を外しました`,
  cancelled: "このレースは中止です",
  candidateAria: (boat, pos) => `${boat}号艇を${pos}着の候補に`,
  candidateLabel: (pos) => `${pos}着`,
  markAria: (boat, positions) =>
    positions.length
      ? `${boat}号艇: ${positions.join("・")}着の候補。マークシートを開く`
      : `${boat}号艇: 候補に入っていない。マークシートを開く`,

  // 買い目（FR-7・FR-8）
  betRegion: "買い目",
  betLabel: (form, points) => `3連単 ${form}（${points}点）`,
  betEmpty: "1着・2着・3着の候補を入れると出る",
  composite: (v) => `合成 ${v}`,
  compositeNote: "合成オッズは丸める前の理論値",
  openSheet: "マークシートを開く",
  sheetTitle: "マークシート",
  close: "閉じる",
  budget: "予算",
  allocation: "配分",
  modeEqualPayout: "均等払戻",
  modeEqual: "均等",
  minimum: (points, yen) =>
    `${points}点には最低${yen.toLocaleString("ja-JP")}円`,
  colTicket: "組",
  colOdds: "オッズ",
  colPopularity: "人気",
  colStake: "金額",
  colPayout: "払戻",
  popularity: (n) => `${n}番`,
  trigami: "トリガミ",
  trigamiLine: "合成オッズが1.0未満。どれが当たっても予算を下回る",
  totalLine: (total, remainder, lo, hi) =>
    `合計 ${total.toLocaleString("ja-JP")}円・残り${remainder.toLocaleString("ja-JP")}円・当たったときの倍率 ${lo}〜${hi}倍`,
  missingOdds: (n) => `オッズの無い${n}点は配分に入れていない`,
  oddsCaution: (time) =>
    `オッズは${time}時点で締切まで動く。返還があると配当は変わる`,

  // v16 の状態（FR-11、v16 screens「状態」にそろえる）
  stateAbsent: "欠場があったため、過去レースの傾向は出していません",
  stateNotSaved: "このレースは、過去レースの傾向を表示できるデータがありません",
  stateReflecting: "展示の結果を反映しています",
});
