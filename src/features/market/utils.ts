import type { IndexerPoolListItem } from '@/integrations/indexer/client'
import type { Pair } from '@/protocol/omnipair'
import type { BorrowHealthSnapshot, PoolView, TokenInfo } from './types'

const KNOWN_TOKENS: Record<string, TokenInfo> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Solana' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4J9sMZ5vZ6n9Y9w4tY9f: { symbol: 'USDT', name: 'Tether' },
  mSoLzYCxHdYgdzU9h5c5fW6jJ9ZgWfM8f8B6Vh9tzrV: { symbol: 'mSOL', name: 'Marinade SOL' },
  jupSoLaJ53Uo89f9Jg7p8hGQ4w2FJv8r1v9h7QpJUP: { symbol: 'JUP', name: 'Jupiter' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6rPggD4R4D9x7GfP: { symbol: 'BONK', name: 'Bonk' },
}

const KNOWN_TOKEN_LOGOS: Record<string, string> = {
  So11111111111111111111111111111111111111112:
    'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:
    'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  Es9vMFrzaCERmJfrF4H2FYD4J9sMZ5vZ6n9Y9w4tY9f:
    'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4J9sMZ5vZ6n9Y9w4tY9f/logo.png',
}

const STABLE_SYMBOLS = new Set([
  'USDC',
  'USDT',
  'USDS',
  'USDE',
  'USDH',
  'PYUSD',
  'FDUSD',
  'USDB',
  'DAI',
  'USD',
])

// Omnipair dynamic max borrow CF is typically ~95% of liquidation CF.
const MAX_BORROW_CF_FROM_LIQUIDATION_RATIO = 0.95
export const DEFAULT_DYNAMIC_MAX_BORROW_CF_BPS = 8075

