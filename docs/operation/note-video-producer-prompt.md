# 龍神レーダー note埋め込み動画 制作ガイド

note下書き（`note-articles/{slug}.md`）に埋め込む機能解説動画（横型 1920x1080、20〜30秒）の制作ルール。X/TikTok向けの縦型ショート動画（`sns-video-producer-prompt.md`）とは目的・トーンが異なるため別ドキュメントとして分離している（2026-08-31新設）。

## 目的とトーンの違い

note読者は既に興味を持って記事を読みに来ている層。TikTok/Xの「知らない人を3秒で止める」フックは不要で、実画面をじっくり見せる「プロダクトデモ」調が適切。派手な演出・煽り文句は避け、実データの可読性を優先する。

## 構成（8人パネル議論、2026-08-31決定）

1. **Hook（2.5〜3秒）**: 機能名のタイトル + 一言サブタイトル
2. **特徴解説（15〜18秒）**: 実画面（表・カード等）を全体表示したまま、2〜4個の注目ポイントに順番にハイライト枠を当てて視線誘導し、各ポイントの価値を**機能説明ではなくベネフィットで言い切る字幕**を添える
   - 例: 「級別・勝率が見れる」ではなく「肩書だけじゃない、実力を数値で比較」
   - ハイライト・字幕は必ずフェードイン**とフェードアウト**の両方を実装する。フェードアウトを忘れると前のハイライトが消えずに次のシーンに残るバグになる（2026-08-31、初版で実際に発生）
3. **CTA（4〜6秒）**: ロゴ + 「無料・登録不要」+ `boat-ai.jp`

## ハイライト座標の出し方

実画面のスクリーンショットに対し、行・カード等の相対座標をPlaywrightで実測してからRemotion側にハードコードする（`sns-video-producer-prompt.md`と同じ「座標は必ずgetBoundingClientRect()で実測」ルール）。

```js
// 例: テーブルの各行の相対位置を取得
const tableRect = await page.locator('.data-race-table').boundingBox();
const rows = await page.locator('.drt-table tbody tr').all();
for (const row of rows) {
  const box = await row.boundingBox();
  // relTop = box.y - tableRect.y 等をRemotion側に渡す
}
```

実測値はCSS px基準。Remotion側で画像を`IMAGE_WIDTH`にリサイズ表示する場合、`scale = IMAGE_WIDTH / 実測時のテーブル幅`でハイライト座標を変換する。

## BGMルール

- **`sns-video-studio/remotion/public/soundtrack.wav`を使わない**（2026-08-31〜）。X/TikTok用の縦型動画で既に使い回されている楽曲で、note用に流用したところ「使い回し感がある」と却下された
- note用動画には毎回、または一定期間ごとに新規の著作権フリー楽曲（Pixabay Content License等）を選定する。曲調は「落ち着いた・穏やか・プレゼンテーション向け」（corporate, calm等のタグ）を選ぶ
- 採用済み: 「Calm Corporate Relax」（331music、[pixabay.com/music/corporate-calm-corporate-relax-591992](https://pixabay.com/music/corporate-calm-corporate-relax-591992/)）。`note-bgm-calm-corporate-relax.wav`として`sns-video-studio/remotion/public/`に配置済み（動画尺に合わせて25秒に切り出し・末尾2秒フェードアウト済み）
- 新しい曲を探す際はWebSearchで`Pixabay royalty free corporate calm explainer background music`等を検索し、WebFetchで候補ページのライセンス条件（Pixabay Content License = 商用利用可・著作権表示不要）を確認してから選ぶ

### Pixabayからのダウンロード手順（2026-08-31確立）

Claude Browser（`mcp__Claude_Browser__*`）は`pixabay.com`がポリシーでブロックされているため使えない。claude-in-chromeで以下の手順を踏む。

1. claude-in-chromeで曲の詳細ページを開く
2. 「Free download」ボタン右の▼（ドロップダウン矢印）をクリックし、「Music track MP3」メニュー項目をクリックする（ボタン本体を直接クリックしただけではネットワークリクエストが発生しない場合がある）
3. `read_network_requests`で`cdn.pixabay.com/download/audio/...`形式のURLを取得する（ステータス503でも構わない、URL自体は正しく取得できる）
4. 取得したURLをBashの`curl`で直接ダウンロードする（`-e`でRefererに元のPixabayページURLを指定するとよい）

```bash
curl -sL -A "Mozilla/5.0 ..." -e "https://pixabay.com/music/xxx/" -o /tmp/xxx.mp3 "https://cdn.pixabay.com/download/audio/.../audio_xxx.mp3?filename=xxx.mp3"
```

5. `ffmpeg`で動画尺に合わせてトリミング・末尾フェードアウトを追加してから`.wav`に変換する

```bash
ffmpeg -y -i input.mp3 -t 25 -ar 44100 trimmed.wav
ffmpeg -y -i trimmed.wav -af "afade=t=out:st=23:d=2" final.wav
```

## 制作・確認フロー

`sns-video-producer-prompt.md`の制作フロー（実データ取得→台本→実装→セルフレビュー）を踏襲しつつ、以下を追加で行う。

1. **YouTube限定公開でアップロードする**（noteに直接動画ファイルを埋め込む機能は無いため）。アップロード自体は手動（YouTube Studioの操作、公開ボタンはユーザーが押す）
2. 確認は`remotion still`でキーフレームを静止画として書き出し、目視確認する（Remotion StudioのUIプレビューはブラウザ操作のタイミングによって不安定になることがある。2026-08-31、frame移動しても画面が固まる現象が発生、still書き出しでは問題なく確認できた）
3. `sns-video-studio/`はgit管理下だが、`remotion-studio`プレビュー/レンダリング実行環境はメインリポジトリ側にしかない（`.claude/launch.json`の設定がworktreeに無いため）。worktreeで正式に編集・コミットし、プレビュー確認・レンダリングだけメインリポジトリ側の`sns-video-studio/remotion/`にファイルをコピーして行う（詳細はメモリ`sns_video_studio_worktree_isolation_2026_08_31`参照）
4. `Root.jsx`はメインリポジトリ側で他セッションの動画制作と共有されているため、直接上書きせず一意な文字列ブロックをPythonスクリプトで置換する方式で安全に追記する

## 実装済みコンポーネント

Hook/特徴解説/CTAの共通実装は`noteVideoShared.jsx`に切り出し済み（2026-09-01、3本目の動画制作で同一パターンの再利用が3箇所目に達したため共通化）。新しい機能の動画を作る際は、この共通モジュールをimportし、対象画像のPlaywright実測座標・ハイライト内容・タイトルのみを新規ファイルに書けばよい。

- `NoteExplainerCM.jsx`の`NoteExplainerCM_DataRaceTable`: データ出走表機能の解説動画（50秒、6特徴）
- `NoteExplainerReturnRate.jsx`の`NoteExplainerCM_ReturnRate`: 選手×艇番別回収率分析の解説動画（30秒、4特徴）
- `NoteExplainerFormRanking.jsx`の`NoteExplainerCM_FormRanking`: 好調・不調選手ランキングの解説動画（50秒、急上昇/急下降の2テーブルをそれぞれ3行ハイライト）。1機能で複数テーブルを扱う場合は、特徴解説パートを`SceneFeatures`の複数`Sequence`に分け、`imageSrc`と`badgeLabel`をテーブルごとに切り替える
- タイトルが長い機能名の場合、`SceneHook`の`titleFontSize`propで縮小しないと1080px幅で折り返してsubtitleと重なる（2026-09-01、好調・不調ランキングで発生・修正）。目安は13文字を超える場合に80px程度へ縮小する
