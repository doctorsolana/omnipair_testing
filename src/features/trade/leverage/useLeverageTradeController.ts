import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Address, Instruction, TransactionSigner } from '@solana/kit'
import {
  getAddCollateralInstructionAsync,
  getBorrowInstructionAsync,
  getSwapInstructionAsync,
  OMNIPAIR_PROGRAM_ID,
} from '@/protocol/omnipair'
import type {
  BorrowHealthSnapshot,
  LoanPositionView,
  PoolView,
  TradeTokenOption,
} from '@/features/market/types'
import { DEFAULT_TRADE_TOKEN } from '@/features/market/types'
import {
  computeBorrowHealthSnapshot,
  shortAddress,
  toBaseUnits,
  toDisplayNumber,
} from '@/features/market/utils'
import { formatActionError, getSimulationCustomErrorCode } from '@/shared/utils/error'
import {
  estimateSwapOut,
  isLikelyStableTicker,
  LEVERAGE_COLLATERAL_BUFFER,
  MAX_LEVERAGE_LOOPS,
  MAX_TARGET_LEVERAGE,
  MIN_TARGET_LEVERAGE,
  SAFE_UTILIZATION_CEILING,
  toBaseUnitsFromNumber,
  type LeverageStepPlan,
} from '@/features/trade/model/leveragePlanner'
import {
  findAssociatedTokenAddress,
  getOwnedTokenAccount,
  type RpcRequest,
} from '@/integrations/wallet/rpcHelpers'

type LeverageTokenConfig = {
  direction: 'long' | 'short'
  assetMint: string
  assetTicker: string
  assetIsToken0: boolean
  startCollateralMint: string
  startCollateralTicker: string
  startCollateralDecimals: number
  startCollateralIsToken0: boolean
  borrowMint: string
  borrowTicker: string
  borrowDecimals: number
  borrowIsToken0: boolean
  loopCollateralMint: string
  loopCollateralTicker: string
  loopCollateralDecimals: number
  loopCollateralIsToken0: boolean
}

type LeveragePreview = {
  steps: LeverageStepPlan[]
  currentHealth: BorrowHealthSnapshot | null
  projectedHealth: BorrowHealthSnapshot | null
  targetUtilization: number
  seedUsesSwap: boolean
  seedSwapInAmount: number
  seedSwapOutAmount: number
  seedCollateralAmount: number
  seedCollateralAmountBase: bigint
  inputCollateralValueToken0: number
  achievedLeverage: number
  maxOneTxLeverage: number
  maxLeverageAtRiskCap: number | null
  maxLeverageAtBorrowLimit: number | null
  liquidationPriceToken1PerToken0: number | null
  liquidationPriceQuotePerAsset: number | null
  currentAssetPriceInBorrowToken: number | null
  liquidationDistance: number | null
  estimatedAssetDeltaAmount: number
  targetReached: boolean
  blockedReason: string | null
}

type UseLeverageTradeControllerParams = {
  account: string | null
  isConnected: boolean
  signer: TransactionSigner<string> | null
  selectedTradePool: PoolView | null
  tradeTokenOptions: TradeTokenOption[]
  selectedTradeLoanPosition: LoanPositionView | null
  tradeEstimatedCf0Bps: number
  tradeEstimatedCf1Bps: number
  rpcRequest: RpcRequest
  send: (instructions: Instruction<Address>[]) => Promise<string>
  onTradeSuccess?: () => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const INITIAL_LOOP_BORROW_SAFETY_FACTOR = 0.82
const FOLLOWUP_LOOP_BORROW_SAFETY_FACTOR = 0.92
const MIN_REMAINING_TARGET_RATIO = 0.01
const MAX_BORROW_CF_FROM_LIQUIDATION_RATIO = 0.95

function mapTargetLeverageToUtilization() {
  return SAFE_UTILIZATION_CEILING
}

function estimateLiquidationCfBpsFromBorrowCf(estimatedBorrowCfBps: number) {
  if (!Number.isFinite(estimatedBorrowCfBps) || estimatedBorrowCfBps <= 0) return 0
  return Math.min(10_000, Math.max(0, Math.round(estimatedBorrowCfBps / MAX_BORROW_CF_FROM_LIQUIDATION_RATIO)))
}

function computeLiquidationPriceToken1PerToken0(params: {
  collateral0: number
  collateral1: number
  debt0: number
  debt1: number
  liquidationCf0Bps: number
  liquidationCf1Bps: number
}) {
  const cf0 = Math.max(0, params.liquidationCf0Bps) / 10_000
  const cf1 = Math.max(0, params.liquidationCf1Bps) / 10_000
  const a = params.debt0 - params.collateral0 * cf0
  const b = params.debt1 - params.collateral1 * cf1

  if (Math.abs(a) < 1e-12) return null
  const liquidationPrice = -b / a
  if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) return null
  return liquidationPrice
}

function getSpotSwapOutEstimate(params: {
  amountIn: number
  inIsToken0: boolean
  priceToken1PerToken0: number
  feeBps: number
}) {
  const { amountIn, inIsToken0, priceToken1PerToken0, feeBps } = params
  if (!Number.isFinite(amountIn) || amountIn <= 0) return 0
  if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) return 0

  const feeFactor = Math.max(0, 1 - feeBps / 10_000)
  const rawOut = inIsToken0 ? amountIn * priceToken1PerToken0 : amountIn / priceToken1PerToken0
  if (!Number.isFinite(rawOut) || rawOut <= 0) return 0

  return rawOut * feeFactor
}

