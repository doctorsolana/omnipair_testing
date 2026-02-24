import { useCallback, useMemo, useState } from 'react'
import type { Address, Instruction, TransactionSigner } from '@solana/kit'
import {
  getRemoveCollateralInstructionAsync,
  getRepayInstructionAsync,
  getUserPositionDecoder,
  OMNIPAIR_PROGRAM_ID,
  type UserPosition,
} from '@/protocol/omnipair'
import type { LoanPositionView, LpPositionView, PoolView } from '@/features/market/types'
import {
  applyDebtFromShares,
  base64ToBytes,
  formatCompact,
  toBaseUnits,
  toDisplayNumber,
} from '@/features/market/utils'
import { formatSimulationError } from '@/shared/utils/error'
import {
  createRpcRequest,
  fetchWalletTokenBalances,
  findUserPositionAddress,
  getOwnedTokenAccount,
  type RpcMultipleAccountInfoResult,
} from '@/integrations/wallet/rpcHelpers'

type UsePositionsControllerParams = {
  account: string | null
  isConnected: boolean
  rpcUrl: string
  pools: PoolView[]
  signer: TransactionSigner<string> | null
  simulate: (
    instructions: Instruction<Address>[],
  ) => Promise<{ value?: { err?: unknown } } | null | undefined>
  send: (instructions: Instruction<Address>[]) => Promise<string>
  onRepaySuccess?: () => void
  onRemoveCollateralSuccess?: () => void
}

