import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPairDecoder, type Pair, OMNIPAIR_PROGRAM_ID } from './omnipair'
import { useRpc } from './solana/useRpc'

type TokenInfo = {
  symbol: string
  name: string
}

type PoolDetailState = {
  address: string
  symbol: string
  name: string
  statusLabel: string
  feeLabel: string
  priceLabel: string
  priceSubLabel: string
  utilizationLabel: string
  reserveLabel: string
  reserveTooltip: string
  debtLabel: string
  token0Mint: string
  token1Mint: string
  token0Ticker: string
  token1Ticker: string
  token0Decimals: number
  token1Decimals: number
  rateModel: string
}

type AccountInfoResult = {
  value: {
    data: [string, string] | string
  } | null
}

const KNOWN_TOKENS: Record<string, TokenInfo> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Solana' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4J9sMZ5vZ6n9Y9w4tY9f: { symbol: 'USDT', name: 'Tether' },
  mSoLzYCxHdYgdzU9h5c5fW6jJ9ZgWfM8f8B6Vh9tzrV: { symbol: 'mSOL', name: 'Marinade SOL' },
  jupSoLaJ53Uo89f9Jg7p8hGQ4w2FJv8r1v9h7QpJUP: { symbol: 'JUP', name: 'Jupiter' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6rPggD4R4D9x7GfP: { symbol: 'BONK', name: 'Bonk' },
}

function shortAddress(value: string) {
  if (value.length < 12) return value
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function getTokenInfo(mint: string): TokenInfo {
  return KNOWN_TOKENS[mint] ?? { symbol: mint.slice(0, 4).toUpperCase(), name: shortAddress(mint) }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toDisplayNumber(amount: bigint, decimals: number) {
  return Number(amount) / 10 ** decimals
}

function formatCompact(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return '--'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits,
  }).format(value)
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '--'
  return `${value.toFixed(1)}%`
}

function toTicker(symbol: string) {
  const cleaned = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (cleaned.length >= 4) return cleaned.slice(0, 4)
  return symbol.slice(0, 4).toUpperCase()
}

function mapPairToDetail(address: string, pair: Pair): PoolDetailState {
  const token0 = getTokenInfo(pair.token0)
  const token1 = getTokenInfo(pair.token1)
  const token0Ticker = toTicker(token0.symbol)
  const token1Ticker = toTicker(token1.symbol)

  const reserve0 = toDisplayNumber(pair.reserve0, pair.token0Decimals)
  const reserve1 = toDisplayNumber(pair.reserve1, pair.token1Decimals)
  const debt0 = toDisplayNumber(pair.totalDebt0, pair.token0Decimals)
  const debt1 = toDisplayNumber(pair.totalDebt1, pair.token1Decimals)

  const utilization0 = reserve0 > 0 ? (debt0 / reserve0) * 100 : 0
  const utilization1 = reserve1 > 0 ? (debt1 / reserve1) * 100 : 0
  const utilization = Math.max(utilization0, utilization1)

  const price = reserve0 > 0 && reserve1 > 0 ? reserve1 / reserve0 : NaN
  const pricePrecision = !Number.isFinite(price) ? 0 : price >= 100 ? 2 : price >= 1 ? 3 : 5

  return {
    address,
    token0Mint: pair.token0,
    token1Mint: pair.token1,
    token0Ticker,
    token1Ticker,
    token0Decimals: pair.token0Decimals,
    token1Decimals: pair.token1Decimals,
    rateModel: pair.rateModel,
    symbol: `${token0Ticker}/${token1Ticker}`,
    name: `${token0.name} / ${token1.name}`,
    statusLabel: pair.reduceOnly ? 'Reduce-only' : 'Active',
    feeLabel: `${(pair.swapFeeBps / 100).toFixed(2)}% fee`,
    priceLabel: Number.isFinite(price) ? `${price.toFixed(pricePrecision)} ${token1Ticker}` : '--',
    priceSubLabel: `per ${token0Ticker}`,
    utilizationLabel: formatPercent(utilization),
    reserveLabel: `${formatCompact(reserve0)} ${token0Ticker} / ${formatCompact(
      reserve1,
    )} ${token1Ticker}`,
    reserveTooltip: `${formatCompact(reserve0)} ${token0Ticker} • ${formatCompact(
      reserve1,
    )} ${token1Ticker}`,
    debtLabel: `${formatCompact(debt0)} ${token0Ticker} / ${formatCompact(debt1)} ${token1Ticker}`,
  }
}

