import { useMemo } from 'react'

const tips = [
  '1号艇の勝率は全国平均で約55%です',
  'モーター2連対率40%以上が狙い目です',
  '風速5m以上の日は外側が有利になります',
  'A1級選手は全体の20%しかいません',
  '展示航走で調子を最終確認しましょう',
  '複勝は的中率50%超えも可能です',
  '大村は1号艇勝率が全国最高（63%）です',
  'トリガミを避けるため購入額を調整しましょう'
]

const styles = {
  container: {
    padding: '3rem 2rem',
    textAlign: 'center',
    background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
    borderRadius: '12px',
    color: 'white',
    minHeight: '300px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center'
  },
  spinner: {
    border: '4px solid rgba(255,255,255,0.3)',
    borderTop: '4px solid white',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    animation: 'spin 1s linear infinite',
    marginBottom: '1.5rem'
  },
  title: {
    fontSize: '1.3rem',
    marginBottom: '1rem',
    color: 'white'
  },
  description: {
    fontSize: '0.95rem',
    marginBottom: '1rem',
    color: 'rgba(255,255,255,0.9)'
  },
  tipContainer: {
    marginTop: '1.5rem',
    padding: '1rem 1.5rem',
    background: 'rgba(255,255,255,0.2)',
    borderRadius: '8px',
    backdropFilter: 'blur(10px)',
    maxWidth: '400px'
  },
  tipText: {
    fontSize: '0.9rem',
    margin: 0,
    color: 'white'
  }
}

// CSS keyframesをhead に注入
const injectKeyframes = () => {
  if (typeof document !== 'undefined' && !document.getElementById('loading-screen-keyframes')) {
    const style = document.createElement('style')
    style.id = 'loading-screen-keyframes'
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `
    document.head.appendChild(style)
  }
}

export default function LoadingScreen({ title, description }) {
  // keyframesを注入
  injectKeyframes()

  // ランダムなTipを選択（再レンダリングで変わらないようにmemo化）
  const randomTip = useMemo(() => {
    return tips[Math.floor(Math.random() * tips.length)]
  }, [])

  return (
    <div style={styles.container}>
      <div style={styles.spinner}></div>
      <h3 style={styles.title}>{title || 'データを読み込み中...'}</h3>
      <p style={styles.description}>{description || 'しばらくお待ちください'}</p>
      <div style={styles.tipContainer}>
        <p style={styles.tipText}>💡 {randomTip}</p>
      </div>
    </div>
  )
}
