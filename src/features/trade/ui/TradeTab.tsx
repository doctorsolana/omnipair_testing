import { useEffect, useMemo, useState } from 'react'
import PoolSelect from '@/shared/ui/PoolSelect'
import TokenSelect from '@/shared/ui/TokenSelect'
import type { PoolSelectOption, TradeTokenOption } from '@/features/market/types'
import { formatCompact, toPercentLabel } from '@/features/market/utils'
import { useWalletPanel } from '@/integrations/wallet/WalletPanelContext'

type LeverageStepItem = {
  step: number
  borrowAmount: number
  borrowTicker: string
  swapInAmount: number
  swapInTicker: string
  swapOutAmount: number
  swapOutTicker: string
  collateralAmount: number
  collateralTicker: string
}

type LeverageInstructionRow = {
  index: number
  title: string
  detail: string
}

function parseDecimalInput(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized.length) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function toInputAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return ''
  return value.toFixed(6).replace(/\.?0+$/, '')
}

type TradeTabProps = {
  isWalletConnected: boolean
  poolSelectOptions: PoolSelectOption[]
  tradePool: string
  tradeTokenOptions: TradeTokenOption[]
  tradeFromAmount: string
  tradeToAmount: string
  tradeFromToken: string
  tradeToToken: string
  tradeError: string | null
  tradeStatus: string | null
  tradeSubmitting: boolean
  tradeMode: 'swap' | 'leverage'
  leverageDirection: 'long' | 'short'
  leverageAssetToken: string
  leverageStartCollateralToken: string
  leverageInitialCollateral: string
  targetLeverage: number
  leverageAssetTicker: string
  leverageBorrowTicker: string
  leverageLoopCollateralTicker: string
  leverageCurrentLtv: number | null
  leverageProjectedLtv: number | null
  leverageCurrentUtilization: number | null
  leverageProjectedUtilization: number | null
  leverageTargetUtilization: number
  leverageSeedUsesSwap: boolean
  leverageSeedSwapInAmount: number
  leverageSeedSwapOutAmount: number
  leverageSeedCollateralAmount: number
  leverageAchievedMultiple: number
  leverageMaxOneTxMultiple: number
  leverageMaxByRiskCapMultiple: number | null
  leverageMaxByBorrowLimitMultiple: number | null
  leverageLiquidationPriceInBorrowToken: number | null
  leverageCurrentAssetPriceInBorrowToken: number | null
  leverageLiquidationDistance: number | null
  leverageEstimatedAssetDeltaAmount: number
  leverageTargetReached: boolean
  leverageSafetyBuffer: number | null
  leverageInputCollateralValueToken0: number
  leveragePlanBlockedReason: string | null
  leverageLoopCap: number
  leverageIsPlanSafe: boolean
  leverageSteps: LeverageStepItem[]
  leverageError: string | null
  leverageStatus: string | null
  leverageSubmitting: boolean
  setTradePool: (value: string) => void
  setTradeMode: (value: 'swap' | 'leverage') => void
  setTradeFromAmount: (value: string) => void
  setTradeToAmount: (value: string) => void
  setTradeFromToken: (value: string) => void
  setTradeToToken: (value: string) => void
  setLeverageDirection: (value: 'long' | 'short') => void
  setLeverageAssetToken: (value: string) => void
  setLeverageStartCollateralToken: (value: string) => void
  setLeverageInitialCollateral: (value: string) => void
  setTargetLeverage: (value: number) => void
  switchTradeDirection: () => void
  executeTrade: () => void
  executeLeverage: () => void
}

