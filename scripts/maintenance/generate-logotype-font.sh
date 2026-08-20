#!/usr/bin/env bash
# ロゴタイプ専用の明朝体サブセットフォントを生成する（ADR 0018）
# 「龍神レーダー」の表示に必要なグリフのみを含むWOFF2を public/fonts/ に出力する。
# ロゴタイプの文言が変わった場合は、このスクリプトを再実行してサブセットを作り直す。
#
# 必要なもの: python3, fonttools（pip install fonttools brotli）
set -euo pipefail

LOGOTYPE_TEXT="龍神レーダー"
FONT_URL="https://fonts.gstatic.com/s/notoserifjp/v33/xn71YHs72GKoTvER4Gn3b5eMRtWGkp6o7MjQ2bwDOubA.ttf"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/public/fonts"
OUT_FILE="$OUT_DIR/noto-serif-jp-logotype-subset.woff2"
TMP_FONT="$(mktemp -t noto-serif-jp-full.XXXXXX.ttf)"

trap 'rm -f "$TMP_FONT"' EXIT

if ! command -v pyftsubset >/dev/null 2>&1; then
  echo "pyftsubset が見つかりません。'pip install fonttools brotli' を実行してください。" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
echo "Noto Serif JP（フルセット）をダウンロード中..."
curl -sSL --max-time 30 -o "$TMP_FONT" "$FONT_URL"

echo "「${LOGOTYPE_TEXT}」のみのサブセットを生成中..."
pyftsubset "$TMP_FONT" \
  --output-file="$OUT_FILE" \
  --text="$LOGOTYPE_TEXT" \
  --flavor=woff2 \
  --layout-features='*' \
  --no-hinting

echo "生成完了: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"
