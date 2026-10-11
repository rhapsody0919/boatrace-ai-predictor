# 龍神レーダー データの知見ノート（データサイエンティスト役が最初に読む）
1行1知見、出典つき。データサイエンティスト役（.claude/agents/data-scientist.md）が最初に読み、答えの最後に出した「足す行」を依頼元が書き足す。古くなった行は消さずに「（廃止 日付 理由）」を付ける。初版は hq の knowledge/ryujin/data-scientist.md（2026-10-11 時点）を写した

## 直前情報・展示
- 展示タイムは直前情報で一番効く。全国の枠なり313,938R、攻める艇の1着率は展示タイム順位の上位(1〜2位)→下位(5〜6位)でカド一撃0.403→0.223、イン凹み0.384→0.235。7形すべてでモーター2連率の順位より差が大きい（docs/design/analogy-finder/slit-hint/mark1.md、2026-10-11 確認）
- 1着モデルの重要度で展示タイム偏差は3位（0.068、艇番0.313・勝率偏差0.111に次ぐ）（analysis/phase-m-result.md）
- 1号艇は同じ選手でも展示タイムが約0.017秒速く出る偏り（analysis/t1/t1-result.md）
- 展示STは本番STとの相関が艇ごと0.08（平均STは0.28）。着順への上積みも無し。主役にせず「参考」と注記（slit-hint/slitpred.md、phase-m-result.md）
- 展示が全艇枠なりなら本番も枠なり92.8%（entry-slit/prep7.md）
- 周回・まわり足・直線（オリジナル展示、BOATCAST）は1,128Rしかなく判定不能、約4.7万R要る。会場ごとに区間が違い会場をまたいで比べられない。チルトも判定不能。当日体重は上積みなし。部品交換・プロペラは未分析（phase-m-result.md、Orchestrate 2026-10-11）
- 2着の当てやすさ（1着艇を除く5艇で2着艇がその指標の上位2位に入る率、でたらめなら40%）: 展示タイム49.3%、展示ST44.3%、モーター2連率42.1%（scripts/lib/unifiedModel.js のコメント、1000R）

## 進入
- 選手ごとの「同じ枠番での実際の進入コース」は racer_aggregated_stats.course_entry_tendency（直近1年、全国と会場別）。サイトの画面には出ていない。例: 岩永雅人(4630) 6号艇29走すべて6コース（2026-10-11 取得）

## 選手・機力
- モーター2連率は単体の予測力が低い。展示タイムと並べて見せる（2026-10-11 データサイエンティスト役）

## 専任のデータ分析レーンは無い
- 分析は BOA-271 の学習側・実装側レーンが行った（Phase M、slit-hint）。問い合わせは Orchestrate 経由（2026-10-11）

## 思考アシスト
- 2〜6号艇が1着のレースを「その艇の級でそろえた範囲（VC/NC）」で見ると中央値69件、30件未満24%、6号艇は57%。会場の全レース（VA）なら中央値1,698件・最小342件（6号艇、10%点400件）（10/8〜10/11の600R×5艇、docs/design/thinking-assist/analysis/boa845-axis-place.md、2026-10-12）
- 2〜6号艇が1着のときの2着は軸で変わる: 1号艇+11〜+22pt、2号艇−6〜−12pt、4が1着なら5が+6pt。無条件の値より2着の Brier が3.4%良い（区間 [2.8, 4.0]%、学習〜2026-03・検証2026-04〜09の12,462R）（docs/design/thinking-assist/analysis/boa845-axis-place.md、2026-10-12）
- 1着だけを条件にした3着は、相手の無条件の3着率より良くならない（Brier −0.24%、区間は0をまたぐ）（docs/design/thinking-assist/analysis/boa845-axis-place.md、2026-10-12）
- 級でそろえた範囲の条件付きの率は30件未満だと無条件より悪い（2着 Brier 0.8123 対 0.7856）。30件未満は割合を出さず、件数が足りる範囲へ広げる（docs/design/thinking-assist/analysis/boa845-axis-place.md、2026-10-12）
- 2〜6号艇の1着時の2着・3着は、1号艇の範囲・会場の全レース・全国の scenario（tri）からバッチの変更なしで出せる（src/utils/assistSummary.js の winFollowers の boat 引数、api/analogy/scenario の scope=VA）（docs/design/thinking-assist/analysis/boa845-axis-place.md、2026-10-12）
