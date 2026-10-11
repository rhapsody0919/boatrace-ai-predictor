export const GITHUB_REPO = "rhapsody0919/boatrace-ai-predictor";
export function extractPrNumber(url) {
  const match = url?.match(/^https:\/\/github\.com\/rhapsody0919\/boatrace-ai-predictor\/pull\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}
export async function getBlogPr(token, number) {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/pulls/${number}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub PR情報の取得に失敗しました (${response.status})`);
  return response.json();
}
export function assertReviewedHead(pr, sha) {
  if (pr.head?.sha !== sha || pr.merged || pr.state !== "open") {
    throw new Error("PRが確認した版と一致しません。版を再確認してください");
  }
}