function PoolDetail() {
  const { address } = useParams<{ address: string }>()
  const { rpcUrl } = useRpc()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pair, setPair] = useState<Pair | null>(null)

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

  const loadPoolDetail = useCallback(async () => {
    if (!address) return
    setLoading(true)
    setError(null)

    try {
      const accountInfo = await rpcRequest<AccountInfoResult>('getAccountInfo', [
        address,
        { encoding: 'base64', commitment: 'confirmed' },
      ])

      if (!accountInfo.value) throw new Error('Pool account not found on-chain.')

      const encodedData = accountInfo.value.data
      const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData
      if (typeof base64Data !== 'string') throw new Error('Invalid account data encoding')

      const decoder = getPairDecoder()
      const decodedPair = decoder.decode(base64ToBytes(base64Data))
      setPair(decodedPair)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pool details')
    } finally {
      setLoading(false)
    }
  }, [address, rpcRequest])

  useEffect(() => {
    void loadPoolDetail()
  }, [loadPoolDetail])

  const detail = useMemo(() => {
    if (!pair || !address) return null
    return mapPairToDetail(address, pair)
  }, [address, pair])

  return (
    <main className="content">
      <section className="pool-detail-shell">
        <div className="pool-detail-header">
          <Link to="/" className="back-link">
            ← Back to Markets
          </Link>
          <span className="pool-program">Program {shortAddress(OMNIPAIR_PROGRAM_ID)}</span>
        </div>

        <div className="pool-detail-card">
          {!address && <div className="status-block error">Missing pool address.</div>}
          {loading && <div className="status-block">Loading pool details…</div>}
          {error && <div className="status-block error">{error}</div>}

          {detail && (
            <>
              <div className="pool-detail-top">
                <div className="pool-detail-title">
                  <div className="pool-detail-logos" aria-hidden>
                    <span className="pool-logo">{detail.token0Ticker.slice(0, 1)}</span>
                    <span className="pool-logo pool-logo-secondary">
                      {detail.token1Ticker.slice(0, 1)}
                    </span>
                  </div>
                  <div>
                    <h2>{detail.symbol}</h2>
                    <p>{detail.name}</p>
                  </div>
                </div>
                <div
                  className={`pool-pill ${
                    detail.statusLabel === 'Reduce-only' ? 'danger' : 'neutral'
                  }`}
                >
                  {detail.statusLabel}
                </div>
              </div>

              <div className="pool-detail-grid">
                <div className="pool-detail-item">
                  <span className="pool-detail-label">Price</span>
                  <span className="pool-detail-value">{detail.priceLabel}</span>
                  <span className="pool-detail-sub">{detail.priceSubLabel}</span>
                </div>
                <div className="pool-detail-item">
                  <span className="pool-detail-label">Utilization</span>
                  <span className="pool-detail-value">{detail.utilizationLabel}</span>
                  <span className="pool-detail-sub">max across reserves</span>
                </div>
                <div className="pool-detail-item">
                  <span className="pool-detail-label">Swap Fee</span>
                  <span className="pool-detail-value">{detail.feeLabel}</span>
                  <span className="pool-detail-sub">per swap</span>
                </div>
                <div className="pool-detail-item">
                  <span className="pool-detail-label">Reserves</span>
                  <span className="pool-detail-value">{detail.reserveLabel}</span>
                  <span className="pool-detail-sub">{detail.reserveTooltip}</span>
                </div>
                <div className="pool-detail-item">
                  <span className="pool-detail-label">Debt</span>
                  <span className="pool-detail-value">{detail.debtLabel}</span>
                  <span className="pool-detail-sub">borrowed in pool</span>
                </div>
                <div className="pool-detail-item">
                  <span className="pool-detail-label">Rate Model</span>
                  <span className="pool-detail-value">{shortAddress(detail.rateModel)}</span>
                  <span className="pool-detail-sub">utilization curve</span>
                </div>
              </div>

              <div className="pool-detail-meta">
                <div>
                  <span>Pool Address</span>
                  <code>{detail.address}</code>
                </div>
                <div>
                  <span>{detail.token0Ticker} Mint</span>
                  <code>{detail.token0Mint}</code>
                </div>
                <div>
                  <span>{detail.token1Ticker} Mint</span>
                  <code>{detail.token1Mint}</code>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

export default PoolDetail
