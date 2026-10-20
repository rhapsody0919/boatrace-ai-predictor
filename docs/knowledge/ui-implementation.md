# 画面の実装の落とし穴

サイトの画面を実装するときに踏みやすい落とし穴（CLS・部品の埋め込み・状態の共有・機能変更で古くなるもの）。画面の決まりは [ui-layout.md](ui-layout.md)。主に visual-designer と実装者が読む。書き方は [README.md](README.md)。

## ページと部品の構成
- トップ（/）の実体は App.jsx ではなく src/pages/VenueGridPage.jsx。トップを調べるときは src/AppRouter.jsx の path="/" から見る（2026-09-01、memory cls_mobile_fix_2026_09_01、PR #467）
- 分析ツールの部品を embedded で埋め込むとき、部品の前提（「本日開催中」の一覧からの自動選択）が埋め込み先で成り立つか確かめる。過去日のレースで無関係なレースへ黙って切り替わっていた（2026-08-31、memory race_detail_analysis_tool_integration_2026_08、PR #435）
- レース詳細の基本情報・枠別・今節タブは艇番（player.number）で艇を識別し、選んだ艇を PredictionPanel の boatFocus で共有する。モータ情報タブだけ motor_number 基準で共有に乗っていない。タブ等の状態は URL に同期していない（2026-09-28、memory race_detail_shared_boat_selection_2026_09_28、PR #899、要確認）

## CLS
- 読み込み中に高さの違う画面へ丸ごと差し替えない。本物と同じ CSS クラスのスケルトン（VenueGridSkeleton）で場所を取る（2026-09-01、memory cls_mobile_fix_2026_09_01、PR #467）
- 画像は実寸の width/height で場所を取る（会場は src/data/venueImageDimensions.js、ブログはビルドの時に作る表）。一律の aspect-ratio: 16/9 はブログ画像121枚中57枚で文字が切れて撤回した。ブログ画像の表は 2026-10-20 からビルドの時に画像のヘッダーから作る（vite.config.js の仮想モジュール、scripts/lib/blogImageDimensions.js、BOA-908）ので、手で直さない（2026-09-09、memory cls_mobile_followup_2026_09_09、PR #614）
- preload="none" の video は height か aspect-ratio を指定する（poster の読み込みで高さが変わる）。CLS を調べるときは先に git log で過去の対策が撤回されていないか見る（2026-09-09、memory cls_mobile_followup_2026_09_09、PR #614）

## 機能を変えたときに古くなるもの
- HowToUse.jsx・About.jsx・FAQ.jsx の説明は機能の変更に追いつかず、今の UI と食い違ったまま残っていた。UI を変えたら3つを grep して確かめる。/how-to-use は日本語だけのページ（2026-09-28、memory phase_a_content_rollout_2026_09_28、BOA-456）
- /about の紹介動画（public/videos/about-hero-*.mp4）は grep では古さが分からない。モデル・指標を大きく変えたら ffmpeg -vf fps=1/8 でフレームを抜き出して目で確かめる（2026-08-16 オーナーの指摘、memory promo_video_stale_after_model_change）

## 会場ガイド
- Google Maps の埋め込み（API キー不要の形）は1地点だけで、複数地点・経路は X-Frame-Options で塞がれる。会場と観光地の位置関係は Leaflet＋OpenStreetMap（src/components/VenueMap.jsx）で出す。動画は BOATRACE 公式チャンネルの uploads の再生リストを埋め込む（2026-08-10、memory feedback_venue_guide_quality_upgrade）
- 会場ガイドのデータは e2e/venue-guide-data.spec.js が検査する（観光地の件数・座標の範囲・image 必須等）。データの項目を足したらこの検査にも足す（2026-08-10、memory feedback_venue_guide_quality_upgrade、PR #199）

