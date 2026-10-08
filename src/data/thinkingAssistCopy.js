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
  backToRaces: "レース一覧へ戻る",
  retry: "もう一度読み込む",

  // ヘッダー（screens S-1 A）
  deadline: (time) => `締切 ${time}`,
  gradeIppan: "一般",
  stageGroup: "時点",
  stagePre: "展示前",
  stagePost: "展示後",
  weatherAfterExhibition: "風・波・天候は展示の後に出る",
  observedAt: (time) => `${time}観測`,
  oddsAt: (time) => `オッズ ${time}時点`,
  // オッズは締切の60分前から取り込む（発売は朝から）。「発売後」と書くと発売中のレースで事実と違う（2026-10-08 ユーザー決定）
  oddsNone: "オッズは締切の約1時間前から出る",
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

  // 集めたレースは2通り（D-26・D-32）。「数える」は使わない。レースを絞る話は「集める」、割合の作り方は「出す」
  // （龍神ソナーと同じ決め方、2026-10-08 ユーザー決定、spec D-41）
  scopeToggle: "集めたレースは2通り",
  scopeHead: ["そろえた条件", "全国・級の並びが同じ", "類似レース"],
  scopeRefund: ["返還のあったレース", "除く", "含む"],
  scopeCount: "件数",
  scopeGrade: "グレード（G1以上）",
  scopeNotes: [
    "ラウンドは優勝戦・準優勝戦の日だけそろえる。グレード（G1以上）は G1・SG の日に類似レースだけそろえる",
    "類似レースは条件が多いぶん少なく、ぶれ幅が広い",
  ],

  // 級の並びの絵（D-31）。「固定」は舟券の「1着固定」と読まれるので使わない（2026-10-08 ユーザー決定）
  // 札は2行で組む（[1行目, 2行目]。読み上げ・検索では間に空白か「・」が入る）
  classFixed: (boat) => [`${boat}号艇`, "枠も級も同じ"],
  classRest: ["級の艇数だけ同じ", "どの枠かは問わない"],
  classAria: (boat, cls, counts) =>
    `${boat}号艇は枠も級（${cls}）も同じ、ほかの5艇は${counts}で級の艇数だけ同じ、どの枠かは問わない`,
  // 呼び名の近くに今日の値で例と注記を出す（名前は変えない。2026-10-08 ユーザー決定）
  classNote: (boat, cls, counts) =>
    `全国・級の並びが同じ: ${boat}号艇は ${cls}、ほかの5艇は ${counts}（どの枠にいたかは問わない）`,
  scopeRowRest: (counts) => `2〜6号艇の級（${counts}、どの枠かは問わない）`,

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
  // 終わったレース（振り返り）。取り込んだ最後のオッズで、確定オッズではない（ファン評価 1周目 指摘13）
  oddsCautionFinished: (time) =>
    `このレースは終わっています。オッズは${time}時点で、確定オッズではない`,

  // ---- レンズの要約（FR-4、screens「レンズごとの図 C」D 要約）と図の印 ----
  // 「数える」「集計」「算出」「対象」は使わない（D-41・D-42）。艇数には単位「艇」
  factNames: Object.freeze({
    nat_win: "全国勝率",
    loc_win: "当地勝率",
    recent_win30: "直近30走の1着率",
    motor_2: "モーター2連率",
    boat_2: "ボート2連率",
    st_mean30: "平均ST（直近30走）",
    exh_time: "展示タイム",
    series_score: "今節の平均着順点",
  }),
  factWords: Object.freeze({
    high: "高い",
    low: "低い",
    early: "早い",
    late: "遅い",
    fast: "速い",
    slow: "遅い",
  }),
  // 図の「良い方の札」（名前の期間は札では省く。読み上げ・要約は factNames）
  factMark: (name, word) =>
    `${name.replace("（直近30走）", "")}が一番${word}`,
  factsHeading: (boat) => `差がつく材料（${boat}号艇）`,
  factsLegend: "▲＝6艇で一番のとき",
  factHit: (word, p, base) => `▲一番${word} → 1着 ${p}%（全体 ${base}%）`,
  factRank: (n) => `${n}番目`,
  factFinalOff: (round) => `${round}の日は使わない`,
  factsNotCause: "過去の割合で、原因とは限らない",
  factsNoneLarge:
    "この範囲では、1着の割合の差がはっきり大きい材料は無い（艇の丸を押すと全部の材料が出る）",
  scopeVenue: (venue) => `${venue}・級の並びが同じ`,
  scopeChip: (label, n) => `${label} ${n.toLocaleString("ja-JP")}件`,
  axisHeading: (boat) => `${boat}号艇が1着になったのは`,
  races: (k, n) =>
    `${k.toLocaleString("ja-JP")}/${n.toLocaleString("ja-JP")}レース`,
  venueAllN: (venue, n) => `${venue}の全レース ${n.toLocaleString("ja-JP")}件`,
  whyToggle: "件数が上の枠と違う理由",
  whyRefund: (n, p, n2, p2) =>
    `ここは返還のあったレースも含める（${n}件・${p}%）。上の枠は除く（${n2}件・${p2}%）`,
  whyVenueRefund: (venue, n, p, n2, p2) =>
    `${venue}の全レースも同じ: 含めると ${n}件・${p}%、除くと ${n2}件・${p2}%`,
  whyFellBack: (venue, n) =>
    `${venue}で級の並びが同じは${n}件と少ないので、全国のレースを集めた`,
  whyVenueScope: (venue) =>
    `ここは${venue}のレースを集めた。上の枠は全国のレースを集めた`,

  // 展開（TC-H・TC-S・TC-E）。形・手がかり・進入の名前は龍神ソナー（aiPredictionTab.analogy.scenario）と同じ
  formNames: Object.freeze({
    flat: "横一線",
    wall: "内3艇そろう",
    d2: "2コース凹み",
    d3: "カド受け凹み",
    kado: "カド一撃",
    d1: "イン凹み",
    dash: "ダッシュ勢先行",
  }),
  hintConds: Object.freeze({
    kado4: "4コース（カド）の平均STが、1〜3コースのどれよりも早い",
    kado4_02: "4コース（カド）の平均STが、1〜3コースのどれよりも.02以上早い",
    in_slow02: "1コースの平均STが、2コースより.02以上遅い",
    in_fastest: "1コースの平均STが、6艇で一番早い",
    d2_slow01: "2コースの平均STが、1・3コースのどちらよりも.01以上遅い",
    d3_slow01: "3コースの平均STが、2・4コースのどちらよりも.01以上遅い",
    dash03: "4〜6コースの平均STの和が、1〜3コースの和より.03以上早い",
    flat03: "6艇の平均STの差（最も遅い−最も早い）が.03以内",
  }),
  entryNames: Object.freeze({
    waku: "枠なり",
    mae6: "前付けあり（6号艇）",
    mae5: "前付けあり（5号艇）",
    mae56: "前付けあり（5・6号艇）",
    maeOther: "前付けあり",
    mae: "前付けあり（1号艇イン）",
    inlost: "1号艇がインを取られた",
  }),
  hintMark: (form, p) => `★${form}の手がかり ${p}%`,
  attackMark: "攻め手",
  flowShapeHeading: "本番のスタートの形",
  flowShapeLead: (form) => `本番で${form}になるのは`,
  flowShapeMiss: (p) => `（当てはまらないときは${p}%）`,
  flowHitBar: (form) => `当てはまるとき、本番が${form}に`,
  flowMissBar: "当てはまらないとき",
  flowHintSource: "平均ST（このコース、直近30走）の並び。展示STではない",
  flowExhForm: (form) => `展示も${form}`,
  flowNoHint: "平均STの並びに、当てはまる手がかりは無い",
  flowIfHeading: (form) => `もし${form}になったら`,
  flowFormScope: (label, n) =>
    `${label}・枠なり ${n.toLocaleString("ja-JP")}件`,
  flowFirstBoat: "1着の艇",
  flowTopTrifecta: "よく出た3連単",
  flowFew: "件数が少ないので割合は出していない",
  entryHeading: "進入",
  entryToday: (type) => `今日の展示は${type}`,
  entryB1: (type) => `${type}のとき、1号艇の1着`,
  entryPre: "展示の後に今日の進入が出る",
  simTechHeading: (label) => `${label}の決まり手`,
  simB1: (k, p) => `1着は1号艇 ${k}件（${p}%）`,
  trifectaCount: (combo, k) => `${combo}（${k}件）`,

  // 機力（TC-X1・T5・T6・T9・T10）
  powerExhHeading: (venue, kinds) =>
    kinds.length
      ? `展示（${venue}のオリジナル展示: ${kinds.join("・")}）`
      : "展示",
  colBoat: "艇",
  colExh: "展示",
  colExhSt: "ST",
  colWeight: "体重",
  colTilt: "チルト",
  weightLight: "軽",
  powerLegendBest: "金枠＝6艇で一番速い（小さいほど良い）",
  powerLegendNone: "体重・チルトは良し悪しを付けない（軽＝一番軽い）",
  partsNone: "部品交換 全艇なし",
  partsBoats: (boats) => `部品交換 ${boats.join("・")}号艇`,
  powerPre: "展示タイム・オリジナル展示・チルト・部品交換は展示の後に出る",
  motorHeading: "モーター2連率（6艇）",
  motorChip: (boat, top, v) =>
    `${boat}号艇は6艇で${top ? "一番高い" : "最下位"}（${v}%）`,
  motorChipRate: (top, p, base) =>
    `${top ? "一番高い" : "最下位"}のとき1着 ${p}%（全体 ${base}%）`,
  tiltMark: (v) => `チルト${v > 0 ? "+" : ""}${v}`,
  partsMark: "交換",

  // 買い目（FR-8・FW-18・FW-19）
  betBoxHeading: (points) => `組んだ買い目（${points}点）`,
  manshuHeading: "万舟の割合（3連単1万円以上）",
  simTopHeading: (label) => `${label}でよく出た3連単`,
  colCount: "件数",
  colSimilar: "類似",
  similarColNote: (n) =>
    `列「類似」は類似レース${n}件のうち、この組で決まった回数（オッズと掛け合わせない）`,

  // 深掘り（FR-5、screens「操作できる要素の名前」）
  deepRegion: (boat) => `${boat}号艇の詳しい情報`,
  deepMeta: (cls, age, weight) =>
    [cls, age != null && `${age}歳`, weight != null && `${weight}kg`]
      .filter(Boolean)
      .join("・"),
  // 成績から付けた札（D-41。「数えた値の札」から言い換え）
  featTitle: "成績から付けた札",
  feat: Object.freeze({
    stFast: "スタートが早い",
    seriesGood: "今節好調",
    recentWin: "最近よく勝つ",
    natTop: "実力上位",
    locTop: (venue) => `${venue}が得意`,
    locNone: "当地の記録なし",
    tech: (t) => `${t}で勝つことが多い`,
  }),
  featWhy: Object.freeze({
    stFast: "平均ST（直近30走）が6艇で一番早い",
    seriesGood: "今節の平均着順点（前日まで）が6艇で一番高い",
    recentWin: "直近30走の1着率が6艇で一番高い",
    natTop: "全国勝率が6艇で一番高い",
    locTop: "当地勝率が6艇で一番高い",
    locNone: "当地勝率の記録が無い",
    tech: (wins, t, k) => `直近90日の1着${wins}回のうち${t}が${k}回`,
  }),
  kvSt: "平均ST",
  kvPretest: "前検タイム",
  kvTech: "勝ち決まり手",
  kvCourse: (c) => `${c}コースで走ったとき`,
  courseWin: (k, n) => `1着 ${k}/${n}`,
  courseNote: "進入コース・直近2年",
  stCourseChip: (v) => `このコース ${v}`,
  stVenueChip: (venue, v) => `${venue} ${v}`,
  seriesRank: (rank) =>
    rank === 1 ? "6艇で一番高い" : rank === 6 ? "6艇で一番低い" : `6艇で${rank}番目`,
  beforeToday: "前日まで",
  todayRun: (r, f) => `今日 ${r}R ${f ?? "—"}着（点に入れない）`,
  runsToggle: "1走ずつの表",
  pretest: (t, rank) => `${t}${rank ? `（参加艇で${rank}位）` : ""}`,
  techLine: (wins) => `1着${wins}回: `,
  techNone: "直近90日の1着なし",
  exhStChip: (v) => `展示ST ${v}`,
  tiltChip: (v) => `チルト ${v}`,
  runsMeet: (venue) => `今節（${venue}）`,
  captionMeet: "今節の各走",
  captionPrior: "今節より前の5走",
  colDay: "日",
  colDate: "日付",
  colVenue: "場",
  colRace: "R",
  colCourse: "進入",
  colSt: "ST",
  colFinish: "着",
  colPoints: "点",
  todayRow: "今日",
  avgRow: (avg, sum, cnt) => `平均 ${avg}＝${sum}点÷${cnt}走`,
  avgNote: "（今日の走は入れない）",
  courseMissing: "進入「—」＝記録なし",
  meetTabLink: "得点率・ST の推移（出走表とタブ › 今節）›",
  noRunsData: "表示できるデータがありません",

  // v16 の状態（FR-11、v16 screens「状態」にそろえる）
  stateAbsent: "欠場があったため、過去レースの傾向は出していません",
  stateNotSaved: "このレースは、過去レースの傾向を表示できるデータがありません",
  stateReflecting: "展示の結果を反映しています",
});
