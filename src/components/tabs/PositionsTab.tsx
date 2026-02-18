import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TokenSelect from '../common/TokenSelect'
import PositionJournal from '../positions/PositionJournal'
import type { LoanPositionView, LpPositionView, TradeTokenOption } from '../../features/market/types'
import { formatCompact, getTokenColor, shortAddress } from '../../features/market/utils'
import { formatActionError } from '../../lib/simulationError'

type PositionsTabProps = {
  isConnected: boolean
  account: string | null
  positionsLoading: boolean
  positionsError: string | null
  lpPositions: LpPositionView[]
  loanPositions: LoanPositionView[]
  poolSymbolsByAddress: Record<string, string>
  onRepayLoan: (poolAddress: string, reserveTokenMint: string, amountInput: string) => Promise<string>
}

function toInputAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return ''
  return value.toFixed(9).replace(/\.?0+$/, '')
}

function LoanPositionCard({
  position,
  onRepayLoan,
}: {
  position: LoanPositionView
  onRepayLoan: (poolAddress: string, reserveTokenMint: string, amountInput: string) => Promise<string>
}) {
  const repayTokenOptions = useMemo<TradeTokenOption[]>(() => {
    const options: TradeTokenOption[] = []

    if (position.debt0 > 0) {
      options.push({
        mint: position.token0Mint,
        ticker: position.token0Ticker,
        name: position.token0Ticker,
        logo: position.token0Ticker.slice(0, 1),
        color: getTokenColor(position.token0Mint),
        logoUrl: position.token0LogoUrl,
      })
    }

    if (position.debt1 > 0) {
      options.push({
        mint: position.token1Mint,
        ticker: position.token1Ticker,
        name: position.token1Ticker,
        logo: position.token1Ticker.slice(0, 1),
        color: getTokenColor(position.token1Mint),
        logoUrl: position.token1LogoUrl,
      })
    }

    if (!options.length) {
      options.push({
        mint: position.token0Mint,
        ticker: position.token0Ticker,
        name: position.token0Ticker,
        logo: position.token0Ticker.slice(0, 1),
        color: getTokenColor(position.token0Mint),
        logoUrl: position.token0LogoUrl,
      })
    }

    return options
  }, [
    position.debt0,
    position.debt1,
    position.token0LogoUrl,
    position.token0Mint,
    position.token0Ticker,
    position.token1LogoUrl,
    position.token1Mint,
    position.token1Ticker,
  ])

  const [repayToken, setRepayToken] = useState(repayTokenOptions[0]?.mint ?? '')
  const [repayAmount, setRepayAmount] = useState('')
  const [repaySubmitting, setRepaySubmitting] = useState(false)
  const [repayError, setRepayError] = useState<string | null>(null)
  const [repayStatus, setRepayStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!repayTokenOptions.length) {
      setRepayToken('')
      return
    }
    if (!repayTokenOptions.some((token) => token.mint === repayToken)) {
      setRepayToken(repayTokenOptions[0].mint)
    }
  }, [repayToken, repayTokenOptions])

  const selectedRepayDebt =
    repayToken === position.token0Mint
      ? position.debt0
      : repayToken === position.token1Mint
        ? position.debt1
        : 0
  const selectedRepayTicker =
    repayToken === position.token0Mint
      ? position.token0Ticker
      : repayToken === position.token1Mint
        ? position.token1Ticker
        : ''
  const hasDebt = position.debt0 > 0 || position.debt1 > 0

  const submitRepay = async () => {
    setRepayError(null)
    setRepayStatus(null)

    if (!hasDebt) {
      setRepayError('No debt to repay in this position.')
      return
    }

    if (!repayToken) {
      setRepayError('Select a token to repay.')
      return
    }

    if (!repayAmount.trim()) {
      setRepayError('Enter amount to repay.')
      return
    }

    setRepaySubmitting(true)
    try {
      const signature = await onRepayLoan(position.poolAddress, repayToken, repayAmount)
      setRepayAmount('')
      setRepayStatus(`Repay submitted: ${shortAddress(signature)}`)
    } catch (error) {
      setRepayError(formatActionError(error, 'Repay failed'))
    } finally {
      setRepaySubmitting(false)
    }
  }

  return (
    <article className="positions-item positions-item-loan positions-loan-card">
      <div className="positions-loan-top">
        <span className="positions-pool">{position.symbol}</span>
        <Link to={`/pools/${position.poolAddress}`} className="positions-open-link">
          Open Pool
        </Link>
      </div>

      <span className="positions-value">
        Debt {formatCompact(position.debt0, 2)} {position.token0Ticker} / {formatCompact(position.debt1, 2)}{' '}
        {position.token1Ticker}
      </span>
      <span className="positions-meta">
        Collateral {formatCompact(position.collateral0, 2)} {position.token0Ticker} /{' '}
        {formatCompact(position.collateral1, 2)} {position.token1Ticker}
      </span>
      <span className="positions-meta">
        Min CF {position.cf0 ? `${(position.cf0 / 100).toFixed(2)}%` : '--'} /{' '}
        {position.cf1 ? `${(position.cf1 / 100).toFixed(2)}%` : '--'}
      </span>

      <div className="positions-manage">
        <div className="positions-manage-head">
          <strong>Manage position</strong>
          <span>
            Repayable {formatCompact(selectedRepayDebt, 4)} {selectedRepayTicker}
          </span>
        </div>
        <div className="positions-manage-row">
          <input
            className="positions-manage-input"
            value={repayAmount}
            onChange={(event) => setRepayAmount(event.target.value)}
            inputMode="decimal"
            placeholder="Repay amount"
            aria-label="Repay amount"
            disabled={repaySubmitting || !hasDebt}
          />
          <TokenSelect
            value={repayToken}
            options={repayTokenOptions}
            onChange={setRepayToken}
            ariaLabel="Repay token"
            disabled={repaySubmitting || !hasDebt}
          />
          <button
            type="button"
            className="positions-inline-button"
            onClick={() => setRepayAmount(toInputAmount(selectedRepayDebt))}
            disabled={repaySubmitting || !hasDebt || selectedRepayDebt <= 0}
          >
            Max
          </button>
          <button
            type="button"
            className="positions-inline-button positions-inline-button-primary"
            onClick={() => {
              void submitRepay()
            }}
            disabled={repaySubmitting || !hasDebt}
          >
            {repaySubmitting ? 'Repaying…' : 'Repay'}
          </button>
        </div>
        {repayError && <div className="status-block error">{repayError}</div>}
        {repayStatus && <div className="status-block">{repayStatus}</div>}
      </div>
    </article>
  )
}

