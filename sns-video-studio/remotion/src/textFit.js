/**
 * 日本語見出しの折り返し崩れ対策（2026-09-02、DataQuoteCard見出しで発生した
 * 「徹底分析」が「徹」／「底分析」に分割される熟語中折り返しの再発防止）。
 *
 * canvas.measureTextで実際のグリフ幅を計測し、
 * 1) maxLines行数以内に収まる最大のフォントサイズを選ぶ
 * 2) 折り返しが必要な場合、助詞・記号等「切ってよい文字」の直後だけを
 *    改行位置候補にする（熟語や漢字の途中では折り返さない）
 * を行う。Remotionのstillレンダリングは実ブラウザ（Chromium）内で
 * コンポーネント関数を実行するため、canvas.measureTextがそのまま使える。
 */

// この文字の直後は改行してよい（助詞・接続語・句読点等）
const BREAK_SAFE_CHARS = new Set([
  "、",
  "。",
  "・",
  "を",
  "の",
  "が",
  "は",
  "で",
  "に",
  "と",
  "も",
  "や",
  "か",
  "ね",
  "よ",
  "し",
  "て",
  " ",
  "　",
]);

let measureCanvas = null;
function getMeasureContext(fontSize, fontWeight, fontFamily) {
  if (typeof document === "undefined") return null;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return ctx;
}

function measureWidth(text, fontSize, fontWeight, fontFamily) {
  const ctx = getMeasureContext(fontSize, fontWeight, fontFamily);
  if (!ctx) return text.length * fontSize; // measureText不可時の概算フォールバック
  return ctx.measureText(text).width;
}

/**
 * 指定フォントサイズでtextをmaxWidth以内・maxLines行以内に折り返す。
 * @returns {{lines: string[], truncated: boolean}}
 */
function wrapAtSize(
  text,
  { fontSize, fontWeight, fontFamily, maxWidth, maxLines },
) {
  const lines = [];
  let remaining = text;

  while (remaining.length > 0 && lines.length < maxLines) {
    const isLastAllowedLine = lines.length === maxLines - 1;

    // このremainingがmaxWidthに収まる最大文字数を二分探索的に求める
    let fitLen = 0;
    for (let i = 1; i <= remaining.length; i++) {
      const w = measureWidth(
        remaining.slice(0, i),
        fontSize,
        fontWeight,
        fontFamily,
      );
      if (w <= maxWidth) {
        fitLen = i;
      } else {
        break;
      }
    }
    if (fitLen === 0) fitLen = 1; // 極端に狭い場合の無限ループ防止

    if (fitLen >= remaining.length) {
      lines.push(remaining);
      remaining = "";
      break;
    }

    if (isLastAllowedLine) {
      // 最終行かつ収まりきらない場合は「…」を付けて切る
      let cut = fitLen;
      while (
        cut > 0 &&
        measureWidth(
          remaining.slice(0, cut) + "…",
          fontSize,
          fontWeight,
          fontFamily,
        ) > maxWidth
      ) {
        cut--;
      }
      lines.push(remaining.slice(0, cut) + "…");
      return { lines, truncated: true };
    }

    // fitLenより前で「切ってよい文字」の直後を探す（直近5文字以内）
    let breakAt = fitLen;
    for (let j = fitLen; j > Math.max(1, fitLen - 5); j--) {
      if (BREAK_SAFE_CHARS.has(remaining[j - 1])) {
        breakAt = j;
        break;
      }
    }
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }

  return { lines, truncated: false };
}

/**
 * maxFontSizeから順にフォントサイズを下げ、maxLines行以内に「…」無しで
 * 収まる最大サイズを選ぶ。どのサイズでも収まらない場合はminFontSizeで
 * 「…」切り詰めを許容する。
 */
export function fitHeadline(
  text,
  {
    maxWidth,
    maxLines = 2,
    fontFamily,
    fontWeight = 800,
    maxFontSize,
    minFontSize,
    step = 2,
  },
) {
  let result = null;
  for (let fs = maxFontSize; fs >= minFontSize; fs -= step) {
    const attempt = wrapAtSize(text, {
      fontSize: fs,
      fontWeight,
      fontFamily,
      maxWidth,
      maxLines,
    });
    if (!attempt.truncated) {
      return { fontSize: fs, lines: attempt.lines };
    }
    result = { fontSize: fs, lines: attempt.lines };
  }
  return result;
}
