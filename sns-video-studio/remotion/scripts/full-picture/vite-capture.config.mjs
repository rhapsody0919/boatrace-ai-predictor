/**
 * 撮影用の頁（f01-capture.mjs）の dev サーバーの設定。龍神のサイトの vite.config.js をそのまま使い、
 * 依存の前処理の置き場（cacheDir）だけを回ごとに分ける（同じ Mac で f01 を並べて作ると node_modules/.vite を取り合うため）
 */
import process from "node:process";
import base from "../../../../vite.config.js";

export default { ...base, cacheDir: process.env.F01_VITE_CACHE_DIR || base.cacheDir };
