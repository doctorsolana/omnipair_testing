import { useEffect, useMemo, useState } from 'react'
import { fetchSwapTape, type SwapTapeItem } from '../../lib/indexerClient'
import { formatCompact, formatIsoDateTime, shortAddress } from '../../lib/formatters'

type SwapTapeProps = {
  poolAddress: string
  token0Ticker: string
  token1Ticker: string
  windowHours: 24 | 168 | 720
}

function sideLabel(item: SwapTapeItem, token0Ticker: string, token1Ticker: string) {
  return item.isToken0In ? `${token0Ticker} → ${token1Ticker}` : `${token1Ticker} → ${token0Ticker}`
}

function SwapTape({ poolAddress, token0Ticker, token1Ticker, windowHours }: SwapTapeProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [swaps, setSwaps] = useState<SwapTapeItem[]>([])
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!poolAddress) return

    const controller = new AbortController()
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const rows = await fetchSwapTape(poolAddress, {
          signal: controller.signal,
          force: refreshTick > 0,
        })

        if (!mounted) return
        setSwaps(rows)
      } catch (fetchError) {
        if (!mounted) return
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load recent swaps')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [poolAddress, refreshTick, windowHours])

  const hasRows = useMemo(() => swaps.length > 0, [swaps.length])

  return (
    <section className="analytics-panel swap-tape-panel" aria-label="Recent swap tape">
      <div className="analytics-head">
        <div>
          <h3>Swap Tape</h3>
          <p>Recent fills for this pool (mount + manual refresh only)</p>
        </div>
        <button
          type="button"
          className="analytics-refresh"
          onClick={() => setRefreshTick((current) => current + 1)}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="status-block error">{error}</div>}
      {!error && loading && !hasRows && <div className="status-block">Loading swaps…</div>}
      {!error && !loading && !hasRows && <div className="status-block">No swaps found for this pool.</div>}

      {hasRows && (
        <div className="swap-tape-list">
          {swaps.map((item) => (
            <article key={item.id} className="swap-tape-row">
              <div className="swap-main">
                <strong>{sideLabel(item, token0Ticker, token1Ticker)}</strong>
                <span>{formatIsoDateTime(item.timestamp)}</span>
              </div>
              <div className="swap-meta">
                <span>
                  {formatCompact(item.amountIn, 2)} in / {formatCompact(item.amountOut, 2)} out
                </span>
                <span>Px {item.impliedPrice ? item.impliedPrice.toFixed(6) : '--'}</span>
                <span className={`size-tier size-${item.sizeTier.toLowerCase()}`}>{item.sizeTier}</span>
                <span className={`speed-tier speed-${item.speedTier.toLowerCase()}`}>{item.speedTier}</span>
                <code title={item.txSignature}>{shortAddress(item.txSignature || 'unknown')}</code>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default SwapTape
