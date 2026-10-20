# ADR-0098: Supabase Storage の3バケットを、日次の突き合わせで Cloudflare R2 に書き足す

- 状態: 採用（2026-10-20 オーナー「Storage yes」、hq 経由。R2 の準備と鍵の登録はオーナー）
- 設計の正本: hq の drafts/storage-mirror-20261020.md の v4 と末尾。棚卸しは hq の drafts/storage-inventory-2026-10.md
- オーナーの作業の手順: [docs/operation/storage-mirror-r2-owner-steps.md](../operation/storage-mirror-r2-owner-steps.md)
- 関連: [ADR-0047](./0047-sns-hub-video-retention-strategy.md)（投稿済みの動画を軽量版に置き換える）、[ADR-0085](./0085-analogy-v16-daily-batch-to-storage.md)（analogy-v16 の朝の出力）、[ADR-0097](./0097-identity-separation-auto-review-and-db-apply.md)（Environment prod-jobs・定期の job の見張り）、[ADR-0066](./0066-scraping-execution-consolidation-to-vercel.md)（新しいバッチは Vercel）

## 背景

- DB は日次7日分と削除前の `_bak` があるが、Storage のファイルは Supabase の1か所だけ。消す・壊す・アカウントの事故で戻せない
- 戻せないものが多いのは sns-hub-media（未投稿の動画・画像）・raw-pages（公式の生の HTML。特記事項・選手コメントの途中の版）・analogy（v16 の再現に要るモデルの版）
- 3バケットの量（2026-10-20 に service key で一覧を最後までたどった実測。`scripts/storage-mirror/supabase-source.js` の listAll）: sns-hub-media 537件・262.9MB、raw-pages 914件・7.6MB、analogy 600件・135.8MB、計 2,051件・406.3MB。1ファイルの最大 15.3MB。eTag は全件が単一の PUT の形（MD5）
- analogy-v16（2年で約55GB）は作り直しでほぼ同じ値が出るので写さない（hq の drafts/storage-mirror-20261020.md「② の答え」）

## 決定

### 形

- `.github/workflows/storage-mirror.yml`（Environment prod-jobs、1日1回 04:40 JST と手での起動）で `scripts/storage-mirror/mirror.js` を動かす。npm ci をせず、Node の組み込みだけで動く
- 写す元は sns-hub-media・raw-pages・analogy の3バケットを丸ごと（新しい書き込み口も自動で入る）。一覧は `scripts/lib/storageMirror.js` の `SOURCE_BUCKETS` に固定し、analogy-v16 は `EXCLUDED_BUCKETS` に明記する
- Supabase は既存の `SUPABASE_SERVICE_KEY` で一覧（`api/_lib/analogyV16.js` の listObjects と同じ口）と読み取り（`GET /storage/v1/object/{bucket}/{path}`）だけをする。Supabase に書く・消す呼び出しは写しの側に無い（verify が検査する）
- R2 は S3 互換の口を SigV4 で直接呼ぶ（`scripts/lib/awsSigV4.js`。使う呼び出しは一覧・PUT・GET・HEAD の4つで、`@aws-sdk/client-s3` の依存の木を入れない）。署名は AWS の公開の試験値で verify が固定する
- ADR-0066（新しいバッチは Vercel）の例外とする。取得ではなく控えで、R2 の token を Vercel（service key と同じ場所）に並べないため

### R2 の中の置き方

| パス | 中身 |
|---|---|
| `objects/{bucket}/{path}` | そのパスで最初に写した版 |
| `versions/{時刻}/{bucket}/{path}` | 同じパスの中身が変わったときの新しい版。時刻はスクリプトの開始（UTC、`20261021T194000Z`）。rerun でも別の時刻になる |
| `manifests/{時刻}.json.gz` | その run の終わりの状態の全部（元のパス → R2 のパス・sha256・大きさ・Content-Type・元の指紋）。元で消えたものも `goneAt` を付けて残す。前の基準から変わらない日は書かない |

- 全部の PUT に `If-None-Match: *` を付ける（R2 は原子的に評価する）。同じキーに2回書かない
- 変わったかは、基準の manifest の元の指紋（eTag・大きさ・更新時刻）と比べ、違えば取り寄せて sha256 で比べる。sha256 が同じなら書かない
- 412（既にある）のときは R2 の `x-amz-meta-sha256` を読み、同じなら採り、違えば次の候補（`versions/`）へ進む（前の run が manifest を書く前に落ちた場合）
- R2 の各オブジェクトに Content-Type（元の mimetype）と `x-amz-meta-sha256`・`x-amz-meta-source`（URL の符号化）を付け、`Content-MD5` と `x-amz-content-sha256` で送り途中の破損を R2 に弾かせる
- 取り寄せた大きさが一覧と違えば失敗にする。一覧に出たのに GET が 404 のもの（写している最中に消えた）は消えた扱いにする
- 元で消えたもの・軽量版に置き換わったもの（ADR-0047）も写しに残る。元の画質が R2 に残る点が ADR-0047 と違う（月 2.5MB 程度、オーナー了承済み）

### 基準と誤りの止め方（鍵の取り違えを success にしない）

anon の鍵だと、非公開のバケットの一覧は 200 で空の配列を返す。これを「元が全部消えた」と読むと、その状態を基準にして翌日から何も写らないまま success になる。そこで:

