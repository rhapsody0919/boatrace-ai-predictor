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
  // 主語を付ける（何が出走表の時点か。PR4 の UI/UX デザイナーのレビュー P2-7）
  similarRacecardStage:
    "類似レースは出走表の時点の値で集めた（展示後の値はまだ無い）",
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
  // label は集めた範囲の呼び名（深掘りで会場に絞った艇は「{会場}・級の並びが同じ」。ファン評価 PR4 1周目 指摘3）
  classNote: (boat, cls, counts, label = "全国・級の並びが同じ") =>
    `${label}: ${boat}号艇は ${cls}、ほかの5艇は ${counts}（どの枠にいたかは問わない）`,
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
  // 説明の種類の案内（screens「説明の種類」）
  hint: "艇・数字をタップ→詳しく ／ ? 用語 ／ 傾向 › 過去",
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
  // 図の右端の「+」。押すとその行に1着・2着・3着の候補のボタンを出す（BOA-801 7、spec D-43）
  markAria: (boat, positions) =>
    positions.length
      ? `${boat}号艇: ${positions.join("・")}着の候補。候補を選ぶ`
      : `${boat}号艇: 候補に入っていない。候補を選ぶ`,

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
  oddsTimes: (v) => `${v}倍`,
  // 類似レースでよく出た3連単の表の上の1行（BOA-808 P3）。オッズの時刻が無ければ「今日の値」とだけ書く。
  // 終わったレースは「今日」と書かない（配分の注記 oddsCautionFinished と同じく確定オッズではないと書く）
  simTopNote: (n, time, finished = false) =>
    `件数は類似レース${n.toLocaleString("ja-JP")}件のうち。${
      finished
        ? `オッズ・人気はこのレースの${time ? `${time}時点` : "取り込んだ最後の値"}で、確定オッズではない`
        : `オッズ・人気は今日${time ? `の${time}時点` : "の値"}`
    }`,
  trigami: "トリガミ",
  trigamiLine: "合成オッズが1.0未満。どれが当たっても予算を下回る",
  totalLine: (total, remainder, lo, hi) =>
    `合計 ${total.toLocaleString("ja-JP")}円・残り${remainder.toLocaleString("ja-JP")}円・当たったときの倍率 ${lo}〜${hi}倍`,
  missingOdds: (n) => `オッズの無い${n}点は配分に入れていない`,
  // 均等払戻で切り捨てた余りを足したとき（spec FR-8・D-43）
  toppedNote: "余りは払戻の少ない組に足した",
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
  factMark: (name, word) => `${name.replace("（直近30走）", "")}が一番${word}`,
  factsHeading: (boat) => `差がつく材料（${boat}号艇）`,
  // ▲は一番上にも一番下にも付く（BOA-808 の4）
  factsLegend: "▲＝今日6艇で一番上か一番下",
  // 件数を添える（どれだけのレースから出した割合か。BOA-808 の3）
  // 「→」はヘッダーで「はっきりしない」の印に使うので、ここでは使わない（ファン評価 PR5 1周目 指摘5）
  factHit: (word, p, n, base) =>
    `▲一番${word}のとき 1着 ${p}%・${n.toLocaleString("ja-JP")}件（全体 ${base}%）`,
  factNoToday: "今日の値なし",
  // 差の大きさ（v16 の judgeGap の level）。軸の要約の「差がはっきり大きい材料は無い」と同じ判定
  factLevel: Object.freeze({
    large: "差が大きい",
    some: "差がある",
    small: "差は小さい",
    unclear: "件数が少なく差ははっきりしない",
  }),
  factRank: (n) => `${n}番目`,
  factFinalOff: (round) => `${round}の日は使わない`,
  factsNotCause: "過去の割合で、原因とは限らない",
  // 深掘りの残りの材料を畳んだ見出し（2026-10-09 ユーザー決定 A）
  factsAll: (boat) => `全部の材料（${boat}号艇）`,
  factsNoneLarge:
    "この範囲では、1着の割合の差がはっきり大きい材料は無い（艇の丸を押すと全部の材料が出る）",
  scopeVenue: (venue) => `${venue}・級の並びが同じ`,
  scopeChip: (label, n) => `${label} ${n.toLocaleString("ja-JP")}件`,
  // 同じ呼び名で件数が違う札に、違う理由を短く添える（BOA-809、2026-10-10 ユーザー決定）
  scopeChipWhy: (label, n, why) =>
    `${label} ${n.toLocaleString("ja-JP")}件・${why}`,
  scopeWhy: Object.freeze({
    hint: "平均STがそろったレース",
    entry: "進入が分かったレース",
  }),
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
  // 図は展示ST でも、手がかりは平均ST から出していると札に書く（screens「★平均STの手がかり（{形}）」。ファン評価 PR4 1周目 指摘8）
  hintMark: (form, p) => `★平均STの手がかり（${form}）${p}%`,
  // 何の形のときの攻め手かを書く（同 指摘9）
  attackMark: (form) => `${form}なら攻め手`,
  // 買い目の図の「過去の1着」がどの範囲の値か（艇ごとに違う。271 の指摘の型「どのレースから出した数字か」）
  pastWinNote:
    "過去の1着＝その艇の差がつく材料と同じ集めたレースでの1着の割合（艇ごとに範囲が違う。範囲と件数は艇の丸から）",
  // 優勝戦・準優勝戦の日でも、展開はラウンドを問わずに集める（形・進入の件数が要るため）。そうと分かる呼び名にする
  flowScopeLabel: (final) =>
    final ? "全国・級の並びが同じ（予選も含む）" : "全国・級の並びが同じ",
  flowShapeHeading: "本番のスタートの形",
  flowShapeLead: (form) => `本番で${form}になるのは`,
  flowShapeMiss: (p) => `（当てはまらないときは${p}%）`,
  flowMissBar: "当てはまらないとき",
  flowHintSource: "平均ST（このコース・直近30走）の並び。展示STではない",
  // 展開レンズの展示前の横軸の切り替え（BOA-815 案A。龍神ソナーと同じ「このコース｜直近30走」）
  stBasisGroup: "使う平均ST",
  stBasis: Object.freeze({ course: "このコース", overall: "直近30走" }),
  stFilled: "全体で補った",
  flowCourseNote:
    "枠なりのレースでこの枠を走った直近30走の平均（F・Lを除く、前日まで）。この枠の走が5走未満の艇は、直近30走（どの枠でも）で補って「全体で補った」と出す",
  // v16 の保存が無いレース（808-6）。正本は v16 の値なので、別の値で埋めずに理由を書く
  stNoData:
    "このレースは平均ST（直近30走）を出せない（前日までの値がまだ無い）",
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
  entryNoPast: "このレースは過去レースの傾向がまだ無い",
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
  colWeight: "体重(kg)",
  colTilt: "チルト",
  weightLight: "軽",
  powerLegendBest: "金枠＝6艇で一番速い（小さいほど良い）",
  powerLegendNone: "体重・チルトは良し悪しを付けない（軽＝一番軽い）",
  partsNone: "部品交換 全艇なし",
  partsBoats: (boats) => `部品交換 ${boats.join("・")}号艇`,
  // 展示前は展示の値の名前（チルト・部品交換）も出さない（screens「状態」展示前）
  // 機力の要約の結論（問い「足が良いのは？」への答えを先に。デザイナーのレビュー P2-8）
  // 一番の艇が同じ項目は1つにまとめる（BOA-808 2）。例: 「展示タイム・モーター2連率は4号艇（6.83秒・38.5%）、一周・まわり足は1号艇（37.31秒・11.49秒）が一番」
  powerConclusion: (items) => {
    const groups = [];
    for (const it of items) {
      const key = it.boats.join("・");
      const g = groups.find((x) => x.key === key);
      if (g) g.items.push(it);
      else groups.push({ key, items: [it] });
    }
    if (!groups.length) return "";
    return `${groups
      .map(
        (g) =>
          `${g.items.map((it) => it.label).join("・")}は${g.key}号艇（${g.items.map((it) => it.text).join("・")}）`,
      )
      .join("、")}が一番`;
  },
  powerPre: "展示タイム・オリジナル展示などの展示の値は、展示の後に出る",
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
  courseWin: (k, n) => `1着 ${k}/${n}走`,
  courseNote: "進入コース・直近2年",
  // 走数を出す。5走未満は直近30走で補った値（BOA-815 方針4）
  stCourseChip: (v, n, filled) =>
    filled ? `このコース ${v}（全体で補った）` : `このコース ${v}（${n}走）`,
  kvStLabel: "平均ST（直近30走）",
  stVenueChip: (venue, v) => `${venue} ${v}`,
  seriesRank: (rank) =>
    rank === 1
      ? "6艇で一番高い"
      : rank === 6
        ? "6艇で一番低い"
        : `6艇で${rank}番目`,
  beforeToday: "前日まで",
  todayRun: (r, f) => `今日 ${r}R ${f ?? "—"}着（点に入れない）`,
  runsToggle: "1走ずつの表",
  pretest: (t, rank) => `${t}${rank ? `（参加艇で${rank}位）` : ""}`,
  techLine: (wins) => `1着${wins}回: `,
  techItem: (t, k) => `${t}${k}回`,
  techNone: "直近90日の1着なし",
  // 期間を書く（コースの1着「直近2年」と並ぶので、何の期間か分からないと矛盾して見える。同 指摘2）
  techPeriod: "直近90日",
  exhStChip: (v) => `展示ST ${v}`,
  tiltChip: (v) => `チルト ${v}`,
  captionMeet: (venue) => `今節の各走（${venue}）`,
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

  // ---- 用語の「?」と「傾向 ›」（spec D-8・D-15、screens「説明の種類」） ----
  termAria: (term) => `${term}とは`,
  theoryAria: (name) => `${name}の過去レースの傾向`,
  trend: "傾向 ›",
  roughLegend: "↑↓＝全国の全レースより高め・低め　→＝はっきりしない",
  factsPreExhibition: "展示タイムの材料は展示の後に分かる",

  // ---- セオリーカード（FR-6、screens S-1b） ----
  theoryCond: "条件",
  theoryLikely: "起きやすいこと",
  theoryPast: "過去レースの傾向",
  theoryPrep: "過去レースの傾向: 準備中（まだ集めていない）",
  theoryTodayHit: (t) => `今日当てはまる（${t}）`,
  theoryTodayMiss: (t) => `今日は当てはまらない（${t}）`,
  theoryTodayPending: (t) => `今日: ${t}`,
  theoryAlso: "同じ条件に関係するセオリー（向きが逆のものも並べる）",
  theoryFoot: "「〜が起きやすい傾向」で、当てはまってもそうならないことがある",
  theorySince: "全国の過去レース（2019/4/1〜）",
  theoryNotHappened: (p) => `攻める艇が1着にならなかった ${p}%`,
  theoryAttackWin: (boat) => `攻める艇（${boat}号艇）の1着`,
  theoryB1Win: "1号艇の1着",
  theoryFormAfter: "スリットの形はレースの後に分かる（もしこうなったら）",
  // スリットの形は本番の結果なので「今日当てはまる」とは書かない（ファン評価 PR5 1周目 指摘2）
  theoryTodayFormHint: (p) =>
    `平均STの手がかりあり。本番でこの形になったのは${p}%（形はレースの後に分かる）`,
  theoryTodayFormExhibition: "展示がこの形（本番の形はレースの後に分かる）",
  theoryPendingForm: "展示の形は展示の後に分かる",
  theoryPendingEntry: "進入は展示の後に分かる",
  theoryMissForm: "今日の展示はこの形ではない",
  theoryHintTitle: (form) => `平均STの手がかり（${form}）`,
  theoryHintLikely: (form) => `本番のスタートが「${form}」になりやすい`,
  theoryHintHit: (form) => `当てはまるとき、本番が${form}に`,
  theoryHintNotDecisive: (form) =>
    `当てはまっても、${form}にならない方が多い（決め手ではなく手がかり）`,
  theoryTodayHint: (vals) =>
    `平均STの並びが条件に合う（このコース・直近30走: ${vals}）`,
  theoryMissHint: "平均STの並びは条件に合わない",
  theoryEntryShare: (name) => `${name}になったレース`,
  theoryFactTitle: (name, boat) => `${boat}号艇の${name}`,
  theoryFactCond: (name, good, bad) => `${name}が6艇で一番${good}／一番${bad}`,
  theoryFactLikely: (boat) => `${boat}号艇の1着の割合が変わる`,
  theoryFactWhen: (word) => `一番${word}とき`,
  theoryFactToday: (boat, pos) => `今日の${boat}号艇は6艇で${pos}`,
  theoryFactFinalOff:
    "優勝戦・準優勝戦の日は、点の順位がほぼ枠の順になるので「今日」は出さない",
  theoryVenueTitle: (venue) => `${venue}のイン`,
  theoryVenueCond: (venue) => `${venue}の全レース`,
  theoryVenueLikely: "1号艇の1着の割合は会場ごとに違う",
  theoryVenueAll: (venue, n) =>
    `${venue}の全レース ${n.toLocaleString("ja-JP")}件で、1号艇の1着`,
  theoryVenueNote:
    "範囲が違う2つ。並べて見るだけで、上がる・下がるとは読まない",
  theoryWindTitle: (speed) =>
    speed != null ? `今日の風（${speed}m）` : "今日の風",
  theoryWindCond: (venue, band) => `${venue}・風速${band}のレース`,
  theoryWindLikely: "艇番ごとの1着の割合が、風を問わないときとどう違うか",
  theoryWindScope: (venue, band) => `${venue}・風速${band}`,
  // 今日の風の向き（ホームストレッチに対して。BOA-809）
  windRelation: Object.freeze({
    tail: "追い風",
    head: "向かい風",
    cross: "横風",
  }),
  theoryWindToday: (dir, speed, rel = null) =>
    `今日は${dir}${speed}m${rel ? `・${rel}` : ""}`,
  // 当てはまる・当てはまらないは札（今日当てはまる／当てはまらない）が言うので、文は今日の風だけ
  theoryWindTodayRel: (rel, speed) => `今日は${rel ?? ""}${speed}m`,
  theoryTodayHere: "今日はこちら",
  theoryPendingWind: "風は展示の後に分かる",
  // 表は風速の区分だけ（向きを区別しない）。今日の向きは「今日当てはまる」の行に書く（BOA-809）
  theoryWindMixed: "表は追い風・向かい風が混ざった値",
  theoryWindCols: ["艇", "この風", "風を問わず", "差(pt)"],
  // 棒の中の線（ファン評価 PR5 1周目 指摘12）
  theoryBarLegend: "棒の2本の縦線の間＝ぶれ幅（件数が少ないほど広い）",
  tidePrep: "潮位は準備中",
  theoryTodayBoat: (boat, t) => `${boat}号艇は${t}`,
  theoryTodayRound: (round) => `今日は${round}`,
  theoryTodayX1: (v, rank) => `今日の1号艇は ${v}（6艇で${rank}番目）`,
  theoryPendingExhibition: "展示の後に分かる",
  theorySujiRelated: (form, att, n, list) =>
    `関連する実データ: ${form}（攻める艇は${att}号艇）になったレース${n.toLocaleString("ja-JP")}件では、よく出た3連単は ${list}`,
  // 図の印・機力の札の名前（押すとセオリーカード）
  exhBiasMark: "展示の偏り",
  // 印の名前は「{印}（{n}号艇）」。「{n}号艇 」で始めない（艇の行のボタン「{n}号艇 {苗字}」と読み分ける）
  markName: (text, boat) => `${text}（${boat}号艇）`,
  sujiChip: ["スジのセオリー", "3まくり→3-4／まくり差し→3-1"],
  powerTheory: Object.freeze({
    x1: "1号艇は展示が速く出やすい",
    tilt: "チルト",
    weight: "体重",
  }),
  roundTheory: (round) => `${round}のスタート`,
  theoryHintButton: "★ 手がかり ›",
  theoryExhGap: "展示タイムの差",
  partsTheory: "部品交換",

  // ---- 会場の特徴（D-14・D-18・D-35・D-37） ----
  venueTitle: (venue) => `${venue}の特徴`,
  venueAria: (venue) => `${venue}の特徴`,
  waterType: Object.freeze({ fresh: "淡水", brackish: "汽水", sea: "海水" }),
  waterTide: "（潮の満ち引きがある）",
  // 型は venues の cluster（モデル調整用の分類）ではなく、この会場の1号艇の1着を全国の全レースと比べて書く
  // （桐生 51% が「イン強い」と出た。ファン評価 PR5 1周目 指摘1）
  venueType: "イン（1号艇）",
  venueTypeWord: (verdict, p, base) =>
    verdict === "high"
      ? `全国の全レースより1着が高め（${p}%・全国${base}%）`
      : verdict === "low"
        ? `全国の全レースより1着が低め（${p}%・全国${base}%）`
        : `全国の全レースと差ははっきりしない（${p}%・全国${base}%）`,
  venueWater: "水質",
  venueB1: (venue, n) =>
    `1号艇の1着: ${venue}の全レース ${n.toLocaleString("ja-JP")}件（2019/4/1〜）`,
  venueTechCount: (n, n90) =>
    `直近1年 ${n.toLocaleString("ja-JP")}件。薄い帯は直近90日 ${n90.toLocaleString("ja-JP")}件`,
  venueTrend: (t, mark, p90, prev) =>
    `${t} 最近${mark === "up" ? "↑" : "↓"} 90日${p90}%／前${prev}%`,
  venueNote:
    "集めた期間が違う（1号艇の1着は2019年から、決まり手は直近1年）。最近↑↓は直近90日とそれより前の275日の割合がはっきり離れたときだけ",
  tide: "潮",
  stScaleDir: "◀ 早い　　　遅い ▶",
  venueTide: "潮の傾向",
  venueTech: "決まり手",
  venueLink: (venue) => `${venue}の会場ページで詳しく見る ›`,

  // ---- ガイド（FR-10、screens S-1c）。各段1文（40字以内） ----
  guideRegion: "ガイド",
  guideStep: (i, step) => `ガイド ${i}/5 ${step}`,
  guideNext: "次へ",
  guidePrev: "戻る",
  guideDone: "おわり",
  guide: Object.freeze([
    { step: "①堅い？荒れる？", q: "このレースは堅い？荒れそう？" },
    { step: "②1号艇", q: "1号艇は逃げられそう？" },
    { step: "③壁と攻める艇", q: "スタートでどこが凹み、誰が攻める？" },
    { step: "④足", q: "足が良いのは？" },
    { step: "⑤買い目", q: "買い目を組んで、オッズに見合うか確かめよう" },
  ]),
  guideVerdictWord: Object.freeze({
    high: "高め",
    low: "低め",
    unclear: "はっきりしない",
  }),
  // 同じ語を2回並べない（両方はっきりしないときは1つにまとめる）
  guideRoughSub: (b1, m) =>
    b1 === m && b1 === "はっきりしない"
      ? "1号艇の1着・万舟とも全国との差ははっきりしない。枠を押すと材料"
      : `1号艇の1着は${b1}・万舟は${m}。枠を押すと材料が出る`,
  guideRoughSubNone: "1号艇の1着と万舟の割合を、全国の全レースと比べる",
  guideAxisSub: "大きい数字が1号艇の1着率。▲は今日6艇で一番上か一番下",
  guideFlowSub: (form, p, att) =>
    att
      ? `${form}の手がかりあり（本番${p}%）。なれば${att}号艇が攻める`
      : `${form}の手がかりあり（本番${p}%）`,
  guideFlowSubNone: "当てはまる手がかりは無い。図はスタートの早さ",
  guidePowerSubPost: "金枠が6艇で一番速い。1号艇は展示が速く出やすい",
  guidePowerSubPre: "展示は展示の後に出る。今はモーター2連率を見る",
  guideBetSub: "1着・2着・3着を押して組む。合成オッズ1.0未満はトリガミ",
});