export function useLeverageTradeController({
  account,
  isConnected,
  signer,
  selectedTradePool,
  tradeTokenOptions,
  selectedTradeLoanPosition,
  tradeEstimatedCf0Bps,
  tradeEstimatedCf1Bps,
  rpcRequest,
  send,
  onTradeSuccess,
}: UseLeverageTradeControllerParams) {
  const lastPoolAddressRef = useRef<string | null>(null)

  const [leverageDirection, setLeverageDirection] = useState<'long' | 'short'>('long')
  const [leverageAssetToken, setLeverageAssetToken] = useState('')
  const [leverageStartCollateralToken, setLeverageStartCollateralToken] = useState('')
  const [leverageInitialCollateral, setLeverageInitialCollateral] = useState('')
  const [targetLeverage, setTargetLeverage] = useState(2)
  const [leverageSubmitting, setLeverageSubmitting] = useState(false)
  const [leverageStatus, setLeverageStatus] = useState<string | null>(null)
  const [leverageError, setLeverageError] = useState<string | null>(null)

  const leverageAssetTokenInfo = useMemo(
    () =>
      tradeTokenOptions.find((token) => token.mint === leverageAssetToken) ??
      tradeTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [leverageAssetToken, tradeTokenOptions],
  )

  const leverageTokenConfig = useMemo<LeverageTokenConfig | null>(() => {
    if (!selectedTradePool) return null
    if (!leverageAssetToken || !leverageStartCollateralToken) return null

    const assetIsToken0 = selectedTradePool.token0Mint === leverageAssetToken
    const assetIsToken1 = selectedTradePool.token1Mint === leverageAssetToken
    if (!assetIsToken0 && !assetIsToken1) return null

    const startCollateralIsToken0 = selectedTradePool.token0Mint === leverageStartCollateralToken
    const startCollateralIsToken1 = selectedTradePool.token1Mint === leverageStartCollateralToken
    if (!startCollateralIsToken0 && !startCollateralIsToken1) return null

    const oppositeIsToken0 = !assetIsToken0
    const borrowIsToken0 = leverageDirection === 'long' ? oppositeIsToken0 : assetIsToken0
    const loopCollateralIsToken0 = leverageDirection === 'long' ? assetIsToken0 : oppositeIsToken0

    return {
      direction: leverageDirection,
      assetMint: assetIsToken0 ? selectedTradePool.token0Mint : selectedTradePool.token1Mint,
      assetTicker: assetIsToken0 ? selectedTradePool.token0Ticker : selectedTradePool.token1Ticker,
      assetIsToken0,
      startCollateralMint: startCollateralIsToken0
        ? selectedTradePool.token0Mint
        : selectedTradePool.token1Mint,
      startCollateralTicker: startCollateralIsToken0
        ? selectedTradePool.token0Ticker
        : selectedTradePool.token1Ticker,
      startCollateralDecimals: startCollateralIsToken0
        ? selectedTradePool.token0Decimals
        : selectedTradePool.token1Decimals,
      startCollateralIsToken0,
      borrowMint: borrowIsToken0 ? selectedTradePool.token0Mint : selectedTradePool.token1Mint,
      borrowTicker: borrowIsToken0 ? selectedTradePool.token0Ticker : selectedTradePool.token1Ticker,
      borrowDecimals: borrowIsToken0 ? selectedTradePool.token0Decimals : selectedTradePool.token1Decimals,
      borrowIsToken0,
      loopCollateralMint: loopCollateralIsToken0 ? selectedTradePool.token0Mint : selectedTradePool.token1Mint,
      loopCollateralTicker: loopCollateralIsToken0
        ? selectedTradePool.token0Ticker
        : selectedTradePool.token1Ticker,
      loopCollateralDecimals: loopCollateralIsToken0
        ? selectedTradePool.token0Decimals
        : selectedTradePool.token1Decimals,
      loopCollateralIsToken0,
    }
  }, [leverageAssetToken, leverageDirection, leverageStartCollateralToken, selectedTradePool])

  const leveragePreview = useMemo<LeveragePreview>(() => {
    const targetUtilization = mapTargetLeverageToUtilization()
    if (!selectedTradePool || !leverageTokenConfig) {
      return {
        steps: [],
        currentHealth: null,
        projectedHealth: null,
        targetUtilization,
        seedUsesSwap: false,
        seedSwapInAmount: 0,
        seedSwapOutAmount: 0,
        seedCollateralAmount: 0,
        seedCollateralAmountBase: 0n,
        inputCollateralValueToken0: 0,
        achievedLeverage: 1,
        maxOneTxLeverage: 1,
        maxLeverageAtRiskCap: null,
        maxLeverageAtBorrowLimit: null,
        liquidationPriceToken1PerToken0: null,
        liquidationPriceQuotePerAsset: null,
        currentAssetPriceInBorrowToken: null,
        liquidationDistance: null,
        estimatedAssetDeltaAmount: 0,
        targetReached: false,
        blockedReason: null,
      }
    }

    const reserve0Start = toDisplayNumber(selectedTradePool.cashReserve0, selectedTradePool.token0Decimals)
    const reserve1Start = toDisplayNumber(selectedTradePool.cashReserve1, selectedTradePool.token1Decimals)
    const priceStart =
      reserve0Start > 0 && reserve1Start > 0 ? reserve1Start / reserve0Start : selectedTradePool.price

    const currentCollateral0 = selectedTradeLoanPosition?.collateral0 ?? 0
    const currentCollateral1 = selectedTradeLoanPosition?.collateral1 ?? 0
    const currentDebt0 = selectedTradeLoanPosition?.debt0 ?? 0
    const currentDebt1 = selectedTradeLoanPosition?.debt1 ?? 0

    const currentHealth = computeBorrowHealthSnapshot({
      priceToken1PerToken0: priceStart,
      collateral0: currentCollateral0,
      collateral1: currentCollateral1,
      debt0: currentDebt0,
      debt1: currentDebt1,
      cf0Bps: tradeEstimatedCf0Bps,
      cf1Bps: tradeEstimatedCf1Bps,
    })

    const initialCollateralBase = toBaseUnits(
      leverageInitialCollateral,
      leverageTokenConfig.startCollateralDecimals,
    )
    const initialCollateralAmount =
      initialCollateralBase && initialCollateralBase > 0n
        ? toDisplayNumber(initialCollateralBase, leverageTokenConfig.startCollateralDecimals)
        : 0

    let collateral0 = currentCollateral0
    let collateral1 = currentCollateral1
    let debt0 = currentDebt0
    let debt1 = currentDebt1
    let reserve0 = reserve0Start
    let reserve1 = reserve1Start
    let priceToken1PerToken0 = priceStart

    let seedUsesSwap = false
    let seedSwapInAmount = 0
    let seedSwapOutAmount = 0
    let seedCollateralAmount = 0
    let seedCollateralAmountBase = 0n

    if (initialCollateralAmount > 0) {
      const shouldSwapSeedCollateral =
        leverageTokenConfig.startCollateralMint !== leverageTokenConfig.loopCollateralMint

      if (shouldSwapSeedCollateral) {
        seedUsesSwap = true
        seedSwapInAmount = initialCollateralAmount

        const seedSwapEstimate = leverageTokenConfig.startCollateralIsToken0
          ? estimateSwapOut({
              amountIn: initialCollateralAmount,
              reserveIn: reserve0,
              reserveOut: reserve1,
              feeBps: selectedTradePool.swapFeeBps,
            })
          : estimateSwapOut({
              amountIn: initialCollateralAmount,
              reserveIn: reserve1,
              reserveOut: reserve0,
              feeBps: selectedTradePool.swapFeeBps,
            })

        const seedSpotOut = getSpotSwapOutEstimate({
          amountIn: initialCollateralAmount,
          inIsToken0: leverageTokenConfig.startCollateralIsToken0,
          priceToken1PerToken0,
          feeBps: selectedTradePool.swapFeeBps,
        })
        const conservativeSeedOut =
          seedSpotOut > 0 ? Math.min(seedSwapEstimate.amountOut, seedSpotOut) : seedSwapEstimate.amountOut

        seedSwapOutAmount = conservativeSeedOut
        seedCollateralAmount = conservativeSeedOut * LEVERAGE_COLLATERAL_BUFFER
        seedCollateralAmountBase = toBaseUnitsFromNumber(
          seedCollateralAmount,
          leverageTokenConfig.loopCollateralDecimals,
        )

        if (leverageTokenConfig.loopCollateralIsToken0) {
          collateral0 += seedCollateralAmount
        } else {
          collateral1 += seedCollateralAmount
        }

        if (leverageTokenConfig.startCollateralIsToken0) {
          reserve0 = seedSwapEstimate.nextReserveIn
          reserve1 = seedSwapEstimate.nextReserveOut
        } else {
          reserve1 = seedSwapEstimate.nextReserveIn
          reserve0 = seedSwapEstimate.nextReserveOut
        }

        if (reserve0 > 0 && reserve1 > 0) {
          priceToken1PerToken0 = reserve1 / reserve0
        }
      } else {
        if (leverageTokenConfig.startCollateralIsToken0) {
          collateral0 += initialCollateralAmount
        } else {
          collateral1 += initialCollateralAmount
        }
      }
    }

    const startHealth = computeBorrowHealthSnapshot({
      priceToken1PerToken0,
      collateral0,
      collateral1,
      debt0,
      debt1,
      cf0Bps: tradeEstimatedCf0Bps,
      cf1Bps: tradeEstimatedCf1Bps,
    })

    const inputCollateralValueToken0 = Math.max(
      0,
      startHealth.collateralValueToken0 - currentHealth.collateralValueToken0,
    )
    const planForTarget = (requestedLeverage: number) => {
      const requestedIncrementalCollateralToken0 =
        inputCollateralValueToken0 * Math.max(0, requestedLeverage - 1)

      let loopCollateral0 = collateral0
      let loopCollateral1 = collateral1
      let loopDebt0 = debt0
      let loopDebt1 = debt1
      let loopReserve0 = reserve0
      let loopReserve1 = reserve1
      let loopPriceToken1PerToken0 = priceToken1PerToken0
      const steps: LeverageStepPlan[] = []

      for (let index = 0; index < MAX_LEVERAGE_LOOPS; index += 1) {
        const loopHealth = computeBorrowHealthSnapshot({
          priceToken1PerToken0: loopPriceToken1PerToken0,
          collateral0: loopCollateral0,
          collateral1: loopCollateral1,
          debt0: loopDebt0,
          debt1: loopDebt1,
          cf0Bps: tradeEstimatedCf0Bps,
          cf1Bps: tradeEstimatedCf1Bps,
        })

        const incrementalCollateralToken0 = Math.max(
          0,
          loopHealth.collateralValueToken0 - startHealth.collateralValueToken0,
        )
        if (
          inputCollateralValueToken0 > 0 &&
          requestedIncrementalCollateralToken0 > 0 &&
          incrementalCollateralToken0 >= requestedIncrementalCollateralToken0 * 0.995
        ) {
          break
        }

        const remainingTargetIncrementalToken0 = Math.max(
          0,
          requestedIncrementalCollateralToken0 - incrementalCollateralToken0,
        )
        const minRemainingTargetToken0 = inputCollateralValueToken0 * MIN_REMAINING_TARGET_RATIO
        if (remainingTargetIncrementalToken0 <= minRemainingTargetToken0) {
          break
        }

        const hardBorrowHeadroom = loopHealth.availableBorrowValueToken0
        const borrowHeadroomToSafetyCap =
          loopHealth.maxBorrowValueToken0 * SAFE_UTILIZATION_CEILING - loopHealth.debtValueToken0
        const borrowValueCapByRisk = Math.max(
          0,
          Math.min(hardBorrowHeadroom, borrowHeadroomToSafetyCap) * 0.97,
        )
        const borrowValueCapByTarget =
          remainingTargetIncrementalToken0 > 0
            ? remainingTargetIncrementalToken0 / Math.max(LEVERAGE_COLLATERAL_BUFFER, 0.1)
            : 0
        const borrowSafetyFactor =
          index === 0 ? INITIAL_LOOP_BORROW_SAFETY_FACTOR : FOLLOWUP_LOOP_BORROW_SAFETY_FACTOR
        const borrowValueToken0 =
          Math.min(borrowValueCapByRisk, borrowValueCapByTarget) * borrowSafetyFactor
        if (!Number.isFinite(borrowValueToken0) || borrowValueToken0 <= 0) break

        const borrowAmount = leverageTokenConfig.borrowIsToken0
          ? borrowValueToken0
          : borrowValueToken0 * loopPriceToken1PerToken0
        if (!Number.isFinite(borrowAmount) || borrowAmount <= 0) break

        const swapEstimate = leverageTokenConfig.borrowIsToken0
          ? estimateSwapOut({
              amountIn: borrowAmount,
              reserveIn: loopReserve0,
              reserveOut: loopReserve1,
              feeBps: selectedTradePool.swapFeeBps,
            })
          : estimateSwapOut({
              amountIn: borrowAmount,
              reserveIn: loopReserve1,
              reserveOut: loopReserve0,
              feeBps: selectedTradePool.swapFeeBps,
            })

        const loopSpotOut = getSpotSwapOutEstimate({
          amountIn: borrowAmount,
          inIsToken0: leverageTokenConfig.borrowIsToken0,
          priceToken1PerToken0: loopPriceToken1PerToken0,
          feeBps: selectedTradePool.swapFeeBps,
        })
        const conservativeLoopOut =
          loopSpotOut > 0 ? Math.min(swapEstimate.amountOut, loopSpotOut) : swapEstimate.amountOut
        const collateralAmount = conservativeLoopOut * LEVERAGE_COLLATERAL_BUFFER
        if (!Number.isFinite(collateralAmount) || collateralAmount <= 0) break

        let nextCollateral0 = loopCollateral0
        let nextCollateral1 = loopCollateral1
        let nextDebt0 = loopDebt0
        let nextDebt1 = loopDebt1
        let nextReserve0 = loopReserve0
        let nextReserve1 = loopReserve1

        if (leverageTokenConfig.borrowIsToken0) {
          nextDebt0 += borrowAmount
          if (leverageTokenConfig.loopCollateralIsToken0) {
            nextCollateral0 += collateralAmount
          } else {
            nextCollateral1 += collateralAmount
          }
          nextReserve0 = swapEstimate.nextReserveIn
          nextReserve1 = swapEstimate.nextReserveOut
        } else {
          nextDebt1 += borrowAmount
          if (leverageTokenConfig.loopCollateralIsToken0) {
            nextCollateral0 += collateralAmount
          } else {
            nextCollateral1 += collateralAmount
          }
          nextReserve1 = swapEstimate.nextReserveIn
          nextReserve0 = swapEstimate.nextReserveOut
        }

        const nextPrice =
          nextReserve0 > 0 && nextReserve1 > 0
            ? nextReserve1 / nextReserve0
            : loopPriceToken1PerToken0

        const projectedStepHealth = computeBorrowHealthSnapshot({
          priceToken1PerToken0: nextPrice,
          collateral0: nextCollateral0,
          collateral1: nextCollateral1,
          debt0: nextDebt0,
          debt1: nextDebt1,
          cf0Bps: tradeEstimatedCf0Bps,
          cf1Bps: tradeEstimatedCf1Bps,
        })
        const projectedStepUtilization = projectedStepHealth.borrowUtilization ?? 0
        if (projectedStepUtilization > SAFE_UTILIZATION_CEILING + 0.005) {
          break
        }

        const borrowAmountBase = toBaseUnitsFromNumber(borrowAmount, leverageTokenConfig.borrowDecimals)
        const collateralAmountBase = toBaseUnitsFromNumber(
          collateralAmount,
          leverageTokenConfig.loopCollateralDecimals,
        )
        if (borrowAmountBase <= 0n || collateralAmountBase <= 0n) break

        loopCollateral0 = nextCollateral0
        loopCollateral1 = nextCollateral1
        loopDebt0 = nextDebt0
        loopDebt1 = nextDebt1
        loopReserve0 = nextReserve0
        loopReserve1 = nextReserve1
        loopPriceToken1PerToken0 = nextPrice

        steps.push({
          step: index + 1,
          borrowAmount,
          borrowAmountBase,
          borrowTicker: leverageTokenConfig.borrowTicker,
          swapInAmount: borrowAmount,
          swapInTicker: leverageTokenConfig.borrowTicker,
          swapOutAmount: conservativeLoopOut,
          swapOutTicker: leverageTokenConfig.loopCollateralTicker,
          collateralAmount,
          collateralAmountBase,
          collateralTicker: leverageTokenConfig.loopCollateralTicker,
        })
      }

      const projectedHealth = computeBorrowHealthSnapshot({
        priceToken1PerToken0: loopPriceToken1PerToken0,
        collateral0: loopCollateral0,
        collateral1: loopCollateral1,
        debt0: loopDebt0,
        debt1: loopDebt1,
        cf0Bps: tradeEstimatedCf0Bps,
        cf1Bps: tradeEstimatedCf1Bps,
      })
      const incrementalCollateralToken0 = Math.max(
        0,
        projectedHealth.collateralValueToken0 - startHealth.collateralValueToken0,
      )
      const remainingTargetIncrementalToken0 = Math.max(
        0,
        requestedIncrementalCollateralToken0 - incrementalCollateralToken0,
      )
      const achievedLeverage =
        inputCollateralValueToken0 > 0
          ? 1 + incrementalCollateralToken0 / inputCollateralValueToken0
          : 1

      return {
        steps,
        projectedHealth,
        achievedLeverage,
        remainingTargetIncrementalToken0,
        collateral0: loopCollateral0,
        collateral1: loopCollateral1,
        debt0: loopDebt0,
        debt1: loopDebt1,
      }
    }

    const mainPlan = planForTarget(targetLeverage)
    const maxPlan = planForTarget(MAX_TARGET_LEVERAGE)
    const maxExecutableLeverage = Math.max(1, maxPlan.achievedLeverage)

    const maxAdditionalBorrowValueAtRiskCapRaw = Math.max(
      0,
      startHealth.maxBorrowValueToken0 * SAFE_UTILIZATION_CEILING - startHealth.debtValueToken0,
    )
    const maxAdditionalBorrowValueAtBorrowLimitRaw = Math.max(
      0,
      startHealth.maxBorrowValueToken0 - startHealth.debtValueToken0,
    )
    const maxLeverageAtRiskCapRaw =
      inputCollateralValueToken0 > 0
        ? 1 +
          (maxAdditionalBorrowValueAtRiskCapRaw * LEVERAGE_COLLATERAL_BUFFER) /
            inputCollateralValueToken0
        : null
    const maxLeverageAtBorrowLimitRaw =
      inputCollateralValueToken0 > 0
        ? 1 +
          (maxAdditionalBorrowValueAtBorrowLimitRaw * LEVERAGE_COLLATERAL_BUFFER) /
            inputCollateralValueToken0
        : null
    const maxLeverageAtRiskCap =
      maxLeverageAtRiskCapRaw === null ? null : Math.max(maxLeverageAtRiskCapRaw, maxExecutableLeverage)
    const maxLeverageAtBorrowLimit =
      maxLeverageAtBorrowLimitRaw === null
        ? null
        : Math.max(maxLeverageAtBorrowLimitRaw, maxExecutableLeverage)
    const targetExceedsHardCap = targetLeverage > maxExecutableLeverage + 0.005

    const reachedWithinResidualThreshold =
      inputCollateralValueToken0 > 0 &&
      mainPlan.remainingTargetIncrementalToken0 <= inputCollateralValueToken0 * MIN_REMAINING_TARGET_RATIO
    const reachedTarget =
      targetLeverage <= 1 ||
      (!targetExceedsHardCap &&
        (mainPlan.achievedLeverage >=
          clamp(targetLeverage, MIN_TARGET_LEVERAGE, MAX_TARGET_LEVERAGE) * 0.995 ||
          reachedWithinResidualThreshold))

    let blockedReason: string | null = null
    if (inputCollateralValueToken0 <= 0) {
      blockedReason = 'Enter collateral to build a leverage plan.'
    } else if (!mainPlan.steps.length) {
      blockedReason = 'No executable loops from current collateral/risk limits.'
    } else if (targetExceedsHardCap) {
      blockedReason = `Target leverage ${targetLeverage.toFixed(2)}x exceeds current executable cap ${maxExecutableLeverage.toFixed(2)}x for this pool/collateral setup.`
    } else if (!reachedTarget) {
      blockedReason = `Reached ${mainPlan.achievedLeverage.toFixed(2)}x max within ${MAX_LEVERAGE_LOOPS} loops and safety limits.`
    }

    const liquidationCf0Bps =
      selectedTradeLoanPosition?.cf0 ?? estimateLiquidationCfBpsFromBorrowCf(tradeEstimatedCf0Bps)
    const liquidationCf1Bps =
      selectedTradeLoanPosition?.cf1 ?? estimateLiquidationCfBpsFromBorrowCf(tradeEstimatedCf1Bps)
    const liquidationPriceToken1PerToken0 = computeLiquidationPriceToken1PerToken0({
      collateral0: mainPlan.collateral0,
      collateral1: mainPlan.collateral1,
      debt0: mainPlan.debt0,
      debt1: mainPlan.debt1,
      liquidationCf0Bps,
      liquidationCf1Bps,
    })

    const currentPriceToken1PerToken0 = selectedTradePool.price
    const currentAssetPriceInBorrowToken = leverageTokenConfig.assetIsToken0
      ? Number.isFinite(currentPriceToken1PerToken0) && currentPriceToken1PerToken0 > 0
        ? currentPriceToken1PerToken0
        : null
      : Number.isFinite(currentPriceToken1PerToken0) && currentPriceToken1PerToken0 > 0
        ? 1 / currentPriceToken1PerToken0
        : null
    const liquidationPriceQuotePerAsset = leverageTokenConfig.assetIsToken0
      ? liquidationPriceToken1PerToken0
      : liquidationPriceToken1PerToken0 && liquidationPriceToken1PerToken0 > 0
        ? 1 / liquidationPriceToken1PerToken0
        : null

    let liquidationDistance: number | null = null
    if (
      currentAssetPriceInBorrowToken &&
      currentAssetPriceInBorrowToken > 0 &&
      liquidationPriceQuotePerAsset &&
      liquidationPriceQuotePerAsset > 0
    ) {
      liquidationDistance =
        leverageTokenConfig.direction === 'long'
          ? (currentAssetPriceInBorrowToken - liquidationPriceQuotePerAsset) /
            currentAssetPriceInBorrowToken
          : (liquidationPriceQuotePerAsset - currentAssetPriceInBorrowToken) /
            currentAssetPriceInBorrowToken
    }

    let estimatedAssetDeltaAmount = 0
    if (leverageTokenConfig.direction === 'long') {
      if (seedUsesSwap && leverageTokenConfig.loopCollateralMint === leverageTokenConfig.assetMint) {
        estimatedAssetDeltaAmount += seedSwapOutAmount
      }
      estimatedAssetDeltaAmount += mainPlan.steps.reduce((sum, step) => sum + step.swapOutAmount, 0)
    } else {
      if (seedUsesSwap && leverageTokenConfig.startCollateralMint === leverageTokenConfig.assetMint) {
        estimatedAssetDeltaAmount += seedSwapInAmount
      }
      estimatedAssetDeltaAmount += mainPlan.steps.reduce((sum, step) => sum + step.swapInAmount, 0)
    }

    return {
      steps: mainPlan.steps,
      currentHealth,
      projectedHealth: mainPlan.projectedHealth,
      targetUtilization,
      seedUsesSwap,
      seedSwapInAmount,
      seedSwapOutAmount,
      seedCollateralAmount,
      seedCollateralAmountBase,
      inputCollateralValueToken0,
      achievedLeverage: mainPlan.achievedLeverage,
      maxOneTxLeverage: maxPlan.achievedLeverage,
      maxLeverageAtRiskCap,
      maxLeverageAtBorrowLimit,
      liquidationPriceToken1PerToken0,
      liquidationPriceQuotePerAsset,
      currentAssetPriceInBorrowToken,
      liquidationDistance,
      estimatedAssetDeltaAmount,
      targetReached: reachedTarget,
      blockedReason,
    }
  }, [
    leverageInitialCollateral,
    leverageTokenConfig,
    selectedTradeLoanPosition,
    selectedTradePool,
    targetLeverage,
    tradeEstimatedCf0Bps,
    tradeEstimatedCf1Bps,
  ])

  useEffect(() => {
    if (!selectedTradePool) return
    if (lastPoolAddressRef.current === selectedTradePool.address) return
    lastPoolAddressRef.current = selectedTradePool.address

    const token0Stable = isLikelyStableTicker(selectedTradePool.token0Ticker)
    const token1Stable = isLikelyStableTicker(selectedTradePool.token1Ticker)
    const defaultAssetMint =
      token0Stable && !token1Stable
        ? selectedTradePool.token1Mint
        : token1Stable && !token0Stable
          ? selectedTradePool.token0Mint
          : selectedTradePool.token0Mint
    const defaultCollateralMint =
      token0Stable && !token1Stable
        ? selectedTradePool.token0Mint
        : token1Stable && !token0Stable
          ? selectedTradePool.token1Mint
          : selectedTradePool.token1Mint

    setLeverageDirection('long')
    setLeverageAssetToken(defaultAssetMint)
    setLeverageStartCollateralToken(defaultCollateralMint)
    setTargetLeverage(2)
  }, [selectedTradePool])

  useEffect(() => {
    if (!tradeTokenOptions.length) return

    const hasMint = (mint: string) => tradeTokenOptions.some((option) => option.mint === mint)
    const firstMint = tradeTokenOptions[0].mint

    let nextAssetToken = leverageAssetToken
    let nextStartCollateralToken = leverageStartCollateralToken

    if (!nextAssetToken || !hasMint(nextAssetToken)) {
      nextAssetToken = firstMint
    }
    if (!nextStartCollateralToken || !hasMint(nextStartCollateralToken)) {
      nextStartCollateralToken =
        tradeTokenOptions.find((option) => option.mint !== nextAssetToken)?.mint ?? firstMint
    }

    if (nextAssetToken !== leverageAssetToken) {
      setLeverageAssetToken(nextAssetToken)
    }
    if (nextStartCollateralToken !== leverageStartCollateralToken) {
      setLeverageStartCollateralToken(nextStartCollateralToken)
    }
  }, [leverageAssetToken, leverageStartCollateralToken, tradeTokenOptions])

  const executeLeverage = useCallback(async () => {
    setLeverageError(null)
    setLeverageStatus(null)

    if (!account || !isConnected || !signer) {
      setLeverageError('Connect wallet to run leverage loops.')
      return
    }

    if (!selectedTradePool) {
      setLeverageError('Select a pool to run leverage loops.')
      return
    }

    if (!leverageTokenConfig) {
      setLeverageError('Select an asset, side (long/short), and start collateral token.')
      return
    }

    const projectedUtilization = leveragePreview.projectedHealth?.borrowUtilization ?? null
    if (projectedUtilization !== null && projectedUtilization > SAFE_UTILIZATION_CEILING) {
      setLeverageError(
        `Projected borrow utilization ${(projectedUtilization * 100).toFixed(2)}% is above the safety cap (${(
          SAFE_UTILIZATION_CEILING *
          100
        ).toFixed(0)}%). Lower target leverage or add collateral.`,
      )
      return
    }

    const initialCollateralBase = toBaseUnits(
      leverageInitialCollateral,
      leverageTokenConfig.startCollateralDecimals,
    )
    if (!initialCollateralBase || initialCollateralBase <= 0n) {
      setLeverageError(
        `Enter a valid initial collateral amount in ${leverageTokenConfig.startCollateralTicker}.`,
      )
      return
    }

    if (!leveragePreview.steps.length) {
      setLeverageError(leveragePreview.blockedReason ?? 'No valid leverage loops could be built.')
      return
    }

    if (!leveragePreview.targetReached) {
      setLeverageError(leveragePreview.blockedReason ?? 'Target leverage is not reachable in one transaction.')
      return
    }

    const userStartCollateralTokenAccount = await getOwnedTokenAccount(
      rpcRequest,
      account,
      leverageTokenConfig.startCollateralMint,
    )
    if (!userStartCollateralTokenAccount) {
      setLeverageError(`No token account found for ${leverageTokenConfig.startCollateralTicker}.`)
      return
    }

    const userBorrowTokenAccount = await getOwnedTokenAccount(
      rpcRequest,
      account,
      leverageTokenConfig.borrowMint,
    )
    if (!userBorrowTokenAccount) {
      setLeverageError(`No token account found for ${leverageTokenConfig.borrowTicker}.`)
      return
    }

    const existingLoopCollateralAccount = await getOwnedTokenAccount(
      rpcRequest,
      account,
      leverageTokenConfig.loopCollateralMint,
    )
    if (
      !existingLoopCollateralAccount &&
      leverageTokenConfig.startCollateralMint !== leverageTokenConfig.loopCollateralMint
    ) {
      setLeverageError(
        `No token account found for ${leverageTokenConfig.loopCollateralTicker}. Create one first, then retry leverage.`,
      )
      return
    }
    const userLoopCollateralTokenAccount =
      existingLoopCollateralAccount ??
      (await findAssociatedTokenAddress(account, leverageTokenConfig.loopCollateralMint))

    setLeverageSubmitting(true)
    try {
      type ExecutableLoopStep = {
        borrowAmountBase: bigint
        collateralAmountBase: bigint
      }

      type ExecutionPlan = {
        seedCollateralAmountBase: bigint
        steps: ExecutableLoopStep[]
      }

      const toScaledAmount = (amount: bigint, bps: number) => {
        if (amount <= 0n) return 0n
        return (amount * BigInt(bps)) / 10_000n
      }

      const basePlan: ExecutionPlan = {
        seedCollateralAmountBase: leveragePreview.seedCollateralAmountBase,
        steps: leveragePreview.steps.map((step) => ({
          borrowAmountBase: step.borrowAmountBase,
          collateralAmountBase: step.collateralAmountBase,
        })),
      }

      const buildInstructions = async (plan: ExecutionPlan) => {
        const instructions: Instruction<Address>[] = []

        if (leveragePreview.seedUsesSwap) {
          if (plan.seedCollateralAmountBase <= 0n) {
            throw new Error('Initial collateral swap estimate is too small for collateralization.')
          }

          const seedSwapIx = await getSwapInstructionAsync({
            pair: selectedTradePool.address as Address,
            rateModel: selectedTradePool.rateModel as Address,
            userTokenInAccount: userStartCollateralTokenAccount as Address,
            userTokenOutAccount: userLoopCollateralTokenAccount as Address,
            tokenInMint: leverageTokenConfig.startCollateralMint as Address,
            tokenOutMint: leverageTokenConfig.loopCollateralMint as Address,
            user: signer,
            program: OMNIPAIR_PROGRAM_ID as Address,
            amountIn: initialCollateralBase,
            minAmountOut: 0n,
          })
          instructions.push(seedSwapIx)

          const seedAddCollateralIx = await getAddCollateralInstructionAsync({
            pair: selectedTradePool.address as Address,
            rateModel: selectedTradePool.rateModel as Address,
            userCollateralTokenAccount: userLoopCollateralTokenAccount as Address,
            collateralTokenMint: leverageTokenConfig.loopCollateralMint as Address,
            user: signer,
            program: OMNIPAIR_PROGRAM_ID as Address,
            args: { amount: plan.seedCollateralAmountBase },
          })
          instructions.push(seedAddCollateralIx)
        } else {
          const seedCollateralIx = await getAddCollateralInstructionAsync({
            pair: selectedTradePool.address as Address,
            rateModel: selectedTradePool.rateModel as Address,
            userCollateralTokenAccount: userStartCollateralTokenAccount as Address,
            collateralTokenMint: leverageTokenConfig.startCollateralMint as Address,
            user: signer,
            program: OMNIPAIR_PROGRAM_ID as Address,
            args: { amount: initialCollateralBase },
          })
          instructions.push(seedCollateralIx)
        }

        for (const step of plan.steps) {
          if (step.borrowAmountBase <= 0n || step.collateralAmountBase <= 0n) continue

          const borrowIx = await getBorrowInstructionAsync({
            pair: selectedTradePool.address as Address,
            rateModel: selectedTradePool.rateModel as Address,
            userReserveTokenAccount: userBorrowTokenAccount as Address,
            reserveTokenMint: leverageTokenConfig.borrowMint as Address,
            user: signer,
            program: OMNIPAIR_PROGRAM_ID as Address,
            args: { amount: step.borrowAmountBase },
          })
          instructions.push(borrowIx)

          const swapIx = await getSwapInstructionAsync({
            pair: selectedTradePool.address as Address,
            rateModel: selectedTradePool.rateModel as Address,
            userTokenInAccount: userBorrowTokenAccount as Address,
            userTokenOutAccount: userLoopCollateralTokenAccount as Address,
            tokenInMint: leverageTokenConfig.borrowMint as Address,
            tokenOutMint: leverageTokenConfig.loopCollateralMint as Address,
            user: signer,
            program: OMNIPAIR_PROGRAM_ID as Address,
            amountIn: step.borrowAmountBase,
            minAmountOut: 0n,
          })
          instructions.push(swapIx)

          const addCollateralIx = await getAddCollateralInstructionAsync({
            pair: selectedTradePool.address as Address,
            rateModel: selectedTradePool.rateModel as Address,
            userCollateralTokenAccount: userLoopCollateralTokenAccount as Address,
            collateralTokenMint: leverageTokenConfig.loopCollateralMint as Address,
            user: signer,
            program: OMNIPAIR_PROGRAM_ID as Address,
            args: { amount: step.collateralAmountBase },
          })
          instructions.push(addCollateralIx)
        }

        return instructions
      }

      const planCandidates = [
        { seedBps: 10_000, borrowBps: 10_000, collateralBps: 10_000 },
        { seedBps: 9_500, borrowBps: 10_000, collateralBps: 9_000 },
        { seedBps: 9_000, borrowBps: 10_000, collateralBps: 8_500 },
        { seedBps: 8_500, borrowBps: 9_500, collateralBps: 8_000 },
        { seedBps: 8_000, borrowBps: 9_500, collateralBps: 7_500 },
        { seedBps: 7_500, borrowBps: 9_000, collateralBps: 7_000 },
        { seedBps: 7_000, borrowBps: 9_000, collateralBps: 6_500 },
        { seedBps: 6_500, borrowBps: 8_500, collateralBps: 6_000 },
        { seedBps: 6_000, borrowBps: 8_000, collateralBps: 5_500 },
      ]

      const scalePlan = (seedBps: number, borrowBps: number, collateralBps: number): ExecutionPlan => ({
        seedCollateralAmountBase: leveragePreview.seedUsesSwap
          ? toScaledAmount(basePlan.seedCollateralAmountBase, seedBps)
          : basePlan.seedCollateralAmountBase,
        steps: basePlan.steps
          .map((step) => ({
            borrowAmountBase: toScaledAmount(step.borrowAmountBase, borrowBps),
            collateralAmountBase: toScaledAmount(step.collateralAmountBase, collateralBps),
          }))
          .filter((step) => step.borrowAmountBase > 0n && step.collateralAmountBase > 0n),
      })

      let sentPlan: ExecutionPlan | null = null
      let sentCandidate = planCandidates[0]
      let signature = ''
      let lastRecoverableError: unknown = null

      for (const candidate of planCandidates) {
        const candidatePlan = scalePlan(
          candidate.seedBps,
          candidate.borrowBps,
          candidate.collateralBps,
        )
        if (!candidatePlan.steps.length) continue

        try {
          const instructions = await buildInstructions(candidatePlan)
          signature = await send(instructions)
          sentPlan = candidatePlan
          sentCandidate = candidate
          break
        } catch (error) {
          const code = getSimulationCustomErrorCode(error)
          if (code !== 6023 && code !== 6010) {
            throw error
          }
          lastRecoverableError = error
        }
      }

      if (!sentPlan || !signature) {
        if (lastRecoverableError) {
          const code = getSimulationCustomErrorCode(lastRecoverableError)
          if (code === 6023) {
            throw new Error(
              'Leverage auto-sizing could not find a collateral amount that clears simulation. This pool/token likely needs a lower target leverage or larger collateral buffer.',
            )
          }
          if (code === 6010) {
            throw new Error(
              'Leverage auto-sizing hit borrow-power limits across all attempts. Lower target leverage or add more initial collateral.',
            )
          }
          throw lastRecoverableError
        }
        throw new Error('No executable leverage sizing found.')
      }

      const loopCount = sentPlan.steps.length
      const fallbackNote =
        sentCandidate.seedBps < 10_000 ||
        sentCandidate.borrowBps < 10_000 ||
        sentCandidate.collateralBps < 10_000
          ? ` (auto-sized for execution margin: seed ${(
              sentCandidate.seedBps / 100
            ).toFixed(1)}%, borrow ${(sentCandidate.borrowBps / 100).toFixed(1)}%, collateral ${(
              sentCandidate.collateralBps / 100
            ).toFixed(1)}%)`
          : ''
      setLeverageStatus(
        `Leverage loop submitted (${loopCount} loop${loopCount === 1 ? '' : 's'}): ${shortAddress(signature)}${fallbackNote}`,
      )
      onTradeSuccess?.()
    } catch (error) {
      setLeverageError(formatActionError(error, 'Leverage loop failed'))
    } finally {
      setLeverageSubmitting(false)
    }
  }, [
    account,
    isConnected,
    leverageInitialCollateral,
    leveragePreview.blockedReason,
    leveragePreview.projectedHealth,
    leveragePreview.seedCollateralAmountBase,
    leveragePreview.seedUsesSwap,
    leveragePreview.steps,
    leveragePreview.targetReached,
    leverageTokenConfig,
    onTradeSuccess,
    rpcRequest,
    selectedTradePool,
    send,
    signer,
  ])

  const clearLeverageFeedback = useCallback(() => {
    setLeverageError(null)
    setLeverageStatus(null)
  }, [])

  const projectedUtilization = leveragePreview.projectedHealth?.borrowUtilization ?? null
  const safetyBuffer = projectedUtilization === null ? null : Math.max(0, 1 - projectedUtilization)
  const isSafePlan = projectedUtilization === null || projectedUtilization <= SAFE_UTILIZATION_CEILING

  return {
    leverageDirection,
    leverageAssetToken,
    leverageStartCollateralToken,
    leverageInitialCollateral,
    targetLeverage,
    leverageSubmitting,
    leverageStatus,
    leverageError,
    leverageAssetTicker: leverageTokenConfig?.assetTicker ?? leverageAssetTokenInfo.ticker,
    leverageBorrowTicker: leverageTokenConfig?.borrowTicker ?? '',
    leverageLoopCollateralTicker: leverageTokenConfig?.loopCollateralTicker ?? '',
    leverageCurrentLtv: leveragePreview.currentHealth?.ltv ?? null,
    leverageProjectedLtv: leveragePreview.projectedHealth?.ltv ?? null,
    leverageCurrentUtilization: leveragePreview.currentHealth?.borrowUtilization ?? null,
    leverageProjectedUtilization: projectedUtilization,
    leverageTargetUtilization: leveragePreview.targetUtilization,
    leverageSeedUsesSwap: leveragePreview.seedUsesSwap,
    leverageSeedSwapInAmount: leveragePreview.seedSwapInAmount,
    leverageSeedSwapOutAmount: leveragePreview.seedSwapOutAmount,
    leverageSeedCollateralAmount: leveragePreview.seedCollateralAmount,
    leverageAchievedMultiple: leveragePreview.achievedLeverage,
    leverageMaxOneTxMultiple: leveragePreview.maxOneTxLeverage,
    leverageMaxByRiskCapMultiple: leveragePreview.maxLeverageAtRiskCap,
    leverageMaxByBorrowLimitMultiple: leveragePreview.maxLeverageAtBorrowLimit,
    leverageLiquidationPriceInBorrowToken: leveragePreview.liquidationPriceQuotePerAsset,
    leverageCurrentAssetPriceInBorrowToken: leveragePreview.currentAssetPriceInBorrowToken,
    leverageLiquidationDistance: leveragePreview.liquidationDistance,
    leverageEstimatedAssetDeltaAmount: leveragePreview.estimatedAssetDeltaAmount,
    leverageTargetReached: leveragePreview.targetReached,
    leverageSafetyBuffer: safetyBuffer,
    leverageInputCollateralValueToken0: leveragePreview.inputCollateralValueToken0,
    leveragePlanBlockedReason: leveragePreview.blockedReason,
    leverageLoopCap: MAX_LEVERAGE_LOOPS,
    leverageIsPlanSafe: isSafePlan,
    leverageSteps: leveragePreview.steps,
    setLeverageDirection,
    setLeverageAssetToken,
    setLeverageStartCollateralToken,
    setLeverageInitialCollateral,
    setTargetLeverage: (nextTarget: number) => {
      setTargetLeverage(clamp(nextTarget, MIN_TARGET_LEVERAGE, MAX_TARGET_LEVERAGE))
    },
    executeLeverage,
    clearLeverageFeedback,
  }
}
