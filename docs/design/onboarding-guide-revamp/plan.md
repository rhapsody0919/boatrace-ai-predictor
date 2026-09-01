# オンボーディング・ガイドページ刷新 システム設計

**訂正（実装中に判明）**: 以下「`App.jsx`」への言及は、古いブランチ調査時点の構造。実際のmasterでは`src/pages/VenueGridPage.jsx`（`TodayVenueGridPage`関数）が該当する。設計思想（`useFirstVisit`フック・排他分岐・自己ガード方式）自体は変更なくそのまま適用した。詳細は`screens.md`冒頭の訂正メモ、`tasks.md`のTask5実装メモを参照。

## データ設計

なし。本機能はSupabase・DBの変更を伴わない。すべて静的コンテンツ（画像・動画アセット・説明文）とReactコンポーネントの追加/拡張で完結する。

## コンポーネント構成・データフロー

### 1. `useFirstVisit`（新規フック、`src/hooks/useFirstVisit.js`）

B-1（初めての方へカード）とB-3（`IntroBanner`との出し分け）の判定を1箇所に集約する共有フック。

```
const KEY = "boatai:visited-before";

function useFirstVisit() {
  const [isFirstVisit] = useState(() => localStorage.getItem(KEY) !== "true");
  useEffect(() => {
    localStorage.setItem(KEY, "true");
  }, []);
  return isFirstVisit;
}
```

- 判定はマウント時の`localStorage`スナップショットで固定する（`IntroBanner.jsx`の既存パターンと同じく`useState`の初期化関数で1回だけ読む）
- フラグを立てる副作用は「初回訪問かどうかに関わらず、このページを開いたら必ず一度は実行する」。カードを閉じる操作とは独立している（閉じなくてもページを開いた時点で「訪問済み」になる）

### 2. `App.jsx` 側の分岐

```
const isFirstVisit = useFirstVisit();
...
{isFirstVisit ? <FirstVisitGuideCard /> : <IntroBanner />}
```

`IntroBanner.jsx`自体は表示条件を追加するだけで、内部の`DISMISS_KEY`ロジック（2回目以降の訪問者が「×」で閉じたら以後出さない）はそのまま残す。

### 3. `FirstVisitGuideCard.jsx`（新規）

- Props無し（自己完結）
- 内部state: `visible`（`useState(true)`）。「✕」「あとで」クリックで`setVisible(false)`。**localStorageへの書き込みは行わない**（次回訪問時は`useFirstVisit`が`false`を返すため自動的に`IntroBanner`に切り替わり、このコンポーネント自体が描画されなくなる）
- 「動画を見る」CTAで`GuideVideoPlayer`を展開表示、または常時カード内に埋め込んでおく（下記4参照。埋め込み方式を採用するため実際は追加の開閉stateは不要）
- 多言語ゲーティング: 内部で`const { i18n } = useTranslation(); if (i18n.language !== "ja") return null;`。理由は次項参照

