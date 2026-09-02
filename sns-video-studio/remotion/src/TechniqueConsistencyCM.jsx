import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import {
  SceneCTA,
  Fade,
  Pop,
  GOLD,
  ACCENT,
  WHITE,
  NAVY,
  FONT,
} from "./noteVideoShared.jsx";
import { DataQuoteCard } from "./DataQuoteCard.jsx";

/**
 * YouTube解説動画 — 「1号艇は逃げ一強、4号艇の決まり手は会場でバラバラ」
 * （content-multi-channel-pipelineのチャネル品質検証、YouTubeチャネル）
 *
 * ブログ/note記事（boat-number-technique-consistency）と同じネタ・同じ実データ
 * （過去90日・全24会場、winning_technique_stats）を動画化。記事本文の表と同じ
 * 会場別の実数値をそのままバーチャートにしており、記事と動画で数値の食い違いが
 * 無いようにしている。
 *
 * 2026-09-02 初版レビューでの指摘と修正: 「フォント・配色がサムネイルと違う」
 * 「動画のクオリティが低い」という指摘を受け、以下を修正した
 * - 初版は巨大な数字（91.5〜97.4%等）だけを見せる抽象的な画面で、既存の
 *   公開済み動画（SceneFeatures、実際のツール画面のスクリーンショットに
 *   ハイライトを当てる構成）と比べて情報量・説得力が薄かった。この機能には
 *   Playwrightで撮影済みの実画面スクリーンショットが無いため、代わりに
 *   記事本文の表の実数値をそのまま使った横棒グラフ（VenueBarChartScene）に
 *   差し替え、「会場ごとの実数値」を画面上で直接見せる構成にした
 * - 見出し・グロー（textShadow）自体は既存動画（SceneHook）と同じ演出で、
 *   これはブランドの動画共通スタイルとして意図した表現（フォント自体は
 *   DataQuoteCardと同じFONT定数）。ただし棒グラフ内のラベル・数値は
 *   グローを外し可読性を優先した
 * - 初版は<Audio>を欠いたまま無音でレンダリングし、ffmpegで別途音声を
 *   後付けしていたが、既存動画と同じ`remotion render src/index.jsx <id> <out>`
 *   の呼び出し方で<Audio src={staticFile(...)} volume={0.4}/>を直接使えば
 *   問題なく音声が乗ることを検証済み（初版の「環境バグ」という判断は誤り）
 */

const HOOK_DURATION = 90;
const BAR1_DURATION = 230;
const BAR2_DURATION = 260;
const COMPARE_DURATION = 160;
const CTA_DURATION = 210;

