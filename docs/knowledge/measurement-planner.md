# 龍神レーダー 計測の知見ノート（計測役が最初に読む）
1行1知見、出典つき。計測役（.claude/agents/measurement-planner.md）が最初に読み、答えの最後に出した「足す行」を依頼元が書き足す。古くなった行は消さずに「（廃止 日付 理由）」を付ける

## 仕様の段階で決めること
- 新しい画面・機能は spec の段階で「何を測るか（問い・イベント・パラメータ・GA4 に登録するディメンション）」を書く。思考アシストは spec に計測が無く、公開後に #1381 で足した。足す前の期間は測れていない（PR #1381、Orchestrate 2026-10-11）
- イベントの定義は機能ごとの events.md に置く（docs/design/analogy-reaction-measurement/events.md、docs/design/thinking-assist/events.md）
- 同じイベントで入口を分けたいときはパラメータで分ける。例 assist_view_switch の assist_entry = top / tab_row / copy_toast（docs/design/thinking-assist/events.md、BOA-832）

## GA4 への登録
- イベントのパラメータは GA4 にカスタムディメンションとして登録しないと、レポートにも Data API にも出ない（docs/design/analogy-reaction-measurement/ga4-custom-dimensions.md）
- 登録した日より前のデータには遡らない。公開と同時か前に登録する（同上）
- 登録の手順は 管理 → データの表示 → カスタム定義 → カスタムディメンションを作成、範囲はイベント。オーナーが PC のブラウザで行う（同上）
- race_id は値の種類が多く「(other)」にまとめられるので登録しない（同上）
- イベント範囲のカスタムディメンションは標準プロパティで50件まで（同上）
- 値がレポート・Data API に出るまで最大24〜48時間（同上）

## 公開後の読み方
- 公開日をまたぐ比較は、登録日より前が欠けていないかを先に確かめる（ga4-custom-dimensions.md の「遡らない」から）
- 「特筆すべき動きが無い」も省略せず報告する（.claude/CLAUDE.md「調査・分析結果の報告原則」、2026-08-25 の多言語 PV の漏れ）
- GA4 のカスタムイベントのパラメータに source・medium・campaign・term・content・id を使わない。source だけ送ると流入元が上書きされ Unassigned になる（2026-09 に 71→259 件、PR #656 で link_source に改名）（memory ga4_unassigned_source_param_collision_2026_09_15）