export function shortAddress(value: string) {
  if (value.length < 12) return value
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function getTokenInfo(mint: string): TokenInfo {
  return KNOWN_TOKENS[mint] ?? { symbol: mint.slice(0, 4).toUpperCase(), name: shortAddress(mint) }
}

export function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function toDisplayNumber(amount: bigint, decimals: number) {
  return Number(amount) / 10 ** decimals
}

export function formatCompact(value: number, maximumFractionDigits = 2) {
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

export function toBaseUnits(amount: string, decimals: number): bigint | null {
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

export function applyDebtFromShares(userShares: bigint, totalDebt: bigint, totalShares: bigint) {
  if (totalShares === 0n) return 0n
  return (userShares * totalDebt) / totalShares
}

export function getTokenColor(seed: string) {
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

function normalizeTokenLogoUrl(value?: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null
  return trimmed
}

export function getIndexerTokenLogoMap(indexerPools: IndexerPoolListItem[]) {
  const iconMap: Record<string, string> = {}
  for (const pool of indexerPools) {
    const token0Address = pool.token0?.address
    const token1Address = pool.token1?.address
    const token0Icon = normalizeTokenLogoUrl(pool.token0?.icon)
    const token1Icon = normalizeTokenLogoUrl(pool.token1?.icon)
    if (token0Address && token0Icon && !iconMap[token0Address]) {
      iconMap[token0Address] = token0Icon
    }
    if (token1Address && token1Icon && !iconMap[token1Address]) {
      iconMap[token1Address] = token1Icon
    }
  }
  return iconMap
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function pickNumberFromObject(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const candidates = [
    obj.usd,
    obj.usdValue,
    obj.value,
    obj.total,
    obj.tvl,
    obj.tvlUsd,
    obj.tvl_usd,
    obj.amount,
  ]
  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate)
    if (parsed !== null) return parsed
  }
  return null
}

function extractIndexerTvlUsd(pool: IndexerPoolListItem): number | null {
  const candidates = [
    pool.tvl_usd,
    pool.tvlUsd,
    pool.usd_tvl,
    pool.total_tvl,
    pool.tvl,
    pool.metrics?.tvl_usd,
    pool.metrics?.tvlUsd,
    pool.metrics?.tvl,
  ]

  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate) ?? pickNumberFromObject(candidate)
    if (parsed !== null && parsed > 0) return parsed
  }

  const reserve0 = toFiniteNumber(pool.reserves?.token0) ?? 0
  const reserve1 = toFiniteNumber(pool.reserves?.token1) ?? 0
  if (reserve0 <= 0 && reserve1 <= 0) return null

  const token0Symbol = (pool.token0?.symbol ?? '').toUpperCase()
  const token1Symbol = (pool.token1?.symbol ?? '').toUpperCase()
  const token0IsStable = STABLE_SYMBOLS.has(token0Symbol)
  const token1IsStable = STABLE_SYMBOLS.has(token1Symbol)

  const priceToken1PerToken0 =
    toFiniteNumber(pool.spot_prices?.token0) ??
    toFiniteNumber(pool.oracle_prices?.token0) ??
    (reserve0 > 0 && reserve1 > 0 ? reserve1 / reserve0 : null)
  const priceToken0PerToken1 =
    toFiniteNumber(pool.spot_prices?.token1) ??
    toFiniteNumber(pool.oracle_prices?.token1) ??
    (reserve0 > 0 && reserve1 > 0 ? reserve0 / reserve1 : null)

  if (token0IsStable && token1IsStable) {
    return reserve0 + reserve1
  }

  if (token1IsStable) {
    if (priceToken1PerToken0 && priceToken1PerToken0 > 0) {
      return reserve1 + reserve0 * priceToken1PerToken0
    }
    if (priceToken0PerToken1 && priceToken0PerToken1 > 0) {
      return reserve1 + reserve0 / priceToken0PerToken1
    }
  }

  if (token0IsStable) {
    if (priceToken0PerToken1 && priceToken0PerToken1 > 0) {
      return reserve0 + reserve1 * priceToken0PerToken1
    }
    if (priceToken1PerToken0 && priceToken1PerToken0 > 0) {
      return reserve0 + reserve1 / priceToken1PerToken0
    }
  }

  return null
}

export function getIndexerPoolTvlUsdMap(indexerPools: IndexerPoolListItem[]) {
  const tvlMap: Record<string, number> = {}
  for (const pool of indexerPools) {
    const poolAddress = pool.pair_address ?? pool.pairAddress
    if (!poolAddress || tvlMap[poolAddress]) continue
    const tvl = extractIndexerTvlUsd(pool)
    if (tvl !== null && tvl > 0) {
      tvlMap[poolAddress] = tvl
    }
  }
  return tvlMap
}

function formatUsdCompact(value: number) {
  return `$${formatCompact(value, 2)}`
}

function resolveTokenLogo(mint: string, tokenLogoMap: Record<string, string>) {
  return tokenLogoMap[mint] ?? KNOWN_TOKEN_LOGOS[mint] ?? null
}

export function mapPairToPoolView(
  address: string,
  pair: Pair,
  tokenLogoMap: Record<string, string> = {},
  poolTvlUsdMap: Record<string, number> = {},
): PoolView {
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
  const tvlUsd = poolTvlUsdMap[address] ?? null

  const price = reserve0 > 0 && reserve1 > 0 ? reserve1 / reserve0 : NaN
  const pricePrecision = !Number.isFinite(price) ? 0 : price >= 100 ? 2 : price >= 1 ? 3 : 5
  const reserveTooltip = `Reserves: ${formatCompact(reserve0)} ${token0Ticker} • ${formatCompact(reserve1)} ${token1Ticker}`
  const reserveLabel =
    tvlUsd !== null && tvlUsd > 0
      ? `TVL ${formatUsdCompact(tvlUsd)}`
      : `Reserves ${formatCompact(reserve0, 1)}/${formatCompact(reserve1, 1)}`

  return {
    address,
    lpMint: pair.lpMint,
    token0Ticker,
    token1Ticker,
    token0Mint: pair.token0,
    token1Mint: pair.token1,
    token0LogoUrl: resolveTokenLogo(pair.token0, tokenLogoMap),
    token1LogoUrl: resolveTokenLogo(pair.token1, tokenLogoMap),
    token0Decimals: pair.token0Decimals,
    token1Decimals: pair.token1Decimals,
    rateModel: pair.rateModel,
    fixedCfBps: unwrapOption<number>(pair.fixedCfBps),
    swapFeeBps: pair.swapFeeBps,
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
    tvlUsd,
    reserveLabel,
    reserveTooltip,
    statusLabel: pair.reduceOnly ? 'Reduce-only' : 'Active',
    trend: utilization >= 85 ? 'down' : 'up',
  }
}

export function toPercentLabel(value: number | null, maximumFractionDigits = 2) {
  if (value === null || !Number.isFinite(value)) return '--'
  return `${(value * 100).toFixed(maximumFractionDigits)}%`
}

export function estimateMaxBorrowCfBps(params: {
  liquidationCfBps?: number | null
  fixedCfBps?: number | null
}) {
  const { liquidationCfBps, fixedCfBps } = params

  if (typeof liquidationCfBps === 'number' && Number.isFinite(liquidationCfBps) && liquidationCfBps > 0) {
    return Math.max(
      0,
      Math.min(10_000, Math.floor(liquidationCfBps * MAX_BORROW_CF_FROM_LIQUIDATION_RATIO)),
    )
  }

  if (typeof fixedCfBps === 'number' && Number.isFinite(fixedCfBps) && fixedCfBps > 0) {
    return Math.max(0, Math.min(10_000, Math.floor(fixedCfBps)))
  }

  return DEFAULT_DYNAMIC_MAX_BORROW_CF_BPS
}

function clampNonNegative(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function toToken0Equivalent(amount0: number, amount1: number, priceToken1PerToken0: number) {
  if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) {
    return clampNonNegative(amount0)
  }
  return clampNonNegative(amount0) + clampNonNegative(amount1) / priceToken1PerToken0
}

export function computeBorrowHealthSnapshot(params: {
  priceToken1PerToken0: number
  collateral0: number
  collateral1: number
  debt0: number
  debt1: number
  cf0Bps: number
  cf1Bps: number
}): BorrowHealthSnapshot {
  const {
    priceToken1PerToken0,
    collateral0,
    collateral1,
    debt0,
    debt1,
    cf0Bps,
    cf1Bps,
  } = params

  const collateralValueToken0 = toToken0Equivalent(collateral0, collateral1, priceToken1PerToken0)
  const debtValueToken0 = toToken0Equivalent(debt0, debt1, priceToken1PerToken0)

  const weightedCollateralValueToken0 = toToken0Equivalent(
    collateral0 * clampNonNegative(cf0Bps) / 10_000,
    collateral1 * clampNonNegative(cf1Bps) / 10_000,
    priceToken1PerToken0,
  )

  const maxBorrowValueToken0 = weightedCollateralValueToken0
  const availableBorrowValueToken0 = clampNonNegative(maxBorrowValueToken0 - debtValueToken0)
  const ltv = collateralValueToken0 > 0 ? debtValueToken0 / collateralValueToken0 : null
  const borrowUtilization =
    weightedCollateralValueToken0 > 0 ? debtValueToken0 / weightedCollateralValueToken0 : null
  const healthFactor = debtValueToken0 > 0 ? weightedCollateralValueToken0 / debtValueToken0 : null

  return {
    collateralValueToken0,
    debtValueToken0,
    weightedCollateralValueToken0,
    maxBorrowValueToken0,
    availableBorrowValueToken0,
    ltv,
    borrowUtilization,
    healthFactor,
  }
}
