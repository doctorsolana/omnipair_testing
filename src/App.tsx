import { useMemo, useState } from 'react'
import { useConnector } from '@solana/connector'
import { ConnectWallet } from './solana/ConnectWallet'

type MarketItem = {
  symbol: string
  name: string
  price: string
  change: string
  trend: 'up' | 'down'
  sparkline: string
}

const MARKETS: MarketItem[] = [
  {
    symbol: 'BTC/USD',
    name: 'Bitcoin',
    price: '$56,342.12',
    change: '+3.15%',
    trend: 'up',
    sparkline: 'M2 32 Q14 20 24 24 T46 16 T70 18 T98 6',
  },
  {
    symbol: 'ETH/USD',
    name: 'Ethereum',
    price: '$3,192.78',
    change: '+2.75%',
    trend: 'up',
    sparkline: 'M2 30 Q16 26 26 28 T50 22 T74 26 T98 14',
  },
  {
    symbol: 'BNB/USD',
    name: 'Binance Coin',
    price: '$534.21',
    change: '-1.24%',
    trend: 'down',
    sparkline: 'M2 18 Q16 26 26 24 T50 30 T74 22 T98 28',
  },
  {
    symbol: 'SOL/USD',
    name: 'Solana',
    price: '$148.45',
    change: '+4.62%',
    trend: 'up',
    sparkline: 'M2 26 Q18 18 28 20 T54 14 T78 22 T98 10',
  },
]

function App() {
  const { account, isConnected } = useConnector()
  const [walletOpen, setWalletOpen] = useState(false)

  const walletLabel = useMemo(() => {
    if (!isConnected || !account) return 'Connect Wallet'
    return `${account.slice(0, 4)}…${account.slice(-4)}`
  }, [account, isConnected])

  return (
    <div className="page">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon" aria-hidden>
              ☁️
            </span>
            <span className="brand-name">SoftSite</span>
          </div>
          <div className="header-actions">
            <div className={`wallet-dropdown ${walletOpen ? 'open' : ''}`}>
              <button className="wallet-pill" onClick={() => setWalletOpen((v) => !v)}>
                {walletLabel} ▾
              </button>
              <div className="wallet-panel">
                <ConnectWallet />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="content">
        <section className="market-card">
          <div className="market-header">
            <span className="rule" />
            <div>
              <h2>Live Market</h2>
              <p>Top Crypto Pairs</p>
            </div>
            <span className="rule" />
          </div>

          <div className="market-tabs">
            {['All', 'Crypto', 'Forex', 'Stocks'].map((tab, index) => (
              <button key={tab} className={`tab-button ${index === 0 ? 'active' : ''}`}>
                {tab}
              </button>
            ))}
          </div>

          <div className="market-list">
            {MARKETS.map((market) => (
              <div key={market.symbol} className="market-row">
                <div className="market-identity">
                  <div className={`token-badge ${market.trend}`}>
                    {market.symbol.split('/')[0][0]}
                  </div>
                  <div>
                    <div className="market-symbol">{market.symbol}</div>
                    <div className="market-name">{market.name}</div>
                  </div>
                </div>
                <div className="market-price">
                  <span>{market.price}</span>
                  <small>{market.price}</small>
                </div>
                <div className={`market-change ${market.trend}`}>{market.change}</div>
                <div className={`market-sparkline ${market.trend}`}>
                  <svg viewBox="0 0 100 40" aria-hidden>
                    <path d={market.sparkline} fill="none" strokeWidth="3" />
                  </svg>
                </div>
              </div>
            ))}
          </div>

          <div className="market-footer">
            <button className="link-button">View All Markets →</button>
          </div>
        </section>

      </main>
    </div>
  )
}

export default App
