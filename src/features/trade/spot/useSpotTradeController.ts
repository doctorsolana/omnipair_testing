import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Address, Instruction, TransactionSigner } from '@solana/kit'
import { getSwapInstructionAsync, OMNIPAIR_PROGRAM_ID } from '@/protocol/omnipair'
import type { PoolView, TradeTokenOption } from '@/features/market/types'
import { DEFAULT_TRADE_TOKEN } from '@/features/market/types'
import { shortAddress, toBaseUnits } from '@/features/market/utils'
import { formatActionError, formatSimulationError } from '@/shared/utils/error'
import {
  findAssociatedTokenAddress,
  getOwnedTokenAccount,
  type RpcRequest,
} from '@/integrations/wallet/rpcHelpers'

type UseSpotTradeControllerParams = {
  account: string | null
  isConnected: boolean
  signer: TransactionSigner<string> | null
  selectedTradePool: PoolView | null
  tradeTokenOptions: TradeTokenOption[]
  rpcRequest: RpcRequest
  simulate: (
    instructions: Instruction<Address>[],
  ) => Promise<{ value?: { err?: unknown } } | null | undefined>
  send: (instructions: Instruction<Address>[]) => Promise<string>
  onTradeSuccess?: () => void
}

export function useSpotTradeController({
  account,
  isConnected,
  signer,
  selectedTradePool,
  tradeTokenOptions,
  rpcRequest,
  simulate,
  send,
  onTradeSuccess,
}: UseSpotTradeControllerParams) {
  const lastPoolAddressRef = useRef<string | null>(null)

  const [tradeFromAmount, setTradeFromAmount] = useState('1.0')
  const [tradeToAmount, setTradeToAmount] = useState('')
  const [tradeFromToken, setTradeFromToken] = useState('')
  const [tradeToToken, setTradeToToken] = useState('')
  const [tradeSubmitting, setTradeSubmitting] = useState(false)
  const [tradeStatus, setTradeStatus] = useState<string | null>(null)
  const [tradeError, setTradeError] = useState<string | null>(null)

  const tradeFromTokenInfo = useMemo(
    () =>
      tradeTokenOptions.find((token) => token.mint === tradeFromToken) ??
      tradeTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [tradeFromToken, tradeTokenOptions],
  )

  useEffect(() => {
    if (!selectedTradePool) return
    if (lastPoolAddressRef.current === selectedTradePool.address) return
    lastPoolAddressRef.current = selectedTradePool.address
    setTradeFromToken(selectedTradePool.token0Mint)
    setTradeToToken(selectedTradePool.token1Mint)
  }, [selectedTradePool])

  useEffect(() => {
    if (!tradeTokenOptions.length) return

    const hasMint = (mint: string) => tradeTokenOptions.some((option) => option.mint === mint)
    const firstMint = tradeTokenOptions[0].mint

    let nextFrom = tradeFromToken
    let nextTo = tradeToToken

    if (!nextFrom || !hasMint(nextFrom)) {
      nextFrom = firstMint
    }
    if (!nextTo || !hasMint(nextTo)) {
      nextTo = tradeTokenOptions.find((option) => option.mint !== nextFrom)?.mint ?? firstMint
    }

    if (nextFrom === nextTo) {
      nextTo = tradeTokenOptions.find((option) => option.mint !== nextFrom)?.mint ?? nextFrom
    }

    if (nextFrom !== tradeFromToken) setTradeFromToken(nextFrom)
    if (nextTo !== tradeToToken) setTradeToToken(nextTo)
  }, [tradeFromToken, tradeToToken, tradeTokenOptions])

  useEffect(() => {
    if (!tradeFromToken || !tradeToToken) return
    if (tradeFromToken !== tradeToToken) return
    const alternative = tradeTokenOptions.find((token) => token.mint !== tradeFromToken)?.mint
    if (alternative) setTradeToToken(alternative)
  }, [tradeFromToken, tradeToToken, tradeTokenOptions])

  useEffect(() => {
    if (!selectedTradePool) return
    if (!tradeFromAmount || Number.isNaN(Number(tradeFromAmount))) return

    const isDirect = selectedTradePool.token0Mint === tradeFromToken
    const numericFrom = Number(tradeFromAmount)
    if (!Number.isFinite(numericFrom) || numericFrom <= 0) return

    const [priceAmount] = selectedTradePool.priceLabel.split(' ')
    const parsedPrice = Number(priceAmount)
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return

    const nextOut = isDirect ? numericFrom * parsedPrice : numericFrom / parsedPrice
    if (!Number.isFinite(nextOut)) return
    setTradeToAmount(nextOut.toFixed(nextOut >= 1 ? 4 : 6))
  }, [selectedTradePool, tradeFromAmount, tradeFromToken])

  const setTradeFromTokenWithPairing = useCallback(
    (nextFromToken: string) => {
      setTradeFromToken(nextFromToken)
      if (nextFromToken === tradeToToken) {
        const alternate = tradeTokenOptions.find((token) => token.mint !== nextFromToken)?.mint
        if (alternate) {
          setTradeToToken(alternate)
        }
      }
    },
    [tradeToToken, tradeTokenOptions],
  )

  const setTradeToTokenWithPairing = useCallback(
    (nextToToken: string) => {
      setTradeToToken(nextToToken)
      if (nextToToken === tradeFromToken) {
        const alternate = tradeTokenOptions.find((token) => token.mint !== nextToToken)?.mint
        if (alternate) {
          setTradeFromToken(alternate)
        }
      }
    },
    [tradeFromToken, tradeTokenOptions],
  )

  const switchTradeDirection = useCallback(() => {
    setTradeFromToken((currentFrom) => {
      const currentTo = tradeToToken
      setTradeToToken(currentFrom)
      return currentTo
    })

    setTradeFromAmount((currentFromAmount) => {
      const currentToAmount = tradeToAmount
      setTradeToAmount(currentFromAmount)
      return currentToAmount
    })
  }, [tradeToAmount, tradeToToken])

  const executeTrade = useCallback(async () => {
    setTradeError(null)
    setTradeStatus(null)

    if (!account || !isConnected || !signer) {
      setTradeError('Connect wallet to place a swap.')
      return
    }

    if (tradeFromToken === tradeToToken) {
      setTradeError('Select two different tokens.')
      return
    }

    if (!selectedTradePool) {
      setTradeError('Select a pool to trade.')
      return
    }

    const isDirect = selectedTradePool.token0Mint === tradeFromToken
    const tokenInMint = isDirect ? selectedTradePool.token0Mint : selectedTradePool.token1Mint
    const tokenOutMint = isDirect ? selectedTradePool.token1Mint : selectedTradePool.token0Mint
    const tokenInDecimals = isDirect ? selectedTradePool.token0Decimals : selectedTradePool.token1Decimals

    const amountIn = toBaseUnits(tradeFromAmount, tokenInDecimals)
    if (!amountIn || amountIn <= 0n) {
      setTradeError('Enter a valid amount.')
      return
    }

    setTradeSubmitting(true)
    try {
      const userTokenInAccount = await getOwnedTokenAccount(rpcRequest, account, tokenInMint)
      if (!userTokenInAccount) {
        setTradeError(`No token account found for ${tradeFromTokenInfo.ticker}.`)
        return
      }

      const existingOutAccount = await getOwnedTokenAccount(rpcRequest, account, tokenOutMint)
      const userTokenOutAccount =
        existingOutAccount ?? (await findAssociatedTokenAddress(account, tokenOutMint))

      const swapInstruction = await getSwapInstructionAsync({
        pair: selectedTradePool.address as Address,
        rateModel: selectedTradePool.rateModel as Address,
        userTokenInAccount: userTokenInAccount as Address,
        userTokenOutAccount: userTokenOutAccount as Address,
        tokenInMint: tokenInMint as Address,
        tokenOutMint: tokenOutMint as Address,
        user: signer,
        program: OMNIPAIR_PROGRAM_ID as Address,
        amountIn,
        minAmountOut: 0n,
      })

      const simulation = await simulate([swapInstruction])
      if (simulation?.value?.err) {
        setTradeError(`Simulation failed: ${formatSimulationError(simulation.value.err)}`)
        return
      }

      const signature = await send([swapInstruction])
      setTradeStatus(`Swap submitted: ${shortAddress(signature)}`)
      onTradeSuccess?.()
    } catch (error) {
      setTradeError(formatActionError(error, 'Swap failed'))
    } finally {
      setTradeSubmitting(false)
    }
  }, [
    account,
    isConnected,
    onTradeSuccess,
    rpcRequest,
    selectedTradePool,
    send,
    signer,
    simulate,
    tradeFromAmount,
    tradeFromToken,
    tradeFromTokenInfo.ticker,
    tradeToToken,
  ])

  const clearSpotFeedback = useCallback(() => {
    setTradeError(null)
    setTradeStatus(null)
  }, [])

  return {
    tradeFromAmount,
    tradeToAmount,
    tradeFromToken,
    tradeToToken,
    tradeError,
    tradeStatus,
    tradeSubmitting,
    setTradeFromAmount,
    setTradeToAmount,
    setTradeFromToken: setTradeFromTokenWithPairing,
    setTradeToToken: setTradeToTokenWithPairing,
    switchTradeDirection,
    executeTrade,
    clearSpotFeedback,
  }
}
