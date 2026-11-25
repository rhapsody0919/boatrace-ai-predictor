# hq の開発効率のハーネスを龍神へ移す（2026-11-25、system-architect の審査「直せば推す」を直した版）

結論: hq のハーネスのうち龍神へ移すのは **deploy-guard の「release の後の本番の確かめ」と「基準の赤との差」だけ**。戻しの PR は作らない（オーナー決定）。残りは龍神に同じ物があるか、今日まで効いた記録が無いので移さない（YAGNI）。移した後に hq の deploy-guard を止める。

- 目的（オーナー 11/25）: 「開発効率のハーネスという観点で移すべきものは龍神に移行したい」。前提は 11/23 の「ハーネスは開発中に感じた非効率からだけ強化。不要なものは移す必要はない」
- 言われた案が最短か: deploy-guard（1,991行＋戻し 283行）を写すのは最短でない。龍神には e2e-release・e2e-live・job-watch・release-dispatch の見張りが既にあり、欠けているのは (1) release の直後に、出した版で e2e-release を起こすこと (2) 前回と同じ赤で毎回 Slack が鳴ること の2つだけ。この2つを足す
- 同じ原因で直す物: e2e-live の Slack も赤のたびに鳴る。直近40回の赤17のうち14は hq が起こした dispatch の run で、hq を止めた後の schedule（14:00）だけでは直近10回で赤3。数は小さいが、オーナーの指示（e2e-live・e2e-release の両方）どおり同じ仕組みに載せる（足すのは workflow の数行）

## 0. 流れ

```
今                                                       移した後
release-dispatch（Vercel Cron 05:45・11:45・17:45）        release-dispatch（同じ）
  └ Deploy Hook を叩く                                      ├ Deploy Hook を叩く
hq deploy-guard（Mac の launchd、5分ごと）                  └ e2e-release を workflow_dispatch（inputs.sha＝出した master の先）
  ├ 本番の配備を見つけて e2e-release を dispatch
  ├ 前の run と比べて新しい赤だけ hq の知らせ・Linear      e2e-release（本番の URL）／e2e-live（本番データ・14:00）
  └ e2e-live の窓・基準・戻しの PR                           ├ 赤の鍵の一覧を artifact に残す（緑なら空）
e2e-release・e2e-live の Slack: 赤のたび毎回                 ├ 前の完了 run の artifact と比べる（e2e-new-reds.js）
                                                             └ Slack は「新しい赤」か「試験の前に落ちた」ときだけ
                                                           job-watch の Issue は今どおり赤のたびに残る（記録）
```

## 1. 移す物・移さない物

効いた記録は hq の台帳（`~/hq/ledger/deploy-guard.jsonl` 1,623行、11/9〜11/25）と龍神の Actions の run から数えた。

