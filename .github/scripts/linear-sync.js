#!/usr/bin/env node

/**
 * Linearタスク同期スクリプト
 * 
 * コミットメッセージからLinearタスクIDを抽出し、
 * Linear APIを使用してタスクを更新します。
 * 
 * 使用方法:
 *   node .github/scripts/linear-sync.js <commit-message>
 * 
 * 環境変数:
 *   LINEAR_API_KEY: Linear APIキー（必須）
 */

import { execSync } from 'child_process';
import https from 'https';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_API_URL = 'https://api.linear.app/graphql';

if (!LINEAR_API_KEY) {
  console.error('❌ LINEAR_API_KEY環境変数が設定されていません');
  process.exit(1);
}

/**
 * GraphQLリクエストを送信
 */
function graphqlRequest(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    
    const options = {
      hostname: 'api.linear.app',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': LINEAR_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
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
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * コミットメッセージからLinearタスクIDを抽出
 */
function extractLinearIds(commitMessage) {
  const regex = /([A-Z]+-\d+)/g;
  const matches = commitMessage.match(regex);
  return matches ? [...new Set(matches)] : [];
}

/**
 * タスクIDからIssue IDを取得
 */
async function getIssueId(identifier) {
  const query = `
    query GetIssue($identifier: String!) {
      issues(filter: { identifier: { eq: $identifier } }) {
        nodes {
          id
          identifier
          state {
            id
            name
          }
        }
      }
    }
  `;
  
  const result = await graphqlRequest(query, { identifier });
  const issues = result?.issues?.nodes || [];
  
  if (issues.length === 0) {
    throw new Error(`タスク ${identifier} が見つかりません`);
  }
  
  return issues[0];
}

/**
 * 完了状態のIDを取得
 */
async function getDoneStateId() {
  const query = `
    query GetDoneState {
      workflowStates(filter: { name: { eq: "Done" } }) {
        nodes {
          id
          name
        }
      }
    }
  `;
  
  const result = await graphqlRequest(query);
  const states = result?.workflowStates?.nodes || [];
  
  if (states.length === 0) {
    throw new Error('完了状態が見つかりません');
  }
  
  return states[0].id;
}

/**
 * タスクを完了状態に更新
 */
async function markIssueAsDone(issueId, stateId) {
  const mutation = `
    mutation UpdateIssue($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
        issue {
          id
          identifier
          state {
            name
          }
        }
      }
    }
  `;
  
  const result = await graphqlRequest(mutation, { issueId, stateId });
  return result?.issueUpdate;
}

/**
 * タスクにコメントを追加
 */
async function addComment(issueId, body) {
  const mutation = `
    mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment {
          id
        }
      }
    }
  `;
  
  const result = await graphqlRequest(mutation, { issueId, body });
  return result?.commentCreate;
}

/**
 * メイン処理
 */
async function main() {
  const commitMessage = process.argv[2] || process.env.GITHUB_COMMIT_MESSAGE || '';
  
  if (!commitMessage) {
    console.error('❌ コミットメッセージが指定されていません');
    process.exit(1);
  }
  
  console.log('📝 コミットメッセージ:', commitMessage);
  
  const linearIds = extractLinearIds(commitMessage);
  
  if (linearIds.length === 0) {
    console.log('ℹ️  LinearタスクIDが見つかりませんでした');
    process.exit(0);
  }
  
  console.log(`✅ 見つかったLinearタスク: ${linearIds.join(', ')}`);
  
  // 完了キーワードをチェック
  const completionKeywords = /(fixes|closes|resolves|completed|done)/i;
  const shouldMarkAsDone = completionKeywords.test(commitMessage);
  
  try {
    let doneStateId = null;
    if (shouldMarkAsDone) {
      console.log('🔍 完了状態のIDを取得中...');
      doneStateId = await getDoneStateId();
      console.log(`✅ 完了状態ID: ${doneStateId}`);
    }
    
    for (const identifier of linearIds) {
      try {
        console.log(`\n📋 タスク ${identifier} を処理中...`);
        
        const issue = await getIssueId(identifier);
        console.log(`   Issue ID: ${issue.id}`);
        console.log(`   現在の状態: ${issue.state.name}`);
        
        if (shouldMarkAsDone && doneStateId) {
          // タスクを完了状態に更新
          const updateResult = await markIssueAsDone(issue.id, doneStateId);
          
          if (updateResult?.success) {
            console.log(`   ✅ ${identifier} を完了状態に更新しました`);
          } else {
            console.log(`   ⚠️  ${identifier} の更新に失敗しました`);
          }
        } else {
          // タスクにコメントを追加
          const commentBody = `GitHubコミット: ${commitMessage}`;
          const commentResult = await addComment(issue.id, commentBody);
          
          if (commentResult?.success) {
            console.log(`   💬 ${identifier} にコメントを追加しました`);
          } else {
            console.log(`   ⚠️  ${identifier} へのコメント追加に失敗しました`);
          }
        }
      } catch (error) {
        console.error(`   ❌ タスク ${identifier} の処理中にエラーが発生しました:`, error.message);
      }
    }
    
    console.log('\n✨ 処理が完了しました');
  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ 予期しないエラー:', error);
  process.exit(1);
});

