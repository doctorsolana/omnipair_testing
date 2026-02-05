import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConnector } from '@solana/connector'
import bs58 from 'bs58'
import { ConnectWallet } from './solana/ConnectWallet'
import { OMNIPAIR_PROGRAM_ID } from './omnipair'
import { useRpc } from './solana/useRpc'

type MarketItem = {
  symbol: string
  name: string
  price: string
  change: string
  trend: 'up' | 'down'
  sparkline: string
}

type AppTab = 'Pools' | 'Trade' | 'Lend' | 'Debug'

type ProgramAccountResult = {
  pubkey: string
}

type SignatureResult = {
  signature: string
  slot: number
  err: unknown
  blockTime: number | null
}

const PAIR_DISCRIMINATOR_B58 = bs58.encode(
  Uint8Array.from([85, 72, 49, 176, 182, 228, 141, 82]),
)

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
  const { rpcUrl } = useRpc()
  const [walletOpen, setWalletOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('Pools')
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugError, setDebugError] = useState<string | null>(null)
  const [poolAccounts, setPoolAccounts] = useState<ProgramAccountResult[]>([])
  const [recentSignatures, setRecentSignatures] = useState<SignatureResult[]>([])
  const [hasLoadedDebug, setHasLoadedDebug] = useState(false)

  const walletLabel = useMemo(() => {
    if (!isConnected || !account) return 'Connect Wallet'
    return `${account.slice(0, 4)}…${account.slice(-4)}`
  }, [account, isConnected])

  const rpcRequest = useCallback(
    async <T,>(method: string, params: unknown[] = []) => {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
      })

      if (!response.ok) throw new Error(`RPC request failed: ${response.status}`)
      const json = (await response.json()) as { result?: T; error?: { message?: string } }
      if (json.error) throw new Error(json.error.message || 'Unknown RPC error')
      if (json.result === undefined) throw new Error(`RPC returned no result for ${method}`)
      return json.result
    },
    [rpcUrl],
  )

  const loadDebugData = useCallback(async () => {
    setDebugLoading(true)
    setDebugError(null)
    try {
      const [accounts, signatures] = await Promise.all([
        rpcRequest<ProgramAccountResult[]>('getProgramAccounts', [
          OMNIPAIR_PROGRAM_ID,
          {
            encoding: 'base64',
            commitment: 'confirmed',
            filters: [{ memcmp: { offset: 0, bytes: PAIR_DISCRIMINATOR_B58 } }],
          },
        ]),
        rpcRequest<SignatureResult[]>('getSignaturesForAddress', [
          OMNIPAIR_PROGRAM_ID,
          { limit: 10, commitment: 'confirmed' },
        ]),
      ])

      setPoolAccounts(accounts)
      setRecentSignatures(signatures)
      setHasLoadedDebug(true)
    } catch (error) {
      setDebugError(error instanceof Error ? error.message : 'Unable to load debug data')
    } finally {
      setDebugLoading(false)
    }
  }, [rpcRequest])

  useEffect(() => {
    if (activeTab !== 'Debug') return
    if (hasLoadedDebug) return
    void loadDebugData()
  }, [activeTab, hasLoadedDebug, loadDebugData])

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
                {walletLabel}
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
            {(['Pools', 'Trade', 'Lend', 'Debug'] as AppTab[]).map((tab) => (
              <button
                key={tab}
                className={`tab-button ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === 'Pools' && (
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
          )}

          {(activeTab === 'Trade' || activeTab === 'Lend') && (
            <div className="tab-placeholder">
              <div className="tab-placeholder-title">{activeTab} panel</div>
              <p>{activeTab} actions will be wired to Omnipair instructions next.</p>
            </div>
          )}

          {activeTab === 'Debug' && (
            <div className="debug-panel">
              <div className="debug-top">
                <div>
                  <div className="debug-title">Program Debug</div>
                  <p>RPC: {rpcUrl}</p>
                </div>
                <button className="ghost-button" onClick={loadDebugData} disabled={debugLoading}>
                  {debugLoading ? 'Loading…' : 'Refresh Debug Data'}
                </button>
              </div>

              {debugError && <div className="status-block error">{debugError}</div>}

              <div className="debug-grid">
                <section className="debug-card">
                  <h3>Pool Accounts ({poolAccounts.length})</h3>
                  <div className="debug-list">
                    {poolAccounts.slice(0, 12).map((pool) => (
                      <code key={pool.pubkey}>{pool.pubkey}</code>
                    ))}
                    {!poolAccounts.length && <span>No pools found yet.</span>}
                  </div>
                </section>

                <section className="debug-card">
                  <h3>Recent Transactions</h3>
                  <div className="debug-list">
                    {recentSignatures.map((tx) => (
                      <div key={tx.signature} className="debug-tx">
                        <code>{tx.signature}</code>
                        <span>Slot {tx.slot}</span>
                        <span>{tx.err ? 'Error' : 'Success'}</span>
                      </div>
                    ))}
                    {!recentSignatures.length && <span>No transactions loaded yet.</span>}
                  </div>
                </section>
              </div>
            </div>
          )}

          <div className="market-footer">
            <button className="link-button">View All Markets →</button>
          </div>
        </section>

      </main>
    </div>
  )
}

export default App