| hq の部品 | 防いでいた非効率 | 龍神に同じ物 | 効いた記録 | 判断 | 移し先・大きさ |
|---|---|---|---|---|---|
| release の後の本番の確かめ（release_check） | release の後に本番の URL（vercel.json・middleware・api/）の壊れに気づかない | e2e-release.yml はある。ただし schedule（release の30分後）は GitHub の遅れがあり、sha を持たない。sha つきの起動は hq だけ | 赤 5（11/20〜21 の middleware の AI クローラーの返し）・ok 21 | **移す** | release-dispatch が Deploy Hook の後に `e2e-release.yml` を dispatch（scripts/lib、約60行） |
| 基準の赤との差（新しい赤だけ知らせる） | 毎回同じ赤で知らせが鳴り、本当に新しい赤が埋もれる | 無い。e2e-release・e2e-live は赤のたびに Slack | e2e-release の middleware の赤は5回続けて同じ物。e2e-live は直近40回中17回赤（うち14は hq の dispatch） | **移す** | 純関数 `e2e-new-reds-decide.js`・CLI `e2e-new-reds.js`＋artifact、workflow 2本 |
| 配備の sha が確かめた sha と違う（release_sha_differs） | Deploy Hook の後に master が進むと、出た版が判定した版と違う | 無い。e2e-release は sha の前方一致だけを待つ | 13 回 | **移す（形を変える）** | e2e-release が「期待の sha かその子孫」を受ける（compare API） |
| e2e-live の窓・基準の dispatch・M のせいの判定・戻しの PR（ZB02 の本体） | maker-merge が入れた壊れを人の手なしで戻す | 無い | broken 2・戻しの PR 2（#2412・#2462。#2462 は誤った戻し、11/11） | **移さない** | オーナー決定（自動の戻しの PR は立てない）。maker-merge は止めた |
| flaky の印（基準の赤が多いときの rerun） | 揺れる赤で関門が閉じる | Playwright の retries 1（取り直しで緑は flaky として失敗に数えない） | 関門は maker-merge と一緒に止まった | **移さない** | retries で足りる |
| push_red（master の push の quality-gates・post-merge の赤を即知らせる） | release の定時に止まってから気づく（HR31、11/18 約7時間） | post-merge-checks は Slack。quality-gates は job-watch の Issue。release_dispatch は止まると1回目から通知（registry.js failureAlertAfter 1） | on 6行。ただし 11/23 は 09:29・09:46 に知らせても 11:45 の release が止まった | **移さない** | 早く知らせても止まりを防げなかった。止まりがまた記録されたら quality-gates.yml に post-merge と同じ Slack の step を足す |
| release_stalled（release が出ない） | 本番が古いまま | 赤で止まる型は release_dispatch の失敗の通知（1回目から）。**「待つ」（deferred：master の先が新しい・検査が走り中）が続く型は stale_release の13時間まで鳴らない** | 14 回。うち5回（11/14・11/15・11/17・11/20 朝・11/24 夕）は deferred の型で、hq が約30分で知らせた | **一部を移す（PR 5、後）** | 拾い直しの回でもまだ deferred なら last_report.alerts に1行（monitor が知らせる）。releaseDispatch.js は400行の線にいるので、判定を小さなファイルに出す形で別の PR |
| flake_rerun（quality-gates の揺れの型を1回 rerun） | 揺れで release が止まる | install-actionlint.js の取り直し（根の直し済み） | action=rerun の行 0（would_rerun 2・skip 33） | **移さない** | 回した記録が無い |
| manual_release_check（窓の外の手の出しを確かめる） | 手で出した版を確かめない | e2e-release の schedule が最新の配備を見る | dispatch 3・赤 0 | **移さない** | schedule で足りる |
| prod_base・auto_rollback（shadow） | 戻す先を決める | 無い | shadow だけ（would_* のみ） | **移さない** | 戻しはしない |
| red_ticket（新しい赤で Linear に票） | 赤を忘れる | job-watch が Issue に残す（run ごとの記録で、人を押さない） | 12 枚。BOA-1444・1445（時刻に依る赤）の直しが生まれた | **形を変えて移す** | Linear の鍵を公開の Actions に置かない。代わりに続いている赤も24時間ごとに Slack で鳴らし直す（2.2） |
| dev-loss の夜の数え・起票（loss-harvest） | 同じ損の型を見落とす | ~/.config/ryujin/private/harness-map.md の「非効率の記録」（窓口が手で書く） | 実行 1 回（11/5）だけ、state/dev-loss は無い | **移さない** | 地図の1枚で足りる（11/23 オーナー） |
| ratchet・大きさの計測（hq の ratchet.py） | hq の汚染・行の増え | lint-changed.js --ci の基準の凍結・sizeBaselines.js・verify-pr-size.js | 3 行（hq 自身の report_only） | **移さない** | 龍神にある |
| merge の順（maker_merge_lanes の「#N の後」） | 積んだ PR を順番違いで入れる | 窓口がマージする（owner-session）。auto-merge は light だけ | maker-merge と一緒に止めた | **移さない** | 窓口の手で足りる |
| 止まりの見張り（dashboard-alerts・cron_watch・heartbeat） | 輪が止まる | job-watch・key-canary・scrape の monitor（死活・連続失敗）・data_health | 多くは hq 自身の輪。ただし actions_fresh（hq config/platform.json:91）は龍神の Job Watch・DB Apply の鮮度を見ていた（job-watch.yml:18 の「外側（hq の鮮度の見張り）が頼り」）。発火の記録は見つからない（未検証） | **移さない** | dashboard-watch は 11/25 に launchd から外れ済み。job-watch の外側は data_health だけになる（2.5 の失う物）|
| 作り手の外の検査（G3・守りの5つ・sandbox） | 無人の作り手が守りのファイルを変える | CODEOWNERS・guard-weakening.yml（影）・verify-pr-shape.js・verify-pr-size.js・.claude の hook | maker-dispatch と一緒に止めた | **移さない（今は）** | 無人の作り手を Mac の外で再び回す段（harness-map の候補）で決める |

## 2. 1本目: deploy-guard の通知版

### 2.1 赤の鍵と基準

- 鍵＝`project › 題の並び`（並びの先頭は spec のファイルの組。`:行:列` は持たない）。既存の `check-e2e-skips.js` の `flattenTests` で読み、`status === "unexpected"` だけを赤に数える（flaky は取り直しで緑なので数えない）
- 各 run は今の赤の鍵と「最後に知らせた時刻」を artifact `e2e-red-keys`（JSON、保存14日）に残す。緑なら空。**組が欠けた run は残さない**（欠けた鍵が次に誤って「新しい赤」になるため）
- 基準＝同じ workflow の master の完了 run（今の run を除く）のうち artifact を持つ一番新しい物を5本まで探す（gh、CLI の中。event を問わない。e2e-release の schedule と dispatch は同じ本番を見るので、同じ赤は2回目で黙る）
- 新しい赤＝今の赤 − 基準の赤。続いている赤も、最後に知らせてから24時間たてば鳴らし直す

