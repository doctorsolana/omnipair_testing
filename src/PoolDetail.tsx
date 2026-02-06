import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useConnector } from '@solana/connector'
import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from '@solana/kit'
import {
  getAddLiquidityInstructionAsync,
  getPairDecoder,
  getRemoveLiquidityInstructionAsync,
  type Pair,
  OMNIPAIR_PROGRAM_ID,
} from './omnipair'
import { useRpc } from './solana/useRpc'
import { useSendSmartTransaction } from './solana/useSendSmartTransaction'

type TokenInfo = {
  symbol: string
  name: string
}

type PoolDetailState = {
  address: string
  symbol: string
  name: string
  statusLabel: string
  feeLabel: string
  priceLabel: string
  priceSubLabel: string
  utilizationLabel: string
  reserveLabel: string
  reserveTooltip: string
  debtLabel: string
  token0Mint: string
  token1Mint: string
  token0Ticker: string
  token1Ticker: string
  token0Decimals: number
  token1Decimals: number
  rateModel: string
}

type AccountInfoResult = {
  value: {
    data: [string, string] | string
  } | null
}

type RpcTokenAccountsResult = {
  value: Array<{
    pubkey: string
  }>
}

type RpcTokenSupplyResult = {
  value: {
    decimals: number
  }
}

type RpcTokenBalanceResult = {
  value: {
    amount: string
    decimals: number
    uiAmount: number | null
    uiAmountString: string
  }
}

type LiquidityMode = 'deposit' | 'withdraw'

const KNOWN_TOKENS: Record<string, TokenInfo> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Solana' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4J9sMZ5vZ6n9Y9w4tY9f: { symbol: 'USDT', name: 'Tether' },
  mSoLzYCxHdYgdzU9h5c5fW6jJ9ZgWfM8f8B6Vh9tzrV: { symbol: 'mSOL', name: 'Marinade SOL' },
  jupSoLaJ53Uo89f9Jg7p8hGQ4w2FJv8r1v9h7QpJUP: { symbol: 'JUP', name: 'Jupiter' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6rPggD4R4D9x7GfP: { symbol: 'BONK', name: 'Bonk' },
}

const RESERVE_VAULT_SEED = new Uint8Array([
  114, 101, 115, 101, 114, 118, 101, 95, 118, 97, 117, 108, 116,
])

function shortAddress(value: string) {
  if (value.length < 12) return value
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function getTokenInfo(mint: string): TokenInfo {
  return KNOWN_TOKENS[mint] ?? { symbol: mint.slice(0, 4).toUpperCase(), name: shortAddress(mint) }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toDisplayNumber(amount: bigint, decimals: number) {
  return Number(amount) / 10 ** decimals
}

function formatCompact(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return '--'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits,
  }).format(value)
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '--'
  return `${value.toFixed(1)}%`
}

function toTicker(symbol: string) {
  const cleaned = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (cleaned.length >= 4) return cleaned.slice(0, 4)
  return symbol.slice(0, 4).toUpperCase()
}

function toBaseUnits(amount: string, decimals: number): bigint | null {
  const normalized = amount.trim()
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) return null

  const [wholePart, fractionalPart = ''] = normalized.split('.')
  const whole = wholePart.length ? BigInt(wholePart) : 0n
  const fraction = fractionalPart.slice(0, decimals).padEnd(decimals, '0')
  const fractional = fraction.length ? BigInt(fraction) : 0n
  return whole * 10n ** BigInt(decimals) + fractional
}

