# 画面の実装の落とし穴

サイトの画面を実装するときに踏みやすい落とし穴（CLS・部品の埋め込み・状態の共有・機能変更で古くなるもの）。画面の決まりは [ui-layout.md](ui-layout.md)。主に visual-designer と実装者が読む。書き方は [README.md](README.md)。

## ページと部品の構成
- トップ（/）の実体は App.jsx ではなく src/pages/VenueGridPage.jsx。トップを調べるときは src/AppRouter.jsx の path="/" から見る（2026-09-01、memory cls_mobile_fix_2026_09_01、PR #467）
- 分析ツールの部品を embedded で埋め込むとき、部品の前提（「本日開催中」の一覧からの自動選択）が埋め込み先で成り立つか確かめる。過去日のレースで無関係なレースへ黙って切り替わっていた（2026-08-31、memory race_detail_analysis_tool_integration_2026_08、PR #435）
- レース詳細の基本情報・枠別・今節タブは艇番（player.number）で艇を識別し、選んだ艇を PredictionPanel の boatFocus で共有する。モータ情報タブだけ motor_number 基準で共有に乗っていない。タブ等の状態は URL に同期していない（2026-09-28、memory race_detail_shared_boat_selection_2026_09_28、PR #899、要確認）

## CLS
- 読み込み中に高さの違う画面へ丸ごと差し替えない。本物と同じ CSS クラスのスケルトン（VenueGridSkeleton）で場所を取る（2026-09-01、memory cls_mobile_fix_2026_09_01、PR #467）
- 画像は実寸の width/height で場所を取る（src/data/venueImageDimensions.js・blogImageDimensions.js）。一律の aspect-ratio: 16/9 はブログ画像121枚中57枚で文字が切れて撤回した。blogImageDimensions.js は画像を足すたびに手で更新し、漏れの機械検知は無い（2026-09-09、memory cls_mobile_followup_2026_09_09、PR #614）
- preload="none" の video は height か aspect-ratio を指定する（poster の読み込みで高さが変わる）。CLS を調べるときは先に git log で過去の対策が撤回されていないか見る（2026-09-09、memory cls_mobile_followup_2026_09_09、PR #614）

## 機能を変えたときに古くなるもの
- HowToUse.jsx・About.jsx・FAQ.jsx の説明は機能の変更に追いつかず、今の UI と食い違ったまま残っていた。UI を変えたら3つを grep して確かめる。/how-to-use は日本語だけのページ（2026-09-28、memory phase_a_content_rollout_2026_09_28、BOA-456）
- /about の紹介動画（public/videos/about-hero-*.mp4）は grep では古さが分からない。モデル・指標を大きく変えたら ffmpeg -vf fps=1/8 でフレームを抜き出して目で確かめる（2026-08-16 オーナーの指摘、memory promo_video_stale_after_model_change）

## 会場ガイド
- Google Maps の埋め込み（API キー不要の形）は1地点だけで、複数地点・経路は X-Frame-Options で塞がれる。会場と観光地の位置関係は Leaflet＋OpenStreetMap（src/components/VenueMap.jsx）で出す。動画は BOATRACE 公式チャンネルの uploads の再生リストを埋め込む（2026-08-10、memory feedback_venue_guide_quality_upgrade）
- 会場ガイドのデータは e2e/venue-guide-data.spec.js が検査する（観光地の件数・座標の範囲・image 必須等）。データの項目を足したらこの検査にも足す（2026-08-10、memory feedback_venue_guide_quality_upgrade、PR #199）
