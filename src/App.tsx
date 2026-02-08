import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { useConnector } from '@solana/connector'
import bs58 from 'bs58'
import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from '@solana/kit'
import { ConnectWallet } from './solana/ConnectWallet'
import PoolDetail from './PoolDetail'
import NewPool from './NewPool'
import PositionJournal from './components/positions/PositionJournal'
import LiquidityHeatmap from './components/debug/LiquidityHeatmap'
import {
  getBorrowInstructionAsync,
  getPairDecoder,
  getSwapInstructionAsync,
  getUserPositionDecoder,
  OMNIPAIR_PROGRAM_ID,
  type Pair,
  type UserPosition,
} from './omnipair'
import { useRpc } from './solana/useRpc'
import { useSendSmartTransaction } from './solana/useSendSmartTransaction'

type AppTab = 'Pools' | 'Trade' | 'Borrow' | 'Positions' | 'Debug'

const APP_TABS: AppTab[] = ['Pools', 'Trade', 'Borrow', 'Positions', 'Debug']

type ProgramAccountResult = {
  pubkey: string
}

type ProgramAccountWithData = {
  pubkey: string
  account: {
    data: [string, string] | string
  }
}

type AccountInfoResult = {
  value: {
    data: [string, string] | string
  } | null
}

type SignatureResult = {
  signature: string
  slot: number
  err: unknown
  blockTime: number | null
}

type TokenInfo = {
  symbol: string
  name: string
}

type TradeTokenOption = {
  mint: string
  ticker: string
  name: string
  logo: string
  color: string
}

const DEFAULT_TRADE_TOKEN: TradeTokenOption = {
  mint: '',
  ticker: 'TOKN',
  name: 'Token',
  logo: 'T',
  color: 'linear-gradient(135deg, #9db8e4, #6f90c5)',
}

