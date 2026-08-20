# SNSシェア機能 - 要件定義と実装計画

## 概要

boat-ai.jpのユーザーが、AI予想や結果を自分のSNSアカウントでシェアできる機能を実装する。

---

## 要件定義

### 1. 機能要件

#### 1.1 シェア対象
- **AI予想**: レースごとの予想内容
- **的中結果**: 的中したレースの結果
- **統計データ**: 的中率、実績サマリー

#### 1.2 対応SNS
- **X (Twitter)**: 最優先
- **Facebook**: 優先度中
- **LINE**: 優先度中
- **ネイティブシェア**: モバイル対応（優先度低）

#### 1.3 シェアボタン配置場所

**優先度1: レース詳細ページ**
```
場所: 各レースのAI予想表示エリア
内容: そのレースの予想をシェア
例: 「徳山12R、1-2-4の予想をシェア」
```

**優先度2: 的中レース一覧ページ**
```
場所: 各的中レースカード
内容: 的中した結果をシェア
例: 「びわこ3R的中！配当1,250円」
```

#### 1.4 シェア時のテキスト内容

**パターンA: AI予想シェア**
```
🏁 龍神レーダー予想【徳山12R】

本命: 1号艇
推奨: 1-2-4

AIスコア: 24.5

▼詳細を見る
https://boat-ai.jp/#race-tokuyama-12

#ボートレース #ボートレース #AI予想 #龍神レーダー
```

**パターンB: 的中結果シェア**
```
🎯 的中！【びわこ3R】

予想: 1-2-4
結果: 1-2-4 ✅
配当: 1,250円

龍神レーダーで予想的中🎉

▼予想を見る
https://boat-ai.jp/

#ボートレース #ボートレース #的中 #龍神レーダー
```

---

## 技術仕様

### 1. 実装方法（難易度別）

#### 方法A: シェアURL方式（最も簡単）
**難易度**: ★☆☆☆☆

各SNSが提供するシェアURLを使用

**X (Twitter) シェアURL**:
```javascript
const shareToTwitter = (text, url) => {
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(twitterUrl, '_blank', 'width=600,height=400');
};
```

**Facebook シェアURL**:
```javascript
const shareToFacebook = (url) => {
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  window.open(facebookUrl, '_blank', 'width=600,height=400');
};
```

**LINE シェアURL**:
```javascript
const shareToLine = (text, url) => {
  const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  window.open(lineUrl, '_blank', 'width=600,height=400');
};
```

**メリット**:
- 実装が超簡単（30分）
- 外部ライブラリ不要
- すぐに動作確認できる

**デメリット**:
- デザインのカスタマイズが難しい

#### 方法B: Web Share API（モダン）
**難易度**: ★★☆☆☆

ブラウザネイティブのシェア機能を使用

```javascript
const shareNative = async (title, text, url) => {
  if (navigator.share) {
    try {
      await navigator.share({
        title: title,
        text: text,
        url: url
      });
      console.log('共有成功');
    } catch (error) {
      console.log('共有キャンセル', error);
    }
  } else {
    // フォールバック: 方法Aを使用
    shareToTwitter(text, url);
  }
};
```

**メリット**:
- モバイルで使いやすい
- ユーザーが好きなアプリを選べる
- モダンなUX

**デメリット**:
- 古いブラウザは非対応
- PC版では使えない場合がある

#### 方法C: react-share ライブラリ（推奨）
**難易度**: ★★★☆☆

React用のシェアボタンライブラリを使用

```bash
npm install react-share
```

