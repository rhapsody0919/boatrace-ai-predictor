/**
 * 思考アシスト（BOA-430）。1レースの予想を、レースの図と4つの見方（軸・展開・機力・買い目）で組み立てるページ。
 * ja 専用（languages.js の isFullyTranslatedPath の例外）。公開まで noindex（spec D-36 (9)）。
 * 中身は後の PR で足す（docs/design/thinking-assist/tasks.md の PR2 以降）。今は準備中の表示だけ
 */
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import Header from "../components/Header";
import { THINKING_ASSIST_PUBLIC } from "../config/featureFlags";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import "./ThinkingAssistPage.css";

const COPY = {
  title: "思考アシスト",
  preparing: "このページは準備中です。",
};

export default function ThinkingAssistPage() {
  const { raceId } = useParams();
  useRobotsMeta(!THINKING_ASSIST_PUBLIC);
  useEffect(() => {
    document.title = `${COPY.title}（${raceId}）`;
  }, [raceId]);

  return (
    <>
      <Header />
      <main className="thinking-assist-page">
        <h1 className="thinking-assist-page__title">{COPY.title}</h1>
        <p className="thinking-assist-page__preparing">{COPY.preparing}</p>
      </main>
    </>
  );
}