function PositionsTab({
  isConnected,
  account,
  positionsLoading,
  positionsError,
  lpPositions,
  loanPositions,
  poolSymbolsByAddress,
  onRepayLoan,
}: PositionsTabProps) {
  return (
    <div className="borrow-shell">
      {!isConnected && <div className="status-block">Connect wallet to view your positions.</div>}
      {positionsLoading && isConnected && <div className="status-block">Loading positions…</div>}
      {positionsError && <div className="status-block error">{positionsError}</div>}

      {isConnected && !positionsLoading && !positionsError && (
        <div className="positions-layout">
          <section className="positions-section">
            <header className="positions-head">
              <h3>LP Positions</h3>
              <span>{lpPositions.length}</span>
            </header>
            {!lpPositions.length && <div className="status-block">No LP positions found.</div>}
            {!!lpPositions.length && (
              <div className="positions-list">
                {lpPositions.map((position) => (
                  <Link
                    key={position.poolAddress}
                    to={`/pools/${position.poolAddress}`}
                    className="positions-item"
                  >
                    <span className="positions-pool">{position.symbol}</span>
                    <span className="positions-value">{position.lpBalanceLabel} LP</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="positions-section">
            <header className="positions-head">
              <h3>Loan Positions</h3>
              <span>{loanPositions.length}</span>
            </header>
            {!loanPositions.length && <div className="status-block">No open loan positions found.</div>}
            {!!loanPositions.length && (
              <div className="positions-list">
                {loanPositions.map((position) => (
                  <LoanPositionCard
                    key={position.poolAddress}
                    position={position}
                    onRepayLoan={onRepayLoan}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <PositionJournal
        isConnected={isConnected}
        walletAddress={account ?? undefined}
        poolSymbols={poolSymbolsByAddress}
      />
    </div>
  )
}

export default PositionsTab