**多言語ゲーティングが必要な理由**: `App.jsx`が描画される`/`パスは`src/config/languages.js`の`TRANSLATED_PATHS`に含まれ、en/zh-TW/koでも表示される。本機能の動画・説明文は日本語のみで用意する方針（`spec.md`のスコープ外事項、[BOA-230](https://linear.app/boat-ai/issue/BOA-230/ガイドページオンボーディング刷新の多言語版展開)で多言語化は別管理）のため、`FirstVisitGuideCard`と後述`TermHintButton`は**非ja言語では何も描画しない**ことを徹底する。過去に「未翻訳ページを翻訳済みとして配信する」構造的な問題が起きた実績（i18n監査、2026-08-16）があるため、ここで同じ種類の見落としを繰り返さないよう、呼び出し側（`App.jsx`等）に条件分岐を書かせるのではなく、**コンポーネント自身が自己ガードする**方針にする（呼び出し漏れを防ぐため）。

### 4. `GuideVideoPlayer.jsx`(新規、`src/components/`)

- Props: `videoSrc`, `posterSrc`
- 実装は素の`<video controls preload="none" poster={posterSrc}><source src={videoSrc} type="video/mp4" /></video>`のラッパー。`preload="none"`により自動読み込みを防ぎ、`poster`でサムネイル表示、ネイティブの再生ボタンでクリック再生する。カスタムの再生ボタン・再生状態管理は持たない（KISS。ブラウザ標準機能で要件V-2をそのまま満たせる）
- `HowToUse.jsx`（A-5）と`FirstVisitGuideCard.jsx`（B-1）の両方から同じpropsで呼び出す共通コンポーネント（`.claude/rules/component-reuse.md`の「同じUIパターンが2箇所以上で使われる場合、必ず共通コンポーネントに切り出す」に該当）
- 動画ファイルの配置先は「動画配信方式」ADR（`docs/adr/0023-onboarding-video-hosting.md`）を参照

### 5. `TermHintButton.jsx`（新規、`src/components/race/`）

- Props: `termKey`（`termHints.js`のキー）
- 内部state: `open`（`useState(false)`）。クリックでトグル。**他のボタンとの排他制御は行わない**（同時に複数開いても許容。状態を持ち上げる複雑さを避けるためKISSを優先。UXレビューで問題が出れば後で調整する）
- 多言語ゲーティング: `GuideVideoPlayer`と同様、`i18n.language !== "ja"`なら`null`を返す
- 説明文は`src/components/race/termHints.js`（新規データファイル）に集約する:
  ```js
  export const TERM_HINTS = {
    motorRate: "そのモーターを使った際に1着または2着になった割合。数値が高いほど「調子の良いモーター」とされます。",
    kimarite: "その選手が得意な勝ちパターン（逃げ・差し・まくり等）。展開予測を読む手がかりになります。",
    inKuzureIndex: "1号艇（インコース）がどれだけ崩れやすいかを、過去90日・同会場のレースと比べた相対的な指数（パーセンタイル）で示したものです。",
    // ... 対象語句は次のレビューで確定（spec.md未確定事項#1）
  };
  ```
  `raceIndicators.jsx`の既存パターン（指標名の一元管理）と同じ設計思想を踏襲する
- 呼び出し箇所: `raceIndicators.jsx`（データ出走表の行ラベル生成部）、`AiAnalysisSection.jsx`（タイトル部）、`PredictionPanel.jsx`（展開予測・イン崩れ指数の各見出し）

### データフロー図（B-1/B-3の分岐）

```
App.jsx マウント
  → useFirstVisit() が localStorage["boatai:visited-before"] を読む
      ├─ 無し(初回) → true を返す → localStorageに"true"を書く(副作用)
      │                → <FirstVisitGuideCard>を描画（ja言語のみ、それ以外は何も出さない）
      └─ 有り(再訪問) → false を返す
                       → <IntroBanner>を描画（既存のDISMISS_KEY判定はそのまま適用）
```

## 既存サービス層・共通ライブラリとの連携

該当なし。`src/services/`（Supabase連携）・`scripts/lib/`（バッチ処理共通ライブラリ）は本機能では使用しない。動画制作のみ既存の`sns-video-studio/remotion`パイプライン（Playwright実画面キャプチャ + Remotion合成 + ffmpeg書き出し）を流用する。

## 技術判断（ADR）

動画ファイルの配信方式について複数案を比較検討したため、[docs/adr/0023-onboarding-video-hosting.md](../../adr/0023-onboarding-video-hosting.md)を参照。

## 実装順序の提案

1. `useFirstVisit`フック新設 → `App.jsx`の分岐実装（`IntroBanner`表示条件の変更含む）
2. `FirstVisitGuideCard`（動画無しのプレースホルダー状態でまず実装・スタイリング確認）
3. `TermHintButton` + `termHints.js`（対象語句リストのユーザーレビュー確定後に本文言を確定）
4. 動画制作（Remotion + Playwright、題材レース選定含む）→ `GuideVideoPlayer`を`FirstVisitGuideCard`・`HowToUse.jsx`に接続
5. `HowToUse.jsx`のA-1〜A-4（スクショ・ツアー画像・入口分岐・実例ベース解説）

2〜3は動画が無くても着手・レビューできるため、動画制作（4、最も時間がかかる見込み）と並行して進められる。
