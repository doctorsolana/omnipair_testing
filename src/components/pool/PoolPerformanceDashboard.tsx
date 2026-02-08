import { useEffect, useMemo, useState } from 'react'
import { fetchPoolPerformance, type PoolPerformanceStats } from '../../lib/indexerClient'
import { formatCompact, formatPercent, formatTokenAmount } from '../../lib/formatters'

type PoolPerformanceDashboardProps = {
  poolAddress: string
  token0Ticker: string
  token1Ticker: string
  utilizationPct: number
  windowHours: 24 | 168 | 720
  onWindowChange: (value: 24 | 168 | 720) => void
}

function formatChartPrice(value: number) {
  if (!Number.isFinite(value)) return '--'
  if (value >= 100) return value.toFixed(2)
  if (value >= 1) return value.toFixed(4)
  return value.toFixed(6)
}

function getTrendLabel(trend: 'up' | 'down' | 'flat') {
  if (trend === 'up') return 'Rising'
  if (trend === 'down') return 'Cooling'
  return 'Stable'
}

function buildChart(stats: PoolPerformanceStats) {
  if (stats.series.length < 2) return null

  const width = 820
  const height = 220
  const padding = { top: 12, right: 12, bottom: 24, left: 12 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  let min = Math.min(...stats.series.map((point) => point.value))
  let max = Math.max(...stats.series.map((point) => point.value))

  if (min === max) {
    const delta = min === 0 ? 1 : Math.abs(min) * 0.01
    min -= delta
    max += delta
  }

  const points = stats.series.map((point, index) => {
    const x = padding.left + (index / (stats.series.length - 1)) * innerWidth
    const y = padding.top + ((max - point.value) / (max - min)) * innerHeight
    return {
      ...point,
      x,
      y,
    }
  })

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  const floorY = padding.top + innerHeight
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)} ${floorY.toFixed(2)} L${points[0].x.toFixed(2)} ${floorY.toFixed(2)} Z`

  const middleIndex = Math.floor(points.length / 2)

  return {
    width,
    height,
    linePath,
    areaPath,
    latestPoint: points[points.length - 1],
    axis: {
      start: new Date(points[0].time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      mid: new Date(points[middleIndex].time).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
      end: new Date(points[points.length - 1].time).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    },
  }
}

function PoolPerformanceDashboard({
  poolAddress,
  token0Ticker,
  token1Ticker,
  utilizationPct,
  windowHours,
  onWindowChange,
}: PoolPerformanceDashboardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<PoolPerformanceStats | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [utilizationTrend, setUtilizationTrend] = useState<'up' | 'down' | 'flat'>('flat')

  useEffect(() => {
    if (!poolAddress) {
      setStats(null)
      setError('Missing pool address')
      return
    }

    const controller = new AbortController()
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetchPoolPerformance(poolAddress, windowHours, {
          signal: controller.signal,
          force: refreshTick > 0,
        })
        if (!mounted) return
        setStats(response)
      } catch (fetchError) {
        if (!mounted) return
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load performance metrics')
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

  useEffect(() => {
    const storageKey = `omni-utilization-${poolAddress}`
    const previousRaw = window.sessionStorage.getItem(storageKey)
    const previous = previousRaw ? Number(previousRaw) : Number.NaN

    if (Number.isFinite(previous)) {
      const delta = utilizationPct - previous
      if (delta > 0.25) {
        setUtilizationTrend('up')
      } else if (delta < -0.25) {
        setUtilizationTrend('down')
      } else {
        setUtilizationTrend('flat')
      }
    } else {
      setUtilizationTrend('flat')
    }

    window.sessionStorage.setItem(storageKey, String(utilizationPct))
  }, [poolAddress, utilizationPct])

  const chart = useMemo(() => {
    if (!stats) return null
    return buildChart(stats)
  }, [stats])

  const windowLabel = useMemo(() => {
    if (windowHours === 24) return '24h'
    if (windowHours === 168) return '7d'
    return '30d'
  }, [windowHours])

  return (
    <section className="analytics-panel performance-panel" aria-label="Pool performance dashboard">
      <div className="analytics-head">
        <div>
          <h3>Pool Performance</h3>
          <p>
            {windowLabel} window • {stats?.interval || 'Auto interval'}
          </p>
        </div>

        <div className="analytics-controls">
          <div className="analytics-segment" role="tablist" aria-label="Performance timeframe">
            <button
              type="button"
              role="tab"
              className={windowHours === 24 ? 'active' : ''}
              aria-selected={windowHours === 24}
              onClick={() => onWindowChange(24)}
            >
              24h
            </button>
            <button
              type="button"
              role="tab"
              className={windowHours === 168 ? 'active' : ''}
              aria-selected={windowHours === 168}
              onClick={() => onWindowChange(168)}
            >
              7d
            </button>
            <button
              type="button"
              role="tab"
              className={windowHours === 720 ? 'active' : ''}
              aria-selected={windowHours === 720}
              onClick={() => onWindowChange(720)}
            >
              30d
            </button>
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
      </div>

      {error && <div className="status-block error">{error}</div>}
      {!error && loading && !stats && <div className="status-block">Loading pool performance…</div>}
      {!error && !loading && stats && !chart && (
        <div className="status-block">Not enough price history points for this window.</div>
      )}

      {!error && stats && chart && (
        <div className="performance-chart-shell">
          <svg
            className="performance-chart"
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            aria-label="Pool performance price chart"
          >
            <defs>
              <linearGradient id="pool-performance-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(118, 172, 248, 0.34)" />
                <stop offset="100%" stopColor="rgba(118, 172, 248, 0.03)" />
              </linearGradient>
            </defs>
            <path d={chart.areaPath} className="performance-area" />
            <path d={chart.linePath} className="performance-line" />
            <circle
              className="performance-dot"
              cx={chart.latestPoint.x}
              cy={chart.latestPoint.y}
              r="3"
            />
          </svg>
          <div className="performance-axis">
            <span>{chart.axis.start}</span>
            <span>{chart.axis.mid}</span>
            <span>{chart.axis.end}</span>
          </div>
        </div>
      )}

      <div className="performance-rail">
        <article>
          <span>Latest Price</span>
          <strong>{stats?.latestPrice !== null && stats ? formatChartPrice(stats.latestPrice) : '--'}</strong>
          <small>{token1Ticker} per {token0Ticker}</small>
        </article>
        <article>
          <span>Volume</span>
          <strong>
            {stats
              ? `${formatCompact(stats.volume0, 2)} / ${formatCompact(stats.volume1, 2)}`
              : '--'}
          </strong>
          <small>
            {token0Ticker} / {token1Ticker}
          </small>
        </article>
        <article>
          <span>Fees</span>
          <strong>
            {stats ? `${formatTokenAmount(stats.fees0, token0Ticker)} • ${formatTokenAmount(stats.fees1, token1Ticker)}` : '--'}
          </strong>
          <small>Collected in window</small>
        </article>
        <article>
          <span>Utilization</span>
          <strong>{formatPercent(utilizationPct)}</strong>
          <small className={`trend-${utilizationTrend}`}>{getTrendLabel(utilizationTrend)}</small>
        </article>
        <article>
          <span>APR</span>
          <strong>{stats?.apr !== null && stats ? formatPercent(stats.apr, 2) : '--'}</strong>
          <small>Pool snapshot APR</small>
        </article>
        <article>
          <span>Window Change</span>
          <strong>
            {stats?.changePct !== null && stats ? `${stats.changePct >= 0 ? '+' : ''}${formatPercent(stats.changePct, 2)}` : '--'}
          </strong>
          <small>Price movement</small>
        </article>
      </div>
    </section>
  )
}

export default PoolPerformanceDashboard
