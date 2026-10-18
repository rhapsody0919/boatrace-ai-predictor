// SNS ハブ管理画面の4ページで共通の枠（見出しとページの切り替え）。
// 1ページに承認・送信状況・数字・資料が積み重なっていたのを、用途ごとに分けた（2026-10-18 オーナー決定）
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { getDrafts, getDeadlineQueue } from "../../../services/snsHubService";
import { attentionRows } from "../../../utils/snsAutoSendStatus.js";
import "../SnsHubAdmin.css";

const MANUAL_PLATFORMS = ["blog", "note", "x", "youtube"];
const REVIEW_STATUSES = ["pending_review", "revision_requested"];

const PAGES = [
  { to: "/admin/sns-hub", label: "手動承認", count: "manual", end: true },
  { to: "/admin/sns-hub/auto", label: "自動送信", count: "auto" },
  { to: "/admin/sns-hub/metrics", label: "数字と戦略メモ" },
  { to: "/admin/sns-hub/library", label: "資料" },
];

// ナビの数字。手動承認は承認待ちの下書き、自動送信は要対応の件数。取れなければ数字を出さない
function useNavCounts() {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    let active = true;
    getDrafts()
      .then((drafts) => {
        if (active)
          setCounts((c) => ({
            ...c,
            manual: drafts.filter(
              (d) =>
                MANUAL_PLATFORMS.includes(d.platform) &&
                REVIEW_STATUSES.includes(d.status),
            ).length,
          }));
      })
      .catch((err) => console.error("承認待ちの件数を取得できません:", err));
    getDeadlineQueue()
      .then(({ rows }) => {
        if (active)
          setCounts((c) => ({
            ...c,
            auto: attentionRows(rows, Date.now()).length,
          }));
      })
      .catch((err) => console.error("要対応の件数を取得できません:", err));
    return () => {
      active = false;
    };
  }, []);
  return counts;
}

function navCountText(kind, value) {
  if (value === undefined) return null;
  if (kind === "auto") return value > 0 ? `要対応 ${value}` : null;
  return String(value);
}

export default function SnsHubLayout({ children }) {
  const counts = useNavCounts();
  return (
    <div className="sns-hub-admin-page">
      <div className="sns-hub-header">
        <Link to="/" className="back-link">
          ← トップへ戻る
        </Link>
        <h1>SNSマーケティングハブ</h1>
        <p className="admin-badge">管理者用</p>
      </div>
      <nav className="sns-hub-page-nav" aria-label="SNSハブのページ">
        {PAGES.map((page) => {
          const countText =
            page.count && navCountText(page.count, counts[page.count]);
          return (
            <NavLink
              key={page.to}
              to={page.to}
              end={page.end}
              className={({ isActive }) =>
                `sns-hub-page-link${isActive ? " active" : ""}`
              }
            >
              {page.label}
              {countText && (
                <span
                  className={`sns-hub-page-count${page.count === "auto" ? " alert" : ""}`}
                >
                  {countText}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
