# 会場ページ レース締切ステータスのライブ表示 実装計画

`docs/design/race-deadline-status/spec.md`・`screens.md`、および`docs/adr/0042`の決定に基づく実装計画。

## データ設計

新規のSupabaseテーブル・カラムは不要。既存の`race.startTime`（"HH:MM"）・`race.id`（"YYYY-MM-DD-VV-RR"）・`race.rawData.cancellationStatus`（BOA-254で追加済み）のみで完結する（ADR 0042）。データ取得層（`supabaseDataService.js`・RPC）への変更は無い。

## ロジック設計

### `src/utils/raceDeadlineStatus.js`（新規）

`src/utils/raceStatus.js`（`RACE_STATUS`/`getRaceStatus()`）とは独立した新規ファイル。既存enumは一切変更しない。

```js
import { parseRaceId } from "./raceId";

export const DEADLINE_STATUS = {
  ACCEPTING: "accepting", // 受付中
  CLOSING_SOON: "closing_soon", // まもなく締切
  CLOSED: "closed", // 締切済み
};

const WARNING_WINDOW_MINUTES = 5;

/**
 * raceId ("YYYY-MM-DD-VV-RR") と startTime ("HH:MM") から締切時刻のDateを構築する。
 * JST固定（+09:00）。parseRaceId が失敗する場合は null を返す（ADR 0042）。
 */
export function getDeadlineDate(raceId, startTime) {
  const parsed = parseRaceId(raceId);
  if (!parsed || !startTime) return null;
  const iso = `${parsed.date}T${startTime}:00+09:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 締切ステータスを計算する。now は呼び出し側から渡す（テスト容易性のため）。
 */
export function getDeadlineStatus(raceId, startTime, now = new Date()) {
  const deadline = getDeadlineDate(raceId, startTime);
  if (!deadline) return null;
  const diffMs = deadline.getTime() - now.getTime();
  if (diffMs <= 0) return DEADLINE_STATUS.CLOSED;
  if (diffMs <= WARNING_WINDOW_MINUTES * 60 * 1000) return DEADLINE_STATUS.CLOSING_SOON;
  return DEADLINE_STATUS.ACCEPTING;
}
```

`getDeadlineDate`を`export`し、`RaceDeadlineCountdown.jsx`からも同じ関数を再利用する（バッジとカウントダウンで締切時刻の計算ロジックを重複させない）。

## コンポーネント構成・データフロー

### `RaceCard.jsx`（拡張）

既存の`nowHHMM`propの変化（60秒毎）でRaceCard自体は再レンダーされる。その際に`new Date()`を評価して締切ステータスを計算する（`nowHHMM`文字列からDateを逆算するのではなく、実際の`Date.now()`を使うことで日付またぎのあいまいさを避ける。詳細はplanの「非機能・パフォーマンス」参照）。

```js
import { getDeadlineStatus, DEADLINE_STATUS } from "../../utils/raceDeadlineStatus";
import RaceDeadlineCountdown from "./RaceDeadlineCountdown";

// 中止確定済みは新バッジを出さない（FR3、isCancelledは既存の実装を流用）
const deadlineStatus = isCancelled
  ? null
  : getDeadlineStatus(race.id, race.startTime);
```

バッジ表示は既存の的中/外れ・結果反映待ち・中止バッジの並びに追加する（`isCancelled`分岐の中には入れない、既存分岐と共存する別要素として追加）。

```js
{deadlineStatus === DEADLINE_STATUS.CLOSING_SOON && (
  <span style={{ /* --color-warning使用、screens.md参照 */ }}>
    {t("raceCard.closingSoon")}
  </span>
)}
{deadlineStatus === DEADLINE_STATUS.ACCEPTING && (
  <span style={{ /* --color-gray-600使用 */ }}>{t("raceCard.accepting")}</span>
)}
{/* CLOSEDは何も表示しない（既存の的中/外れ・結果反映待ちバッジが締切後の情報を担うため、
    重複表示を避ける） */}
```

カウントダウンは`deadlineStatus`が`CLOSING_SOON`または`ACCEPTING`のときのみレンダーする（`CLOSED`・中止確定では非表示、spec.md FR2）。

```js
{deadlineStatus && deadlineStatus !== DEADLINE_STATUS.CLOSED && (
  <RaceDeadlineCountdown raceId={race.id} startTime={race.startTime} />
)}
```

### `RaceDeadlineCountdown.jsx`（新規、`src/components/race/`）

```js
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDeadlineDate } from "../../utils/raceDeadlineStatus";

function RaceDeadlineCountdown({ raceId, startTime }) {
  const { t } = useTranslation();
  const deadline = getDeadlineDate(raceId, startTime);
  const [remainingMs, setRemainingMs] = useState(() =>
    deadline ? deadline.getTime() - Date.now() : null,
  );

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => {
      setRemainingMs(deadline.getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [deadline?.getTime()]);

  if (!deadline || remainingMs == null || remainingMs <= 0) return null;

  const totalSec = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");

  return (
    <span style={{ fontVariantNumeric: "tabular-nums" /* --text-secondary */ }}>
      {t("raceCard.deadlineCountdown", { time: `${mm}:${ss}` })}
    </span>
  );
}

export default RaceDeadlineCountdown;
```

`setInterval`はこのコンポーネントのローカルstateのみを更新するため、Reactの再レンダーは`RaceDeadlineCountdown`自身に閉じる。親の`RaceCard`・`VenueRaceListPage`・他のレースカードは再レンダーされない（spec.mdの非機能要件）。

`src/components/race/index.js`（barrel export）に`RaceDeadlineCountdown`を追加するかは、他ファイルからの直接import要否次第（`RaceCard.jsx`内部でのみ使うなら相対importのままでよく、barrel追加は必須ではない）。

## 多言語対応

`raceCard.accepting`・`raceCard.closingSoon`・`raceCard.deadlineCountdown`（`{{time}}`プレースホルダ付き）の3キーを`src/locales/{ja,en,ko,zh-TW}/common.json`に追加する。

## 非機能・パフォーマンスに関する設計判断

- `nowHHMM`は既存通り60秒毎の更新のまま変更しない。締切ステータスバッジ（FR1）の計算は、`RaceCard`が`nowHHMM`の変化で再レンダーされた瞬間に`new Date()`を評価する形にし、`nowHHMM`という文字列自体をパースしてDateを作る（＝日付またぎで壊れる可能性のある文字列演算をもう一段挟む）ことはしない
- カウントダウン（FR2）の1秒毎`setInterval`は`RaceDeadlineCountdown`コンポーネント内に閉じており、`RaceCard`本体のstateやpropsを変更しない。会場ページに最大12個のカウントダウンが同時に存在しうるが、各々が独立したstateを持つため、1つの更新が他の11個の再レンダーを誘発しない

## テスト方針

- ユニットテスト相当: `scripts/analysis/verify-*.js`パターンに準拠した検証スクリプトを`scripts/analysis/verify-race-deadline-status-logic.js`として新設し、`getDeadlineStatus()`の境界値（5分1秒前=ACCEPTING、5分0秒前=CLOSING_SOON、0秒=CLOSED、日付またぎダミーケース）を検証する（BOA-254 Task 3と同じ方針、フレームワーク不使用はBOA-255で別途検討中のため）
- `RaceCard.jsx`・`RaceDeadlineCountdown.jsx`はPlaywrightで一時プレビュールートを使い、3状態（受付中/まもなく締切/締切済み）と中止確定時の非表示を目視確認する（BOA-254 Task 9と同じ手法）
- `npm run build`・`npm run test:e2e`を実行する

## 未確定事項
なし。
