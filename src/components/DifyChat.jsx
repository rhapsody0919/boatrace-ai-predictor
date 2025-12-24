import { useState } from 'react';
import './DifyChat.css';

/**
 * Difyチャットコンポーネント
 * 
 * 使用方法:
 * 1. Difyでチャットボットを作成
 * 2. 公開URLまたはAPIキーを取得
 * 3. 環境変数に設定: VITE_DIFY_CHAT_URL または VITE_DIFY_API_KEY
 * 4. このコンポーネントをApp.jsxに追加
 * 
 * 例: <DifyChat />
 */
export default function DifyChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // DifyのチャットURL（環境変数から取得、または直接指定）
  const difyChatUrl = import.meta.env.VITE_DIFY_CHAT_URL || '';

  // DifyチャットURLが設定されていない場合、非表示
  if (!difyChatUrl) {
    return null;
  }

  return (
    <>
      {/* フローティングボタン */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="dify-chat-button"
          aria-label="AIアシスタントを開く"
        >
          <span className="chat-icon">💬</span>
          <span className="chat-label">AIに質問</span>
        </button>
      )}

      {/* チャットウィンドウ */}
      {isOpen && (
        <div className={`dify-chat-window ${isMinimized ? 'minimized' : ''}`}>
          {/* ヘッダー */}
          <div className="dify-chat-header">
            <div className="chat-header-content">
              <span className="chat-header-icon">🤖</span>
              <span className="chat-header-title">AIアシスタント</span>
              <span className="chat-header-subtitle">予想について質問できます</span>
            </div>
            <div className="chat-header-actions">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="chat-minimize-btn"
                aria-label={isMinimized ? '最大化' : '最小化'}
              >
                {isMinimized ? '□' : '−'}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="chat-close-btn"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
          </div>

          {/* チャットコンテンツ */}
          {!isMinimized && (
            <div className="dify-chat-content">
              <iframe
                src={difyChatUrl}
                className="dify-chat-iframe"
                title="Dify AI Chat"
                frameBorder="0"
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