### 2.2 知らせ

| 場合 | Slack | 訳 |
|---|---|---|
| 新しい赤が1つ以上 | 鳴らす（新しい赤の一覧と、続いている赤の数） | 本当に知りたい物 |
| 続いている赤で、最後に知らせてから24時間たった物がある | 鳴らす | 続く赤を誰も直さないまま黙らせない（red_ticket の代わり） |
| 赤はあるが全部が24時間以内に知らせた物 | 鳴らさない（step summary に数） | 同じ赤で毎回鳴らさない |
| 試験の前に落ちた（レポートが無い・配備の sha を待ち切れない） | 鳴らす | 比べられない。閉じる側に倒す |
| 組が欠けた・skip と網羅の検査が落ちた（e2e-live） | 鳴らす | 1組の時間切れで鍵が減り「新しい赤0」で黙るのを防ぐ（審査 P1-1） |
| 試験は全部通ったが後の step が落ちた | 鳴らす | 比べる物が無い |
| 基準が無い（初回・artifact の期限切れ） | 赤があれば鳴らす | 今と同じ |
| 判定の step が答えを出せなかった | 鳴らす（Slack の条件は `notify != 'false'`） | 判定の故障で黙らない |

workflow の成否は今どおり（赤なら failure）。job-watch の Issue は赤のたびに残るので、続いている赤は Issue で追える。

### 2.3 release-dispatch からの起動

- `createReleaseDispatchRun` が live で Deploy Hook を叩けたら、`e2e-release.yml` を `inputs.sha=head.sha`（判定した master の先）で dispatch する。鍵は今の `GITHUB_ACTIONS_DISPATCH_TOKEN`（Actions: Read and write、releaseFullCheck が既に dispatch に使う）。新しい鍵は作らない
- dispatch の失敗で release は失敗にしない（Hook は叩けている）。記録の `releaseCheck` に `{dispatched:false, error}` を書き、`alerts` に1行足す（monitor が知らせる）
- `dispatchWorkflow` の fetch には時間の打ち切りが無いので、`AbortSignal.timeout(min(15秒, 60秒−8秒−使った時間))` を渡す。残りが2秒より少なければ起こさず理由を残す（関数が殺されて released・lastReleasedSha の記録を失うと、次の回の「叩いたのに版がそのまま」「Instant Rollback」の見張りが古い値で判定するため。審査 P2-2）
- ADR-0106 に追記する（通知だけで関所にしない）
- shadow は叩かず `wouldDispatchReleaseCheck: true` だけ
- Hook の後に master が進むと、Vercel は進んだ先を出すことがある（hq で13回）。e2e-release は「最新の success の配備の sha が期待の sha と同じか、その子孫」（`GET /compare/{want}...{got}` の status が identical か ahead）で待ち終える
- schedule（release の30分後）は残す。dispatch が届かなかったときの保険で、同じ赤は 2.1 の基準で黙る
- concurrency を `e2e-release-${{ github.event_name }}` に分ける。待ちは列ごとに1本で後から来た run が待っている run を取り消すので、数時間遅れた schedule が sha つきの dispatch を消さないように（審査 P2-7）

### 2.4 PR の列

| 順 | PR | 変えるファイル | マージ |
|---|---|---|---|
| 1 | この設計 | docs/design/harness-migration/design.md | 窓口 |
| 2a | 知らせるかの純関数と検査 | scripts/maintenance/e2e-new-reds-decide.js・verify-e2e-new-reds.js・verify-registry.json | 窓口 |
| 2b | CLI（基準の取得・鍵の読み・GITHUB_OUTPUT）と検査（2a の上に積む） | scripts/maintenance/e2e-new-reds.js・verify-e2e-new-reds-cli.js・verify-registry.json | 窓口 |
| 3 | e2e-release・e2e-live を新しい赤だけ知らせ、e2e-release が子孫の sha を受け、concurrency を分ける | .github/workflows/e2e-release.yml・e2e-live.yml | **オーナー**（.github） |
| 4 | release-dispatch が e2e-release を起こす（時間の打ち切りつき）、ADR-0106 の追記 | scripts/lib/releaseCheckDispatch.js（新）・releaseDispatch.js・verify-release-dispatch.js・verifyData/release-dispatch-scenes-3.js・docs/adr/0106 | 窓口（api/cron に届く変更。窓口の判断でオーナーへ） |
| 5（後） | 拾い直しでもまだ「待つ」なら alerts（release_stalled の deferred の型） | scripts/lib の小さなファイル・releaseDispatch.js・検査 | 窓口。hq の deploy-guard を止めた後に「待つ」の止まりがまた記録されたら着手（ハーネスは記録から） |

