# Storage の写し（R2）: オーナーの作業の手順

設計: [ADR-0098](../adr/0098-storage-mirror-to-r2.md)。Supabase Storage の sns-hub-media・raw-pages・analogy を、1日1回 Cloudflare R2 の1バケットへ書き足す。R2 のアカウント・バケット・token の作成と、GitHub の Environment prod-jobs への登録はオーナーの操作。

## 全体の決まり
- **鍵の値（Access Key ID・Secret Access Key・アカウント ID）は、チャット・Slack・Linear・PR に貼らない。** Claude・hq には「登録した」「名前は ○○」だけを返す
- 作業は Claude in Chrome の入っていないブラウザ（または別プロファイル）で行う
- 順番を守る。**R2 の secret を prod-jobs に登録してから PR をマージする**（先にマージすると、key-canary の r2 の job が30分ごとに落ちて、鍵の Issue が開く）

| 順 | 作業 | 時間 |
|---|---|---|
| 1 | prod-jobs が master だけかを確かめる | 2分 |
| 2 | R2 のバケットを作る（非公開） | 5分 |
| 3 | バケット全体に bucket lock を掛ける | 2分 |
| 4 | バケット1つに限った token を作る | 5分 |
| 5 | 請求の通知を置く | 3分 |
| 6 | prod-jobs に secret を4つ登録する | 5分 |
| 7 | PR をマージする | 1分 |
| 8 | 初回の run を手で起動し、件数を確かめる | 10分 |
| 9 | 翌日、定期の run と見張りを確かめる | 3分 |
| 10 | Supabase に復元の試験用のバケットを作る | 3分 |
| 11 | 復元の試験を全部で1回動かす（採用時） | 10分 |

---

## 1. prod-jobs が master だけかを確かめる

GitHub → https://github.com/rhapsody0919/boatrace-ai-predictor/settings/environments → prod-jobs

- 「Deployment branches and tags」が **Selected branches and tags** で、規則が `master` の1つだけ
  - 「Protected branches only」や「No restriction」なら、Selected にして `master` だけを足す
- 理由: Environment の secret は、許されたブランチで動く workflow から読める。master だけに限らないと、PR のブランチで workflow を書き換えて R2 の token を読める

## 2. R2 のバケットを作る

Cloudflare のダッシュボード → R2 Object Storage（初めてなら R2 を有効にする。画面の案内に従う）→ Create bucket

| 項目 | 値 |
|---|---|
| Bucket name | 任意（例 `ryujin-storage-mirror`）。6 で `R2_BUCKET` に入れる |
| Location | Automatic |
| Default storage class | Standard |
| Jurisdiction | 指定しない（指定すると口の URL が変わり、今のコードでは繋がらない） |

作った後、バケットの Settings で次を確かめる。
- **Public access**: r2.dev の公開 URL は Disabled のまま。Custom Domains は付けない（raw-pages は公式の HTML で、公開しない。ADR-0067）
- **Object lifecycle rules**: 足さない（lock があれば効かないが、誤解のもとになる）
- CORS: 足さない

## 3. バケット全体に bucket lock を掛ける

バケット → Settings → Bucket lock rules → Add rule

| 項目 | 値 |
|---|---|
| Rule name | `all-indefinite` |
| Prefix | 空（バケット全体） |
| Retention | Indefinite |

- 最初の書き込み（8）より前に掛ける
- これで token からは消せず、上書きもできない。規則を外せるのはアカウントの管理者だけ。外すと写しを消せるようになるので、外さない

## 4. バケット1つに限った token を作る

R2 Object Storage の Overview → Account Details の API Tokens の **Manage** → **Create Account API token**

| 項目 | 値 |
|---|---|
| Token name | 任意（例 `ryujin-storage-mirror-actions`） |
| Permissions | **Object Read & Write**（Admin の2つは選ばない） |
| Specify bucket(s) | **Apply to specific buckets only** で、2 のバケットだけ |
| TTL | 任意。期限を付けたら日付を控える（切れると key-canary の r2 の job が落ち、鍵の Issue が開く） |
| Client IP Address Filtering | 付けない（GitHub の runner の IP は決まらない） |

- 作成の後に1回だけ出る **Access Key ID** と **Secret Access Key** を、6 で登録するまで手元に控える（登録したら控えを消す）
- **アカウント ID**: 同じ画面の endpoint `https://<アカウント ID>.r2.cloudflarestorage.com` の `<アカウント ID>`（32桁の16進）
- R2 に「書くだけ」の token は無い。Object Read & Write は消すこともできるが、3 の lock で消せない

## 5. 請求の通知を置く

Cloudflare のダッシュボード → Notifications → Add → 請求・使用量の通知（Usage Based Billing 等、画面にある名前）を R2 について置く。

- 見込みは R2 の無料枠（10GB-month）の内（初回 約406MB、1年で約1.2GB）。超えるのは6〜7年後の試算（ADR-0098「費用・容量の見込み」）
- 通知は、誤りで大量に書かれたときに気づくため

