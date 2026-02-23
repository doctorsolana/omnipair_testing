import PoolSelect from '../common/PoolSelect'
import TokenSelect from '../common/TokenSelect'
import type {
  BorrowHealthSnapshot,
  PoolSelectOption,
  PoolView,
  TradeTokenOption,
} from '../../features/market/types'
import { formatCompact, toPercentLabel } from '../../features/market/utils'

type BorrowTabProps = {
  isWalletConnected: boolean
  pools: PoolView[]
  poolSelectOptions: PoolSelectOption[]
  borrowPool: string
  borrowAmount: string
  borrowToken: string
  borrowTokenOptions: TradeTokenOption[]
  collateralAmount: string
  collateralToken: string
  collateralTokenOptions: TradeTokenOption[]
  selectedBorrowPool: PoolView | null
  currentBorrowHealth: BorrowHealthSnapshot | null
  projectedBorrowHealth: BorrowHealthSnapshot | null
  estimatedCf0Bps: number
  estimatedCf1Bps: number
  collateralBalanceLabel: string
  borrowError: string | null
  borrowStatus: string | null
  borrowSubmitting: boolean
  setBorrowPool: (value: string) => void
  setBorrowAmount: (value: string) => void
  setBorrowToken: (value: string) => void
  setCollateralAmount: (value: string) => void
  setCollateralToken: (value: string) => void
  switchBorrowDirection: () => void
  executeBorrow: () => void
}