- 起動時に `SUPABASE_SERVICE_KEY` の role（JWT の payload、新しい形は接頭辞）が service_role かを確かめる
- 基準にあった件数が1以上のバケットの一覧が0件なら失敗にし、消えた扱いにしない
- 1つのバケットで基準の 20% 以上（かつ10件以上）が1日で消えたら失敗にし、その run の manifest に `baseline: false` を付ける。次の run は `baseline: false` の manifest を飛ばし、最後に正しかった manifest と比べ続ける。消したのが正しければ、手での起動の `accept_gone` で基準を進める
- 初回は手での起動の `initial` で明示する。基準の manifest が無いのに `initial` が無い run と、あるのに `initial` がある run は止める（R2 の一覧の誤りで全部を取り直さない）
- 1回の run の取り寄せは 500件・200MB まで（初回は外す）。超えたら何も書かずに止める。指紋が毎日変わる誤り・token の悪用で、lock で消せない版を積まないため

### 鍵と lock

- R2 の token は「1バケットに限った Object Read & Write」で、Environment prod-jobs にだけ置く（repo の secret・ryujin-bot・Vercel・手元に置かない）。R2 に書くだけの token は無い
- R2 のバケット全体（prefix なし）に bucket lock（Indefinite）を掛ける。token では消せず上書きできない。lock の規則を外せるのは Cloudflare のアカウントの管理者（オーナー）だけ
- バケットは非公開のまま（r2.dev の公開 URL・custom domain を付けない）。raw-pages は公式の HTML で、再配布・公開しない（ADR-0067）
- prod-jobs は master だけに限る（Deployment branches の Selected branches に master だけ）。オーナーが R2 の token を入れる前に確かめる
- 2026-10-20 時点では repo の secret に `SUPABASE_SERVICE_KEY` 等がまだ残っている（identity-separation-owner-steps.md の 7 が未了）。それが済むまで、Supabase の鍵は prod-jobs の外からも読める。R2 の token はその影響を受けない（prod-jobs にだけ置く）

### 見張り

- 落ちたら: job-watch（ADR-0097 の追記）が Issue にする。`scripts/watch/job-watch.json` の watched と `job-watch.yml` に載せる。rerun の許可の一覧には入れない（翌日の run が取りこぼしを拾う）
- 鍵の誤り: R2 の一覧の 401・403 は `R2 HTTP 403` の形でログに出し、job-watch が「鍵・設定の誤り」に分ける。key-canary に別の job `r2`（prod-jobs）を足し、`manifests/` を1件だけ一覧する（30分ごと、Class A で月約1,440回）。足さないと、R2 の鍵の誤りで開いた Issue が Supabase だけのカナリアの成功で閉じる
- オブジェクト単位の失敗（一覧が通った後の PUT・HEAD・GET）は `R2 object error {状態} {コード}` の形にし、`HTTP 403` の文字を含めない。キーの符号化の誤りを鍵の誤りに分けると、カナリアの成功で閉じては翌日開くを繰り返すため
- 最後に成功した時刻: `storage-mirror.yml` の master の run のうち、最後に conclusion が success のものの時刻。hq の dashboard-alerts は `gh run list -R rhapsody0919/boatrace-ai-predictor -w storage-mirror.yml -b master -s success -L 1 --json updatedAt` で読み、2日より前なら知らせる（結果が空でも知らせる）。1件でも写し損ねたら run は失敗にするので、success は「その時点の全部を写した」を意味する。Supabase に状態を書く案は、この job が Supabase に書かない前提を崩し、Supabase が落ちているときに書けないので退ける
- 件数・容量は run の Step Summary に出す。リポジトリは PUBLIC で Actions のログは外から見えるので、ログ・Step Summary・失敗の文にはバケット名・件数・容量・状態の番号だけを出し、ファイルのパス・R2 のアカウント ID を出さない
- data_health: 画面が読む表を書かないので、`scripts/lib/dataHealth/workflowCoverage.js` の除外（no_table）に載せる

### 受け入れる損失

- 最大1日分（約3MB）。analogy-v16 の展示後の段（exh-*）は戻せない。race_notices は取り直せない扱い
- Supabase の一覧は offset で区切って取るので、取る途中で増えたファイルで行が抜けることがある。抜けたものはその日だけ「消えた」と記録され、翌日の一覧に出れば取り寄せ直す（中身が同じなら書かない）

## 費用・容量の見込み

- 単価の出典: Cloudflare R2 の料金表（developers.cloudflare.com/r2/pricing/、2026-10-20 に確認。Standard の無料枠 10GB-month・Class A 100万回・Class B 1,000万回、超過 $0.015/GB-month、取り出し無料）
- 初回: Supabase からの取り出し約 406MB（Pro の込みの 250GB の内）、R2 の PUT 約 2,050回
- 以後の本体: 1日約3MB・数十回の PUT。1年で約 1.1GB
- manifest: 毎回全部を書くので、1本の大きさは件数に比例し、合計は日数の2乗で増える。2,051件で gzip 後 約150KB（1件約75B、合成した manifest での試算）、件数は1日約34件増える（棚卸しの増え方）。1年で約0.1GB、3年で約1.7GB（試算）
- 本体と manifest の合計が R2 の無料枠（10GB）を超えるのは6〜7年後の見込み（試算）。超えた分も $0.015/GB-month。5年目までに、manifest を差分の形に変えるかを見直す
- lock は Indefinite なので、写しは減らない

## 退けた案

- 龍神の書き込み口が書いたときに R2 にも書く（v3 の B）: 書き込み口を後から足すと写し漏れに気づけない。R2 の token が Vercel（service key と同じ場所）に並ぶ。lock と上書きの書き込み口がぶつかる
- hq の Actions に Supabase の全権の S3 鍵を置き rclone で週1（v1 の A）: 全権の鍵が増える。`sync` は上書き・移動をするので lock とぶつかる
- `@aws-sdk/client-s3` を足す: 使う呼び出しは4つだけで、依存の木が大きい
