import { Link } from 'react-router-dom'
import type { PoolView } from '../../features/market/types'
import PoolLogo from '../common/PoolLogo'

type PoolsTabProps = {
  pools: PoolView[]
  poolsLoading: boolean
  poolsError: string | null
}

function PoolsTab({ pools, poolsLoading, poolsError }: PoolsTabProps) {
  return (
    <>
      <div className="pool-summary">
        <span>{pools.length} pools</span>
        <Link to="/pools/new" className="pool-create-btn">
          <span className="pool-create-icon">＋</span>
          New Pool
        </Link>
      </div>

      {poolsError && <div className="status-block error">{poolsError}</div>}

      {!poolsError && poolsLoading && !pools.length && (
        <div className="status-block">Loading Omnipair pools...</div>
      )}

      {!poolsError && !poolsLoading && pools.length === 0 && (
        <div className="status-block">No pools found for this program right now.</div>
      )}

      {!!pools.length && (
        <div className="market-list pools-list">
          {pools.map((pool) => (
            <Link
              key={pool.address}
              to={`/pools/${pool.address}`}
              className="market-row pool-row pool-row-link"
              title={`${pool.name} • ${pool.address}`}
            >
              <div className="pool-pair">
                <div className="pool-logo-stack">
                  <PoolLogo
                    className="pool-logo"
                    logoUrl={pool.token0LogoUrl}
                    fallback={pool.token0Ticker.slice(0, 1)}
                    alt={`${pool.token0Ticker} logo`}
                  />
                  <PoolLogo
                    className="pool-logo pool-logo-secondary"
                    logoUrl={pool.token1LogoUrl}
                    fallback={pool.token1Ticker.slice(0, 1)}
                    alt={`${pool.token1Ticker} logo`}
                  />
                </div>
                <div className="pool-pair-line">{pool.symbol}</div>
              </div>
              <div className="pool-price-line">
                <span className="pool-price-main">{pool.priceLabel}</span>
                <span className="pool-price-sub">{pool.priceSubLabel}</span>
              </div>
              <div className={`market-change ${pool.trend} pool-util-pill`}>Util {pool.utilizationLabel}</div>
              <span className="pool-pill pool-pill-inline">{pool.feeLabel}</span>
              <span
                className={`pool-pill pool-pill-inline ${
                  pool.statusLabel === 'Reduce-only' ? 'danger' : 'neutral'
                }`}
              >
                {pool.statusLabel}
              </span>
              <span className="pool-hint pool-hint-inline" title={pool.reserveTooltip}>
                {pool.reserveLabel}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

export default PoolsTab
