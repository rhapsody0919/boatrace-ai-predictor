# SNS PDCA ループの運用手順（hq 向け）

sns-pdca-loop（X スレッド・YouTube Shorts の自動送信と計測）で、hq が手元で行う作業の手順。設計は `docs/design/sns-pdca-loop/`（plan §1・§5・§6）、決定は ADR 0090・0094。

## 1. 素材バンドル v1 を取り込む（毎日）

Codex の集客レーンが出力した素材フォルダを、`push-bundle` で Storage に上げて下書きにする。

```bash
npm run sns:push-bundle -- <素材フォルダ> --dry-run
```

```bash
npm run sns:push-bundle -- <素材フォルダ>
```

- 先に `--dry-run` で検査だけ通す（Storage にもDBにも書かない）。出力の `holds`（保留の理由）・`missing`（足りないファイル）・`risk_flags`（禁止表現の件数）を見る
- 鍵は本体の `.env.local`（`SUPABASE_URL`・`SUPABASE_SERVICE_KEY`）を読む。**Codex に鍵・`.env.local` を渡さない**（Codex はファイルを出力するだけ）
- `x_thread[0]` の媒体が `draft-x.mp4` でフォルダに無ければ、`draft.mp4` から ffmpeg で 720×1280 を書き出す（一時フォルダに作り、素材フォルダは変えない。ffmpeg が要る）。YouTube には 1080×1920 の `draft.mp4` を送る
- 取り込みの直後は全部の下書きが公開保留（`publish_blocked=true`）。保留を外すのは送信の側（auto-plan）の検査が通ったときだけ
- 同じ版（ファイルの中身が同じ）を2回上げても、同じ下書きが返るだけで増えない

### 結果の見方

| 欄 | 意味 | どうするか |
|---|---|---|
| `version_hash` | ファイルの中身から決まる版 | 同じ素材かどうかの確認に使う |
| `derived` | push-bundle が作ったファイル（`draft-x.mp4`） | integrity.json に無いのが正しい。ハッシュの保留にしない |
| `ignored` | 決まった名前でないので読まなかったファイル | 必要なファイルなら名前を直す |
| `missing` | 足りないファイル | Codex にやり直しを頼む |
| `holds` | 保留の理由（QA 不合格・ハッシュ不一致・会場の食い違いなど） | 1件でもあれば、その素材は送られない。理由を Codex に返す |
| `risk_flags` | 禁止表現などの件数（X はスレッドの投稿ごと） | 0 でなければ管理画面で中身を見る |
| `imported` | 取り込みの結果（下書きの ID・thread_index） | dry-run では出ない |

止まったとき（`push-bundle を止めた: ...`）は、検査の理由がそのまま出る。Storage への保存・登録の 5xx は同じフォルダで再実行してよい。4xx は再実行しても同じ結果になる。

## 2. Codex 向け: 素材バンドル v1 の形式

v0（`ryujin-preview/0`）と同じファイル構成（`bundle.json`・`qa.json`・`integrity.json`・`script.txt`・`draft.mp4`・`scene-1〜3.png`・4つの出典 `*.json` と `*.meta.json`）に、次を変える。v0 の形式は `docs/operation/sns-preview-bundle-import.md`。

- `bundle.json` の `schema_version` は `ryujin-preview/1`
- `screen_key`: 送る前に表示を確かめる画面の印の名前（必須）
- `x_thread`: `[{index, text, media?}]`。index は 0 からの連番で1〜6件。親（index 0）の `media` は `draft-x.mp4`。**URL は親だけに置く**（子に URL があると取り込みを拒否する。URL を含む投稿は単価が高いため）。各投稿は X の文字数（全角は2と数える、280まで）に収める
- `claims`: `[{id, text, value, source: {endpoint, path}}]`。`endpoint` は龍神の公開 API（`/api/...`）、`path` はその JSON の中の場所。送る前に公開 API を読み直して `value` と照合する
- `x_text`・`template_variant_id`・`local_only`・`release_verified`・`approval_status` は v1 では要らない（`x-draft.txt` も要らない）
- 動画は1本 32 MiB まで
- 締切の時刻は bundle に書かない（送信の側が DB の races から計算する）
- `integrity.json` には、Codex が出力したファイルのハッシュを入れる（`draft-x.mp4` は push-bundle が作るので入れない）

## 3. X の鍵の登録（初回・鍵の作り直し）

1. console.x.com で App を開き、右上の Settings → User authentication settings
   - Type of App: Web App, Automated App or Bot（Confidential client）
   - Callback URI: `https://www.boat-ai.jp/api/admin/sns-hub/x-oauth/callback`
   - Website URL: `https://www.boat-ai.jp`
2. Keys and tokens の OAuth 2.0 Client ID・Client Secret を、Vercel の Production に `X_OAUTH_CLIENT_ID`・`X_OAUTH_CLIENT_SECRET`（Sensitive）として登録する
3. `SNS_TOKEN_ENC_KEY`（32バイトの乱数の base64。トークンの暗号化の鍵）を Vercel に登録する。作り直すと保存済みのトークンを読めなくなるので、作り直したら手順4をやり直す
4. 再デプロイの後、管理画面の「X と連携する」から連携する
5. Billing の spending limit を月の上限額に合わせる（L2 は $10、L3 は $130。`sns_x_send_control.budget_microusd` と同じ額）
6. `/api/admin/sns-hub/token-health?x_read=1` で、X の読み取りが通るか確かめる（1回 $0.001 程度）

Vercel の `vercel env ls` の時刻の列は作成日時で、値を変えても変わらない。更新を確かめるときは Vercel の API（`/v9/projects/{id}/env` の `updatedAt`）を読む。

## 4. GA4 の鍵の登録（sns-daily の流入の取り込み）

`sns-daily`（tasks 22）の GA4 の部分は、Vercel の Production に次の2つが無い間は飛ばし、監視が「GA4 の鍵が無い」を知らせる。

- `GOOGLE_SERVICE_ACCOUNT_KEY`: サービスアカウントの JSON 全体（手元の `credentials/google-service-account.json` の中身）。Sensitive
- `GA4_PROPERTY_ID`: `.env.local` と同じ値
