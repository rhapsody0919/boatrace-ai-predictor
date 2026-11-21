/** MP4 の大きさと尺の純粋な読み取り。push-setsu-kiryoku-short.js から移した（字は同じ） */
/**
 * MP4 の大きさと尺（純粋関数）。moov の mvhd（尺）と、trak の tkhd のうち幅・高さが0でないもの（映像）を読む。読めなければ null の欄
 * 返り値: { ftyp, width, height, durationSec }
 */
export function mp4Info(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const info = { ftyp: false, width: null, height: null, durationSec: null };
  const walk = (start, end, depth) => {
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at);
      const t = type(at + 4);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return;
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return;
      const body = at + header;
      if (depth === 0 && t === "ftyp") info.ftyp = at === 0;
      if (t === "moov" || t === "trak") walk(body, at + size, depth + 1);
      if (t === "mvhd" && body + 32 <= at + size) {
        const v1 = bytes[body] === 1;
        const scale = view.getUint32(body + (v1 ? 20 : 12));
        const duration = v1
          ? Number(view.getBigUint64(body + 24))
          : view.getUint32(body + 16);
        if (scale > 0) info.durationSec = duration / scale;
      }
      if (t === "tkhd") {
        const v1 = bytes[body] === 1;
        const off = body + (v1 ? 88 : 76);
        if (off + 8 <= at + size) {
          const w = view.getUint32(off) / 65536;
          const h = view.getUint32(off + 4) / 65536;
          // 表示の行列（幅・高さの直前の36バイト、先頭の a・b は 16.16）が 90度・270度の回転なら、見える縦横は入れ替わる
          const a = view.getInt32(off - 36) / 65536;
          const b = view.getInt32(off - 32) / 65536;
          const rotated = a === 0 && Math.abs(b) === 1;
          if (w > 0 && h > 0 && info.width == null) {
            info.width = rotated ? h : w;
            info.height = rotated ? w : h;
          }
        }
      }
      at += size;
    }
  };
  walk(0, bytes.byteLength, 0);
  return info;
}