/**
 * 用語の「?」（D-8・D-15・D-32）。長い説明は箇条書き・表・絵にする。
 * lead＝1行目、items＝箇条書き、points＝今節の平均着順点の配点の表、classes＝級の並びの絵、stScale＝平均ST の目盛り
 */
export const GLOSSARY = Object.freeze({
  級: { lead: "選手の格付け。上から A1・A2・B1・B2。半年ごとに成績で決まる" },
  F: {
    lead: "フライング（スタートの早すぎ）の回数",
    items: ["持っていると罰則が重くなるので、スタートを控えやすい"],
  },
  全国勝率: {
    lead: "全国のレースの成績を点にした平均（1着ほど高い）。高いほど強い選手",
  },
  当地勝率: { lead: "この会場での勝率。高いほどこの水面が得意" },
  直近30走の1着率: {
    lead: "前日までの直近30走で1着だった割合。高いほど最近調子が良い",
  },
  平均ST: {
    lead: "スタートタイミング（合図からスタートラインを通るまでの遅れ）の平均。直近30走、Fを除く",
    items: [
      "「このコース」は今日と同じコースを走ったときだけの平均",
      "0に近いほど早い",
    ],
    stScale: true,
  },
  今節の平均着順点: {
    lead: "この節で前日までに走ったレースの着順を点にした平均。高いほど調子が良い（公式の得点率とは別）",
    points: true,
  },
  モーター2連率: {
    lead: "このモーターが、使われてから2着以内に入った割合。高いほど良いモーターと言われる",
  },
  前検タイム: {
    lead: "節の初日の前に、モーターの調子を見るために測るタイム。小さいほど速い",
    items: ["順位は、その節に参加する全艇の中での順番"],
  },
  勝ち決まり手: {
    lead: "この選手が直近90日に1着になったときの決まり手の内訳。どんな勝ち方が多い選手か",
  },
  成績から付けた札: {
    lead: "成績の値から機械的に付けた札（評判ではない）",
    items: ["札を押すと、何の値から付けたかが出る"],
  },
  展示: { lead: "展示航走（本番前の試走）のタイム。小さいほど速い" },
  一周: {
    lead: "オリジナル展示の1周のタイム。小さいほど速い",
    items: ["測る項目は会場ごとに違う"],
  },
  まわり足: {
    lead: "オリジナル展示の、ターンの区間を測ったタイム。小さいほど速い",
    items: ["測る区間は会場ごとに違う"],
  },
  直線: {
    lead: "オリジナル展示の、直線の区間を測ったタイム。小さいほど速い",
    items: ["測る区間は会場ごとに違う"],
  },
  展示ST: {
    lead: "展示航走のスタートタイミング。0に近いほど早い",
    items: ["本番のスタートとは別"],
  },
  類似レース: {
    lead: "全国の過去レース（2019/4/1〜）のうち、次がそろうレース。龍神ソナーの「類似レース」と同じ",
    items: [
      "1号艇の級",
      "勝率トップの艇",
      "1号艇と勝率トップの全国勝率の差の段階",
      "ラウンド（優勝戦・準優勝戦の日だけ）・グレード（G1・SG の日だけ）",
      "級の並びは問わない。返還のあったレースも含める",
    ],
  },
  "全国・級の並びが同じ": {
    lead: "全国の過去レース（2019/4/1〜）で、6艇の級の艇数と1号艇の級が今日と同じレース",
    items: ["艇番の並び（2〜6号艇の枠）・ラウンド・勝率は問わない"],
    classes: true,
  },
  全国の全レース: {
    lead: "比べる基準",
    items: [
      "全国24場の全レース（2019/4/1〜、返還を除く）",
      "1レースを1件として出した割合。会場ごとや選手ごとの平均ではない",
      "高め・低めは、ぶれ幅が全国の全レースと重ならないときだけ付ける",
    ],
  },
  万舟: { lead: "3連単の払戻が1万円以上になったレース" },
  合成オッズ: {
    lead: "組んだ買い目のどれが当たっても同じ払戻になるように買ったときの、全体の倍率（理論値）",
    items: [
      "100円単位に丸めると組ごとに少しずれる",
      "1.0未満だと、当たっても賭けた金額を下回る（トリガミ）",
    ],
  },
  トリガミ: { lead: "当たったのに、払戻が賭けた合計を下回ること" },
  人気: {
    lead: "3連単120通りのオッズが低い順の順番。1番人気が一番売れている",
  },
  過去の1着: {
    lead: "この艇番・この級で、差がつく材料と同じ集めたレースで1着になった割合",
  },
  均等払戻: {
    lead: "どれが当たっても払戻がほぼ同じになるように、オッズが低い組ほど多く買う配分",
    items: ["「均等」はどの組も同じ金額で買う配分"],
  },
  差がつく材料: {
    lead: "過去レースで、その項目が6艇で一番良いときと一番悪いときに、1着の割合がどれだけ違ったか",
    items: [
      "差が大きい項目ほど着順に関係していた",
      "▲は今日その艇が6艇で一番上か一番下",
      "過去の割合で、原因とは限らない",
    ],
  },
  枠なり: { lead: "6艇が艇番どおりのコースに入ること" },
  水質: {
    lead: "海水・淡水・汽水",
    items: [
      "海水・汽水は潮の満ち引きで水面が変わる",
      "淡水は体が浮きにくく、体重差が効きやすいと言われる",
    ],
  },
});
