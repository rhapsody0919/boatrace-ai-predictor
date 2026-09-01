/**
 * Linearの content-quality ラベル付きIssueを取得し、鮮度優先（起票日が古い順）で
 * 上位N件だけを抽出する。tweet-drafts.mdの「毎回2〜3件提示」と同じペース設計
 * （溜め込まず、かつ提示しすぎない）。詳細: docs/design/content-ops-flow/spec.md C6
 */

import https from "https";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const DEFAULT_SURFACE_COUNT = 3;

function graphqlRequest(apiKey, query, variables = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const req = https.request(
      LINEAR_API_URL,
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data, "utf8"),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(body);
            if (result.errors) {
              reject(new Error(JSON.stringify(result.errors)));
            } else {
              resolve(result.data);
            }
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data, "utf8");
    req.end();
  });
}

const QUERY = `
  query ContentQualityBacklog {
    issueLabels(filter: { name: { eq: "content-quality" } }) {
      nodes {
        id
        issues(filter: { state: { type: { nin: ["completed", "canceled"] } } }, orderBy: createdAt) {
          nodes {
            identifier
            title
            url
            createdAt
            state { name }
          }
        }
      }
    }
  }
`;

export async function checkQualityBacklog({
  apiKey = process.env.LINEAR_API_KEY,
  surfaceCount = DEFAULT_SURFACE_COUNT,
} = {}) {
  if (!apiKey) {
    return {
      openCount: 0,
      surfaceCount: 0,
      items: [],
      error: "LINEAR_API_KEY未設定のため品質バックログを取得できない",
    };
  }

  const data = await graphqlRequest(apiKey, QUERY);
  const label = data?.issueLabels?.nodes?.[0];
  const allIssues = label?.issues?.nodes ?? [];

  return {
    openCount: allIssues.length,
    surfaceCount: Math.min(surfaceCount, allIssues.length),
    items: allIssues.slice(0, surfaceCount).map((issue) => ({
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      createdAt: issue.createdAt,
      state: issue.state?.name,
    })),
  };
}