function TradeTab({
  isWalletConnected,
  poolSelectOptions,
  tradePool,
  tradeTokenOptions,
  tradeFromAmount,
  tradeToAmount,
  tradeFromToken,
  tradeToToken,
  tradeError,
  tradeStatus,
  tradeSubmitting,
  tradeMode,
  leverageDirection,
  leverageAssetToken,
  leverageStartCollateralToken,
  leverageInitialCollateral,
  targetLeverage,
  leverageAssetTicker,
  leverageBorrowTicker,
  leverageLoopCollateralTicker,
  leverageCurrentLtv,
  leverageProjectedLtv,
  leverageCurrentUtilization,
  leverageProjectedUtilization,
  leverageTargetUtilization,
  leverageSeedUsesSwap,
  leverageSeedSwapInAmount,
  leverageSeedSwapOutAmount,
  leverageSeedCollateralAmount,
  leverageAchievedMultiple,
  leverageMaxOneTxMultiple,
  leverageMaxByRiskCapMultiple,
  leverageMaxByBorrowLimitMultiple,
  leverageLiquidationPriceInBorrowToken,
  leverageCurrentAssetPriceInBorrowToken,
  leverageLiquidationDistance,
  leverageEstimatedAssetDeltaAmount,
  leverageTargetReached,
  leverageSafetyBuffer,
  leverageInputCollateralValueToken0,
  leveragePlanBlockedReason,
  leverageLoopCap,
  leverageIsPlanSafe,
  leverageSteps,
  leverageError,
  leverageStatus,
  leverageSubmitting,
  setTradePool,
  setTradeMode,
  setTradeFromAmount,
  setTradeToAmount,
  setTradeFromToken,
  setTradeToToken,
  setLeverageDirection,
  setLeverageAssetToken,
  setLeverageStartCollateralToken,
  setLeverageInitialCollateral,
  setTargetLeverage,
  switchTradeDirection,
  executeTrade,
  executeLeverage,
}: TradeTabProps) {
  const { openWalletPanel } = useWalletPanel()
  const [desiredExposureInput, setDesiredExposureInput] = useState('')
  const [isExposureEditing, setIsExposureEditing] = useState(false)

  const leverageStartCollateralTicker =
    tradeTokenOptions.find((token) => token.mint === leverageStartCollateralToken)?.ticker ?? ''
  const safetyHeadroom =
    leverageProjectedUtilization === null ? null : Math.max(0, 1 - leverageProjectedUtilization)
  const hasExistingPoolLoan =
    (leverageCurrentLtv !== null && leverageCurrentLtv > 0) ||
    (leverageCurrentUtilization !== null && leverageCurrentUtilization > 0)
  const isExistingLoanOverLimit =
    leverageCurrentUtilization !== null && Number.isFinite(leverageCurrentUtilization)
      ? leverageCurrentUtilization > 1
      : false
  const initialCollateralValue = parseDecimalInput(leverageInitialCollateral) ?? 0
  const hasInitialCollateral = Number.isFinite(initialCollateralValue) && initialCollateralValue > 0
  const leverageExposurePerCollateral = useMemo(() => {
    if (!hasInitialCollateral) return 0
    if (!Number.isFinite(leverageEstimatedAssetDeltaAmount) || leverageEstimatedAssetDeltaAmount <= 0) return 0
    return leverageEstimatedAssetDeltaAmount / initialCollateralValue
  }, [hasInitialCollateral, initialCollateralValue, leverageEstimatedAssetDeltaAmount])
  const leverageTargetMax = useMemo(() => {
    if (!hasInitialCollateral) return 5
    if (!Number.isFinite(leverageMaxOneTxMultiple) || leverageMaxOneTxMultiple <= 1) return 1
    return Math.max(1, Math.min(5, leverageMaxOneTxMultiple))
  }, [hasInitialCollateral, leverageMaxOneTxMultiple])
  const assetPriceLabel =
    leverageBorrowTicker && leverageAssetTicker
      ? `${leverageBorrowTicker} per ${leverageAssetTicker}`
      : ''
  const leverageInstructionRows: LeverageInstructionRow[] = []
  let instructionIndex = 1

  if (leverageSeedUsesSwap && leverageSeedSwapInAmount > 0) {
    leverageInstructionRows.push({
      index: instructionIndex,
      title: 'Seed swap',
      detail: `Swap ${formatCompact(leverageSeedSwapInAmount, 4)} ${leverageStartCollateralTicker} -> ${formatCompact(leverageSeedSwapOutAmount, 4)} ${leverageLoopCollateralTicker} (est).`,
    })
    instructionIndex += 1
    leverageInstructionRows.push({
      index: instructionIndex,
      title: 'Seed collateral',
      detail: `Add ${formatCompact(leverageSeedCollateralAmount, 4)} ${leverageLoopCollateralTicker} as collateral.`,
    })
    instructionIndex += 1
  } else if (hasInitialCollateral && leverageStartCollateralTicker) {
    leverageInstructionRows.push({
      index: instructionIndex,
      title: 'Seed collateral',
      detail: `Add ${formatCompact(initialCollateralValue, 4)} ${leverageStartCollateralTicker} as collateral.`,
    })
    instructionIndex += 1
  }

  leverageSteps.forEach((step) => {
    leverageInstructionRows.push({
      index: instructionIndex,
      title: `Loop ${step.step} - Borrow`,
      detail: `Borrow ${formatCompact(step.borrowAmount, 4)} ${step.borrowTicker}.`,
    })
    instructionIndex += 1
    leverageInstructionRows.push({
      index: instructionIndex,
      title: `Loop ${step.step} - Swap`,
      detail: `Swap ${formatCompact(step.swapInAmount, 4)} ${step.swapInTicker} -> ${formatCompact(step.swapOutAmount, 4)} ${step.swapOutTicker} (est).`,
    })
    instructionIndex += 1
    leverageInstructionRows.push({
      index: instructionIndex,
      title: `Loop ${step.step} - Add collateral`,
      detail: `Add ${formatCompact(step.collateralAmount, 4)} ${step.collateralTicker}.`,
    })
    instructionIndex += 1
  })

  const swapActionDisabled =
    tradeSubmitting || (isWalletConnected && (!poolSelectOptions.length || !tradeFromToken || !tradeToToken))
  const leverageDisabledReason = isWalletConnected
    ? !poolSelectOptions.length
      ? 'Load pools first to run leverage.'
      : !leverageAssetToken || !leverageStartCollateralToken
        ? 'Select both exposure token and collateral token.'
        : !leverageSteps.length
          ? leveragePlanBlockedReason ?? 'No executable loops from current collateral/risk limits.'
          : !leverageIsPlanSafe
            ? 'Plan is too close to liquidation. Lower target leverage or add collateral.'
            : !leverageTargetReached
              ? leveragePlanBlockedReason ?? 'Target leverage is not reachable in one transaction.'
              : null
    : null
  const leverageActionDisabled = leverageSubmitting || Boolean(isWalletConnected && leverageDisabledReason)

  const handleSwapClick = () => {
    if (!isWalletConnected) {
      openWalletPanel()
      return
    }
    executeTrade()
  }

  const handleLeverageClick = () => {
    if (!isWalletConnected) {
      openWalletPanel()
      return
    }
    executeLeverage()
  }

  useEffect(() => {
    if (tradeMode !== 'leverage') {
      setDesiredExposureInput('')
      setIsExposureEditing(false)
      return
    }

    if (isExposureEditing) return

    if (leverageEstimatedAssetDeltaAmount > 0) {
      setDesiredExposureInput(toInputAmount(leverageEstimatedAssetDeltaAmount))
      return
    }
    setDesiredExposureInput('')
  }, [isExposureEditing, leverageEstimatedAssetDeltaAmount, tradeMode])

  useEffect(() => {
    setIsExposureEditing(false)
  }, [leverageAssetToken, leverageDirection, leverageStartCollateralToken, tradePool])

  useEffect(() => {
    if (targetLeverage > leverageTargetMax + 0.0001) {
      setTargetLeverage(leverageTargetMax)
    }
  }, [leverageTargetMax, setTargetLeverage, targetLeverage])

  const handleDesiredExposureChange = (nextValue: string) => {
    setDesiredExposureInput(nextValue)
    setIsExposureEditing(true)

    const parsedExposure = parseDecimalInput(nextValue)
    if (!parsedExposure || parsedExposure <= 0) return
    if (!Number.isFinite(leverageExposurePerCollateral) || leverageExposurePerCollateral <= 0) return

    const requiredCollateral = parsedExposure / leverageExposurePerCollateral
    if (!Number.isFinite(requiredCollateral) || requiredCollateral <= 0) return
    setLeverageInitialCollateral(toInputAmount(requiredCollateral))
  }

  return (
    <div className="trade-shell">
      <section className="trade-card">
        {!poolSelectOptions.length && <div className="status-block">Load pools first to enable trading.</div>}

        <div className="trade-field">
          <label htmlFor="trade-pool">Pool</label>
          <PoolSelect
            id="trade-pool"
            value={tradePool}
            options={poolSelectOptions}
            onChange={setTradePool}
            ariaLabel="Select pool"
            disabled={!poolSelectOptions.length}
          />
        </div>

        <div className="borrow-toggle">
          <button
            type="button"
            className={`borrow-toggle-btn ${tradeMode === 'swap' ? 'active' : ''}`}
            onClick={() => setTradeMode('swap')}
          >
            Normal Swap
          </button>
          <button
            type="button"
            className={`borrow-toggle-btn ${tradeMode === 'leverage' ? 'active' : ''}`}
            onClick={() => setTradeMode('leverage')}
          >
            Leverage Loop
          </button>
        </div>

        {tradeMode === 'swap' && (
          <>
            <div className="trade-field">
              <label htmlFor="trade-from-amount">From</label>
              <div className="trade-input-wrap">
                <input
                  id="trade-from-amount"
                  className="trade-input"
                  value={tradeFromAmount}
                  onChange={(event) => setTradeFromAmount(event.target.value)}
                  inputMode="decimal"
                />
                <TokenSelect
                  value={tradeFromToken}
                  options={tradeTokenOptions}
                  onChange={setTradeFromToken}
                  ariaLabel="Select token to swap from"
                  disabled={!tradeTokenOptions.length}
                />
              </div>
            </div>

            <button
              type="button"
              className="trade-switch"
              onClick={switchTradeDirection}
              aria-label="Switch token direction"
            >
              ↕
            </button>

            <div className="trade-field">
              <label htmlFor="trade-to-amount">To</label>
              <div className="trade-input-wrap">
                <input
                  id="trade-to-amount"
                  className="trade-input"
                  value={tradeToAmount}
                  onChange={(event) => setTradeToAmount(event.target.value)}
                  inputMode="decimal"
                />
                <TokenSelect
                  value={tradeToToken}
                  options={tradeTokenOptions}
                  onChange={setTradeToToken}
                  ariaLabel="Select token to swap to"
                  disabled={!tradeTokenOptions.length}
                />
              </div>
            </div>

            {tradeError && <div className="status-block error">{tradeError}</div>}
            {tradeStatus && <div className="status-block">{tradeStatus}</div>}

            <button
              type="button"
              className="trade-submit"
              onClick={handleSwapClick}
              disabled={swapActionDisabled}
            >
              {tradeSubmitting ? 'Submitting…' : !isWalletConnected ? 'Connect First' : 'Place Swap'}
            </button>
          </>
        )}

        {tradeMode === 'leverage' && (
          <>
            <div className="borrow-toggle">
              <button
                type="button"
                className={`borrow-toggle-btn ${leverageDirection === 'long' ? 'active' : ''}`}
                onClick={() => setLeverageDirection('long')}
              >
                Long
              </button>
              <button
                type="button"
                className={`borrow-toggle-btn ${leverageDirection === 'short' ? 'active' : ''}`}
                onClick={() => setLeverageDirection('short')}
              >
                Short
              </button>
            </div>

            <div className="trade-field">
              <label htmlFor="leverage-asset-token">Token</label>
              <div className="trade-input-wrap">
                <input
                  id="leverage-desired-exposure"
                  className="trade-input trade-input-lite-input"
                  value={desiredExposureInput}
                  onChange={(event) => handleDesiredExposureChange(event.target.value)}
                  onBlur={() => setIsExposureEditing(false)}
                  inputMode="decimal"
                  placeholder={
                    leverageDirection === 'long'
                      ? 'I want to long (approx amount)'
                      : 'I want to short (approx amount)'
                  }
                  aria-label={
                    leverageDirection === 'long'
                      ? 'Approximate long amount'
                      : 'Approximate short amount'
                  }
                />
                <TokenSelect
                  id="leverage-asset-token"
                  value={leverageAssetToken}
                  options={tradeTokenOptions}
                  onChange={setLeverageAssetToken}
                  ariaLabel="Select leverage asset token"
                  disabled={!tradeTokenOptions.length}
                />
              </div>
              <div className="field-note">
                {leverageEstimatedAssetDeltaAmount > 0
                  ? `Estimated ${leverageDirection} size: ${formatCompact(leverageEstimatedAssetDeltaAmount, 4)} ${leverageAssetTicker}. Edit the amount above to auto-adjust required collateral.`
                  : `Set collateral and target leverage to estimate your ${leverageDirection} size in ${leverageAssetTicker}.`}
              </div>
            </div>

            <div className="trade-field">
              <label htmlFor="leverage-initial-collateral">Initial collateral</label>
              <div className="trade-input-wrap">
                <input
                  id="leverage-initial-collateral"
                  className="trade-input"
                  value={leverageInitialCollateral}
                  onChange={(event) => {
                    setIsExposureEditing(false)
                    setLeverageInitialCollateral(event.target.value)
                  }}
                  inputMode="decimal"
                  placeholder="0.0"
                />
                <TokenSelect
                  id="leverage-start-collateral"
                  value={leverageStartCollateralToken}
                  options={tradeTokenOptions}
                  onChange={setLeverageStartCollateralToken}
                  ariaLabel="Select leverage start collateral token"
                  disabled={!tradeTokenOptions.length}
                />
              </div>
            </div>

            <div className="field-note">
              {leverageDirection === 'long'
                ? `Long ${leverageAssetTicker}: borrow ${leverageBorrowTicker}, swap to ${leverageAssetTicker}, add ${leverageLoopCollateralTicker} as collateral.`
                : `Short ${leverageAssetTicker}: borrow ${leverageBorrowTicker}, sell into ${leverageLoopCollateralTicker}, add ${leverageLoopCollateralTicker} as collateral.`}
            </div>

            {hasExistingPoolLoan && (
              <div className={`status-block ${isExistingLoanOverLimit ? 'error' : ''}`}>
                {isExistingLoanOverLimit
                  ? `You already have an open ${leverageAssetTicker}/${leverageBorrowTicker} loan above borrow limit (${toPercentLabel(
                      leverageCurrentUtilization,
                    )}). Leverage caps are reduced until you repay/add collateral.`
                  : `Leverage plan is computed on top of your existing ${leverageAssetTicker}/${leverageBorrowTicker} position.`}
              </div>
            )}

            <div className="trade-field leverage-slider-wrap">
              <div className="leverage-slider-head">
                <label htmlFor="leverage-target-range">Target leverage</label>
                <div className="leverage-slider-target">
                  <strong>{targetLeverage.toFixed(2)}x</strong>
                  <input
                    type="number"
                    className="leverage-target-input"
                    min={1}
                    max={leverageTargetMax}
                    step={0.01}
                    value={targetLeverage.toFixed(2)}
                    onChange={(event) => {
                      const nextTarget = Number(event.target.value)
                      if (Number.isFinite(nextTarget)) {
                        setTargetLeverage(Math.min(nextTarget, leverageTargetMax))
                      }
                    }}
                    aria-label="Set target leverage"
                  />
                </div>
              </div>
              <input
                id="leverage-target-range"
                type="range"
                className="leverage-slider"
                min={1}
                max={leverageTargetMax}
                step={0.05}
                value={targetLeverage}
                onChange={(event) =>
                  setTargetLeverage(Math.min(Number(event.target.value), leverageTargetMax))
                }
              />
              <div className="leverage-slider-values">
                <span>Safer</span>
                <span>Risk cap {toPercentLabel(leverageTargetUtilization, 1)}</span>
                <span>Aggressive</span>
              </div>
              <div className="field-note">Max executable leverage now: {leverageTargetMax.toFixed(2)}x</div>
            </div>

            <div className="borrow-risk-panel">
              <div className="risk-meter-head">
                <span>Loop plan (max {leverageLoopCap} loops)</span>
                <span>
                  Borrow {leverageBorrowTicker} → Collateral {leverageLoopCollateralTicker}
                </span>
              </div>
              <div className="risk-grid">
                <article>
                  <span>Current LTV</span>
                  <strong>{toPercentLabel(leverageCurrentLtv)}</strong>
                </article>
                <article>
                  <span>Projected LTV</span>
                  <strong>{toPercentLabel(leverageProjectedLtv)}</strong>
                </article>
                <article>
                  <span>Current Utilization</span>
                  <strong>{toPercentLabel(leverageCurrentUtilization)}</strong>
                </article>
                <article>
                  <span>Projected Utilization</span>
                  <strong>{toPercentLabel(leverageProjectedUtilization)}</strong>
                </article>
                <article>
                  <span>Target / Achieved</span>
                  <strong>
                    {targetLeverage.toFixed(2)}x / {leverageAchievedMultiple.toFixed(2)}x
                  </strong>
                </article>
                <article>
                  <span>Safety Buffer</span>
                  <strong>{toPercentLabel(leverageSafetyBuffer)}</strong>
                </article>
              </div>

              <div className="risk-grid">
                <article>
                  <span>Max One-Tx (loop cap)</span>
                  <strong>{leverageMaxOneTxMultiple.toFixed(2)}x</strong>
                </article>
                <article>
                  <span>Max By Risk Cap</span>
                  <strong>
                    {leverageMaxByRiskCapMultiple && Number.isFinite(leverageMaxByRiskCapMultiple)
                      ? `${leverageMaxByRiskCapMultiple.toFixed(2)}x`
                      : '--'}
                  </strong>
                </article>
                <article>
                  <span>Max By Borrow Limit</span>
                  <strong>
                    {leverageMaxByBorrowLimitMultiple && Number.isFinite(leverageMaxByBorrowLimitMultiple)
                      ? `${leverageMaxByBorrowLimitMultiple.toFixed(2)}x`
                      : '--'}
                  </strong>
                </article>
                <article>
                  <span>Liquidation Price</span>
                  <strong>
                    {leverageLiquidationPriceInBorrowToken && Number.isFinite(leverageLiquidationPriceInBorrowToken)
                      ? `${formatCompact(leverageLiquidationPriceInBorrowToken, 5)} ${assetPriceLabel}`
                      : '--'}
                  </strong>
                </article>
                <article>
                  <span>Current Asset Price</span>
                  <strong>
                    {leverageCurrentAssetPriceInBorrowToken &&
                    Number.isFinite(leverageCurrentAssetPriceInBorrowToken)
                      ? `${formatCompact(leverageCurrentAssetPriceInBorrowToken, 5)} ${assetPriceLabel}`
                      : '--'}
                  </strong>
                </article>
                <article>
                  <span>Distance To Liquidation</span>
                  <strong>{toPercentLabel(leverageLiquidationDistance)}</strong>
                </article>
              </div>

              <div className={`status-block ${leverageIsPlanSafe ? '' : 'error'}`}>
                {leverageIsPlanSafe
                  ? `Safety check: plan keeps about ${((safetyHeadroom ?? 0) * 100).toFixed(0)}% borrow-limit headroom.`
                  : 'Projected plan is too close to liquidation. Lower target leverage or add collateral.'}
              </div>

              {leverageInputCollateralValueToken0 <= 0 && (
                <div className="status-block">Enter collateral to generate loops.</div>
              )}

              {leveragePlanBlockedReason && leverageInputCollateralValueToken0 > 0 && (
                <div className="status-block error">{leveragePlanBlockedReason}</div>
              )}

              <div className="leverage-execution-plan">
                <div className="leverage-execution-head">
                  <strong>Bundled Transaction Order</strong>
                  <span>
                    {leverageInstructionRows.length} instruction
                    {leverageInstructionRows.length === 1 ? '' : 's'} in 1 tx
                  </span>
                </div>
                {leverageInstructionRows.length ? (
                  <ol className="leverage-execution-list">
                    {leverageInstructionRows.map((row) => (
                      <li key={`${row.index}-${row.title}`} className="leverage-execution-item">
                        <span className="leverage-execution-index">{row.index}</span>
                        <div className="leverage-execution-content">
                          <strong>{row.title}</strong>
                          <span>{row.detail}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="status-block">Enter collateral to preview the bundled transaction steps.</div>
                )}
                <p className="leverage-execution-footnote">
                  Atomic execution: if any step fails, the whole transaction is reverted.
                </p>
              </div>

              <div className="leverage-loop-estimates-head">Loop sizing estimates</div>
              <div className="positions-list leverage-loop-estimates-list">
                {!leverageSteps.length && !leveragePlanBlockedReason && (
                  <div className="status-block">No executable loops from current collateral/risk limits.</div>
                )}
                {leverageSteps.map((step) => (
                  <div key={step.step} className="positions-item positions-item-loan">
                    <span className="positions-pool">Loop {step.step}</span>
                    <span className="positions-meta">
                      Borrow {formatCompact(step.borrowAmount, 4)} {step.borrowTicker}
                    </span>
                    <span className="positions-meta">
                      Swap {formatCompact(step.swapInAmount, 4)} {step.swapInTicker} -&gt;{' '}
                      {formatCompact(step.swapOutAmount, 4)} {step.swapOutTicker} (est)
                    </span>
                    <span className="positions-meta">
                      Add collateral {formatCompact(step.collateralAmount, 4)} {step.collateralTicker}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {leverageError && <div className="status-block error">{leverageError}</div>}
            {leverageStatus && <div className="status-block">{leverageStatus}</div>}
            {leverageDisabledReason && isWalletConnected && !leverageError && (
              <div className="status-block error">{leverageDisabledReason}</div>
            )}

            <button
              type="button"
              className="trade-submit"
              onClick={handleLeverageClick}
              disabled={leverageActionDisabled}
              title={leverageActionDisabled && leverageDisabledReason ? leverageDisabledReason : undefined}
            >
              {leverageSubmitting
                ? 'Submitting…'
                : !isWalletConnected
                  ? 'Connect First'
                  : leverageActionDisabled && leverageDisabledReason
                    ? 'Run Blocked'
                  : leverageSteps.length
                  ? `Run ${leverageSteps.length} Loop${leverageSteps.length === 1 ? '' : 's'}`
                  : 'Run Loops'}
            </button>
          </>
        )}
      </section>
    </div>
  )
}

export default TradeTab
