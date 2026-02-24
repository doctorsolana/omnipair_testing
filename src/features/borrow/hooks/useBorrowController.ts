import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Address, Instruction, TransactionSigner } from '@solana/kit'
import {
  getAddCollateralInstructionAsync,
  getBorrowInstructionAsync,
  OMNIPAIR_PROGRAM_ID,
} from '@/protocol/omnipair'
import type {
  BorrowHealthSnapshot,
  LoanPositionView,
  PoolSelectOption,
  PoolView,
  TradeTokenOption,
} from '@/features/market/types'
import {
  computeBorrowHealthSnapshot,
  estimateMaxBorrowCfBps,
  formatCompact,
  getTokenColor,
  shortAddress,
  toBaseUnits,
  toDisplayNumber,
} from '@/features/market/utils'
import { formatActionError, formatSimulationError } from '@/shared/utils/error'
import {
  createRpcRequest,
  fetchWalletTokenBalances,
  getOwnedTokenAccount,
} from '@/integrations/wallet/rpcHelpers'
import { DEFAULT_TRADE_TOKEN } from '@/features/market/types'

type UseBorrowControllerParams = {
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
  isActive: boolean
  onBorrowSuccess?: () => void
}

export function useBorrowController({
  pools,
  poolSelectOptions,
  loanPositions,
  account,
  isConnected,
  rpcUrl,
  signer,
  simulate,
  send,
  isActive,
  onBorrowSuccess,
}: UseBorrowControllerParams) {
  const lastBorrowPoolAddressRef = useRef<string | null>(null)

  const [borrowPool, setBorrowPool] = useState('')
  const [borrowToken, setBorrowToken] = useState('')
  const [borrowAmount, setBorrowAmount] = useState('')
  const [collateralToken, setCollateralToken] = useState('')
  const [collateralAmount, setCollateralAmount] = useState('')
  const [borrowTokenBalances, setBorrowTokenBalances] = useState<Record<string, number>>({})
  const [borrowSubmitting, setBorrowSubmitting] = useState(false)
  const [borrowStatus, setBorrowStatus] = useState<string | null>(null)
  const [borrowError, setBorrowError] = useState<string | null>(null)

  const rpcRequest = useMemo(() => createRpcRequest(rpcUrl), [rpcUrl])

  const selectedBorrowPool = useMemo(() => {
    return pools.find((pool) => pool.address === borrowPool) ?? pools[0] ?? null
  }, [borrowPool, pools])

  const borrowTokenOptions = useMemo<TradeTokenOption[]>(() => {
    if (!selectedBorrowPool) return []
    return [
      {
        mint: selectedBorrowPool.token0Mint,
        ticker: selectedBorrowPool.token0Ticker,
        name: selectedBorrowPool.token0Ticker,
        logo: selectedBorrowPool.token0Ticker.slice(0, 1),
        color: getTokenColor(selectedBorrowPool.token0Mint),
        logoUrl: selectedBorrowPool.token0LogoUrl,
      },
      {
        mint: selectedBorrowPool.token1Mint,
        ticker: selectedBorrowPool.token1Ticker,
        name: selectedBorrowPool.token1Ticker,
        logo: selectedBorrowPool.token1Ticker.slice(0, 1),
        color: getTokenColor(selectedBorrowPool.token1Mint),
        logoUrl: selectedBorrowPool.token1LogoUrl,
      },
    ]
  }, [selectedBorrowPool])

  const collateralTokenOptions = borrowTokenOptions

  const borrowTokenInfo = useMemo(
    () =>
      borrowTokenOptions.find((token) => token.mint === borrowToken) ??
      borrowTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [borrowToken, borrowTokenOptions],
  )

  const collateralTokenInfo = useMemo(
    () =>
      collateralTokenOptions.find((token) => token.mint === collateralToken) ??
      collateralTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [collateralToken, collateralTokenOptions],
  )

  const selectedBorrowLoanPosition = useMemo(() => {
    if (!selectedBorrowPool) return null
    return loanPositions.find((position) => position.poolAddress === selectedBorrowPool.address) ?? null
  }, [loanPositions, selectedBorrowPool])

  const estimatedCf0Bps = useMemo(() => {
    return estimateMaxBorrowCfBps({
      liquidationCfBps: selectedBorrowLoanPosition?.cf0 ?? null,
      fixedCfBps: selectedBorrowPool?.fixedCfBps ?? null,
    })
  }, [selectedBorrowLoanPosition, selectedBorrowPool])

  const estimatedCf1Bps = useMemo(() => {
    return estimateMaxBorrowCfBps({
      liquidationCfBps: selectedBorrowLoanPosition?.cf1 ?? null,
      fixedCfBps: selectedBorrowPool?.fixedCfBps ?? null,
    })
  }, [selectedBorrowLoanPosition, selectedBorrowPool])

  const currentBorrowHealth = useMemo<BorrowHealthSnapshot | null>(() => {
    if (!selectedBorrowPool) return null

    return computeBorrowHealthSnapshot({
      priceToken1PerToken0: selectedBorrowPool.price,
      collateral0: selectedBorrowLoanPosition?.collateral0 ?? 0,
      collateral1: selectedBorrowLoanPosition?.collateral1 ?? 0,
      debt0: selectedBorrowLoanPosition?.debt0 ?? 0,
      debt1: selectedBorrowLoanPosition?.debt1 ?? 0,
      cf0Bps: estimatedCf0Bps,
      cf1Bps: estimatedCf1Bps,
    })
  }, [estimatedCf0Bps, estimatedCf1Bps, selectedBorrowLoanPosition, selectedBorrowPool])

  const projectedBorrowHealth = useMemo<BorrowHealthSnapshot | null>(() => {
    if (!selectedBorrowPool || !currentBorrowHealth) return null

    let collateral0 = selectedBorrowLoanPosition?.collateral0 ?? 0
    let collateral1 = selectedBorrowLoanPosition?.collateral1 ?? 0
    let debt0 = selectedBorrowLoanPosition?.debt0 ?? 0
    let debt1 = selectedBorrowLoanPosition?.debt1 ?? 0

    const collateralIsToken0 = selectedBorrowPool.token0Mint === collateralToken
    const collateralDecimals = collateralIsToken0
      ? selectedBorrowPool.token0Decimals
      : selectedBorrowPool.token1Decimals
    const collateralBase =
      collateralToken && collateralAmount.trim() ? toBaseUnits(collateralAmount, collateralDecimals) : 0n
    const collateralValue =
      collateralBase && collateralBase > 0n ? toDisplayNumber(collateralBase, collateralDecimals) : 0
    if (collateralValue > 0) {
      if (collateralIsToken0) {
        collateral0 += collateralValue
      } else {
        collateral1 += collateralValue
      }
    }

    const borrowIsToken0 = selectedBorrowPool.token0Mint === borrowToken
    const borrowDecimals = borrowIsToken0 ? selectedBorrowPool.token0Decimals : selectedBorrowPool.token1Decimals
    const borrowBase = borrowToken ? toBaseUnits(borrowAmount, borrowDecimals) : 0n
    const borrowValue = borrowBase && borrowBase > 0n ? toDisplayNumber(borrowBase, borrowDecimals) : 0
    if (borrowValue > 0) {
      if (borrowIsToken0) {
        debt0 += borrowValue
      } else {
        debt1 += borrowValue
      }
    }

    return computeBorrowHealthSnapshot({
      priceToken1PerToken0: selectedBorrowPool.price,
      collateral0,
      collateral1,
      debt0,
      debt1,
      cf0Bps: estimatedCf0Bps,
      cf1Bps: estimatedCf1Bps,
    })
  }, [
    borrowAmount,
    borrowToken,
    collateralAmount,
    collateralToken,
    currentBorrowHealth,
    estimatedCf0Bps,
    estimatedCf1Bps,
    selectedBorrowLoanPosition,
    selectedBorrowPool,
  ])

  const collateralBalanceLabel = useMemo(() => {
    if (!collateralTokenInfo.mint) return '--'
    const balance = borrowTokenBalances[collateralTokenInfo.mint] ?? 0
    return `${formatCompact(balance, 4)} ${collateralTokenInfo.ticker}`
  }, [borrowTokenBalances, collateralTokenInfo])

  const loadBorrowTokenBalances = useCallback(async () => {
    if (!account || !isConnected || !selectedBorrowPool) {
      setBorrowTokenBalances({})
      return
    }

    try {
      const balances = await fetchWalletTokenBalances(rpcRequest, account)
      const nextBalances: Record<string, number> = {
        [selectedBorrowPool.token0Mint]: balances.get(selectedBorrowPool.token0Mint) ?? 0,
        [selectedBorrowPool.token1Mint]: balances.get(selectedBorrowPool.token1Mint) ?? 0,
      }
      setBorrowTokenBalances(nextBalances)
    } catch {
      setBorrowTokenBalances({})
    }
  }, [account, isConnected, rpcRequest, selectedBorrowPool])

  useEffect(() => {
    if (!pools.length) return
    if (!borrowPool) {
      setBorrowPool(pools[0].address)
    }
  }, [borrowPool, pools])

  useEffect(() => {
    if (!selectedBorrowPool) return
    if (lastBorrowPoolAddressRef.current === selectedBorrowPool.address) return
    lastBorrowPoolAddressRef.current = selectedBorrowPool.address

    setBorrowToken(selectedBorrowPool.token0Mint)
    setCollateralToken(selectedBorrowPool.token1Mint)
  }, [selectedBorrowPool])

  useEffect(() => {
    if (!borrowTokenOptions.length) return

    const hasMint = (mint: string) => borrowTokenOptions.some((option) => option.mint === mint)
    const firstMint = borrowTokenOptions[0].mint

    let nextBorrowToken = borrowToken
    let nextCollateralToken = collateralToken

    if (!nextBorrowToken || !hasMint(nextBorrowToken)) {
      nextBorrowToken = firstMint
    }
    if (!nextCollateralToken || !hasMint(nextCollateralToken)) {
      nextCollateralToken =
        borrowTokenOptions.find((option) => option.mint !== nextBorrowToken)?.mint ?? firstMint
    }

    if (nextBorrowToken === nextCollateralToken) {
      const alternateMint =
        borrowTokenOptions.find((option) => option.mint !== nextBorrowToken)?.mint ?? nextBorrowToken
      nextCollateralToken = alternateMint
    }

    if (nextBorrowToken !== borrowToken) {
      setBorrowToken(nextBorrowToken)
    }
    if (nextCollateralToken !== collateralToken) {
      setCollateralToken(nextCollateralToken)
    }
  }, [borrowToken, borrowTokenOptions, collateralToken])

  useEffect(() => {
    if (!isActive) return
    void loadBorrowTokenBalances()
  }, [isActive, loadBorrowTokenBalances])

  const setBorrowTokenWithPairing = useCallback(
    (nextBorrowToken: string) => {
      setBorrowToken(nextBorrowToken)
      if (nextBorrowToken === collateralToken) {
        const alternateToken = borrowTokenOptions.find((token) => token.mint !== nextBorrowToken)?.mint
        if (alternateToken) {
          setCollateralToken(alternateToken)
        }
      }
    },
    [borrowTokenOptions, collateralToken],
  )

  const setCollateralTokenWithPairing = useCallback(
    (nextCollateralToken: string) => {
      setCollateralToken(nextCollateralToken)
      if (nextCollateralToken === borrowToken) {
        const alternateToken = collateralTokenOptions.find((token) => token.mint !== nextCollateralToken)?.mint
        if (alternateToken) {
          setBorrowToken(alternateToken)
        }
      }
    },
    [borrowToken, collateralTokenOptions],
  )

  const switchBorrowDirection = useCallback(() => {
    if (!borrowTokenOptions.length) return
    const nextBorrowToken =
      collateralToken || borrowTokenOptions.find((token) => token.mint !== borrowToken)?.mint || borrowToken
    const nextCollateralToken = borrowToken
    if (!nextBorrowToken || !nextCollateralToken || nextBorrowToken === nextCollateralToken) return

    setBorrowToken(nextBorrowToken)
    setCollateralToken(nextCollateralToken)
  }, [borrowToken, borrowTokenOptions, collateralToken])

  const executeBorrow = useCallback(async () => {
    setBorrowError(null)
    setBorrowStatus(null)

    if (!account || !isConnected || !signer) {
      setBorrowError('Connect wallet to borrow.')
      return
    }

    if (!selectedBorrowPool) {
      setBorrowError('Select a pool to borrow from.')
      return
    }

    if (!borrowToken) {
      setBorrowError('Select a token to borrow.')
      return
    }

    if (borrowToken === collateralToken) {
      setBorrowError('Borrow token and collateral token must be different in this pool.')
      return
    }

    if (!collateralToken) {
      setBorrowError('Select a collateral token.')
      return
    }

    const isToken0 = selectedBorrowPool.token0Mint === borrowToken
    const borrowDecimals = isToken0 ? selectedBorrowPool.token0Decimals : selectedBorrowPool.token1Decimals
    const amount = toBaseUnits(borrowAmount, borrowDecimals)

    if (!amount || amount <= 0n) {
      setBorrowError('Enter a valid borrow amount.')
      return
    }

    const collateralIsToken0 = selectedBorrowPool.token0Mint === collateralToken
    const collateralDecimals = collateralIsToken0
      ? selectedBorrowPool.token0Decimals
      : selectedBorrowPool.token1Decimals
    const normalizedCollateralInput = collateralAmount.trim()
    const collateralBaseAmount = normalizedCollateralInput
      ? toBaseUnits(normalizedCollateralInput, collateralDecimals)
      : 0n
    if (normalizedCollateralInput && collateralBaseAmount === null) {
      setBorrowError('Enter a valid collateral amount.')
      return
    }
    const shouldAddCollateral = typeof collateralBaseAmount === 'bigint' && collateralBaseAmount > 0n

    setBorrowSubmitting(true)

    try {
      const userReserveTokenAccount = await getOwnedTokenAccount(rpcRequest, account, borrowToken)
      if (!userReserveTokenAccount) {
        setBorrowError(`No token account found for ${borrowTokenInfo.ticker}.`)
        return
      }

      const transactionInstructions: Instruction<Address>[] = []
      if (shouldAddCollateral) {
        const userCollateralTokenAccount = await getOwnedTokenAccount(rpcRequest, account, collateralToken)
        if (!userCollateralTokenAccount) {
          setBorrowError(`No token account found for ${collateralTokenInfo.ticker}.`)
          return
        }

        const addCollateralInstruction = await getAddCollateralInstructionAsync({
          pair: selectedBorrowPool.address as Address,
          rateModel: selectedBorrowPool.rateModel as Address,
          userCollateralTokenAccount: userCollateralTokenAccount as Address,
          collateralTokenMint: collateralToken as Address,
          user: signer,
          program: OMNIPAIR_PROGRAM_ID as Address,
          args: { amount: collateralBaseAmount },
        })
        transactionInstructions.push(addCollateralInstruction)
      }

      const borrowInstruction = await getBorrowInstructionAsync({
        pair: selectedBorrowPool.address as Address,
        rateModel: selectedBorrowPool.rateModel as Address,
        userReserveTokenAccount: userReserveTokenAccount as Address,
        reserveTokenMint: borrowToken as Address,
        user: signer,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount },
      })
      transactionInstructions.push(borrowInstruction)

      const simulation = await simulate(transactionInstructions)
      if (simulation?.value?.err) {
        setBorrowError(`Simulation failed: ${formatSimulationError(simulation.value.err)}`)
        return
      }

      const signature = await send(transactionInstructions)
      setBorrowStatus(
        `${shouldAddCollateral ? 'Collateral + borrow' : 'Borrow'} submitted: ${shortAddress(signature)}`,
      )
      setCollateralAmount('')
      onBorrowSuccess?.()
      void loadBorrowTokenBalances()
    } catch (error) {
      setBorrowError(formatActionError(error, 'Borrow failed'))
    } finally {
      setBorrowSubmitting(false)
    }
  }, [
    account,
    borrowAmount,
    borrowToken,
    borrowTokenInfo.ticker,
    collateralAmount,
    collateralToken,
    collateralTokenInfo.ticker,
    isConnected,
    loadBorrowTokenBalances,
    onBorrowSuccess,
    rpcRequest,
    selectedBorrowPool,
    send,
    signer,
    simulate,
  ])

  return {
    isWalletConnected: Boolean(isConnected && account),
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
    setBorrowToken: setBorrowTokenWithPairing,
    setCollateralAmount,
    setCollateralToken: setCollateralTokenWithPairing,
    switchBorrowDirection,
    executeBorrow,
    refreshBorrowTokenBalances: loadBorrowTokenBalances,
  }
}