## 6. prod-jobs に secret を4つ登録する

GitHub → Settings → Environments → prod-jobs → Environment secrets → Add environment secret

| 名前 | 値 |
|---|---|
| `R2_ACCOUNT_ID` | 4 のアカウント ID（32桁の16進） |
| `R2_BUCKET` | 2 のバケットの名前 |
| `R2_ACCESS_KEY_ID` | 4 の Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 4 の Secret Access Key |

- **repo の secret（Settings → Secrets and variables → Actions の Repository secrets）・Environment ryujin-bot・Vercel には入れない**
- 端末から入れる場合（値は対話で入れ、コマンドの履歴に残さない）:

```bash
gh secret set R2_SECRET_ACCESS_KEY --env prod-jobs -R rhapsody0919/boatrace-ai-predictor
```

## 7. PR をマージする

Storage の写しの PR（.github を変えるので、オーナーが承認してマージする）。

```bash
gh pr merge {番号} --squash --admin -R rhapsody0919/boatrace-ai-predictor
```

マージの後、次の :07 か :37 の Key Canary の run で、job `r2` が緑になる（Actions → Key Canary）。

## 8. 初回の run を手で起動する

Actions → **Storage Mirror (R2)** → Run workflow → `initial` に**チェックを入れて**実行（`accept_gone` は入れない）。

確かめること（run の Summary の表）:
- 失敗が0件で、run が緑
- 元の件数・容量が、2026-10-20 の実測に近い（sns-hub-media 537件・262.9MB、raw-pages 914件・7.6MB、analogy 600件・135.8MB。その後に増えた分だけ多い）
- 「書いた」が「元の件数」と同じ（初回は全部書く）

`initial` は初回だけ。R2 に manifest が1本でもあると、`initial` 付きの run は止まる。

## 9. 翌日、定期の run と見張りを確かめる

- 翌日 04:40 JST の定期の run が緑で、「取り寄せ」が数十件以内（全部を取り寄せ直していない）
- Key Canary の job `r2` が緑
- hq の dashboard-alerts の「Storage の写しの最後の成功」が1日以内

## 10. Supabase に復元の試験用のバケットを作る

（復元の試験の PR をマージする前に）Supabase の Dashboard → Storage → New bucket

| 項目 | 値 |
|---|---|
| Name | `storage-mirror-drill`（この名前だけを受け付ける） |
| Public bucket | オフ（非公開） |
| Restrict file upload size | オフ、または 50MB 以上（今の最大は 15.3MB） |
| Allowed MIME types | 空（制限しない。写す元に image/png・image/jpeg・video/mp4・application/json・text/plain・application/gzip がある） |

- 試験は毎回同じパスへ上書きするだけで、消さない。容量は写しの本体（約406MB）を超えない
- RLS のポリシーは足さない（service key だけが読み書きする）

## 11. 復元の試験を全部で1回動かす（採用時）

8 の初回の写しが緑になった後、Actions → **Storage Mirror Restore Drill** → Run workflow → `all` に**チェックを入れて**実行。

確かめること（run の Summary の表）:
- 失敗が0件で、run が緑
- 「試した」と「一致」が同じで、合計が 8 の「書いた」の件数と同じ

以後は毎月2日 05:20 JST に見本（バケットごとに一番大きいファイルと20件）で自動で動く。

## 落ちたとき

- job-watch が Issue を開く（鍵の誤りはラベル job-watch-key、それ以外は job-watch-failure）
- 「元から消えた」で落ちた: 写しには残っている。元で消したのが正しいか（ADR-0047 の軽量版への置き換え・掃除・誤り）を確かめる。正しければ Run workflow で `accept_gone` にチェックを入れて実行する（入れないと、最後に正しかった状態と比べて毎日落ちる）
- 「一覧が0件」で落ちた: `SUPABASE_SERVICE_KEY` に anon の鍵が入っていないかを確かめる（anon の鍵だと非公開のバケットが空に見える）。鍵が正しく、本当に空にしたのなら `accept_gone` で実行する
- 「1回の上限を超える」で落ちた: 何も書いていない。元で大量に書き換わった理由を確かめる（指紋が毎日変わる誤りなら Claude に直すよう頼む）。正しければ Run workflow で `accept_gone` にチェックを入れて実行する（`accept_gone` は大量の削除・一覧0件の承認と、取り寄せの上限の解除を兼ねる）
- 「GET が 404 のものが多い」で落ちた: 一覧に出たのに読めないファイルがある。キーの符号化の誤りの疑いがあるので Claude に調べるよう頼む
- 復元の試験で「Content-Type が違う」「sha256 が違う」: 写しが壊れているか、戻す口が変わった。Claude に調べるよう頼む（写しは lock で消えていない）
- R2 の token の期限切れ・取り消し: 4 で作り直し、6 で `R2_ACCESS_KEY_ID`・`R2_SECRET_ACCESS_KEY` を上書きする
