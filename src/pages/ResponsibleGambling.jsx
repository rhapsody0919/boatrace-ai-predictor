import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import './About.css';

export default function ResponsibleGambling() {
    return (
        <>
                <title>責任あるギャンブル | 龍神レーダー</title>
                <meta name="description" content="ボートレースを楽しく続けるために。ギャンブル依存症の予防と相談窓口のご案内。" />
                <link rel="canonical" href="https://www.boat-ai.jp/responsible-gambling" />


                {/* BreadcrumbList */}
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "BreadcrumbList",
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": 1,
                                "name": "ホーム",
                                "item": "https://www.boat-ai.jp/"
                            },
                            {
                                "@type": "ListItem",
                                "position": 2,
                                "name": "責任あるギャンブル",
                                "item": "https://www.boat-ai.jp/responsible-gambling"
                            }
                        ]
                    })}
                </script>

            <Header />

            <div className="about-container">
                <div className="about-header">
                    <h1>責任あるギャンブル</h1>
                    <p>ボートレースを楽しく続けるために</p>
                </div>

                <section className="about-section">
                    <h2>龍神レーダーの基本方針</h2>
                    <p>
                        龍神レーダーは、ボートレースの予測情報を提供するサービスです。
                        私たちは、ユーザーの皆様が健全にボートレースを楽しめるよう、
                        以下の方針を掲げています。
                    </p>
                    <ul style={{ marginTop: '1rem', paddingLeft: '1.5rem' }}>
                        <li>舟券の購入を推奨・勧誘するものではありません</li>
                        <li>予測情報は参考としてご利用ください</li>
                        <li>的中を保証するものではありません</li>
                        <li>余裕資金の範囲内でお楽しみください</li>
                    </ul>
                </section>

                <section className="about-section" style={{ background: '#fff3e0', padding: '1.5rem', borderRadius: '8px' }}>
                    <h2 style={{ color: '#e65100' }}>ギャンブル依存症について</h2>
                    <p>
                        ギャンブル依存症は、自分の意志だけではギャンブルをやめられない状態です。
                        以下のような症状がある場合は、専門家への相談をお勧めします。
                    </p>
                    <ul style={{ marginTop: '1rem', paddingLeft: '1.5rem' }}>
                        <li>ギャンブルのことが頭から離れない</li>
                        <li>負けを取り戻そうとして、さらに賭けてしまう</li>
                        <li>ギャンブルのために嘘をついたことがある</li>
                        <li>生活費や借金をしてまでギャンブルをしてしまう</li>
                        <li>ギャンブルが原因で人間関係に問題が生じている</li>
                        <li>やめようと思っても、やめられない</li>
                    </ul>
                </section>

                <section className="about-section" style={{ background: '#e3f2fd', padding: '1.5rem', borderRadius: '8px' }}>
                    <h2 style={{ color: '#1565c0' }}>相談窓口</h2>
                    <p style={{ marginBottom: '1.5rem' }}>
                        ギャンブルに関する悩みは、一人で抱え込まずに専門家に相談しましょう。
                    </p>

                    <div style={{ display: 'grid', gap: '1rem' }}>
                        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #1565c0' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>消費者ホットライン</h3>
                            <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1565c0', margin: '0.5rem 0' }}>
                                188（いやや）
                            </p>
                            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>
                                最寄りの消費生活センターにつながります
                            </p>
                        </div>

                        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #1565c0' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>依存症対策全国センター</h3>
                            <p style={{ fontSize: '0.9rem', color: '#666', margin: '0.5rem 0' }}>
                                <a href="https://www.ncasa-japan.jp/" target="_blank" rel="noopener noreferrer" style={{ color: '#1565c0' }}>
                                    https://www.ncasa-japan.jp/
                                </a>
                            </p>
                            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>
                                全国の相談窓口を検索できます
                            </p>
                        </div>

                        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #1565c0' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>ギャンブル依存症問題を考える会</h3>
                            <p style={{ fontSize: '0.9rem', color: '#666', margin: '0.5rem 0' }}>
                                <a href="https://scga.jp/" target="_blank" rel="noopener noreferrer" style={{ color: '#1565c0' }}>
                                    https://scga.jp/
                                </a>
                            </p>
                            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>
                                相談ダイヤル: 070-4501-9625（毎日10時〜22時）
                            </p>
                        </div>

                        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #1565c0' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>よりそいホットライン</h3>
                            <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1565c0', margin: '0.5rem 0' }}>
                                0120-279-338
                            </p>
                            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>
                                24時間対応・通話無料
                            </p>
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <h2>健全に楽しむための3つのルール</h2>
                    <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
                        <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', color: '#333' }}>1. 予算を決める</h3>
                            <p style={{ margin: 0, color: '#666' }}>
                                1日・1週間・1ヶ月の上限を決め、必ず守りましょう。
                                生活費には絶対に手を付けないでください。
                            </p>
                        </div>
                        <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', color: '#333' }}>2. 負けを追わない</h3>
                            <p style={{ margin: 0, color: '#666' }}>
                                負けた分を取り返そうとして追加で賭けるのは危険です。
                                予算を使い切ったら、その日は終わりにしましょう。
                            </p>
                        </div>
                        <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 0.5rem 0', color: '#333' }}>3. 休む日を作る</h3>
                            <p style={{ margin: 0, color: '#666' }}>
                                毎日ボートレースを見る必要はありません。
                                週に何日かは完全に離れる日を作りましょう。
                            </p>
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <h2>20歳未満の方へ</h2>
                    <p style={{ background: '#ffebee', padding: '1rem', borderRadius: '8px', color: '#c62828' }}>
                        <strong>20歳未満の方は舟券を購入できません。</strong><br />
                        法律により禁止されています。本サービスも20歳以上の方を対象としています。
                    </p>
                </section>

                <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                    <Link
                        to="/"
                        style={{
                            display: 'inline-block',
                            padding: '0.75rem 2rem',
                            background: '#0ea5e9',
                            color: 'white',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontWeight: 'bold'
                        }}
                    >
                        トップページに戻る
                    </Link>
                </div>
            </div>

            <footer className="footer" style={{ marginTop: '3rem', padding: '2rem', background: '#1e293b', color: '#94a3b8', textAlign: 'center' }}>
                <p>&copy; 2025 龍神レーダー - All Rights Reserved</p>
            </footer>
        </>
    );
}
