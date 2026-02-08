import { clamp, toNumber, sumNumberish } from './formatters'
import { mergeJournalEntries, type JournalEntry, type JournalLendingEvent, type JournalSwapEvent } from './journalTransform'
import { computeCompositeRiskScore, type RiskLabel } from './riskModel'

const INDEXER_BASE_URL = 'https://api.indexer.omnipair.fi/api/v1'
const DEFAULT_CACHE_TTL_MS = 60_000

const responseCache = new Map<string, { timestamp: number; data: unknown }>()
const inflightRequests = new Map<string, Promise<unknown>>()

export type FetchOptions = {
  signal?: AbortSignal
  force?: boolean
  ttlMs?: number
}

type IndexerEnvelope<T> = {
  success?: boolean
  data?: T
  error?: string
}

export type IndexerPoolToken = {
  symbol?: string
  name?: string
  decimals?: number
  address?: string
  icon?: string
}

export type IndexerPoolListItem = {
  id?: number
  pair_address: string
  token0?: IndexerPoolToken
  token1?: IndexerPoolToken
  reserves?: {
    token0?: string | number
    token1?: string | number
  }
  utilization?: {
    token0?: number
    token1?: number
  }
  total_debts?: {
    token0?: string | number
    token1?: string | number
  }
  apr?: number | string
  volume_24h?: unknown
  swap_fee_bps?: string | number
  fixed_cf_bps?: string | number | null
}

export type IndexerPriceChartPoint = {
  bucket: string
  avg_price: string | number | null
}

export type IndexerPriceChartResponse = {
  prices?: IndexerPriceChartPoint[]
  latestPrice?: string | number | null
  period?: string
  interval?: string
  hours?: number
  pairAddress?: string
}

export type IndexerVolumeResponse = {
  volume0?: string | number
  volume1?: string | number
  period?: string
  hours?: number
  pairAddress?: string
}

export type IndexerFeesResponse = {
  total_fee_paid_in_token0?: string | number
  total_fee_paid_in_token1?: string | number
  period?: string
  hours?: number
  pairAddress?: string
}

export type IndexerStatsResponse = {
  apr?: string | number
  apr_breakdown?: {
    token0_apr?: string | number
    token1_apr?: string | number
  }
  pairAddress?: string
}

export type IndexerPoolInfoResponse = {
  reserve0?: string | number
  reserve1?: string | number
  pairAddress?: string
  timestamp?: string
}

export type IndexerSwap = {
  id?: string | number
  pair?: string
  user_address?: string
  is_token0_in?: boolean
  amount_in?: string | number
  amount_out?: string | number
  timestamp?: string
  tx_sig?: string
  slot?: string | number
}

export type IndexerPosition = {
  signer?: string
  pair?: string
  position?: string
  collateralToken?: 'token0' | 'token1' | string
  debtToken?: 'token0' | 'token1' | string
  collateral?: string | number
  debtShares?: string | number
  debtWithInterest?: string | number
  event_timestamp?: string
}

export type IndexerLendingEvent = {
  id?: string | number
  event_type?: string
  pair?: string
  signer?: string
  transaction_signature?: string
  event_timestamp?: string
  amount0?: string | number
  amount1?: string | number
  description?: string
}

export type IndexerLiquidityEvent = {
  id?: string | number
  pair?: {
    address?: string
  }
  user_address?: string
  amount0?: string | number
  amount1?: string | number
  liquidity?: string | number
  tx_sig?: string
  timestamp?: string
  event_type?: string
}

export type PoolPerformanceSeriesPoint = {
  time: string
  value: number
}

export type PoolPerformanceStats = {
  windowHours: number
  period: string
  interval: string
  series: PoolPerformanceSeriesPoint[]
  latestPrice: number | null
  changePct: number | null
  high: number | null
  low: number | null
  volume0: number
  volume1: number
  fees0: number
  fees1: number
  apr: number | null
}

export type BorrowRiskSnapshot = {
  scopeLabel: 'Pool Snapshot' | 'Pool + Wallet Events'
  utilizationPct: number
  borrowPressurePct: number
  debtSkewPct: number
  collateralMixToken0Pct: number
  collateralMixToken1Pct: number
  debtMixToken0Pct: number
  debtMixToken1Pct: number
  positionCount: number
  eventMomentum: number
  riskScore: number
  riskLabel: RiskLabel
  lastEventAt: string | null
}

