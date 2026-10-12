# 計測と GA4

何を測るか・GA4 への登録・公開後の読み方。書き方は [README.md](README.md)。

## 仕様の段階で決めること
- 新しい画面・機能は spec の段階で「何を測るか（問い・イベント・パラメータ・GA4 に登録するディメンション）」を書く。思考アシストは spec に計測が無く公開後に足したので、足す前の期間は測れていない（2026-10-11、PR #1381）
- イベントの定義は機能ごとの events.md に置く（docs/design/analogy-reaction-measurement/events.md、docs/design/thinking-assist/events.md）
- 同じイベントで入口を分けたいときはパラメータで分ける。例 assist_view_switch の assist_entry = top / tab_row / copy_toast（BOA-832、docs/design/thinking-assist/events.md）
- GA4 のカスタムイベントのパラメータに source・medium・campaign・term・content・id を使わない。source だけ送ると流入元が上書きされ Unassigned になる（2026-09 に 71→259 件、PR #656 で link_source に改名、memory ga4_unassigned_source_param_collision_2026_09_15）

## GA4 への登録
- イベントのパラメータは GA4 にカスタムディメンションとして登録しないと、レポートにも Data API にも出ない（docs/design/analogy-reaction-measurement/ga4-custom-dimensions.md）
- 登録した日より前のデータには遡らない。公開と同時か前に登録する（同 ga4-custom-dimensions.md）
- 登録の手順は 管理 → データの表示 → カスタム定義 → カスタムディメンションを作成、範囲はイベント。オーナーが PC のブラウザで行う（同 ga4-custom-dimensions.md）
- race_id は値の種類が多く「(other)」にまとめられるので登録しない（同 ga4-custom-dimensions.md）
- イベント範囲のカスタムディメンションは標準プロパティで50件まで（同 ga4-custom-dimensions.md）
- 値がレポート・Data API に出るまで最大24〜48時間（同 ga4-custom-dimensions.md）

## 公開後の読み方
- 公開日をまたぐ比較は、登録日より前が欠けていないかを先に確かめる（ga4-custom-dimensions.md の「遡らない」から）
- 「特筆すべき動きが無い」も省略せず報告する（2026-08-25 の多言語 PV の漏れ、.claude/CLAUDE.md「調査・分析結果の報告原則」）
