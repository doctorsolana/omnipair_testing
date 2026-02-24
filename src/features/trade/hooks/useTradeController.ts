import { useEffect, useMemo, useState } from 'react'
import type { Address, Instruction, TransactionSigner } from '@solana/kit'
import type { LoanPositionView, PoolSelectOption, PoolView, TradeTokenOption } from '@/features/market/types'
import { estimateMaxBorrowCfBps, getTokenColor } from '@/features/market/utils'
import { createRpcRequest } from '@/integrations/wallet/rpcHelpers'
import { useLeverageTradeController } from '@/features/trade/leverage/useLeverageTradeController'
import { useSpotTradeController } from '@/features/trade/spot/useSpotTradeController'

type UseTradeControllerParams = {
  pools: PoolView[]
  poolSelectOptions: PoolSelectOption[]
  loanPositions: LoanPositionView[]
  account: string | null
  isConnected: boolean
  rpcUrl: string
  signer: TransactionSigner<string> | null
  simulate: (
    instructions: Instruction<Address>[],
  ) => Promise<{ value?: { err?: unknown } } | null | undefined>
  send: (instructions: Instruction<Address>[]) => Promise<string>
  onTradeSuccess?: () => void
}

export function useTradeController({
  pools,
  poolSelectOptions,
  loanPositions,
  account,
  isConnected,
  rpcUrl,
  signer,
  simulate,
  send,
  onTradeSuccess,
}: UseTradeControllerParams) {
  const [tradePool, setTradePool] = useState('')
  const [tradeMode, setTradeMode] = useState<'swap' | 'leverage'>('swap')

  const rpcRequest = useMemo(() => createRpcRequest(rpcUrl), [rpcUrl])
  const effectiveTradePool = tradePool || pools[0]?.address || ''

  const selectedTradePool = useMemo(() => {
    return pools.find((pool) => pool.address === effectiveTradePool) ?? pools[0] ?? null
  }, [effectiveTradePool, pools])

  const tradeTokenOptions = useMemo<TradeTokenOption[]>(() => {
    if (!selectedTradePool) return []
    return [
      {
        mint: selectedTradePool.token0Mint,
        ticker: selectedTradePool.token0Ticker,
        name: selectedTradePool.token0Ticker,
        logo: selectedTradePool.token0Ticker.slice(0, 1),
        color: getTokenColor(selectedTradePool.token0Mint),
        logoUrl: selectedTradePool.token0LogoUrl,
      },
      {
        mint: selectedTradePool.token1Mint,
        ticker: selectedTradePool.token1Ticker,
        name: selectedTradePool.token1Ticker,
        logo: selectedTradePool.token1Ticker.slice(0, 1),
        color: getTokenColor(selectedTradePool.token1Mint),
        logoUrl: selectedTradePool.token1LogoUrl,
      },
    ]
  }, [selectedTradePool])

  const selectedTradeLoanPosition = useMemo(() => {
    if (!selectedTradePool) return null
    return loanPositions.find((position) => position.poolAddress === selectedTradePool.address) ?? null
  }, [loanPositions, selectedTradePool])

  const tradeEstimatedCf0Bps = useMemo(() => {
    return estimateMaxBorrowCfBps({
      liquidationCfBps: selectedTradeLoanPosition?.cf0 ?? null,
      fixedCfBps: selectedTradePool?.fixedCfBps ?? null,
    })
  }, [selectedTradeLoanPosition, selectedTradePool])

  const tradeEstimatedCf1Bps = useMemo(() => {
    return estimateMaxBorrowCfBps({
      liquidationCfBps: selectedTradeLoanPosition?.cf1 ?? null,
      fixedCfBps: selectedTradePool?.fixedCfBps ?? null,
    })
  }, [selectedTradeLoanPosition, selectedTradePool])

  const {
    tradeFromAmount,
    tradeToAmount,
    tradeFromToken,
    tradeToToken,
    tradeError,
    tradeStatus,
    tradeSubmitting,
    setTradeFromAmount,
    setTradeToAmount,
    setTradeFromToken,
    setTradeToToken,
    switchTradeDirection,
    executeTrade,
    clearSpotFeedback,
  } = useSpotTradeController({
    account,
    isConnected,
    signer,
    selectedTradePool,
    tradeTokenOptions,
    rpcRequest,
    simulate,
    send,
    onTradeSuccess,
  })

  const {
    leverageDirection,
    leverageAssetToken,
    leverageStartCollateralToken,
    leverageInitialCollateral,
    targetLeverage,
    leverageSubmitting,
    leverageStatus,
    leverageError,
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
    setLeverageDirection,
    setLeverageAssetToken,
    setLeverageStartCollateralToken,
    setLeverageInitialCollateral,
    setTargetLeverage,
    executeLeverage,
    clearLeverageFeedback,
  } = useLeverageTradeController({
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
  })

  useEffect(() => {
    clearSpotFeedback()
    clearLeverageFeedback()
  }, [
    clearLeverageFeedback,
    clearSpotFeedback,
    leverageAssetToken,
    leverageDirection,
    leverageStartCollateralToken,
    targetLeverage,
    tradeMode,
    effectiveTradePool,
  ])

  return {
    isWalletConnected: Boolean(isConnected && account),
    poolSelectOptions,
    tradePool: effectiveTradePool,
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
  }
}
