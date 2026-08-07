# ホームズ予想 手法サーベイと実装ロードマップ

BOA-103（機械学習・深層学習モデルの検討）の一環として、既存4手法の評価と
追加手法の調査を行った結果をまとめる。競艇ML実践事例（日本語ブログ・GitHub等
15件超）と、競馬・パリミュチュエル賭博の学術研究（Benter 1994, Bolton & Chapman
1986, arXiv:2509.14645 ほか15件超）の両面から調査した。

## 1. 現在の4探偵の構成

| 探偵 | 手法 | 役割 | 状況 |
|------|------|------|------|
| 🩺 ワトソン | LightGBM (LambdaRank) | 順位予測 | 未実装 |
| 💎 アドラー | 位置別温度付き Plackett-Luce | 順列確率予測 | 実装済み（軽量版・温度フィット） |
| 🏛️ マイクロフト | Transformer（選手時系列） | 順位予測（切り札） | 未実装 |
| 🎩 モリアーティ | オッズ条件付き校正 + Kelly | 賭け方の最適化（メタ） | 実装済み・改善済み |

## 2. 調査から得た核心的知見

### 2.1 予測精度と回収率は別物（むしろ逆相関）

競艇ML実践者の一致した報告: モデルを賢くすると低配当の本命レースばかり
当てるようになり、的中率は上がるが回収率は下がる。LambdaRank を8ヶ月
改善し続けた事例でも回収率100%前後で頭打ち。「安定して回収率100%超」を
主張する事例は、短期間・特定会場・偶然の高配当のいずれかだった。

**帰結**: 順位予測モデル単体の磨き込みより、「市場オッズとの歪みを突く」
構造（EVフィルタ・レース選択・券種選択）が本体。

### 2.2 Benter流「二段階オッズ結合」が最重要（今回実装済み）

香港競馬で長期利益を実証した唯一のフレームワーク:

```
P(勝者=i) ∝ exp(α・ln f_i + β・ln q_i)
  f_i = 自前モデルの勝率（必ず out-of-sample）
  q_i = 市場オッズの implied 確率
```

- 評価指標は ΔR² = R²(結合) − R²(オッズ単独)。正なら市場に対する上乗せ情報がある
- 自前モデルの価値は「市場への上乗せ分」のみ。オッズは常に特徴量に入れる

### 2.3 実測結果（本リポジトリのデータ、walk-forward 評価）

`scripts/analysis/train-conditional-logit.js` による評価。基礎モデルは
オッズ欠損レースも含む全32,068レース（2025-12〜2026-07）で学習し、
評価はオッズありのテスト月3,931レース（2026-05〜07）で実施:

| モデル | logloss | 的中率 | McFadden R² |
|--------|---------|--------|-------------|
| 基礎特徴量のみ (fund) | 1.2960 | 52.3% | 0.2767 |
| オッズ単独 (odds) | 1.3885 | 49.4% | 0.2250 |
| 二段階結合 (combined) | **1.2821** | **52.9%** | **0.2844** |

- **ΔR² = +0.059 → 市場への上乗せ情報あり**（ただしオッズが締切60〜5分前の
  スナップショットである点に注意。最終オッズはより効率的なはず）
- 結合係数は α(fund)=0.72 > β(odds)=0.32（OOF方式で推定）。オッズデータの
  蓄積が浅い（2026-04〜）ため、市場側の重みは今後上がる可能性が高い
- EVフィルタ付き単勝回収率シミュレーション: 最良でEV≥1.0の71.1%
  （100%には遠い。控除率25%の壁は厚い）
- 基礎モデルの係数: lane1=2.82 が支配的。次いで winRateDev=0.51、
  exTimeAdv=0.45（「展示タイムが最重要」という実践知見と一致）、
  venueIn1Adv=4.34（会場別1コース優位のtarget encodingが有効）

**精度改善の実験ログ**（同一テスト月2026-06/07での比較）:

| 変更 | logloss(comb) | ΔR² |
|------|---------------|------|
| 初版（オッズありレースのみ学習・単純ホールドアウト結合） | 1.2753 | +0.051 |
| +会場encoding・OOF結合（学習データ同一） | 1.2754 | +0.051 |
| +オッズ欠損レースも基礎学習に投入（6倍のデータ） | **1.2647** (2026-06) | +0.052〜0.060 |

→ 最も効いたのは**学習データを6倍にしたこと**（オッズの有無で学習対象を
絞らない）。特徴量追加の寄与は小さい。線形モデルの限界が見えており、
次の精度向上はワトソン（GBDT）の非線形性に期待するのが合理的。

### 2.4 オッズ・モメンタムは現状データでは情報なし

JRA研究（arXiv:2509.14645）の「締切直前のオッズ変化が予測情報を持つ」を
`scripts/analysis/analyze-odds-momentum.js` で検証した結果、**現状の
スナップショット密度（2時点以上あるレースが978件のみ）では有意な追加情報を
確認できず**。オッズ取得の成功率・頻度が上がった段階で再検証する価値がある。

### 2.5 特徴量の重要度（競艇ML実践の一致した知見）

1. 展示タイム（最重要）
2. モーター2連率
3. ボート2連率、全国/当地勝率、平均ST
- 効果が薄い: 風・波・チルト角
- 重要テクニック: 生値ではなく**レース内相対化（偏差値化）**

## 3. 今回実装したもの（feature/BOA-103-model-improvements）