function toDecimalInput(value: string): number | null {
  const normalized = value.trim()
  if (!normalized || !/^(?:\d+|\d*\.\d+)$/.test(normalized)) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function formatAutoAmount(value: number, decimals: number) {
  if (!Number.isFinite(value)) return ''
  const maxDecimals = Math.min(Math.max(decimals, 2), 8)
  return value.toFixed(maxDecimals).replace(/\.?0+$/, '')
}

function mapPairToDetail(address: string, pair: Pair): PoolDetailState {
  const token0 = getTokenInfo(pair.token0)
  const token1 = getTokenInfo(pair.token1)
  const token0Ticker = toTicker(token0.symbol)
  const token1Ticker = toTicker(token1.symbol)

  const reserve0 = toDisplayNumber(pair.reserve0, pair.token0Decimals)
  const reserve1 = toDisplayNumber(pair.reserve1, pair.token1Decimals)
  const debt0 = toDisplayNumber(pair.totalDebt0, pair.token0Decimals)
  const debt1 = toDisplayNumber(pair.totalDebt1, pair.token1Decimals)

  const utilization0 = reserve0 > 0 ? (debt0 / reserve0) * 100 : 0
  const utilization1 = reserve1 > 0 ? (debt1 / reserve1) * 100 : 0
  const utilization = Math.max(utilization0, utilization1)

  const price = reserve0 > 0 && reserve1 > 0 ? reserve1 / reserve0 : NaN
  const pricePrecision = !Number.isFinite(price) ? 0 : price >= 100 ? 2 : price >= 1 ? 3 : 5

  return {
    address,
    token0Mint: pair.token0,
    token1Mint: pair.token1,
    token0Ticker,
    token1Ticker,
    token0Decimals: pair.token0Decimals,
    token1Decimals: pair.token1Decimals,
    rateModel: pair.rateModel,
    symbol: `${token0Ticker}/${token1Ticker}`,
    name: `${token0.name} / ${token1.name}`,
    statusLabel: pair.reduceOnly ? 'Reduce-only' : 'Active',
    feeLabel: `${(pair.swapFeeBps / 100).toFixed(2)}% fee`,
    priceLabel: Number.isFinite(price) ? `${price.toFixed(pricePrecision)} ${token1Ticker}` : '--',
    priceSubLabel: `per ${token0Ticker}`,
    utilizationLabel: formatPercent(utilization),
    reserveLabel: `${formatCompact(reserve0)} ${token0Ticker} / ${formatCompact(
      reserve1,
    )} ${token1Ticker}`,
    reserveTooltip: `${formatCompact(reserve0)} ${token0Ticker} • ${formatCompact(
      reserve1,
    )} ${token1Ticker}`,
    debtLabel: `${formatCompact(debt0)} ${token0Ticker} / ${formatCompact(debt1)} ${token1Ticker}`,
  }
}

function PoolDetail() {
  const { address } = useParams<{ address: string }>()
  const { rpcUrl } = useRpc()
  const { account, isConnected } = useConnector()
  const { signer, simulate, send } = useSendSmartTransaction()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pair, setPair] = useState<Pair | null>(null)
  const [lpDecimals, setLpDecimals] = useState(9)
  const [liquidityMode, setLiquidityMode] = useState<LiquidityMode>('deposit')
  const [depositAmount0, setDepositAmount0] = useState('')
  const [depositAmount1, setDepositAmount1] = useState('')
  const [depositSubmitting, setDepositSubmitting] = useState(false)
  const [depositStatus, setDepositStatus] = useState<string | null>(null)
  const [depositError, setDepositError] = useState<string | null>(null)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false)
  const [withdrawStatus, setWithdrawStatus] = useState<string | null>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [token0Balance, setToken0Balance] = useState('0')
  const [token1Balance, setToken1Balance] = useState('0')
  const [lpBalance, setLpBalance] = useState('0')

  const rpcRequest = useCallback(
    async <T,>(method: string, params: unknown[] = []) => {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
      })

      if (!response.ok) throw new Error(`RPC request failed: ${response.status}`)
      const json = (await response.json()) as { result?: T; error?: { message?: string } }
      if (json.error) throw new Error(json.error.message || 'Unknown RPC error')
      if (json.result === undefined) throw new Error(`RPC returned no result for ${method}`)
      return json.result
    },
    [rpcUrl],
  )

  const loadPoolDetail = useCallback(async () => {
    if (!address) return
    setLoading(true)
    setError(null)

    try {
      const accountInfo = await rpcRequest<AccountInfoResult>('getAccountInfo', [
        address,
        { encoding: 'base64', commitment: 'confirmed' },
      ])

      if (!accountInfo.value) throw new Error('Pool account not found on-chain.')

      const encodedData = accountInfo.value.data
      const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData
      if (typeof base64Data !== 'string') throw new Error('Invalid account data encoding')

      const decoder = getPairDecoder()
      const decodedPair = decoder.decode(base64ToBytes(base64Data))
      setPair(decodedPair)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pool details')
    } finally {
      setLoading(false)
    }
  }, [address, rpcRequest])

  useEffect(() => {
    void loadPoolDetail()
  }, [loadPoolDetail])

  useEffect(() => {
    if (!pair) return
    const loadLpDecimals = async () => {
      try {
        const supply = await rpcRequest<RpcTokenSupplyResult>('getTokenSupply', [pair.lpMint])
        setLpDecimals(supply.value.decimals ?? 9)
      } catch {
        setLpDecimals(9)
      }
    }
    void loadLpDecimals()
  }, [pair, rpcRequest])

  const detail = useMemo(() => {
    if (!pair || !address) return null
    return mapPairToDetail(address, pair)
  }, [address, pair])

  const poolReserves = useMemo(() => {
    if (!pair || !detail) return null
    const reserve0 = toDisplayNumber(pair.reserve0, detail.token0Decimals)
    const reserve1 = toDisplayNumber(pair.reserve1, detail.token1Decimals)
    if (reserve0 <= 0 || reserve1 <= 0) return null
    return {
      reserve0,
      reserve1,
      token1PerToken0: reserve1 / reserve0,
      token0PerToken1: reserve0 / reserve1,
    }
  }, [detail, pair])

  const handleDepositAmount0Change = useCallback(
    (value: string) => {
      setDepositAmount0(value)
      if (value.trim() === '') {
        setDepositAmount1('')
        return
      }
      const numericValue = toDecimalInput(value)
      if (numericValue === null || !detail || !poolReserves) return
      setDepositAmount1(
        formatAutoAmount(numericValue * poolReserves.token1PerToken0, detail.token1Decimals),
      )
    },
    [detail, poolReserves],
  )

  const handleDepositAmount1Change = useCallback(
    (value: string) => {
      setDepositAmount1(value)
      if (value.trim() === '') {
        setDepositAmount0('')
        return
      }
      const numericValue = toDecimalInput(value)
      if (numericValue === null || !detail || !poolReserves) return
      setDepositAmount0(
        formatAutoAmount(numericValue * poolReserves.token0PerToken1, detail.token0Decimals),
      )
    },
    [detail, poolReserves],
  )

  const findReserveVaultAddress = useCallback(async (pairAddress: string, mint: string) => {
    const [reserveVaultAddress] = await getProgramDerivedAddress({
      programAddress: OMNIPAIR_PROGRAM_ID as Address,
      seeds: [
        getBytesEncoder().encode(RESERVE_VAULT_SEED),
        getAddressEncoder().encode(pairAddress as Address),
        getAddressEncoder().encode(mint as Address),
      ],
    })
    return reserveVaultAddress
  }, [])

  const getOwnedTokenAccount = useCallback(
    async (owner: string, mint: string) => {
      const result = await rpcRequest<RpcTokenAccountsResult>('getTokenAccountsByOwner', [
        owner,
        { mint },
        { commitment: 'confirmed', encoding: 'base64' },
      ])
      return result.value[0]?.pubkey ?? null
    },
    [rpcRequest],
  )

  const getTokenAccountBalance = useCallback(
    async (tokenAccount: string | null) => {
      if (!tokenAccount) return '0'
      const result = await rpcRequest<RpcTokenBalanceResult>('getTokenAccountBalance', [
        tokenAccount,
        { commitment: 'confirmed' },
      ])
      return result.value.uiAmountString || '0'
    },
    [rpcRequest],
  )

  const loadBalances = useCallback(async () => {
    if (!account || !isConnected || !detail || !pair) {
      setToken0Balance('0')
      setToken1Balance('0')
      setLpBalance('0')
      return
    }

    setBalancesLoading(true)
    try {
      const [token0Account, token1Account, lpTokenAccount] = await Promise.all([
        getOwnedTokenAccount(account, detail.token0Mint),
        getOwnedTokenAccount(account, detail.token1Mint),
        getOwnedTokenAccount(account, pair.lpMint as string),
      ])

      const [token0, token1, lp] = await Promise.all([
        getTokenAccountBalance(token0Account),
        getTokenAccountBalance(token1Account),
        getTokenAccountBalance(lpTokenAccount),
      ])

      setToken0Balance(token0)
      setToken1Balance(token1)
      setLpBalance(lp)
    } catch {
      setToken0Balance('0')
      setToken1Balance('0')
      setLpBalance('0')
    } finally {
      setBalancesLoading(false)
    }
  }, [
    account,
    detail,
    getOwnedTokenAccount,
    getTokenAccountBalance,
    isConnected,
    pair,
  ])

  useEffect(() => {
    void loadBalances()
  }, [loadBalances])

  useEffect(() => {
    if (liquidityMode === 'deposit') {
      setWithdrawError(null)
      setWithdrawStatus(null)
      return
    }
    setDepositError(null)
    setDepositStatus(null)
  }, [liquidityMode])

  const executeDeposit = useCallback(async () => {
    setDepositError(null)
    setDepositStatus(null)

    if (!detail || !pair) {
      setDepositError('Pool details are not loaded yet.')
      return
    }

    if (!account || !isConnected || !signer) {
      setDepositError('Connect wallet to deposit.')
      return
    }

    if (detail.statusLabel === 'Reduce-only') {
      setDepositError('This pool is in reduce-only mode.')
      return
    }

    const amount0 = toBaseUnits(depositAmount0, detail.token0Decimals)
    const amount1 = toBaseUnits(depositAmount1, detail.token1Decimals)
    if (!amount0 || amount0 <= 0n) {
      setDepositError(`Enter a valid ${detail.token0Ticker} amount.`)
      return
    }
    if (!amount1 || amount1 <= 0n) {
      setDepositError(`Enter a valid ${detail.token1Ticker} amount.`)
      return
    }

    setDepositSubmitting(true)
    try {
      const userToken0Account = await getOwnedTokenAccount(account, detail.token0Mint)
      if (!userToken0Account) {
        setDepositError(`No token account found for ${detail.token0Ticker}.`)
        return
      }
      const userToken1Account = await getOwnedTokenAccount(account, detail.token1Mint)
      if (!userToken1Account) {
        setDepositError(`No token account found for ${detail.token1Ticker}.`)
        return
      }

      const reserve0Vault = await findReserveVaultAddress(detail.address, detail.token0Mint)
      const reserve1Vault = await findReserveVaultAddress(detail.address, detail.token1Mint)

      const instruction = await getAddLiquidityInstructionAsync({
        pair: detail.address as Address,
        rateModel: detail.rateModel as Address,
        reserve0Vault: reserve0Vault as Address,
        reserve1Vault: reserve1Vault as Address,
        userToken0Account: userToken0Account as Address,
        userToken1Account: userToken1Account as Address,
        token0Mint: detail.token0Mint as Address,
        token1Mint: detail.token1Mint as Address,
        lpMint: pair.lpMint as Address,
        user: signer as any,
        program: OMNIPAIR_PROGRAM_ID as Address,
        amount0In: amount0,
        amount1In: amount1,
        minLiquidityOut: 0n,
      })

      const simulation = await simulate([instruction as any])
      if (simulation?.value?.err) {
        setDepositError(`Simulation failed: ${JSON.stringify(simulation.value.err)}`)
        return
      }

      const signature = await send([instruction as any])
      setDepositStatus(`Deposit submitted: ${shortAddress(signature)}`)
      void loadPoolDetail()
      void loadBalances()
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : 'Deposit failed')
    } finally {
      setDepositSubmitting(false)
    }
  }, [
    account,
    depositAmount0,
    depositAmount1,
    detail,
    findReserveVaultAddress,
    getOwnedTokenAccount,
    isConnected,
    loadBalances,
    loadPoolDetail,
    pair,
    send,
    signer,
    simulate,
  ])

  const executeWithdraw = useCallback(async () => {
    setWithdrawError(null)
    setWithdrawStatus(null)

    if (!detail || !pair) {
      setWithdrawError('Pool details are not loaded yet.')
      return
    }

    if (!account || !isConnected || !signer) {
      setWithdrawError('Connect wallet to withdraw.')
      return
    }

    const amountLp = toBaseUnits(withdrawAmount, lpDecimals)
    if (!amountLp || amountLp <= 0n) {
      setWithdrawError('Enter a valid LP token amount.')
      return
    }

    setWithdrawSubmitting(true)
    try {
      const userToken0Account = await getOwnedTokenAccount(account, detail.token0Mint)
      if (!userToken0Account) {
        setWithdrawError(`No token account found for ${detail.token0Ticker}.`)
        return
      }
      const userToken1Account = await getOwnedTokenAccount(account, detail.token1Mint)
      if (!userToken1Account) {
        setWithdrawError(`No token account found for ${detail.token1Ticker}.`)
        return
      }
      const userLpTokenAccount = await getOwnedTokenAccount(account, pair.lpMint as string)
      if (!userLpTokenAccount) {
        setWithdrawError('No LP token account found for this pool.')
        return
      }

      const reserve0Vault = await findReserveVaultAddress(detail.address, detail.token0Mint)
      const reserve1Vault = await findReserveVaultAddress(detail.address, detail.token1Mint)

      const instruction = await getRemoveLiquidityInstructionAsync({
        pair: detail.address as Address,
        rateModel: detail.rateModel as Address,
        reserve0Vault: reserve0Vault as Address,
        reserve1Vault: reserve1Vault as Address,
        userToken0Account: userToken0Account as Address,
        userToken1Account: userToken1Account as Address,
        token0Mint: detail.token0Mint as Address,
        token1Mint: detail.token1Mint as Address,
        lpMint: pair.lpMint as Address,
        userLpTokenAccount: userLpTokenAccount as Address,
        user: signer as any,
        program: OMNIPAIR_PROGRAM_ID as Address,
        liquidityIn: amountLp,
        minAmount0Out: 0n,
        minAmount1Out: 0n,
      })

      const simulation = await simulate([instruction as any])
      if (simulation?.value?.err) {
        setWithdrawError(`Simulation failed: ${JSON.stringify(simulation.value.err)}`)
        return
      }

      const signature = await send([instruction as any])
      setWithdrawStatus(`Withdraw submitted: ${shortAddress(signature)}`)
      void loadPoolDetail()
      void loadBalances()
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Withdraw failed')
    } finally {
      setWithdrawSubmitting(false)
    }
  }, [
    account,
    detail,
    findReserveVaultAddress,
    getOwnedTokenAccount,
    isConnected,
    loadBalances,
    loadPoolDetail,
    lpDecimals,
    pair,
    send,
    signer,
    simulate,
    withdrawAmount,
  ])

  return (
    <main className="content">
      <section className="pool-detail-shell">
        <div className="pool-detail-header">
          <Link to="/" className="back-link">
            ← Back to Markets
          </Link>
        </div>

        <div className="pool-detail-card">
          {!address && <div className="status-block error">Missing pool address.</div>}
          {loading && <div className="status-block">Loading pool details…</div>}
          {error && <div className="status-block error">{error}</div>}

          {detail && (
            <>
              <div className="pool-detail-top">
                <div className="pool-detail-title">
                  <div className="pool-detail-logos" aria-hidden>
                    <span className="pool-logo">{detail.token0Ticker.slice(0, 1)}</span>
                    <span className="pool-logo pool-logo-secondary">
                      {detail.token1Ticker.slice(0, 1)}
                    </span>
                  </div>
                  <div>
                    <h2>{detail.symbol}</h2>
                    <p>{detail.name}</p>
                  </div>
                </div>
                <div
                  className={`pool-pill ${
                    detail.statusLabel === 'Reduce-only' ? 'danger' : 'neutral'
                  }`}
                >
                  {detail.statusLabel}
                </div>
              </div>

              <section className="pool-metrics-board" aria-label="Pool metrics">
                <article className="pool-metric-line">
                  <span className="pool-detail-label">Price</span>
                  <span className="pool-detail-value">{detail.priceLabel}</span>
                  <span className="pool-detail-sub">{detail.priceSubLabel}</span>
                </article>
                <article className="pool-metric-line">
                  <span className="pool-detail-label">Utilization</span>
                  <span className="pool-detail-value">{detail.utilizationLabel}</span>
                  <span className="pool-detail-sub">max across reserves</span>
                </article>
                <article className="pool-metric-line">
                  <span className="pool-detail-label">Swap Fee</span>
                  <span className="pool-detail-value">{detail.feeLabel}</span>
                  <span className="pool-detail-sub">per swap</span>
                </article>
                <article className="pool-metric-line">
                  <span className="pool-detail-label">Reserves</span>
                  <span className="pool-detail-value">{detail.reserveLabel}</span>
                  <span className="pool-detail-sub">{detail.reserveTooltip}</span>
                </article>
                <article className="pool-metric-line">
                  <span className="pool-detail-label">Debt</span>
                  <span className="pool-detail-value">{detail.debtLabel}</span>
                  <span className="pool-detail-sub">borrowed in pool</span>
                </article>
                <article className="pool-metric-line">
                  <span className="pool-detail-label">Rate Model</span>
                  <span className="pool-detail-value">{shortAddress(detail.rateModel)}</span>
                  <span className="pool-detail-sub">utilization curve</span>
                </article>
              </section>

              <div className="pool-workbench-grid">
                <section className="pool-liquidity-panel">
                  <div className="pool-mode-toggle" role="tablist" aria-label="Liquidity mode">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={liquidityMode === 'deposit'}
                      className={`pool-mode-button ${
                        liquidityMode === 'deposit' ? 'active' : ''
                      }`}
                      onClick={() => setLiquidityMode('deposit')}
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={liquidityMode === 'withdraw'}
                      className={`pool-mode-button ${
                        liquidityMode === 'withdraw' ? 'active' : ''
                      }`}
                      onClick={() => setLiquidityMode('withdraw')}
                    >
                      Withdraw
                    </button>
                  </div>

                  <div className="pool-liquidity-header">
                    <h3>
                      {liquidityMode === 'deposit'
                        ? `Deposit ${detail.token0Ticker}/${detail.token1Ticker}`
                        : `Withdraw ${detail.token0Ticker}/${detail.token1Ticker}`}
                    </h3>
                    <span>{balancesLoading ? 'Loading balances…' : 'Balances loaded'}</span>
                  </div>

                  {isConnected && (
                    <div className="pool-wallet-strip" aria-label="Wallet balances">
                      <div className="pool-wallet-chip">
                        <span>{detail.token0Ticker}</span>
                        <strong>{token0Balance}</strong>
                      </div>
                      <div className="pool-wallet-chip">
                        <span>{detail.token1Ticker}</span>
                        <strong>{token1Balance}</strong>
                      </div>
                      <div className="pool-wallet-chip">
                        <span>LP</span>
                        <strong>{lpBalance}</strong>
                      </div>
                    </div>
                  )}

                  {!isConnected && (
                    <div className="status-block">
                      Connect wallet to {liquidityMode === 'deposit' ? 'deposit' : 'withdraw'} liquidity.
                    </div>
                  )}

                  {liquidityMode === 'deposit' && (
                    <>
                      <div className="trade-field">
                        <div className="pool-field-head">
                          <label htmlFor="deposit-token0">{detail.token0Ticker} amount</label>
                          <span>
                            Balance {token0Balance} {detail.token0Ticker}
                          </span>
                        </div>
                        <div className="trade-input-wrap">
                          <input
                            id="deposit-token0"
                            className="trade-input pool-liquidity-input"
                            value={depositAmount0}
                            onChange={(event) => handleDepositAmount0Change(event.target.value)}
                            inputMode="decimal"
                            placeholder="0.0"
                          />
                          <span className="pool-liquidity-token">{detail.token0Ticker}</span>
                        </div>
                      </div>

                      <div className="trade-field">
                        <div className="pool-field-head">
                          <label htmlFor="deposit-token1">{detail.token1Ticker} amount</label>
                          <span>
                            Balance {token1Balance} {detail.token1Ticker}
                          </span>
                        </div>
                        <div className="trade-input-wrap">
                          <input
                            id="deposit-token1"
                            className="trade-input pool-liquidity-input"
                            value={depositAmount1}
                            onChange={(event) => handleDepositAmount1Change(event.target.value)}
                            inputMode="decimal"
                            placeholder="0.0"
                          />
                          <span className="pool-liquidity-token">{detail.token1Ticker}</span>
                        </div>
                      </div>

                      <div className="pool-ratio-note">
                        {poolReserves
                          ? `Pool ratio: 1 ${detail.token0Ticker} ≈ ${formatAutoAmount(
                              poolReserves.token1PerToken0,
                              detail.token1Decimals,
                            )} ${detail.token1Ticker}`
                          : 'Pool ratio unavailable (missing reserves).'}
                      </div>

                      {depositError && <div className="status-block error">{depositError}</div>}
                      {depositStatus && <div className="status-block">{depositStatus}</div>}

                      <button
                        type="button"
                        className="pool-action-button pool-action-button-primary"
                        onClick={executeDeposit}
                        disabled={
                          depositSubmitting ||
                          !isConnected ||
                          !depositAmount0 ||
                          !depositAmount1
                        }
                      >
                        {depositSubmitting ? 'Depositing…' : 'Deposit'}
                      </button>
                    </>
                  )}

                  {liquidityMode === 'withdraw' && (
                    <>
                      <div className="trade-field">
                        <div className="pool-field-head">
                          <label htmlFor="withdraw-lp">LP token amount</label>
                          <span>Balance {lpBalance} LP</span>
                        </div>
                        <div className="trade-input-wrap">
                          <input
                            id="withdraw-lp"
                            className="trade-input pool-liquidity-input"
                            value={withdrawAmount}
                            onChange={(event) => setWithdrawAmount(event.target.value)}
                            inputMode="decimal"
                            placeholder="0.0"
                          />
                          <span className="pool-liquidity-token">LP</span>
                        </div>
                      </div>

                      {withdrawError && <div className="status-block error">{withdrawError}</div>}
                      {withdrawStatus && <div className="status-block">{withdrawStatus}</div>}

                      <button
                        type="button"
                        className="pool-action-button pool-action-button-secondary"
                        onClick={executeWithdraw}
                        disabled={withdrawSubmitting || !isConnected || !withdrawAmount}
                      >
                        {withdrawSubmitting ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                    </>
                  )}
                </section>

                <aside className="pool-detail-meta-card">
                  <div className="pool-detail-meta-head">On-chain Addresses</div>
                  <dl className="pool-detail-meta">
                    <div className="pool-detail-meta-row">
                      <dt>Pool</dt>
                      <dd>
                        <code>{detail.address}</code>
                      </dd>
                    </div>
                    <div className="pool-detail-meta-row">
                      <dt>{detail.token0Ticker} Mint</dt>
                      <dd>
                        <code>{detail.token0Mint}</code>
                      </dd>
                    </div>
                    <div className="pool-detail-meta-row">
                      <dt>{detail.token1Ticker} Mint</dt>
                      <dd>
                        <code>{detail.token1Mint}</code>
                      </dd>
                    </div>
                  </dl>
                </aside>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

export default PoolDetail