export type SwapSizeTier = 'S' | 'M' | 'L' | 'XL'
export type SwapSpeedTier = 'Fast' | 'Normal' | 'Slow'

export type SwapTapeItem = {
  id: string
  timestamp: string
  txSignature: string
  userAddress: string
  amountIn: number
  amountOut: number
  impliedPrice: number | null
  isToken0In: boolean
  sizeTier: SwapSizeTier
  speedTier: SwapSpeedTier
  slot: string
}

export type WalletJournalResult = {
  entries: JournalEntry[]
  errors: string[]
}

export type HeatmapPoolPoint = {
  poolAddress: string
  symbol: string
  token0Symbol: string
  token1Symbol: string
  liquidityValue: number
  volumeValue: number
  compositeScore: number
  liquidityBucket: number
  volumeBucket: number
}

export type HeatmapCell = {
  x: number
  y: number
  poolCount: number
  intensity: number
  pools: HeatmapPoolPoint[]
}

export type HeatmapResult = {
  points: HeatmapPoolPoint[]
  cells: HeatmapCell[]
}

function toQueryKey(params?: Record<string, string | number | undefined>) {
  if (!params) return ''
  const entries = Object.entries(params).filter(([, value]) => value !== undefined)
  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries.map(([key, value]) => `${key}=${String(value)}`).join('&')
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>) {
  const safePath = path.startsWith('/') ? path : `/${path}`
  const query = toQueryKey(params)
  const suffix = query ? `${safePath}?${query}` : safePath
  return `${INDEXER_BASE_URL}${suffix}`
}

