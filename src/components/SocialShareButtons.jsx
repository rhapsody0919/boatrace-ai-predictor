import React from 'react';
import {
    TwitterShareButton,
    FacebookShareButton,
    LineShareButton,
    XIcon,
    FacebookIcon,
    LineIcon
} from 'react-share';
import './SocialShareButtons.css';
import { trackEvent } from '../utils/analytics';
import { raceShareEventOf } from '../utils/shareEvents';

export const SocialShareButtons = ({
    shareUrl = 'https://www.boat-ai.jp/',
    title,
    hashtags = ['ボートレース', 'AI予想', '龍神レーダー'],
    size = 36,
    // GA4 の race_share（BOA-822 の計測）。shareKind（prediction / result / hit）が無い呼び出しは送らない。
    // 以前の type（'prediction' or 'hit'）はどこからも渡されず使われていなかったので置き換えた
    raceId = null,
    shareKind = null
}) => {
    const track = (channel) => () => {
        const ev = raceShareEventOf({ raceId, channel, kind: shareKind });
        if (ev) trackEvent(ev.name, ev.params);
    };

    // LINEシェア用: テキストからURLを除去（LINEは自動的にURLを追加するため）
    const lineTitle = title
        .replace(/▼詳細を見る\nhttps:\/\/boat-ai\.jp\/\n?/g, '')
        .replace(/▼本日の予想を見る\nhttps:\/\/boat-ai\.jp\/\n?/g, '')
        .replace(/https:\/\/boat-ai\.jp\/\n?/g, '')
        .trim();

    return (
        <div className="social-share-buttons">
            <TwitterShareButton
                url={shareUrl}
                title={title}
                hashtags={hashtags}
                className="social-share-button"
                onClick={track('x')}
            >
                <XIcon size={size} round />
            </TwitterShareButton>

            <FacebookShareButton
                url={shareUrl}
                quote={title}
                hashtag={`#${hashtags[0]}`}
                className="social-share-button"
                onClick={track('facebook')}
            >
                <FacebookIcon size={size} round />
            </FacebookShareButton>

            <LineShareButton
                url={lineTitle ? `${lineTitle}\n${shareUrl}` : shareUrl}
                className="social-share-button"
                onClick={track('line')}
            >
                <LineIcon size={size} round />
            </LineShareButton>
        </div>
    );
};
