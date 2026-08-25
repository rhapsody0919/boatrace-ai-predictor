import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Header from "../components/Header";
import RacerStructuredData from "../components/RacerStructuredData";
import {
  RacerProfileHeader,
  RacerProfileCard,
  RacerNewsList,
} from "../components/racer";
import { getRacerPageData } from "../services/racerService";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import "./RacerProfile.css";

const SITE_URL = "https://www.boat-ai.jp";

export default function RacerProfile() {
  const { racerId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getRacerPageData(racerId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId]);

  const hasNews = (data?.news?.length ?? 0) > 0;
  useRobotsMeta(!loading && !hasNews);

  const displayName = data?.profile?.name?.replace(/\s+/g, "") ?? "選手";
  const title = `${displayName} 選手プロフィール | 龍神レーダー`;
  const description = data?.profile
    ? `${displayName}選手のプロフィール（生年月日・支部・出身地等）とニュースをまとめて紹介。`
    : "選手プロフィール | 龍神レーダー";
  const canonicalUrl = `${SITE_URL}/racer/${racerId}`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      {data?.profile && (
        <RacerStructuredData profile={data.profile} racerId={racerId} />
      )}

      <Header />

      <div className="racer-profile-page">
        <nav className="racer-profile-breadcrumb">
          <Link to="/">← ホームに戻る</Link>
        </nav>

        {loading && <p className="racer-profile-loading">読み込み中...</p>}
        {error && <p className="racer-profile-error">{error}</p>}

        {!loading && !error && (
          <>
            <RacerProfileHeader profile={data.profile} grade={data.grade} />
            <RacerProfileCard profile={data.profile} />
            <RacerNewsList news={data.news} />
          </>
        )}
      </div>
    </>
  );
}