type TokenSelectProps = {
  id?: string
  value: string
  options: TradeTokenOption[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel: string
}

function TokenSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: TokenSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selected =
    options.find((token) => token.mint === value) ??
    options[0] ??
    DEFAULT_TRADE_TOKEN

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && containerRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open])

  useEffect(() => {
    if (disabled && open) setOpen(false)
  }, [disabled, open])

  useEffect(() => {
    if (!options.length && open) setOpen(false)
  }, [open, options.length])

  return (
    <div
      ref={containerRef}
      className={`token-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
    >
      <button
        id={id}
        type="button"
        className="token-select-trigger"
        onClick={() => {
          if (disabled || !options.length) return
          setOpen((current) => !current)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span
          className="trade-token-logo"
          style={{ background: selected.color }}
          aria-hidden
        >
          {selected.logo}
        </span>
        <span className="trade-token-label">{selected.ticker}</span>
        <span className="token-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="token-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((token) => (
            <button
              key={token.mint}
              type="button"
              role="option"
              aria-selected={token.mint === selected.mint}
              className={`token-select-option ${token.mint === selected.mint ? 'active' : ''}`}
              onClick={() => {
                onChange(token.mint)
                setOpen(false)
              }}
            >
              <span
                className="trade-token-logo"
                style={{ background: token.color }}
                aria-hidden
              >
                {token.logo}
              </span>
              <span className="token-option-text">
                <span className="token-option-main">{token.ticker}</span>
                <span className="token-option-sub">{token.name}</span>
              </span>
            </button>
          ))}
          {!options.length && <div className="token-select-empty">No tokens available</div>}
        </div>
      )}
    </div>
  )
}

type PoolView = {
  address: string
  lpMint: string
  token0Ticker: string
  token1Ticker: string
  token0Mint: string
  token1Mint: string
  token0Decimals: number
  token1Decimals: number
  rateModel: string
  fixedCfBps: number | null
  price: number
  totalDebt0: bigint
  totalDebt1: bigint
  totalDebt0Shares: bigint
  totalDebt1Shares: bigint
  totalCollateral0: bigint
  totalCollateral1: bigint
  cashReserve0: bigint
  cashReserve1: bigint
  symbol: string
  name: string
  priceLabel: string
  priceSubLabel: string
  utilizationPct: number
  utilizationLabel: string
  feeLabel: string
  reserveLabel: string
  reserveTooltip: string
  statusLabel: 'Active' | 'Reduce-only'
  trend: 'up' | 'down'
}

type RpcTokenAccountsResult = {
  value: Array<{
    pubkey: string
  }>
}

type RpcTokenBalanceResult = {
  value: {
    uiAmount: number | null
    uiAmountString: string
  }
}

const PAIR_DISCRIMINATOR_B58 = bs58.encode(
  Uint8Array.from([85, 72, 49, 176, 182, 228, 141, 82]),
)
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const GAMM_POSITION_SEED = new Uint8Array([
  103, 97, 109, 109, 95, 112, 111, 115, 105, 116, 105, 111, 110,
])

type LoanPositionView = {
  poolAddress: string
  symbol: string
  collateral0: number
  collateral1: number
  debt0: number
  debt1: number
  cf0: number | null
  cf1: number | null
}

type LpPositionView = {
  poolAddress: string
  symbol: string
  lpBalance: number
  lpBalanceLabel: string
}

const KNOWN_TOKENS: Record<string, TokenInfo> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Solana' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4J9sMZ5vZ6n9Y9w4tY9f: { symbol: 'USDT', name: 'Tether' },
  mSoLzYCxHdYgdzU9h5c5fW6jJ9ZgWfM8f8B6Vh9tzrV: { symbol: 'mSOL', name: 'Marinade SOL' },
  jupSoLaJ53Uo89f9Jg7p8hGQ4w2FJv8r1v9h7QpJUP: { symbol: 'JUP', name: 'Jupiter' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6rPggD4R4D9x7GfP: { symbol: 'BONK', name: 'Bonk' },
}

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

function toBaseUnits(amount: string, decimals: number): bigint | null {
  const normalized = amount.trim()
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) return null

  const [wholePart, fractionalPart = ''] = normalized.split('.')
  const whole = wholePart.length ? BigInt(wholePart) : 0n
  const fraction = fractionalPart.slice(0, decimals).padEnd(decimals, '0')
  const fractional = fraction.length ? BigInt(fraction) : 0n
  return whole * 10n ** BigInt(decimals) + fractional
}

function toTicker(symbol: string) {
  const cleaned = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (cleaned.length >= 4) return cleaned.slice(0, 4)
  return symbol.slice(0, 4).toUpperCase()
}

function unwrapOption<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object' && value && '__option' in value) {
    const optionValue = value as { __option: 'Some' | 'None'; value?: T }
    if (optionValue.__option === 'Some') return optionValue.value ?? null
    return null
  }
  return value as T
}

function applyDebtFromShares(userShares: bigint, totalDebt: bigint, totalShares: bigint) {
  if (totalShares === 0n) return 0n
  return (userShares * totalDebt) / totalShares
}

function getTokenColor(seed: string) {
  const palette = [
    'linear-gradient(135deg, #70d4ff, #4f8ce8)',
    'linear-gradient(135deg, #ffc57a, #f0a24f)',
    'linear-gradient(135deg, #b5c5dc, #8397b8)',
    'linear-gradient(135deg, #86b9ff, #618de1)',
    'linear-gradient(135deg, #8ec8ad, #5a9d7f)',
  ]
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}

function mapPairToPoolView(address: string, pair: Pair): PoolView {
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
    lpMint: pair.lpMint,
    token0Ticker,
    token1Ticker,
    token0Mint: pair.token0,
    token1Mint: pair.token1,
    token0Decimals: pair.token0Decimals,
    token1Decimals: pair.token1Decimals,
    rateModel: pair.rateModel,
    fixedCfBps: unwrapOption<number>(pair.fixedCfBps),
    price,
    totalDebt0: pair.totalDebt0,
    totalDebt1: pair.totalDebt1,
    totalDebt0Shares: pair.totalDebt0Shares,
    totalDebt1Shares: pair.totalDebt1Shares,
    totalCollateral0: pair.totalCollateral0,
    totalCollateral1: pair.totalCollateral1,
    cashReserve0: pair.cashReserve0,
    cashReserve1: pair.cashReserve1,
    symbol: `${token0Ticker}/${token1Ticker}`,
    name: `${token0.name} / ${token1.name}`,
    priceLabel: Number.isFinite(price) ? `${price.toFixed(pricePrecision)} ${token1Ticker}` : '--',
    priceSubLabel: `per ${token0Ticker}`,
    utilizationPct: utilization,
    utilizationLabel: formatPercent(utilization),
    feeLabel: `${(pair.swapFeeBps / 100).toFixed(2)}% fee`,
    reserveLabel: `R ${formatCompact(reserve0, 1)}/${formatCompact(reserve1, 1)}`,
    reserveTooltip: `${formatCompact(reserve0)} ${token0Ticker} • ${formatCompact(reserve1)} ${token1Ticker}`,
    statusLabel: pair.reduceOnly ? 'Reduce-only' : 'Active',
    trend: utilization >= 85 ? 'down' : 'up',
  }
}

function App() {
  const { account, isConnected } = useConnector()
  const { rpcUrl } = useRpc()
  const { signer, simulate, send } = useSendSmartTransaction()
  const [walletOpen, setWalletOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('Pools')
  const activeTabIndex = Math.max(0, APP_TABS.indexOf(activeTab))
  const walletDropdownRef = useRef<HTMLDivElement | null>(null)

  const [poolsLoading, setPoolsLoading] = useState(false)
  const [poolsError, setPoolsError] = useState<string | null>(null)
  const [pools, setPools] = useState<PoolView[]>([])
  const [poolAccounts, setPoolAccounts] = useState<ProgramAccountResult[]>([])
  const [hasLoadedPools, setHasLoadedPools] = useState(false)

  const [debugLoading, setDebugLoading] = useState(false)
  const [debugError, setDebugError] = useState<string | null>(null)
  const [recentSignatures, setRecentSignatures] = useState<SignatureResult[]>([])
  const [hasLoadedDebug, setHasLoadedDebug] = useState(false)
  const [tradeFromAmount, setTradeFromAmount] = useState('1.0')
  const [tradeToAmount, setTradeToAmount] = useState('')
  const [tradeFromToken, setTradeFromToken] = useState('')
  const [tradeToToken, setTradeToToken] = useState('')
  const [tradeSubmitting, setTradeSubmitting] = useState(false)
  const [tradeStatus, setTradeStatus] = useState<string | null>(null)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [borrowPool, setBorrowPool] = useState('')
  const [borrowToken, setBorrowToken] = useState('')
  const [borrowAmount, setBorrowAmount] = useState('10')
  const [borrowSubmitting, setBorrowSubmitting] = useState(false)
  const [borrowStatus, setBorrowStatus] = useState<string | null>(null)
  const [borrowError, setBorrowError] = useState<string | null>(null)
  const [positionsLoading, setPositionsLoading] = useState(false)
  const [positionsError, setPositionsError] = useState<string | null>(null)
  const [loanPositions, setLoanPositions] = useState<LoanPositionView[]>([])
  const [lpPositions, setLpPositions] = useState<LpPositionView[]>([])

  const walletLabel = useMemo(() => {
    if (!isConnected || !account) return 'Connect Wallet'
    return `${account.slice(0, 4)}…${account.slice(-4)}`
  }, [account, isConnected])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!walletOpen) return
      const target = event.target as Node | null
      if (target && walletDropdownRef.current?.contains(target)) return
      setWalletOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [walletOpen])

  const tradeTokenOptions = useMemo<TradeTokenOption[]>(() => {
    const map = new Map<string, TradeTokenOption>()
    for (const pool of pools) {
      if (!map.has(pool.token0Mint)) {
        map.set(pool.token0Mint, {
          mint: pool.token0Mint,
          ticker: pool.token0Ticker,
          name: pool.token0Ticker,
          logo: pool.token0Ticker.slice(0, 1),
          color: getTokenColor(pool.token0Mint),
        })
      }
      if (!map.has(pool.token1Mint)) {
        map.set(pool.token1Mint, {
          mint: pool.token1Mint,
          ticker: pool.token1Ticker,
          name: pool.token1Ticker,
          logo: pool.token1Ticker.slice(0, 1),
          color: getTokenColor(pool.token1Mint),
        })
      }
    }
    return [...map.values()].sort((a, b) => a.ticker.localeCompare(b.ticker))
  }, [pools])

  const tradeFromTokenInfo = useMemo(
    () =>
      tradeTokenOptions.find((token) => token.mint === tradeFromToken) ??
      tradeTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [tradeFromToken, tradeTokenOptions],
  )

  const selectedTradePool = useMemo(() => {
    return (
      pools.find(
        (pool) =>
          pool.token0Mint === tradeFromToken &&
          pool.token1Mint === tradeToToken,
      ) ??
      pools.find(
        (pool) =>
          pool.token0Mint === tradeToToken &&
          pool.token1Mint === tradeFromToken,
      ) ??
      null
    )
  }, [pools, tradeFromToken, tradeToToken])

  const selectedBorrowPool = useMemo(() => {
    return pools.find((pool) => pool.address === borrowPool) ?? pools[0] ?? null
  }, [borrowPool, pools])

  const poolSymbolsByAddress = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const pool of pools) {
      map[pool.address] = pool.symbol
    }
    return map
  }, [pools])

  const borrowTokenOptions = useMemo<TradeTokenOption[]>(() => {
    if (!selectedBorrowPool) return []
    return [
      {
        mint: selectedBorrowPool.token0Mint,
        ticker: selectedBorrowPool.token0Ticker,
        name: selectedBorrowPool.token0Ticker,
        logo: selectedBorrowPool.token0Ticker.slice(0, 1),
        color: getTokenColor(selectedBorrowPool.token0Mint),
      },
      {
        mint: selectedBorrowPool.token1Mint,
        ticker: selectedBorrowPool.token1Ticker,
        name: selectedBorrowPool.token1Ticker,
        logo: selectedBorrowPool.token1Ticker.slice(0, 1),
        color: getTokenColor(selectedBorrowPool.token1Mint),
      },
    ]
  }, [selectedBorrowPool])

  const borrowTokenInfo = useMemo(
    () =>
      borrowTokenOptions.find((token) => token.mint === borrowToken) ??
      borrowTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [borrowToken, borrowTokenOptions],
  )

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

  const findAssociatedTokenAddress = useCallback(async (owner: string, mint: string) => {
    return getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
      seeds: [
        getAddressEncoder().encode(owner as Address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ID as Address),
        getAddressEncoder().encode(mint as Address),
      ],
    })
  }, [])

  const findUserPositionAddress = useCallback(async (pairAddress: string, owner: string) => {
    return getProgramDerivedAddress({
      programAddress: OMNIPAIR_PROGRAM_ID as Address,
      seeds: [
        getBytesEncoder().encode(GAMM_POSITION_SEED),
        getAddressEncoder().encode(pairAddress as Address),
        getAddressEncoder().encode(owner as Address),
      ],
    })
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
      if (!tokenAccount) return 0
      const result = await rpcRequest<RpcTokenBalanceResult>('getTokenAccountBalance', [
        tokenAccount,
        { commitment: 'confirmed' },
      ])
      return result.value.uiAmount ?? 0
    },
    [rpcRequest],
  )

  const loadPools = useCallback(async () => {
    setPoolsLoading(true)
    setPoolsError(null)
    try {
      const accounts = await rpcRequest<ProgramAccountWithData[]>('getProgramAccounts', [
        OMNIPAIR_PROGRAM_ID,
        {
          encoding: 'base64',
          commitment: 'confirmed',
          filters: [{ memcmp: { offset: 0, bytes: PAIR_DISCRIMINATOR_B58 } }],
        },
      ])

      const decoder = getPairDecoder()
      const decodedPools = accounts
        .map((accountItem) => {
          const encodedData = accountItem.account.data
          const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData
          if (typeof base64Data !== 'string') throw new Error('Invalid account data encoding')
          const pair = decoder.decode(base64ToBytes(base64Data))
          return mapPairToPoolView(accountItem.pubkey, pair)
        })
        .sort((a, b) => b.utilizationPct - a.utilizationPct)

      setPoolAccounts(accounts.map(({ pubkey }) => ({ pubkey })))
      setPools(decodedPools)
      setHasLoadedPools(true)
    } catch (error) {
      setPoolsError(error instanceof Error ? error.message : 'Unable to load pools')
    } finally {
      setPoolsLoading(false)
    }
  }, [rpcRequest])

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
      const entries = await Promise.all(
        pools.map(async (pool) => {
          const [positionAddress] = await findUserPositionAddress(pool.address, account)
          const accountInfo = await rpcRequest<AccountInfoResult>('getAccountInfo', [
            positionAddress,
            { encoding: 'base64', commitment: 'confirmed' },
          ])

          let loanPosition: LoanPositionView | null = null

          if (accountInfo.value) {
            const encodedData = accountInfo.value.data
            const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData
            if (typeof base64Data !== 'string') throw new Error('Invalid account data encoding')
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
                collateral0,
                collateral1,
                debt0,
                debt1,
                cf0: userPosition.collateral0AppliedMinCfBps,
                cf1: userPosition.collateral1AppliedMinCfBps,
              }
            }
          }

          const lpTokenAccount = await getOwnedTokenAccount(account, pool.lpMint)
          const lpBalance = await getTokenAccountBalance(lpTokenAccount)
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
        }),
      )

      setLoanPositions(
        entries
          .map((entry) => entry.loanPosition)
          .filter((entry): entry is LoanPositionView => Boolean(entry)),
      )
      setLpPositions(
        entries
          .map((entry) => entry.lpPosition)
          .filter((entry): entry is LpPositionView => Boolean(entry)),
      )
    } catch (error) {
      setPositionsError(error instanceof Error ? error.message : 'Unable to load positions')
    } finally {
      setPositionsLoading(false)
    }
  }, [
    account,
    findUserPositionAddress,
    getOwnedTokenAccount,
    getTokenAccountBalance,
    isConnected,
    pools,
    rpcRequest,
  ])

  const loadDebugData = useCallback(async () => {
    setDebugLoading(true)
    setDebugError(null)
    try {
      if (!hasLoadedPools) {
        await loadPools()
      }

      const signatures = await rpcRequest<SignatureResult[]>('getSignaturesForAddress', [
        OMNIPAIR_PROGRAM_ID,
        { limit: 10, commitment: 'confirmed' },
      ])

      setRecentSignatures(signatures)
      setHasLoadedDebug(true)
    } catch (error) {
      setDebugError(error instanceof Error ? error.message : 'Unable to load debug data')
    } finally {
      setDebugLoading(false)
    }
  }, [hasLoadedPools, loadPools, rpcRequest])

  useEffect(() => {
    if (
      activeTab !== 'Pools' &&
      activeTab !== 'Trade' &&
      activeTab !== 'Borrow' &&
      activeTab !== 'Positions'
    ) {
      return
    }
    if (hasLoadedPools) return
    void loadPools()
  }, [activeTab, hasLoadedPools, loadPools])

  useEffect(() => {
    if (activeTab !== 'Debug') return
    if (hasLoadedDebug) return
    void loadDebugData()
  }, [activeTab, hasLoadedDebug, loadDebugData])

  useEffect(() => {
    if (activeTab !== 'Positions') return
    if (!isConnected || !account || !pools.length) {
      setLoanPositions([])
      setLpPositions([])
      return
    }
    void loadPositionsData()
  }, [account, activeTab, isConnected, loadPositionsData, pools.length])

  useEffect(() => {
    if (!tradeTokenOptions.length) return
    if (!tradeFromToken) {
      setTradeFromToken(tradeTokenOptions[0].mint)
    }
    if (!tradeToToken) {
      const fallback = tradeTokenOptions[1]?.mint ?? tradeTokenOptions[0].mint
      setTradeToToken(fallback)
    }
  }, [tradeFromToken, tradeToToken, tradeTokenOptions])

  useEffect(() => {
    if (!tradeFromToken || !tradeToToken) return
    if (tradeFromToken !== tradeToToken) return
    const alternative = tradeTokenOptions.find((token) => token.mint !== tradeFromToken)?.mint
    if (alternative) setTradeToToken(alternative)
  }, [tradeFromToken, tradeToToken, tradeTokenOptions])

  useEffect(() => {
    if (!pools.length) return
    if (!borrowPool) {
      setBorrowPool(pools[0].address)
    }
  }, [borrowPool, pools])

  useEffect(() => {
    if (!borrowTokenOptions.length) return
    if (!borrowToken) {
      setBorrowToken(borrowTokenOptions[0].mint)
    }
  }, [borrowToken, borrowTokenOptions])

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
      setTradeError('No matching Omnipair pool for selected tokens.')
      return
    }

    const isDirect = selectedTradePool.token0Mint === tradeFromToken
    const tokenInMint = isDirect ? selectedTradePool.token0Mint : selectedTradePool.token1Mint
    const tokenOutMint = isDirect ? selectedTradePool.token1Mint : selectedTradePool.token0Mint
    const tokenInDecimals = isDirect
      ? selectedTradePool.token0Decimals
      : selectedTradePool.token1Decimals

    const amountIn = toBaseUnits(tradeFromAmount, tokenInDecimals)
    if (!amountIn || amountIn <= 0n) {
      setTradeError('Enter a valid amount.')
      return
    }

    setTradeSubmitting(true)

    try {
      const userTokenInAccount = await getOwnedTokenAccount(account, tokenInMint)
      if (!userTokenInAccount) {
        setTradeError(`No token account found for ${tradeFromTokenInfo.ticker}.`)
        return
      }

      const existingOutAccount = await getOwnedTokenAccount(account, tokenOutMint)
      const userTokenOutAccount =
        existingOutAccount ?? (await findAssociatedTokenAddress(account, tokenOutMint))

      const swapInstruction = await getSwapInstructionAsync({
        pair: selectedTradePool.address as Address,
        rateModel: selectedTradePool.rateModel as Address,
        userTokenInAccount: userTokenInAccount as Address,
        userTokenOutAccount: userTokenOutAccount as Address,
        tokenInMint: tokenInMint as Address,
        tokenOutMint: tokenOutMint as Address,
        user: signer as any,
        program: OMNIPAIR_PROGRAM_ID as Address,
        amountIn,
        minAmountOut: 0n,
      })

      const simulation = await simulate([swapInstruction as any])
      if (simulation?.value?.err) {
        setTradeError(`Simulation failed: ${JSON.stringify(simulation.value.err)}`)
        return
      }

      const signature = await send([swapInstruction as any])
      setTradeStatus(`Swap submitted: ${shortAddress(signature)}`)
    } catch (error) {
      setTradeError(error instanceof Error ? error.message : 'Swap failed')
    } finally {
      setTradeSubmitting(false)
    }
  }, [
    account,
    isConnected,
    signer,
    selectedTradePool,
    tradeFromToken,
    tradeToToken,
    tradeFromAmount,
    getOwnedTokenAccount,
    tradeFromTokenInfo,
    findAssociatedTokenAddress,
    simulate,
    send,
  ])

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

    const isToken0 = selectedBorrowPool.token0Mint === borrowToken
    const borrowDecimals = isToken0
      ? selectedBorrowPool.token0Decimals
      : selectedBorrowPool.token1Decimals
    const amount = toBaseUnits(borrowAmount, borrowDecimals)

    if (!amount || amount <= 0n) {
      setBorrowError('Enter a valid borrow amount.')
      return
    }

    setBorrowSubmitting(true)

    try {
      const userReserveTokenAccount = await getOwnedTokenAccount(account, borrowToken)
      if (!userReserveTokenAccount) {
        setBorrowError(`No token account found for ${borrowTokenInfo.ticker}.`)
        return
      }

      const borrowInstruction = await getBorrowInstructionAsync({
        pair: selectedBorrowPool.address as Address,
        rateModel: selectedBorrowPool.rateModel as Address,
        userReserveTokenAccount: userReserveTokenAccount as Address,
        reserveTokenMint: borrowToken as Address,
        user: signer as any,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount },
      })

      const simulation = await simulate([borrowInstruction as any])
      if (simulation?.value?.err) {
        setBorrowError(`Simulation failed: ${JSON.stringify(simulation.value.err)}`)
        return
      }

      const signature = await send([borrowInstruction as any])
      setBorrowStatus(`Borrow submitted: ${shortAddress(signature)}`)
      void loadPools()
      void loadPositionsData()
    } catch (error) {
      setBorrowError(error instanceof Error ? error.message : 'Borrow failed')
    } finally {
      setBorrowSubmitting(false)
    }
  }, [
    account,
    isConnected,
    signer,
    selectedBorrowPool,
    borrowToken,
    borrowAmount,
    borrowTokenInfo,
    getOwnedTokenAccount,
    loadPools,
    loadPositionsData,
    simulate,
    send,
  ])

  const mainContent = (
    <main className="content">
      <section className="market-shell">
        <div className="market-shell-card">
          <div className="market-header market-header-empty" />

          <div className="market-tabs-rail">
            <span className="tabs-rule" />
            <div className="market-tabs">
              <span
                className="tab-indicator"
                style={{
                  width: `${100 / APP_TABS.length}%`,
                  transform: `translateX(${activeTabIndex * 100}%)`,
                  borderTopLeftRadius: activeTabIndex === 0 ? '999px' : '0',
                  borderBottomLeftRadius: activeTabIndex === 0 ? '999px' : '0',
                  borderTopRightRadius: activeTabIndex === APP_TABS.length - 1 ? '999px' : '0',
                  borderBottomRightRadius: activeTabIndex === APP_TABS.length - 1 ? '999px' : '0',
                }}
                aria-hidden="true"
              />
              {APP_TABS.map((tab) => (
                <button
                  key={tab}
                  className={`tab-button ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <span className="tabs-rule" />
          </div>

          <div className="market-content-card">
            {activeTab === 'Pools' && (
              <>
                <div className="pool-summary">
                  <span>{pools.length} pools</span>
                  <Link to="/pools/new" className="pool-create-btn">
                    <span className="pool-create-icon">＋</span>
                    New Pool
                  </Link>
                </div>

                {poolsError && <div className="status-block error">{poolsError}</div>}

                {!poolsError && poolsLoading && !pools.length && (
                  <div className="status-block">Loading Omnipair pools...</div>
                )}

                {!poolsError && !poolsLoading && pools.length === 0 && (
                  <div className="status-block">No pools found for this program right now.</div>
                )}

                {!!pools.length && (
                  <div className="market-list pools-list">
                    {pools.map((pool) => (
                      <Link
                        key={pool.address}
                        to={`/pools/${pool.address}`}
                        className="market-row pool-row pool-row-link"
                        title={`${pool.name} • ${pool.address}`}
                      >
                        <div className="pool-pair">
                          <div className="pool-logo-stack">
                            <span className="pool-logo">{pool.token0Ticker.slice(0, 1)}</span>
                            <span className="pool-logo pool-logo-secondary">
                              {pool.token1Ticker.slice(0, 1)}
                            </span>
                          </div>
                          <div className="pool-pair-line">{pool.symbol}</div>
                        </div>
                        <div className="pool-price-line">
                          <span className="pool-price-main">{pool.priceLabel}</span>
                          <span className="pool-price-sub">{pool.priceSubLabel}</span>
                        </div>
                        <div className={`market-change ${pool.trend} pool-util-pill`}>
                          Util {pool.utilizationLabel}
                        </div>
                        <span className="pool-pill pool-pill-inline">{pool.feeLabel}</span>
                        <span
                          className={`pool-pill pool-pill-inline ${
                            pool.statusLabel === 'Reduce-only' ? 'danger' : 'neutral'
                          }`}
                        >
                          {pool.statusLabel}
                        </span>
                        <span className="pool-hint pool-hint-inline" title={pool.reserveTooltip}>
                          {pool.reserveLabel}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === 'Trade' && (
              <div className="trade-shell">
                <section className="trade-card">
                  {!tradeTokenOptions.length && (
                    <div className="status-block">Load pools first to enable trading.</div>
                  )}

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
                        onChange={(value) => setTradeFromToken(value)}
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
                        onChange={(value) => setTradeToToken(value)}
                        ariaLabel="Select token to swap to"
                        disabled={!tradeTokenOptions.length}
                      />
                    </div>
                  </div>

                  {tradeError && <div className="status-block error">{tradeError}</div>}
                  {tradeStatus && <div className="status-block">{tradeStatus}</div>}
                  {!tradeError && tradeFromToken && tradeToToken && !selectedTradePool && (
                    <div className="status-block">No direct pool found for selected token pair.</div>
                  )}

                  <button
                    type="button"
                    className="trade-submit"
                    onClick={executeTrade}
                    disabled={
                      tradeSubmitting || !tradeTokenOptions.length || !tradeFromToken || !tradeToToken
                    }
                  >
                    {tradeSubmitting ? 'Submitting…' : 'Place Swap'}
                  </button>
                </section>
              </div>
            )}

            {activeTab === 'Borrow' && (
              <div className="borrow-shell borrow-center">
                <section className="trade-card borrow-card">
                  {!pools.length && (
                    <div className="status-block">Load pools to enable borrowing.</div>
                  )}

                  <div className="borrow-top">
                    <label htmlFor="borrow-pool">Pool</label>
                    <select
                      id="borrow-pool"
                      className="borrow-pool-select"
                      value={borrowPool}
                      onChange={(event) => setBorrowPool(event.target.value)}
                      disabled={!pools.length}
                    >
                      {pools.map((pool) => (
                        <option key={pool.address} value={pool.address}>
                          {pool.symbol}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedBorrowPool?.statusLabel === 'Reduce-only' && (
                    <div className="status-block error">
                      This pool is reduce-only. Borrowing is currently disabled.
                    </div>
                  )}

                  <div className="trade-field">
                    <label htmlFor="borrow-amount">Amount</label>
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
                        onChange={(value) => setBorrowToken(value)}
                        ariaLabel="Select token to borrow"
                        disabled={!borrowTokenOptions.length}
                      />
                    </div>
                  </div>

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
            )}

            {activeTab === 'Positions' && (
              <div className="borrow-shell">
                {!isConnected && (
                  <div className="status-block">Connect wallet to view your positions.</div>
                )}
                {positionsLoading && isConnected && (
                  <div className="status-block">Loading positions…</div>
                )}
                {positionsError && <div className="status-block error">{positionsError}</div>}

                {isConnected && !positionsLoading && !positionsError && (
                  <div className="positions-layout">
                    <section className="positions-section">
                      <header className="positions-head">
                        <h3>LP Positions</h3>
                        <span>{lpPositions.length}</span>
                      </header>
                      {!lpPositions.length && (
                        <div className="status-block">No LP positions found.</div>
                      )}
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
                      {!loanPositions.length && (
                        <div className="status-block">No open loan positions found.</div>
                      )}
                      {!!loanPositions.length && (
                        <div className="positions-list">
                          {loanPositions.map((position) => (
                            <Link
                              key={position.poolAddress}
                              to={`/pools/${position.poolAddress}`}
                              className="positions-item positions-item-loan"
                            >
                              <span className="positions-pool">{position.symbol}</span>
                              <span className="positions-value">
                                Debt {formatCompact(position.debt0, 2)} /{' '}
                                {formatCompact(position.debt1, 2)}
                              </span>
                              <span className="positions-meta">
                                Collateral {formatCompact(position.collateral0, 2)} /{' '}
                                {formatCompact(position.collateral1, 2)}
                              </span>
                              <span className="positions-meta">
                                Min CF {position.cf0 ? `${(position.cf0 / 100).toFixed(2)}%` : '--'} /{' '}
                                {position.cf1 ? `${(position.cf1 / 100).toFixed(2)}%` : '--'}
                              </span>
                            </Link>
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
            )}

            {activeTab === 'Debug' && (
              <div className="debug-panel">
                <div className="debug-top">
                  <div>
                    <div className="debug-title">Program Debug</div>
                    <p>RPC: {rpcUrl}</p>
                  </div>
                  <button className="ghost-button" onClick={loadDebugData} disabled={debugLoading}>
                    {debugLoading ? 'Loading…' : 'Refresh Debug Data'}
                  </button>
                </div>

                {debugError && <div className="status-block error">{debugError}</div>}

                <div className="debug-grid">
                  <section className="debug-card">
                    <h3>Pool Accounts ({poolAccounts.length})</h3>
                    <div className="debug-list">
                      {poolAccounts.slice(0, 12).map((pool) => (
                        <code key={pool.pubkey}>{pool.pubkey}</code>
                      ))}
                      {!poolAccounts.length && <span>No pools found yet.</span>}
                    </div>
                  </section>

                  <section className="debug-card">
                    <h3>Recent Transactions</h3>
                    <div className="debug-list">
                      {recentSignatures.map((tx) => (
                        <div key={tx.signature} className="debug-tx">
                          <code>{tx.signature}</code>
                          <span>Slot {tx.slot}</span>
                          <span>{tx.err ? 'Error' : 'Success'}</span>
                        </div>
                      ))}
                      {!recentSignatures.length && <span>No transactions loaded yet.</span>}
                    </div>
                  </section>
                </div>

                <LiquidityHeatmap />
              </div>
            )}

            <div className="market-footer">
              {activeTab === 'Pools' ? (
                <button className="link-button" onClick={loadPools} disabled={poolsLoading}>
                  {poolsLoading ? 'Refreshing Pools…' : 'Refresh Pools'}
                </button>
              ) : (
                <button className="link-button">View All Markets →</button>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  )

  return (
    <div className="page">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon" aria-hidden>
              ☁️
            </span>
            <span className="brand-name">omni_test</span>
          </div>
          <div className="header-actions">
            <div
              ref={walletDropdownRef}
              className={`wallet-dropdown ${walletOpen ? 'open' : ''}`}
            >
              <button className="wallet-pill" onClick={() => setWalletOpen((v) => !v)}>
                {walletLabel}
              </button>
              <div className="wallet-panel">
                <ConnectWallet />
              </div>
            </div>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={mainContent} />
        <Route path="/pools/:address" element={<PoolDetail />} />
        <Route path="/pools/new" element={<NewPool />} />
      </Routes>
    </div>
  )
}

export default App