```jsx
import {
  TwitterShareButton,
  FacebookShareButton,
  LineShareButton,
  TwitterIcon,
  FacebookIcon,
  LineIcon
} from 'react-share';

function ShareButtons({ race }) {
  const shareUrl = `https://boat-ai.jp/#race-${race.id}`;
  const title = `🏁 龍神レーダー予想【${race.venue}${race.raceNo}R】`;
  const text = `本命: ${race.prediction.topPick}号艇\n推奨: ${race.prediction.top3.join('-')}`;

  return (
    <div className="share-buttons">
      <TwitterShareButton url={shareUrl} title={`${title}\n\n${text}`}>
        <TwitterIcon size={32} round />
      </TwitterShareButton>

      <FacebookShareButton url={shareUrl} quote={title}>
        <FacebookIcon size={32} round />
      </FacebookShareButton>

      <LineShareButton url={shareUrl} title={title}>
        <LineIcon size={32} round />
      </LineShareButton>
    </div>
  );
}
```

**メリット**:
- デザインが統一されている
- カスタマイズ可能
- 複数SNS対応が簡単

**デメリット**:
- ライブラリのインストールが必要
- バンドルサイズがやや増加

---

## 難易度評価

### 実装難易度まとめ

| 機能 | 難易度 | 実装時間 | 推奨度 |
|------|--------|----------|--------|
| Xシェアボタン（URL方式） | ★☆☆☆☆ | 30分 | ⭐⭐⭐⭐ |
| 複数SNS（react-share） | ★★★☆☆ | 2時間 | ⭐⭐⭐⭐⭐ |
| Web Share API | ★★☆☆☆ | 1時間 | ⭐⭐⭐ |

### 推奨実装プラン

**フェーズ1: 最小実装（30分）**
- Xシェアボタンのみ（URL方式）
- レース詳細ページに配置
- 基本的なシェアテキスト

**フェーズ2: 拡充（2時間）**
- react-share導入
- Facebook、LINE対応
- 的中レースページにも追加
- シェアテキストの最適化

**フェーズ3: 高度化（3時間）**
- OGP（Open Graph Protocol）対応
- シェア時のプレビュー画像
- シェア数カウント表示

---

## 実装詳細

### フェーズ1: Xシェアボタン（最小実装）

#### ステップ1: シェア関数を作成

`src/utils/share.js`:
```javascript
/**
 * AI予想をXでシェア
 */
export const shareRacePredictionToX = (race) => {
  const venue = race.venue || '不明';
  const raceNo = race.raceNo || '?';
  const topPick = race.prediction?.topPick || '?';
  const top3 = race.prediction?.top3?.join('-') || '?-?-?';
  const aiScore = race.prediction?.aiScores?.[0]?.toFixed(1) || '?';

  const text = `🏁 龍神レーダー予想【${venue}${raceNo}R】

本命: ${topPick}号艇
推奨: ${top3}

AIスコア: ${aiScore}

▼詳細を見る
https://boat-ai.jp/

#ボートレース #ボートレース #AI予想 #龍神レーダー`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'width=600,height=400');
};

/**
 * 的中結果をXでシェア
 */
export const shareHitRaceToX = (race) => {
  const venue = race.venue || '不明';
  const raceNo = race.raceNo || '?';
  const prediction = race.prediction?.top3?.join('-') || '?-?-?';
  const result = race.result?.join('-') || '?-?-?';
  const payout = race.totalPayout || 0;

  const text = `🎯 的中！【${venue}${raceNo}R】

予想: ${prediction}
結果: ${result} ✅
配当: ${payout.toLocaleString()}円

龍神レーダーで予想的中🎉

▼予想を見る
https://boat-ai.jp/

#ボートレース #ボートレース #的中 #龍神レーダー`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'width=600,height=400');
};

/**
 * 統計データをXでシェア
 */
export const shareDailyStatsToX = (stats) => {
  const date = stats.date || new Date().toISOString().split('T')[0];
  const tanRate = ((stats.tanWins / stats.total) * 100).toFixed(1);
  const fukuRate = ((stats.fukuWins / stats.total) * 100).toFixed(1);

  const text = `📊 本日の実績【${date}】

✅ 単勝: ${stats.tanWins}/${stats.total}（${tanRate}%）
✅ 複勝: ${stats.fukuWins}/${stats.total}（${fukuRate}%）

龍神レーダーのAI予想で的中率UP📈

▼無料で使える
https://boat-ai.jp/

#ボートレース #ボートレース #AI予想`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'width=600,height=400');
};
```

#### ステップ2: シェアボタンコンポーネント作成

`src/components/ShareButton.jsx`:
```jsx
import React from 'react';
import './ShareButton.css';

export const ShareButton = ({ onClick, label = 'Xでシェア' }) => {
  return (
    <button className="share-button" onClick={onClick}>
      <svg className="twitter-icon" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
      {label}
    </button>
  );
};
```

`src/components/ShareButton.css`:
```css
.share-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #1DA1F2;
  color: white;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.share-button:hover {
  background: #1a8cd8;
}

.twitter-icon {
  flex-shrink: 0;
}
```

#### ステップ3: App.jsxに統合

レース詳細表示部分に追加:

```jsx
import { ShareButton } from './components/ShareButton';
import { shareRacePredictionToX } from './utils/share';