function BgDecoration() {
  return (
    <>
      <div
        style={{
          position: "absolute",
          right: -180,
          bottom: -220,
          width: 640,
          height: 640,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}22 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -140,
          top: -160,
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 70%)`,
        }}
      />
    </>
  );
}

// 会場別の横棒グラフ（記事本文の表と同じ実数値）。barColorが指定された行は
// 「1位の決まり手が他と違う」ことを示す強調色にする（4号艇シーン用）。
function VenueBarChartScene({
  label,
  headline,
  excerptNote,
  bars,
  maxValue,
  note,
}) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 55%, #081521 100%)`,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      <BgDecoration />

      <Pop
        delay={0}
        style={{
          position: "absolute",
          top: 64,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            color: NAVY,
            background: GOLD,
            fontSize: 28,
            fontWeight: 900,
            padding: "9px 30px",
            borderRadius: 999,
          }}
        >
          {label}
        </div>
      </Pop>

      <Pop
        delay={8}
        style={{
          position: "absolute",
          top: 138,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 40,
            fontWeight: 900,
            lineHeight: 1.3,
          }}
        >
          {headline}
        </div>
      </Pop>

      {excerptNote && (
        <Fade
          delay={12}
          style={{
            position: "absolute",
            top: 200,
            left: 0,
            right: 0,
            textAlign: "center",
          }}
        >
          <div style={{ color: WHITE, fontSize: 20, opacity: 0.6 }}>
            {excerptNote}
          </div>
        </Fade>
      )}

      <div style={{ position: "absolute", top: 250, left: 160, right: 160 }}>
        {bars.map((bar, i) => {
          const widthPct = (bar.value / maxValue) * 100;
          const barColor = bar.emphasis ? ACCENT : GOLD;
          return (
            <Fade
              key={bar.venue}
              delay={16 + i * 8}
              durationIn={12}
              style={{ marginBottom: 26 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                }}
              >
                <div
                  style={{
                    width: 128,
                    color: WHITE,
                    fontSize: 26,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {bar.venue}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 40,
                    background: "#ffffff14",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${widthPct}%`,
                      height: "100%",
                      background: barColor,
                      borderRadius: 8,
                    }}
                  />
                </div>
                <div
                  style={{
                    width: 260,
                    color: barColor,
                    fontSize: 26,
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  {bar.displayValue}
                  {bar.sublabel && (
                    <span
                      style={{
                        color: WHITE,
                        fontSize: 18,
                        fontWeight: 700,
                        opacity: 0.75,
                        marginLeft: 10,
                      }}
                    >
                      {bar.sublabel}
                    </span>
                  )}
                </div>
              </div>
            </Fade>
          );
        })}
      </div>

      <Fade
        delay={16 + bars.length * 8 + 10}
        style={{
          position: "absolute",
          bottom: 70,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div style={{ color: WHITE, fontSize: 26, opacity: 0.85 }}>{note}</div>
      </Fade>
    </AbsoluteFill>
  );
}

function CompareScene() {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        fontFamily: FONT,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Pop delay={0} style={{ textAlign: "center" }}>
        <div style={{ color: WHITE, fontSize: 44, fontWeight: 800 }}>
          会場によるブレ幅を比べると
        </div>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            gap: 64,
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ color: WHITE, fontSize: 26, opacity: 0.75 }}>
              1号艇（逃げ率）
            </div>
            <div style={{ color: GOLD, fontSize: 84, fontWeight: 900 }}>
              5.87pt
            </div>
          </div>
          <div
            style={{
              color: WHITE,
              fontSize: 60,
              fontWeight: 900,
              alignSelf: "center",
            }}
          >
            vs
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: WHITE, fontSize: 26, opacity: 0.75 }}>
              4号艇（1位決まり手の割合）
            </div>
            <div style={{ color: ACCENT, fontSize: 84, fontWeight: 900 }}>
              約30pt
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 40,
            color: GOLD,
            fontSize: 40,
            fontWeight: 900,
            textShadow: `0 0 30px ${GOLD}55`,
          }}
        >
          差はなんと5倍以上
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

const BOAT1_BARS = [
  { venue: "鳴門", value: 97.41, displayValue: "97.41%" },
  { venue: "戸田", value: 97.22, displayValue: "97.22%" },
  { venue: "尼崎", value: 96.82, displayValue: "96.82%" },
  { venue: "江戸川", value: 91.94, displayValue: "91.94%" },
  { venue: "浜名湖", value: 91.54, displayValue: "91.54%" },
];

const BOAT4_BARS = [
  {
    venue: "蒲郡",
    value: 66.07,
    displayValue: "66.07%",
    sublabel: "まくり",
  },
  {
    venue: "桐生",
    value: 64.71,
    displayValue: "64.71%",
    sublabel: "まくり",
  },
  {
    venue: "常滑",
    value: 62.5,
    displayValue: "62.50%",
    sublabel: "まくり",
  },
  {
    venue: "若松",
    value: 38.46,
    displayValue: "38.46%",
    sublabel: "差し",
    emphasis: true,
  },
  {
    venue: "三国",
    value: 36.36,
    displayValue: "36.36%",
    sublabel: "まくり差し",
    emphasis: true,
  },
  {
    venue: "丸亀",
    value: 36.17,
    displayValue: "36.17%",
    sublabel: "まくり",
  },
];

export function TechniqueConsistencyCM() {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile("note-bgm-calm-corporate-relax.wav")}
        volume={0.4}
      />
      {/* サムネイルと全く同じカバー画像から動画を開始する（2026-09-02、
          「最初の画面が低クオリティ、サムネと同じ画像から入れば良いのでは」
          という指摘を受けてDataQuoteCardをそのまま再利用に変更） */}
      <Sequence from={0} durationInFrames={HOOK_DURATION}>
        <DataQuoteCard
          headline="1号艇は逃げ一強、4号艇は会場でバラバラ"
          statValue="24会場"
          statLabel="過去90日の決まり手データを比較"
        />
      </Sequence>
      <Sequence from={HOOK_DURATION} durationInFrames={BAR1_DURATION}>
        <VenueBarChartScene
          label="1号艇の決まり手（逃げ率）"
          headline="全24会場、逃げ率はすべて90%超"
          excerptNote="全24会場中、上位3・下位2を抜粋"
          bars={BOAT1_BARS}
          maxValue={100}
          note="会場が変わっても、1号艇の勝ち方はほぼ変わらない（会場差5.87pt）"
        />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + BAR1_DURATION}
        durationInFrames={BAR2_DURATION}
      >
        <VenueBarChartScene
          label="4号艇の1位の決まり手"
          headline="会場によって主役の決まり手が変わる"
          excerptNote="全24会場中、上位3・「まくり」以外が1位の3会場を抜粋"
          bars={BOAT4_BARS}
          maxValue={100}
          note="若松・三国は「まくり」以外が1位。会場差は約30pt"
        />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + BAR1_DURATION + BAR2_DURATION}
        durationInFrames={COMPARE_DURATION}
      >
        <CompareScene />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + BAR1_DURATION + BAR2_DURATION + COMPARE_DURATION}
        durationInFrames={CTA_DURATION}
      >
        <SceneCTA
          featureDigest={[
            "全24会場の決まり手データ",
            "枠番別の勝ちパターン",
            "無料・登録不要で確認",
          ]}
        />
      </Sequence>
    </AbsoluteFill>
  );
}

export const TECHNIQUE_CONSISTENCY_DURATION =
  HOOK_DURATION +
  BAR1_DURATION +
  BAR2_DURATION +
  COMPARE_DURATION +
  CTA_DURATION;