function BorrowTab({
  isWalletConnected,
  pools,
  poolSelectOptions,
  borrowPool,
  borrowAmount,
  borrowToken,
  borrowTokenOptions,
  collateralAmount,
  collateralToken,
  collateralTokenOptions,
  selectedBorrowPool,
  currentBorrowHealth,
  projectedBorrowHealth,
  estimatedCf0Bps,
  estimatedCf1Bps,
  collateralBalanceLabel,
  borrowError,
  borrowStatus,
  borrowSubmitting,
  setBorrowPool,
  setBorrowAmount,
  setBorrowToken,
  setCollateralAmount,
  setCollateralToken,
  switchBorrowDirection,
  executeBorrow,
}: BorrowTabProps) {
  const borrowTokenInfo = borrowTokenOptions.find((token) => token.mint === borrowToken) ?? null
  const collateralTokenInfo =
    collateralTokenOptions.find((token) => token.mint === collateralToken) ?? null
  const priceToken1PerToken0 = selectedBorrowPool?.price ?? NaN
  const borrowIsToken0 = selectedBorrowPool
    ? selectedBorrowPool.token0Mint === borrowToken
    : true
  const collateralIsToken0 = selectedBorrowPool
    ? selectedBorrowPool.token0Mint === collateralToken
    : false

  const token0ToBorrowToken = (amountToken0: number) => {
    if (!Number.isFinite(amountToken0) || amountToken0 <= 0) return 0
    if (borrowIsToken0) return amountToken0
    if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) return 0
    return amountToken0 * priceToken1PerToken0
  }

  const token0ToCollateralToken = (amountToken0: number) => {
    if (!Number.isFinite(amountToken0) || amountToken0 <= 0) return 0
    if (collateralIsToken0) return amountToken0
    if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) return 0
    return amountToken0 * priceToken1PerToken0
  }

  const currentBorrowLimit = token0ToBorrowToken(currentBorrowHealth?.maxBorrowValueToken0 ?? 0)
  const projectedBorrowLimit = token0ToBorrowToken(projectedBorrowHealth?.maxBorrowValueToken0 ?? 0)
  const projectedDebtValue = token0ToBorrowToken(projectedBorrowHealth?.debtValueToken0 ?? 0)
  const availableAfterBorrow = token0ToBorrowToken(projectedBorrowHealth?.availableBorrowValueToken0 ?? 0)

  const projectedBorrowShortfallToken0 = Math.max(
    0,
    (projectedBorrowHealth?.debtValueToken0 ?? 0) - (projectedBorrowHealth?.maxBorrowValueToken0 ?? 0),
  )
  const collateralCfRatio = Math.max(0, collateralIsToken0 ? estimatedCf0Bps : estimatedCf1Bps) / 10_000
  const additionalCollateralNeeded =
    projectedBorrowShortfallToken0 > 0 && collateralCfRatio > 0
      ? token0ToCollateralToken(projectedBorrowShortfallToken0 / collateralCfRatio)
      : 0

  const borrowAmountNumeric = Number(borrowAmount)
  const borrowAmountToken0 =
    Number.isFinite(borrowAmountNumeric) && borrowAmountNumeric > 0
      ? borrowIsToken0
        ? borrowAmountNumeric
        : Number.isFinite(priceToken1PerToken0) && priceToken1PerToken0 > 0
          ? borrowAmountNumeric / priceToken1PerToken0
          : 0
      : 0
  const borrowAmountValueInCollateral = token0ToCollateralToken(borrowAmountToken0)
  const hasPreviewInput = (Number(borrowAmount) > 0) || (Number(collateralAmount) > 0)

  const utilizationRaw = projectedBorrowHealth?.borrowUtilization ?? null
  const utilization = !isWalletConnected && !hasPreviewInput ? null : utilizationRaw
  const riskClass =
    utilization === null
      ? 'risk-low'
      : utilization < 0.5
        ? 'risk-low'
        : utilization < 0.75
          ? 'risk-moderate'
          : utilization < 0.92
            ? 'risk-high'
            : 'risk-critical'
  const riskLabel =
    !isWalletConnected && !hasPreviewInput
      ? 'Connect wallet'
      : utilization === null
      ? 'No debt'
      : utilization < 0.5
        ? 'Low'
        : utilization < 0.75
          ? 'Moderate'
          : utilization < 0.92
            ? 'High'
            : 'Critical'

  return (
    <div className="borrow-shell borrow-center">
      <section className="trade-card borrow-card">
        {!pools.length && <div className="status-block">Load pools to enable borrowing.</div>}

        <div className="trade-field">
          <label htmlFor="borrow-pool">Pool</label>
          <PoolSelect
            id="borrow-pool"
            value={borrowPool}
            options={poolSelectOptions}
            onChange={setBorrowPool}
            ariaLabel="Select pool"
            disabled={!pools.length}
          />
        </div>

        {selectedBorrowPool?.statusLabel === 'Reduce-only' && (
          <div className="status-block error">This pool is reduce-only. Borrowing is currently disabled.</div>
        )}

        <div className="trade-field">
          <label htmlFor="borrow-amount">I want to borrow</label>
          <div className="trade-input-wrap">
            <input
              id="borrow-amount"
              className="trade-input"
              value={borrowAmount}
              onChange={(event) => setBorrowAmount(event.target.value)}
              inputMode="decimal"
            />
            <TokenSelect
              value={borrowToken}
              options={borrowTokenOptions}
              onChange={setBorrowToken}
              ariaLabel="Select token to borrow"
              disabled={!borrowTokenOptions.length}
            />
          </div>
          {borrowAmountValueInCollateral > 0 && collateralTokenInfo?.ticker && (
            <span className="field-note">
              Approx value: {formatCompact(borrowAmountValueInCollateral, 4)} {collateralTokenInfo.ticker}
            </span>
          )}
        </div>

        <button
          type="button"
          className="trade-switch"
          onClick={switchBorrowDirection}
          aria-label="Switch borrow and collateral tokens"
          disabled={borrowTokenOptions.length < 2 || collateralTokenOptions.length < 2}
        >
          ↕
        </button>

        <div className="trade-field">
          <label htmlFor="borrow-collateral-amount">Collateral (isolated to this pool)</label>
          <div className="trade-input-wrap">
            <input
              id="borrow-collateral-amount"
              className="trade-input"
              value={collateralAmount}
              onChange={(event) => setCollateralAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0.0"
            />
            <TokenSelect
              value={collateralToken}
              options={collateralTokenOptions}
              onChange={setCollateralToken}
              ariaLabel="Select collateral token"
              disabled={!collateralTokenOptions.length}
            />
          </div>
          <span className="field-note">Wallet balance: {collateralBalanceLabel}</span>
        </div>

        <section className="borrow-risk-panel">
          {!isWalletConnected && (
            <div className="field-note">
              Wallet disconnected: risk is preview-only and does not include your current position.
              Connect wallet for real LTV and borrow limit.
            </div>
          )}

          <div className="risk-meter-wrap">
            <div className="risk-meter-head">
              <span>Borrow Risk (estimated)</span>
              <span>{riskLabel}</span>
            </div>
            <div className="risk-meter-track">
              <div
                className={`risk-meter-fill ${riskClass}`}
                style={{ width: `${Math.min(100, Math.max(0, (utilization ?? 0) * 100))}%` }}
              />
            </div>
            <span className="risk-meter-value">
              Utilization {toPercentLabel(utilization)} of borrow limit
            </span>
          </div>

          <div className="risk-grid">
            <article>
              <span>Current LTV</span>
              <strong>{toPercentLabel(currentBorrowHealth?.ltv ?? null)}</strong>
            </article>
            <article>
              <span>Projected LTV</span>
              <strong>{toPercentLabel(projectedBorrowHealth?.ltv ?? null)}</strong>
            </article>
            <article>
              <span>Current Borrow Limit</span>
              <strong>{formatCompact(currentBorrowLimit, 3)} {borrowTokenInfo?.ticker ?? ''}</strong>
            </article>
            <article>
              <span>Projected Borrow Limit</span>
              <strong>{formatCompact(projectedBorrowLimit, 3)} {borrowTokenInfo?.ticker ?? ''}</strong>
            </article>
            <article>
              <span>Projected Debt Value</span>
              <strong>{formatCompact(projectedDebtValue, 3)} {borrowTokenInfo?.ticker ?? ''}</strong>
            </article>
            <article>
              <span>Available After Borrow</span>
              <strong>{formatCompact(availableAfterBorrow, 3)} {borrowTokenInfo?.ticker ?? ''}</strong>
            </article>
          </div>

          <div className="risk-foot">
            <span>Est. CF {selectedBorrowPool?.token0Ticker}: {(estimatedCf0Bps / 100).toFixed(2)}%</span>
            <span>Est. CF {selectedBorrowPool?.token1Ticker}: {(estimatedCf1Bps / 100).toFixed(2)}%</span>
          </div>

          {additionalCollateralNeeded > 0 && collateralTokenInfo?.ticker && (
            <div className="field-note">
              Need about +{formatCompact(additionalCollateralNeeded, 4)} {collateralTokenInfo.ticker}{' '}
              collateral to clear this borrow at current CF.
            </div>
          )}
        </section>

        {borrowError && <div className="status-block error">{borrowError}</div>}
        {borrowStatus && <div className="status-block">{borrowStatus}</div>}

        <button
          type="button"
          className="trade-submit"
          onClick={executeBorrow}
          disabled={
            borrowSubmitting ||
            !borrowToken ||
            !borrowPool ||
            selectedBorrowPool?.statusLabel === 'Reduce-only'
          }
        >
          {borrowSubmitting ? 'Submitting…' : 'Borrow'}
        </button>
      </section>
    </div>
  )
}

export default BorrowTab
