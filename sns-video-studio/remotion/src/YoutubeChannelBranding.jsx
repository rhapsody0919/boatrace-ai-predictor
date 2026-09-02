import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { NAVY, GOLD, WHITE, FONT } from "./noteVideoShared.jsx";

/**
 * YouTubeチャンネルのプロフィール画像（アバター・バナー）。
 * 2026-09-02、ユーザー指摘（「チャンネルのプロフィールも作成する必要がある」）
 * を受けて新設。チャンネル自体にはアイコン・バナーが未設定だった
 * （YouTube Studioの汎用グレーアイコンのままだった）。
 *
 * チャンネル装飾のアップロードには対応するAPIエンドポイントが無く、
 * 一度きりの手動セットアップ作業のため、ここでは静止画を生成するのみ。
 * 実際のアップロードはYouTube Studio（設定 > ブランディング）でユーザーが行う。
 *
 * アバター（800x800推奨）: 円形にクロップされて表示されるため、
 * 四隅が切れても破綻しないよう余白を大きめに取る
 * バナー（2560x1440推奨）: 中央1235x338が「セーフエリア」（全デバイスで
 * 必ず見える領域）。それ以外は背景装飾として扱い、主要な文字要素は
 * セーフエリア内に収める
 */

export function YoutubeChannelAvatar() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 45%, #163a5c 0%, ${NAVY} 60%, #081521 100%)`,
      }}
    >
      <Img
        src={staticFile("logo-light.png")}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "62%",
          transform: "translate(-50%, -50%)",
        }}
      />
    </AbsoluteFill>
  );
}

export function YoutubeChannelBanner() {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 55%, #081521 100%)`,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      {/* 背景装飾（セーフエリア外、切れても問題ない） */}
      <div
        style={{
          position: "absolute",
          right: -260,
          bottom: -320,
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}22 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -220,
          top: -260,
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle, #38bdf818 0%, transparent 70%)",
        }}
      />
      <Img
        src={staticFile("logo-light.png")}
        style={{
          position: "absolute",
          right: 40,
          top: "50%",
          transform: "translateY(-50%)",
          width: 1000,
          opacity: 0.16,
        }}
      />

      {/* セーフエリア（中央1235x338、全デバイスで確実に見える範囲） */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 1235,
          height: 338,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          <Img
            src={staticFile("logo-light.png")}
            style={{ width: 96, height: 96, objectFit: "contain" }}
          />
          <span
            style={{
              color: GOLD,
              fontSize: 88,
              fontWeight: 900,
              letterSpacing: -1,
            }}
          >
            龍神レーダー
          </span>
        </div>
        <div
          style={{
            color: WHITE,
            fontSize: 34,
            fontWeight: 700,
            marginTop: 18,
            opacity: 0.9,
          }}
        >
          ボートレースを見える化。迷ったら、データを信じる。
        </div>
        <div
          style={{
            color: GOLD,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 2,
            marginTop: 20,
            textTransform: "uppercase",
          }}
        >
          boat-ai.jp
        </div>
      </div>
    </AbsoluteFill>
  );
}