// レース詳細表示部分
<div className="race-details">
  <h3>{race.venue} {race.raceNo}R</h3>

  {/* AI予想表示 */}
  <div className="ai-prediction">
    <p>本命: {race.prediction.topPick}号艇</p>
    <p>推奨: {race.prediction.top3.join('-')}</p>
  </div>

  {/* シェアボタン追加 */}
  <ShareButton
    onClick={() => shareRacePredictionToX(race)}
    label="予想をシェア"
  />
</div>
```

的中レース表示部分に追加:

```jsx
import { shareHitRaceToX } from './utils/share';

// 的中レース表示部分
<div className="hit-race-card">
  <h4>{race.venue} {race.raceNo}R</h4>
  <p>予想: {race.prediction.top3.join('-')}</p>
  <p>結果: {race.result.join('-')} ✅</p>
  <p>配当: {race.totalPayout.toLocaleString()}円</p>

  {/* シェアボタン追加 */}
  <ShareButton
    onClick={() => shareHitRaceToX(race)}
    label="的中をシェア"
  />
</div>
```

---

### フェーズ2: 複数SNS対応（react-share使用）

#### ステップ1: ライブラリインストール

```bash
npm install react-share
```

#### ステップ2: 複数SNSシェアコンポーネント

`src/components/SocialShareButtons.jsx`:
```jsx
import React from 'react';
import {
  TwitterShareButton,
  FacebookShareButton,
  LineShareButton,
  TwitterIcon,
  FacebookIcon,
  LineIcon
} from 'react-share';
import './SocialShareButtons.css';

export const SocialShareButtons = ({
  url,
  title,
  text,
  size = 32
}) => {
  const shareUrl = url || 'https://boat-ai.jp/';
  const fullText = `${title}\n\n${text}`;

  return (
    <div className="social-share-buttons">
      <TwitterShareButton url={shareUrl} title={fullText}>
        <TwitterIcon size={size} round />
      </TwitterShareButton>

      <FacebookShareButton url={shareUrl} quote={title}>
        <FacebookIcon size={size} round />
      </FacebookShareButton>

      <LineShareButton url={shareUrl} title={title}>
        <LineIcon size={size} round />
      </LineShareButton>
    </div>
  );
};
```

`src/components/SocialShareButtons.css`:
```css
.social-share-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.social-share-buttons button {
  cursor: pointer;
  transition: opacity 0.2s;
}

.social-share-buttons button:hover {
  opacity: 0.8;
}
```

#### ステップ3: 使用例

```jsx
import { SocialShareButtons } from './components/SocialShareButtons';

// レース詳細に追加
<SocialShareButtons
  url={`https://boat-ai.jp/#race-${race.id}`}
  title={`🏁 龍神レーダー予想【${race.venue}${race.raceNo}R】`}
  text={`本命: ${race.prediction.topPick}号艇\n推奨: ${race.prediction.top3.join('-')}`}
  size={32}
/>
```

---

## テスト計画

### 1. 機能テスト
- [ ] Xシェアボタンをクリック → 新しいウィンドウでX投稿画面が開く
- [ ] シェアテキストが正しく表示される
- [ ] URLが正しく含まれている
- [ ] ハッシュタグが含まれている

### 2. ブラウザ互換性テスト
- [ ] Chrome
- [ ] Safari
- [ ] Firefox
- [ ] Edge
- [ ] モバイルブラウザ

### 3. デザインテスト
- [ ] ボタンが適切な位置に表示される
- [ ] レスポンシブ対応
- [ ] ホバー効果が動作する

---

## 実装スケジュール

### 今日（12/17）
- [ ] フェーズ1実装（30分）
- [ ] テスト（15分）
- [ ] デプロイ

### 明日（12/18）
- [ ] フェーズ2実装（2時間）
- [ ] テスト（30分）
- [ ] デプロイ

### 来週（12/24）
- [ ] フェーズ3実装（OGP対応）

---

## 期待効果

### 1. トラフィック増加
- ユーザーがシェア → フォロワーが見る → サイト訪問
- 1日10シェア想定 → 月間300シェア
- シェア1件あたり平均5PV → 月間1,500PV増加

### 2. 認知度向上
- ユーザー発信のオーガニックな宣伝
- 信頼性の向上（第三者の推奨）

### 3. エンゲージメント向上
- ユーザーの満足度向上
- コミュニティ形成

---

## まとめ

**実装難易度**: ★☆☆☆☆〜★★★☆☆（フェーズによる）

**推奨プラン**:
1. 今日: フェーズ1実装（Xシェアのみ、30分）
2. 明日: フェーズ2実装（複数SNS、2時間）
3. 来週: フェーズ3実装（OGP対応、3時間）

**次のアクション**:
フェーズ1の実装を開始しますか？