| 種別 | ファイル | 内容 |
|------|----------|------|
| lib | `scripts/lib/harville.js` | 補正Harville（Benter γ=0.81, δ=0.65）。単勝確率→2連単/3連単/3連複確率 |
| lib | `scripts/lib/parametric-calibration.js` | Platt / Beta / **オッズ条件付き** 校正器 + 線形ソルバ |
| 改修 | `scripts/analysis/train-moriarty-calibration.js` | スコア源を race_entries に修正（**旧実装は75サンプルで飢餓状態**）、オッズ条件付き校正へ全面刷新、trio追加 |
| 改修 | `scripts/daily/generate-moriarty-recommendations.js` | 複勝proxy(winOdds/3)廃止、3連単/3連複対応、オッズ変動ヘアカット、EV閾値1.15/1.35、--dry-run |
| 改修 | `scripts/daily/update-moriarty-outcomes.js` | **的中判定バグ修正**（賭け対象を照合せず全的中扱いだった）、券種別payout照合 |
| 新規 | `scripts/analysis/train-conditional-logit.js` | 条件付きロジット+オッズ結合（新手法）の学習・walk-forward評価・本番モデル出力（--fit-production） |
| 新規 | `scripts/analysis/analyze-odds-momentum.js` | オッズモメンタムの情報量検証 |
| 新規 | `src/services/sherlockModel.js` | 特徴量・推論ロジックの共有実装（学習/フロント共用でリーク・乖離防止） |
| 新規 | `src/services/sherlockService.js` + `HolmesSherlock.jsx` | **シャーロック予想タブ**: 二段階ロジックのSVG図解、当日レースのブラウザ内リアルタイム推論（勝率バー・EV表示）、実測指標の表示 |
| 新規 | `.github/workflows/train-sherlock.yml` | 週次でモデル再学習し `data/sherlock/model.json` を自動コミット |
| docs | `docs/issues/trifecta-trio-naming-swap.md` | **trifecta/trioカラム命名スワップ問題**の記録 |
| UI | `src/services/moriartyService.js` ほか | reasons オブジェクトの表示対応、説明文の更新 |

## 4. 未実装手法のロードマップ

### 優先度A: ワトソン（LightGBM）
- 条件付きロジット（実装済み）が超えるべきベースラインになった
- Python + LightGBM の学習環境が必要（本リポジトリはNode.js）
- 設計指針: レース内相対化特徴量 / オッズあり・なし両方を学習して
  ΔR² で自前特徴量の真の価値を計測 / 時系列 walk-forward 必須 /
  LambdaRank と multiclass+校正 の両方を比較

### 優先度B: アドラー（Plackett-Luce）— 軽量版実装済み
- 軽量版を実装済み: シャーロックの勝率を効用として位置別温度付きPLで
  順列確率に展開（`src/services/adlerModel.js` / `adlerService.js`、
  タブUI `HolmesAdler.jsx`）
- 温度パラメータは `scripts/analysis/train-adler-temps.js` で実データ最尤推定
  （γ≈0.67, δ≈0.47。Benter既定値より強い減衰 = イン優位のボートレースでは
  勝率が連対力に直結しにくい）。時系列検証で3連単loglossが
  素のHarville 4.008 → Benter 3.895 → フィット値 3.876 と改善を確認。
  `train-sherlock.yml` に組み込み週次で再フィット
- 残タスク: フルNN版（効用スコアを entity embedding（選手・モーター・会場）
  入りのNNで学習）、連単・連複オッズ収集後のEV表示

### 優先度C: レース内相互作用モデル（Set Transformer）— 新探偵候補
- 6艇の集合に self-attention をかけ「誰と誰が競るか」= 展開を学習
- LambdaRank実践者が指摘した「強い選手が沈められるパターンを捉えられない」
  問題への直接の解答。艇数固定6で実装しやすい

### 優先度D: マイクロフト（Transformer）
- 現時点では見送りが正解（データ約7ヶ月、選手あたり履歴が浅い）
- ただし選手×レースの履歴系列テーブルの蓄積設計は先に始めるべき
- 投入時は「直近Nレースの attention pooling → GBDT特徴量」から

### 非推奨: 強化学習
- 競艇・競馬とも具体的成功事例なし。教師あり + Kelly最適化で十分

## 5. モリアーティの残改善（次のイテレーション）

1. **レース単位ポートフォリオKelly**: 同一レース内の排反な複数買い目を
   同時最適化（現在はbest EV 1点のみ）。Risk-Constrained Kelly
   （Busseti-Ryu-Boyd 2016）は Half Kelly の上位互換
2. **スナップショット→最終オッズのドリフトモデル**: 現在は固定ヘアカット
   （win 5% / 3連単・3連複 15%）。オッズ帯別の実測ドリフトで置き換える
3. **複勝オッズのスクレイプ追加** → 複勝EVの復活
4. **校正の定期監視**: `/calibration-report` との接続、Brier score の推移追跡
5. **命名スワップの恒久対応**（docs/issues/trifecta-trio-naming-swap.md）
   の後、補正マッピングを除去

## 6. 主要参考文献

- Benter, W. (1994). Computer Based Horse Race Handicapping and Wagering
  Systems. 注解版: actamachina.com/posts/annotated-benter-paper
- Bolton, R. & Chapman, R. (1986). Searching for Positive Returns at the
  Track. Management Science 32(8)
- Busseti, Ryu & Boyd (2016). Risk-Constrained Kelly Gambling.
  web.stanford.edu/~boyd/papers/pdf/kelly.pdf
- arXiv:2509.14645 — JRA 2004-2023 のオッズ効率性実証
- Lee et al. (2019). Set Transformer. arXiv:1810.00825
- 競艇ML実践: pc-kyotei.com（LambdaRank連載）、koji30learn.com（回収率検証）、
  note.com/blue_mihanada（8ヶ月開発記）、github.com/hmasdev/pyjpboatrace