## 撮影・描画の落とし穴
- 要素単位の撮影は、長い要素なら対象行を表示範囲へ移してから矩形を決める。bounding box が画面内でもスクロール祖先に隠れると撮影されない。固定ヘッダーが要素内へ重なることもあるので、撮影画像の上下と完成フレームを目で確認する（2026-10-13、2026-10-13-venue-20261013-09-fukuoka.md・2026-10-16-full-picture-generator.md）
- スマホで display: contents になる図の親は getBoundingClientRect が0になり、親を基点にした撮影は失敗する。実寸を持つ子要素を基点にする（2026-10-15、2026-10-15-scene4-trial.md）
- headless 撮影では networkidle の後も会場別データ・集計行・記事本文の描画が終わっていないことがある。固有の行・見出しの visible を待ち、表示した会場・率・件数を保存データと照合する。通信の停止だけを描画完了と扱わない（2026-10-13、2026-10-13-venue-20261013-06-shimonoseki.md・2026-10-13-venue-20261013-13-ashiya.md）
- 操作で折りたたまれる部品の撮影は、クリック前の座標を使い回さず、操作後の安定した節を再測定する。操作対象のラベルはクリック前に保存する（クリック後に同じ locator の文字を取ると停止する）（2026-10-15、2026-10-15-scene4-trial.md・2026-10-15-scene-similar.md）
- 終了したレースのソナーは初期状態が展示後になることがある。展示前の試作では時点ボタンを明示的に選び、展示タイム軸の有無で確認する（2026-10-14、2026-10-14-scene2-trial.md）
- 撮影依頼の部品名だけで同じ画面と決めない。思考アシストの会場シートとリンク先の会場ページの「過去90日」は、内容と集めた期間が違う。公開画面の期間・図・URL を確認する（2026-10-14、2026-10-14-scene1-trial.md）
- リポジトリのコードと現行の公開画面は一致しないことがある。機能の存在は公開画面で、式・定義はコードで別々に確認し、台帳にも分けて残す（2026-10-14、2026-10-14-ryujin-feature-catalog.md）
- sticky 要素を撮影用に relative へ変えるときは top 等の位置指定も点検する。position だけ変えて残った top が隣のボタンを覆った（2026-10-16、2026-10-16-generator-structure-progress.md）
- 汎用のセレクタ（.line span 等）の変更は、局所の回帰検査に加えて全編でも確認する。語単位の span まで block にして締めが縦一列に崩れた（2026-10-16、2026-10-16-full-picture-generator.md）
- 図の艇切替とカードの対象が共通なら、全艇比較後の特定艇の判定には対象艇の再確認が要る。「材料なし」の否定にも、正しい艇の走査証拠を残す（2026-10-16、2026-10-16-generator-structure-progress.md）
- 保存 DOM の世代により Range 記録の有無が違う。native crop の処理は3例で試し、古い記録を黙って別時点の画像へ差し替えない（2026-10-17、2026-10-17-split-r13-r17.md）
- 公開画面の上部を画像にするとき、viewport と画像実寸の指定は、当日データの生成済み・版一致・読みやすさの証拠にならない。元行の生成時刻・表示ロード・撮影時刻・承認媒体 hash を分けて固定する（2026-10-14、2026-10-14-plan-review-20261014-10.md）
- 公開表示の marker は、状態で消える要素かを実 DOM の分岐で確認する。展示前の stage-chip を共通必須にすると、展示後の正常な画面を不合格にする（2026-10-13、2026-10-13-plan-review-20261013-33.md）
- 指標の向き・文言を直す修正は、静的コピーだけでなく選定式・理由文・保存済みの日次の理由・スナップショットまで点検する（2026-10-15、2026-10-15-morning-info-discussion.md）
- 保存済みの理由をそのまま表示する画面では、共通コピーの配備と日次行の再生成を別々に確認する。計算関数とテンプレートを直しても既存行の説明は置き換わらない（2026-10-15、2026-10-15-plan-review-20261015-10.md）
- 非同期に届くデータからアンカーへスクロールするときは、データの有無だけでなく対象 DOM の描画条件も待ち、要素が実在して移動した後にだけ済み扱いにする（2026-10-15、2026-10-15-plan-review-20261015-07.md）
- 子の送信完了をawaitして親パネルを閉じるときは、待機中の取消・再入場による世代変更を照合する。古い成功応答で新しい未送信本文を閉じない。送信ボタンのdisabledだけでは再マウント後の待機状態は保持できない。（2026-10-19、2026-10-19-review-20261019-06.md）
- 画面の既定選択を投稿の型・時刻で別の観測窓へ読み替えるときは、比較関数に加えAPIの取得窓集合が全代替先を含むか確認する。戻り値だけのassertでは保存済み値の取得漏れを検出できない。（2026-10-19、2026-10-19-review-20261019-08.md）