async function getIndexerData<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  options?: FetchOptions,
): Promise<T> {
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  const url = buildUrl(path, params)
  const cacheKey = url

  const now = Date.now()
  if (!options?.force) {
    const cached = responseCache.get(cacheKey)
    if (cached && now - cached.timestamp < ttlMs) {
      return cached.data as T
    }
  }

  const canShareInflight = !options?.signal
  if (canShareInflight) {
    const existing = inflightRequests.get(cacheKey)
    if (existing) return (await existing) as T
  }

  const requestPromise = (async () => {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: options?.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Indexer request failed (${response.status}): ${text || url}`)
    }

    const json = (await response.json()) as IndexerEnvelope<T>
    if (json.success === false) {
      throw new Error(json.error || `Indexer request failed: ${url}`)
    }
    if (json.data === undefined) {
      throw new Error(`Indexer response missing data: ${url}`)
    }

    responseCache.set(cacheKey, { timestamp: Date.now(), data: json.data })
    return json.data
  })()

  if (canShareInflight) {
    inflightRequests.set(cacheKey, requestPromise)
  }

  try {
    return (await requestPromise) as T
  } finally {
    if (canShareInflight) {
      inflightRequests.delete(cacheKey)
    }
  }
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const right = sorted[base + 1] ?? sorted[base]
  return sorted[base] + rest * (right - sorted[base])
}

function toBucket(values: number[], value: number) {
  if (!values.length) return 0
  const q20 = quantile(values, 0.2)
  const q40 = quantile(values, 0.4)
  const q60 = quantile(values, 0.6)
  const q80 = quantile(values, 0.8)

  if (value <= q20) return 0
  if (value <= q40) return 1
  if (value <= q60) return 2
  if (value <= q80) return 3
  return 4
}

function parseVolumeLike(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number' || typeof value === 'string') return toNumber(value)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return sumNumberish(obj.token0, obj.token1, obj.volume0, obj.volume1, obj.total)
  }
  return 0
}

function pctOf(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0
  return clamp((part / total) * 100, 0, 100)
}

function speedTier(deltaSeconds: number | null): SwapSpeedTier {
  if (deltaSeconds === null) return 'Normal'
  if (deltaSeconds < 45) return 'Fast'
  if (deltaSeconds > 300) return 'Slow'
  return 'Normal'
}

function sizeTier(value: number, values: number[]): SwapSizeTier {
  const q25 = quantile(values, 0.25)
  const q50 = quantile(values, 0.5)
  const q75 = quantile(values, 0.75)
  if (value <= q25) return 'S'
  if (value <= q50) return 'M'
  if (value <= q75) return 'L'
  return 'XL'
}

export async function fetchPoolPerformance(
  poolAddress: string,
  windowHours: number,
  options?: FetchOptions,
): Promise<PoolPerformanceStats> {
  const [chartResult, volumeResult, feesResult, statsResult] = await Promise.allSettled([
    getIndexerData<IndexerPriceChartResponse>(`/pools/${poolAddress}/price-chart`, { windowHours }, options),
    getIndexerData<IndexerVolumeResponse>(`/pools/${poolAddress}/volume`, { windowHours }, options),
    getIndexerData<IndexerFeesResponse>(`/pools/${poolAddress}/fees`, { windowHours }, options),
    getIndexerData<IndexerStatsResponse>(`/pools/${poolAddress}/stats`, { windowHours }, options),
  ])

  if (chartResult.status === 'rejected') {
    throw chartResult.reason
  }

  const chart = chartResult.value
  const series = (chart.prices ?? [])
    .map((point) => ({
      time: point.bucket,
      value: toNumber(point.avg_price),
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0)

  const latest = series.length ? series[series.length - 1].value : null
  const first = series.length ? series[0].value : null
  const high = series.length ? Math.max(...series.map((point) => point.value)) : null
  const low = series.length ? Math.min(...series.map((point) => point.value)) : null
  const changePct = first && latest ? ((latest - first) / first) * 100 : null

  const volume = volumeResult.status === 'fulfilled' ? volumeResult.value : null
  const fees = feesResult.status === 'fulfilled' ? feesResult.value : null
  const stats = statsResult.status === 'fulfilled' ? statsResult.value : null

  return {
    windowHours,
    period: chart.period || `${windowHours} hours`,
    interval: chart.interval || '1 minute',
    series,
    latestPrice: latest,
    changePct,
    high,
    low,
    volume0: toNumber(volume?.volume0),
    volume1: toNumber(volume?.volume1),
    fees0: toNumber(fees?.total_fee_paid_in_token0),
    fees1: toNumber(fees?.total_fee_paid_in_token1),
    apr: stats ? toNumber(stats.apr) : null,
  }
}

export async function fetchPoolRisk(
  poolAddress: string,
  walletAddress?: string,
  options?: FetchOptions,
): Promise<BorrowRiskSnapshot> {
  const positionsRequest = getIndexerData<{ positions?: IndexerPosition[] }>(
    '/positions',
    { poolAddress, limit: 500, offset: 0 },
    options,
  )
  const poolInfoRequest = getIndexerData<IndexerPoolInfoResponse>(`/pools/${poolAddress}`, undefined, options)

  const lendingRequest = walletAddress
    ? getIndexerData<{ lendingHistory?: IndexerLendingEvent[] }>(
        `/users/${walletAddress}/lending-events`,
        { poolAddress, limit: 100, offset: 0 },
        options,
      )
    : Promise.resolve<{ lendingHistory?: IndexerLendingEvent[] }>({ lendingHistory: [] })

  const [positionsData, poolInfoData, lendingData] = await Promise.all([
    positionsRequest,
    poolInfoRequest,
    lendingRequest,
  ])

  const positions = positionsData.positions ?? []
  const lendingEvents = lendingData.lendingHistory ?? []

  let collateral0 = 0
  let collateral1 = 0
  let debt0 = 0
  let debt1 = 0

  for (const position of positions) {
    const collateralValue = toNumber(position.collateral)
    const debtValue = toNumber(position.debtWithInterest ?? position.debtShares)

    if (position.collateralToken === 'token1') {
      collateral1 += collateralValue
    } else {
      collateral0 += collateralValue
    }

    if (position.debtToken === 'token1') {
      debt1 += debtValue
    } else {
      debt0 += debtValue
    }
  }

  const reserve0 = toNumber(poolInfoData.reserve0)
  const reserve1 = toNumber(poolInfoData.reserve1)

  const utilization0 = reserve0 > 0 ? (debt0 / reserve0) * 100 : 0
  const utilization1 = reserve1 > 0 ? (debt1 / reserve1) * 100 : 0
  const utilizationPct = clamp(Math.max(utilization0, utilization1), 0, 100)

  const totalDebt = debt0 + debt1
  const totalCollateral = collateral0 + collateral1
  const totalReserves = reserve0 + reserve1

  const debtSkewPct = totalDebt > 0 ? (Math.abs(debt0 - debt1) / totalDebt) * 100 : 0
  const borrowPressurePct = totalReserves > 0 ? (totalDebt / totalReserves) * 100 : utilizationPct

  let positiveSignals = 0
  let negativeSignals = 0
  let lastEventAt: string | null = null

  for (const event of lendingEvents) {
    if (event.event_timestamp) {
      if (!lastEventAt || new Date(event.event_timestamp) > new Date(lastEventAt)) {
        lastEventAt = event.event_timestamp
      }
    }

    const amount0 = toNumber(event.amount0)
    const amount1 = toNumber(event.amount1)
    const hasPositiveAmount = amount0 > 0 || amount1 > 0
    const hasNegativeAmount = amount0 < 0 || amount1 < 0
    const type = (event.event_type || '').toLowerCase()

    if (hasPositiveAmount || type.includes('borrow')) {
      positiveSignals += 1
    }
    if (hasNegativeAmount || type.includes('repay')) {
      negativeSignals += 1
    }
  }

  let eventMomentum = 50
  if (walletAddress) {
    const signalCount = positiveSignals + negativeSignals
    if (signalCount > 0) {
      eventMomentum = clamp(50 + ((positiveSignals - negativeSignals) / signalCount) * 50, 0, 100)
    }
  }

  const risk = computeCompositeRiskScore({
    utilizationStress: utilizationPct,
    debtSkewStress: debtSkewPct,
    eventMomentumStress: eventMomentum,
  })

  return {
    scopeLabel: walletAddress ? 'Pool + Wallet Events' : 'Pool Snapshot',
    utilizationPct,
    borrowPressurePct: clamp(borrowPressurePct, 0, 100),
    debtSkewPct: clamp(debtSkewPct, 0, 100),
    collateralMixToken0Pct: pctOf(collateral0, totalCollateral),
    collateralMixToken1Pct: pctOf(collateral1, totalCollateral),
    debtMixToken0Pct: pctOf(debt0, totalDebt),
    debtMixToken1Pct: pctOf(debt1, totalDebt),
    positionCount: positions.length,
    eventMomentum,
    riskScore: risk.score,
    riskLabel: risk.label,
    lastEventAt,
  }
}

export async function fetchSwapTape(
  poolAddress: string,
  options?: FetchOptions,
): Promise<SwapTapeItem[]> {
  const data = await getIndexerData<{ swaps?: IndexerSwap[] }>(
    `/pools/${poolAddress}/swaps`,
    { limit: 50, offset: 0 },
    options,
  )

  const swaps = (data.swaps ?? [])
    .map((swap, index) => {
      const timestamp = swap.timestamp || new Date(0).toISOString()
      const amountIn = Math.abs(toNumber(swap.amount_in))
      const amountOut = Math.abs(toNumber(swap.amount_out))
      return {
        id: String(swap.id ?? index),
        timestamp,
        txSignature: swap.tx_sig ?? '',
        userAddress: swap.user_address ?? '',
        amountIn,
        amountOut,
        impliedPrice: amountIn > 0 ? amountOut / amountIn : null,
        isToken0In: Boolean(swap.is_token0_in),
        slot: String(swap.slot ?? ''),
      }
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const amountValues = swaps.map((item) => item.amountIn)

  return swaps.map((item, index) => {
    const previous = index === 0 ? null : swaps[index - 1]
    const deltaSeconds = previous
      ? Math.abs(new Date(previous.timestamp).getTime() - new Date(item.timestamp).getTime()) / 1000
      : null

    return {
      ...item,
      sizeTier: sizeTier(item.amountIn, amountValues),
      speedTier: speedTier(deltaSeconds),
    }
  })
}

export async function fetchWalletJournal(
  walletAddress: string,
  options?: FetchOptions,
): Promise<WalletJournalResult> {
  const errors: string[] = []

  const [swapsData, lendingData, positionsData] = await Promise.all([
    getIndexerData<{ swaps?: JournalSwapEvent[] }>(
      `/users/${walletAddress}/swaps`,
      { limit: 100, offset: 0 },
      options,
    ).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : 'Unable to load swaps')
      return { swaps: [] }
    }),
    getIndexerData<{ lendingHistory?: JournalLendingEvent[] }>(
      `/users/${walletAddress}/lending-events`,
      { limit: 100, offset: 0 },
      options,
    ).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : 'Unable to load lending events')
      return { lendingHistory: [] }
    }),
    getIndexerData<{ positions?: IndexerPosition[] }>(
      `/users/${walletAddress}/positions`,
      { limit: 100, offset: 0 },
      options,
    ).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : 'Unable to load positions')
      return { positions: [] }
    }),
  ])

  const poolSet = new Set<string>()

  for (const position of positionsData.positions ?? []) {
    if (position.pair) poolSet.add(position.pair)
  }
  for (const swap of swapsData.swaps ?? []) {
    if (swap.pair) poolSet.add(swap.pair)
  }
  for (const lending of lendingData.lendingHistory ?? []) {
    if (lending.pair) poolSet.add(lending.pair)
  }

  const liquidityPools = [...poolSet].slice(0, 8)
  const liquidityRequests = liquidityPools.map(async (poolAddress) => {
    try {
      const response = await getIndexerData<{ userHistory?: IndexerLiquidityEvent[] }>(
        `/users/${walletAddress}/liquidity-events`,
        { poolAddress, limit: 50, offset: 0 },
        options,
      )
      return response.userHistory ?? []
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `Liquidity events (${poolAddress.slice(0, 6)}…): ${error.message}`
          : `Liquidity events (${poolAddress.slice(0, 6)}…): failed`,
      )
      return []
    }
  })

  const liquidityResults = await Promise.all(liquidityRequests)
  const liquidityEvents = liquidityResults.flat()

  const entries = mergeJournalEntries({
    swaps: swapsData.swaps ?? [],
    lending: lendingData.lendingHistory ?? [],
    liquidity: liquidityEvents,
  })

  return {
    entries,
    errors,
  }
}

export async function fetchPoolsForHeatmap(options?: FetchOptions) {
  const response = await getIndexerData<{ pools?: IndexerPoolListItem[] }>(
    '/pools',
    {
      limit: 200,
      offset: 0,
      sortBy: 'tvl',
      sortOrder: 'desc',
    },
    options,
  )

  return response.pools ?? []
}

export function buildHeatmap(pools: IndexerPoolListItem[]): HeatmapResult {
  const pointsBase = pools
    .filter((pool) => Boolean(pool.pair_address))
    .map((pool) => {
      const reserve0 = toNumber(pool.reserves?.token0)
      const reserve1 = toNumber(pool.reserves?.token1)
      const liquidityValue = reserve0 + reserve1
      const volumeValue = parseVolumeLike(pool.volume_24h)
      const token0Symbol = pool.token0?.symbol || pool.token0?.address?.slice(0, 4) || 'T0'
      const token1Symbol = pool.token1?.symbol || pool.token1?.address?.slice(0, 4) || 'T1'

      return {
        poolAddress: pool.pair_address,
        symbol: `${token0Symbol}/${token1Symbol}`,
        token0Symbol,
        token1Symbol,
        liquidityValue,
        volumeValue,
        compositeScore: (liquidityValue + 1) * (volumeValue + 1),
      }
    })

  const liquidityValues = pointsBase.map((point) => point.liquidityValue)
  const volumeValues = pointsBase.map((point) => point.volumeValue)

  const points: HeatmapPoolPoint[] = pointsBase.map((point) => ({
    ...point,
    liquidityBucket: toBucket(liquidityValues, point.liquidityValue),
    volumeBucket: toBucket(volumeValues, point.volumeValue),
  }))

  const cellMap = new Map<string, HeatmapCell>()
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      cellMap.set(`${x}-${y}`, { x, y, poolCount: 0, intensity: 0, pools: [] })
    }
  }

  for (const point of points) {
    const key = `${point.liquidityBucket}-${point.volumeBucket}`
    const cell = cellMap.get(key)
    if (!cell) continue
    cell.poolCount += 1
    cell.pools.push(point)
  }

  const cells = [...cellMap.values()]
  const maxCount = Math.max(1, ...cells.map((cell) => cell.poolCount))

  for (const cell of cells) {
    cell.intensity = cell.poolCount > 0 ? cell.poolCount / maxCount : 0
    cell.pools.sort((a, b) => b.compositeScore - a.compositeScore)
  }

  points.sort((a, b) => b.compositeScore - a.compositeScore)

  return { points, cells }
}
