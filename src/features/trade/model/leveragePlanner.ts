import { computeBorrowHealthSnapshot } from '@/features/market/utils'

export { computeBorrowHealthSnapshot }

// Keep a hard loop cap so one-tx plans stay within practical compute limits.
export const MAX_LEVERAGE_LOOPS = 4
export const MIN_TARGET_LEVERAGE = 1
export const MAX_TARGET_LEVERAGE = 5

// Docs suggest keeping meaningful liquidation headroom; this keeps ~15% room at the top end.
export const SAFE_UTILIZATION_FLOOR = 0.55
export const SAFE_UTILIZATION_CEILING = 0.85
// Buffer estimated swap outputs before add-collateral to absorb curve drift, rounding and token transfer fees.
export const LEVERAGE_COLLATERAL_BUFFER = 0.95

const STABLE_TOKEN_TICKERS = new Set(['USDC', 'USDT', 'USDH', 'USDS', 'DAI', 'PYUSD'])

export type LeverageStepPlan = {
  step: number
  borrowAmount: number
  borrowAmountBase: bigint
  borrowTicker: string
  swapInAmount: number
  swapInTicker: string
  swapOutAmount: number
  swapOutTicker: string
  collateralAmount: number
  collateralAmountBase: bigint
  collateralTicker: string
}

export function estimateSwapOut(params: {
  amountIn: number
  reserveIn: number
  reserveOut: number
  feeBps: number
}) {
  const { amountIn, reserveIn, reserveOut, feeBps } = params
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    return {
      amountOut: 0,
      nextReserveIn: reserveIn,
      nextReserveOut: reserveOut,
    }
  }

  const feeFactor = Math.max(0, 1 - feeBps / 10_000)
  const effectiveIn = amountIn * feeFactor
  if (!Number.isFinite(effectiveIn) || effectiveIn <= 0 || reserveIn <= 0 || reserveOut <= 0) {
    return {
      amountOut: 0,
      nextReserveIn: reserveIn + amountIn,
      nextReserveOut: reserveOut,
    }
  }

  const amountOut = (reserveOut * effectiveIn) / (reserveIn + effectiveIn)
  const sanitizedOut = Math.max(0, Math.min(reserveOut * 0.999999, amountOut))
  return {
    amountOut: sanitizedOut,
    nextReserveIn: reserveIn + amountIn,
    nextReserveOut: Math.max(0, reserveOut - sanitizedOut),
  }
}

export function toBaseUnitsFromNumber(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return 0n
  const safeDecimals = Math.max(0, decimals)
  const precision = Math.min(9, safeDecimals)
  const whole = Math.floor(value)
  const fractional = Math.max(0, value - whole)
  const scaledFraction = Math.floor((fractional + Number.EPSILON) * 10 ** precision)

  const wholeBase = BigInt(whole) * 10n ** BigInt(safeDecimals)
  const fractionBase = BigInt(scaledFraction) * 10n ** BigInt(safeDecimals - precision)
  return wholeBase + fractionBase
}

export function isLikelyStableTicker(ticker: string) {
  const normalized = ticker.trim().toUpperCase()
  if (!normalized) return false
  if (STABLE_TOKEN_TICKERS.has(normalized)) return true
  return normalized.includes('USD')
}