export function usePositionsController({
  account,
  isConnected,
  rpcUrl,
  pools,
  signer,
  simulate,
  send,
  onRepaySuccess,
  onRemoveCollateralSuccess,
}: UsePositionsControllerParams) {
  const [positionsLoading, setPositionsLoading] = useState(false)
  const [positionsError, setPositionsError] = useState<string | null>(null)
  const [loanPositions, setLoanPositions] = useState<LoanPositionView[]>([])
  const [lpPositions, setLpPositions] = useState<LpPositionView[]>([])

  const rpcRequest = useMemo(() => createRpcRequest(rpcUrl), [rpcUrl])

  const poolSymbolsByAddress = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const pool of pools) {
      map[pool.address] = pool.symbol
    }
    return map
  }, [pools])

  const loadPositionsData = useCallback(async () => {
    if (!account || !isConnected) {
      setLoanPositions([])
      setLpPositions([])
      setPositionsError(null)
      return
    }

    if (!pools.length) {
      setLoanPositions([])
      setLpPositions([])
      return
    }

    setPositionsLoading(true)
    setPositionsError(null)

    try {
      const decoder = getUserPositionDecoder()
      const [positionAddresses, tokenBalancesByMint] = await Promise.all([
        Promise.all(
          pools.map(async (pool) => {
            const positionAddress = await findUserPositionAddress(pool.address, account)
            return String(positionAddress)
          }),
        ),
        fetchWalletTokenBalances(rpcRequest, account),
      ])

      const positionInfos = await rpcRequest<RpcMultipleAccountInfoResult>('getMultipleAccounts', [
        positionAddresses,
        { encoding: 'base64', commitment: 'confirmed' },
      ])

      const entries = pools.map((pool, index) => {
        let loanPosition: LoanPositionView | null = null
        const accountInfo = positionInfos.value[index]

        if (accountInfo?.data) {
          const encodedData = accountInfo.data
          const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData

          if (typeof base64Data === 'string') {
            try {
              const userPosition = decoder.decode(base64ToBytes(base64Data)) as UserPosition
              const collateral0 = toDisplayNumber(userPosition.collateral0, pool.token0Decimals)
              const collateral1 = toDisplayNumber(userPosition.collateral1, pool.token1Decimals)
              const debt0 = toDisplayNumber(
                applyDebtFromShares(userPosition.debt0Shares, pool.totalDebt0, pool.totalDebt0Shares),
                pool.token0Decimals,
              )
              const debt1 = toDisplayNumber(
                applyDebtFromShares(userPosition.debt1Shares, pool.totalDebt1, pool.totalDebt1Shares),
                pool.token1Decimals,
              )

              if (collateral0 > 0 || collateral1 > 0 || debt0 > 0 || debt1 > 0) {
                loanPosition = {
                  poolAddress: pool.address,
                  symbol: pool.symbol,
                  rateModel: pool.rateModel,
                  token0Mint: pool.token0Mint,
                  token1Mint: pool.token1Mint,
                  token0Ticker: pool.token0Ticker,
                  token1Ticker: pool.token1Ticker,
                  token0Decimals: pool.token0Decimals,
                  token1Decimals: pool.token1Decimals,
                  token0LogoUrl: pool.token0LogoUrl,
                  token1LogoUrl: pool.token1LogoUrl,
                  collateral0,
                  collateral1,
                  debt0,
                  debt1,
                  cf0: userPosition.collateral0LiquidationCfBps,
                  cf1: userPosition.collateral1LiquidationCfBps,
                }
              }
            } catch {
              loanPosition = null
            }
          }
        }

        const lpBalance = tokenBalancesByMint.get(pool.lpMint) ?? 0
        const lpPosition: LpPositionView | null =
          lpBalance > 0
            ? {
                poolAddress: pool.address,
                symbol: pool.symbol,
                lpBalance,
                lpBalanceLabel: formatCompact(lpBalance, 4),
              }
            : null

        return { loanPosition, lpPosition }
      })

      setLoanPositions(
        entries
          .map((entry) => entry.loanPosition)
          .filter((entry): entry is LoanPositionView => Boolean(entry)),
      )
      setLpPositions(
        entries.map((entry) => entry.lpPosition).filter((entry): entry is LpPositionView => Boolean(entry)),
      )
    } catch (error) {
      setPositionsError(error instanceof Error ? error.message : 'Unable to load positions')
    } finally {
      setPositionsLoading(false)
    }
  }, [account, isConnected, pools, rpcRequest])

  const executeRepayLoan = useCallback(
    async (poolAddress: string, reserveTokenMint: string, amountInput: string) => {
      if (!account || !isConnected || !signer) {
        throw new Error('Connect wallet to repay.')
      }

      const pool = pools.find((item) => item.address === poolAddress)
      if (!pool) {
        throw new Error('Pool not found for this position.')
      }

      const reserveIsToken0 = reserveTokenMint === pool.token0Mint
      const reserveIsToken1 = reserveTokenMint === pool.token1Mint
      if (!reserveIsToken0 && !reserveIsToken1) {
        throw new Error('Selected repay token does not belong to this pool.')
      }

      const reserveDecimals = reserveIsToken0 ? pool.token0Decimals : pool.token1Decimals
      const repayAmount = toBaseUnits(amountInput, reserveDecimals)
      if (!repayAmount || repayAmount <= 0n) {
        throw new Error('Enter a valid repay amount.')
      }

      const userReserveTokenAccount = await getOwnedTokenAccount(rpcRequest, account, reserveTokenMint)
      if (!userReserveTokenAccount) {
        const tokenLabel = reserveIsToken0 ? pool.token0Ticker : pool.token1Ticker
        throw new Error(`No token account found for ${tokenLabel}.`)
      }

      const repayInstruction = await getRepayInstructionAsync({
        pair: pool.address as Address,
        rateModel: pool.rateModel as Address,
        userReserveTokenAccount: userReserveTokenAccount as Address,
        reserveTokenMint: reserveTokenMint as Address,
        user: signer,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount: repayAmount },
      })

      const simulation = await simulate([repayInstruction])
      if (simulation?.value?.err) {
        throw new Error(`Simulation failed: ${formatSimulationError(simulation.value.err)}`)
      }

      const signature = await send([repayInstruction])
      await loadPositionsData()
      onRepaySuccess?.()
      return signature
    },
    [account, isConnected, loadPositionsData, onRepaySuccess, pools, rpcRequest, send, signer, simulate],
  )

  const executeRemoveCollateral = useCallback(
    async (poolAddress: string, collateralTokenMint: string, amountInput: string) => {
      if (!account || !isConnected || !signer) {
        throw new Error('Connect wallet to withdraw collateral.')
      }

      const pool = pools.find((item) => item.address === poolAddress)
      if (!pool) {
        throw new Error('Pool not found for this position.')
      }

      const collateralIsToken0 = collateralTokenMint === pool.token0Mint
      const collateralIsToken1 = collateralTokenMint === pool.token1Mint
      if (!collateralIsToken0 && !collateralIsToken1) {
        throw new Error('Selected collateral token does not belong to this pool.')
      }

      const collateralDecimals = collateralIsToken0 ? pool.token0Decimals : pool.token1Decimals
      const removeAmount = toBaseUnits(amountInput, collateralDecimals)
      if (!removeAmount || removeAmount <= 0n) {
        throw new Error('Enter a valid collateral amount to withdraw.')
      }

      const userCollateralTokenAccount = await getOwnedTokenAccount(rpcRequest, account, collateralTokenMint)
      if (!userCollateralTokenAccount) {
        const tokenLabel = collateralIsToken0 ? pool.token0Ticker : pool.token1Ticker
        throw new Error(`No token account found for ${tokenLabel}.`)
      }

      const removeCollateralInstruction = await getRemoveCollateralInstructionAsync({
        pair: pool.address as Address,
        rateModel: pool.rateModel as Address,
        userCollateralTokenAccount: userCollateralTokenAccount as Address,
        collateralTokenMint: collateralTokenMint as Address,
        user: signer,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount: removeAmount },
      })

      const simulation = await simulate([removeCollateralInstruction])
      if (simulation?.value?.err) {
        throw new Error(`Simulation failed: ${formatSimulationError(simulation.value.err)}`)
      }

      const signature = await send([removeCollateralInstruction])
      await loadPositionsData()
      onRemoveCollateralSuccess?.()
      return signature
    },
    [
      account,
      isConnected,
      loadPositionsData,
      onRemoveCollateralSuccess,
      pools,
      rpcRequest,
      send,
      signer,
      simulate,
    ],
  )

  return {
    positionsLoading,
    positionsError,
    loanPositions,
    lpPositions,
    poolSymbolsByAddress,
    loadPositionsData,
    executeRepayLoan,
    executeRemoveCollateral,
  }
}