2a → 2b → 3 → 4 の順（3 は 2b の CLI を呼ぶ。4 を 3 より先に入れると、master が進んだ回に e2e-release が20分待って偽の赤になる）。2a と 2b は 300行の線で分けた。

### 2.5 hq の deploy-guard を止める

4 が入った後の**次の** release（4 を本番に出す release の tick は古い版のコードで動くので、最初に起こすのはその次。6〜12時間後）で、(a) release-dispatch の last_report に `releaseCheck.dispatched: true` (b) その sha の e2e-release の run が完了し artifact がある、を確かめたら、窓口がオーナーに一言断って止める:

```
launchctl bootout gui/$(id -u)/com.terukina.hq.deploy-guard
```

あわせて、同じ時間帯に hq が起こした run と二重になったとき、2本目が「続いている赤」で黙ることを見る。止めた後の1日目は 14:00 の e2e-live と3回の e2e-release で、Slack の鳴る・黙るが 2.2 の表どおりかを見る。

止めると無くなる物（1 の表で「移さない」にした物）:
- e2e-live の窓・基準の dispatch と per-merge の判定（broken は実質0）。e2e-live は schedule（14:00）の1日1回になり、窓口のマージから 14:00 までの壊れは release の後の e2e-release まで見えない
- push_red・flake_rerun・manual_release_check の hq の知らせ、gh_hold（GitHub の障害中の run を捨てて起こし直す、2回。新しい形では「試験の前に落ちた」で鳴る側に倒れる）
- release_stalled の deferred の型（PR 5 まで、stale_release の13時間まで鳴らない）
- hq の high の知らせは窓口の会話にも出ていた（window-alerts.py）。移した後は Slack だけ
- red_ticket（24時間の鳴らし直しで代える）

## 3. 誤りなら原因は何か（1回当てた）

| 主張 | 誤りなら | 潰せたか |
|---|---|---|
| 同じ赤は2回目で黙ってよい | 続いている赤を誰も直さない | job-watch の Issue が赤のたびに残る。新しい赤が混ざれば続いている数も Slack に書く。潰せた |
| 基準は前の完了 run でよい | 前の run が試験の前に落ちて artifact が無い／古い／組が欠けていた | artifact を持つ一番新しい run を探す（5本まで）。組が欠けた run は artifact を残さない。無ければ「基準なし」で鳴らす。潰せた |
| 同じ赤で黙るのは e2e-live にも効く | 1組の時間切れで鍵が減り「新しい赤0」で黙る | 組の欠け・網羅の検査の落ちは比べず鳴らす。潰せた（審査 P1-1） |
| artifact を読める | GITHUB_TOKEN に actions: read が要る | workflow の permissions に足す（PR 3） |
| 子孫の sha で待ち終えてよい | 子孫に壊れた commit が混ざる | 確かめるのは出た版そのもの（got）。期待の sha は「出たか」の判定にだけ使う。潰せた |
| release-dispatch の時間（60秒）に収まる | 前の読み取り（各15秒）で時間を使った後に dispatch が詰まる | 残り時間から8秒の余白を引いた分だけ待ち、2秒より少なければ起こさない。潰せた |
| e2e-live の dispatch が無くなっても困らない | hq の窓の run が拾っていた release 前の壊れを逃す | window_verdict は ok 29・ambiguous 8・broken 0（窓では壊れを1回も確定していない）。推測が残る |

## 4. 範囲の外で気づいたこと（直さない）

- 11/25 の開発の非効率（hq から移す話ではない。harness-map の「非効率の記録」へ）: AGENTS.md の表の `run-heavy.sh playwright …` が command not found（2回。run-heavy.sh は渡されたコマンドをそのまま実行するので `npx playwright` が要る）・作り手がマージの後に push して直しが入らない・guard-weakening の css の誤検出（2回）
- e2e-release.yml の頭の注釈が「正確な時刻は hq が … dispatch」のまま（PR 3 で直す）
- job-watch.yml:18 の注釈「外側（hq の鮮度の見張り）が頼り」は hq を閉じると当たらなくなる（.github、オーナーの PR で直す候補）
- release-dispatch の Hook の後の数秒の commit は検査を通さずに出る（hq で13回）。e2e-release で後から見つけるだけで、この設計の範囲の外
- `releaseDispatch.js` の run の関数は complexity 17（線15）で、行も400の線にいる。PR 5 は判定を外のファイルに出す形にする
