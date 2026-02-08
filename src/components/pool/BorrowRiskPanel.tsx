import { useEffect, useMemo, useState } from 'react'
import { fetchPoolRisk, type BorrowRiskSnapshot } from '../../lib/indexerClient'
import { formatIsoDateTime, formatPercent } from '../../lib/formatters'

type BorrowRiskPanelProps = {
  poolAddress: string
  walletAddress?: string
  token0Ticker: string
  token1Ticker: string
}

function BorrowRiskPanel({ poolAddress, walletAddress, token0Ticker, token1Ticker }: BorrowRiskPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [risk, setRisk] = useState<BorrowRiskSnapshot | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!poolAddress) return

    const controller = new AbortController()
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const snapshot = await fetchPoolRisk(poolAddress, walletAddress, {
          signal: controller.signal,
          force: refreshTick > 0,
        })
        if (!mounted) return
        setRisk(snapshot)
      } catch (fetchError) {
        if (!mounted) return
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load pool risk')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [poolAddress, refreshTick, walletAddress])

  const meterStyle = useMemo(() => {
    const value = risk?.riskScore ?? 0
    return {
      width: `${Math.max(4, Math.min(100, value))}%`,
    }
  }, [risk?.riskScore])

  return (
    <section className="analytics-panel risk-panel" aria-label="Borrow risk panel">
      <div className="analytics-head">
        <div>
          <h3>Borrow Risk</h3>
          <p>{risk?.scopeLabel || (walletAddress ? 'Pool + Wallet Events' : 'Pool Snapshot')}</p>
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
      {!error && loading && !risk && <div className="status-block">Loading risk model…</div>}

      {!error && risk && (
        <>
          <div className="risk-meter-wrap">
            <div className="risk-meter-head">
              <span>Risk Meter</span>
              <strong>{risk.riskLabel}</strong>
            </div>
            <div className="risk-meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(risk.riskScore)}>
              <div className={`risk-meter-fill risk-${risk.riskLabel.toLowerCase()}`} style={meterStyle} />
            </div>
            <div className="risk-meter-value">{risk.riskScore.toFixed(1)} / 100</div>
          </div>

          <div className="risk-grid">
            <article>
              <span>Implied Borrow Pressure</span>
              <strong>{formatPercent(risk.borrowPressurePct, 2)}</strong>
            </article>
            <article>
              <span>Utilization Stress</span>
              <strong>{formatPercent(risk.utilizationPct, 2)}</strong>
            </article>
            <article>
              <span>Debt Concentration</span>
              <strong>{formatPercent(risk.debtSkewPct, 2)}</strong>
            </article>
            <article>
              <span>Positions Tracked</span>
              <strong>{risk.positionCount}</strong>
            </article>
          </div>

          <div className="risk-mix-grid">
            <div>
              <h4>Collateral Mix</h4>
              <p>
                {token0Ticker}: {formatPercent(risk.collateralMixToken0Pct, 1)}
              </p>
              <p>
                {token1Ticker}: {formatPercent(risk.collateralMixToken1Pct, 1)}
              </p>
            </div>
            <div>
              <h4>Debt Mix</h4>
              <p>
                {token0Ticker}: {formatPercent(risk.debtMixToken0Pct, 1)}
              </p>
              <p>
                {token1Ticker}: {formatPercent(risk.debtMixToken1Pct, 1)}
              </p>
            </div>
          </div>

          <div className="risk-foot">
            <span>Event momentum {formatPercent(risk.eventMomentum, 1)}</span>
            <span>{risk.lastEventAt ? `Last lending event ${formatIsoDateTime(risk.lastEventAt)}` : 'No lending events in scope'}</span>
          </div>
        </>
      )}
    </section>
  )
}

export default BorrowRiskPanel
