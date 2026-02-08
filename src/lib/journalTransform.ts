import { shortAddress, toNumber } from './formatters'

export type JournalSwapEvent = {
  id?: string | number
  pair?: string
  user_address?: string
  is_token0_in?: boolean
  amount_in?: string | number
  amount_out?: string | number
  timestamp?: string
  tx_sig?: string
}

export type JournalLendingEvent = {
  id?: string | number
  pair?: string
  event_type?: string
  description?: string
  amount0?: string | number
  amount1?: string | number
  event_timestamp?: string
  transaction_signature?: string
}

export type JournalLiquidityEvent = {
  id?: string | number
  pair?: {
    address?: string
  }
  amount0?: string | number
  amount1?: string | number
  liquidity?: string | number
  timestamp?: string
  tx_sig?: string
  event_type?: string
}

export type JournalEntryType = 'swap' | 'liquidity' | 'lending'

export type JournalEntry = {
  id: string
  type: JournalEntryType
  timestamp: string
  poolAddress: string
  txSignature: string
  title: string
  subtitle: string
  amountSummary: string
}

function fallbackTimestamp(value: string | undefined) {
  if (!value) return new Date(0).toISOString()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString()
  return date.toISOString()
}

function safePool(value: string | undefined) {
  if (!value) return 'unknown-pool'
  return value
}

function buildSwapEntry(event: JournalSwapEvent, index: number): JournalEntry {
  const poolAddress = safePool(event.pair)
  const amountIn = toNumber(event.amount_in)
  const amountOut = toNumber(event.amount_out)
  const side = event.is_token0_in ? 'Swap T0→T1' : 'Swap T1→T0'

  return {
    id: `swap-${event.id ?? index}`,
    type: 'swap',
    timestamp: fallbackTimestamp(event.timestamp),
    poolAddress,
    txSignature: event.tx_sig ?? '',
    title: side,
    subtitle: shortAddress(poolAddress),
    amountSummary: `${amountIn.toFixed(2)} in • ${amountOut.toFixed(2)} out`,
  }
}

function buildLendingEntry(event: JournalLendingEvent, index: number): JournalEntry {
  const poolAddress = safePool(event.pair)
  const title = event.description?.trim() || event.event_type?.replace(/_/g, ' ') || 'Lending event'
  const amount0 = toNumber(event.amount0)
  const amount1 = toNumber(event.amount1)

  return {
    id: `lending-${event.id ?? index}`,
    type: 'lending',
    timestamp: fallbackTimestamp(event.event_timestamp),
    poolAddress,
    txSignature: event.transaction_signature ?? '',
    title,
    subtitle: shortAddress(poolAddress),
    amountSummary: `Δ0 ${amount0.toFixed(2)} • Δ1 ${amount1.toFixed(2)}`,
  }
}

function buildLiquidityEntry(event: JournalLiquidityEvent, index: number): JournalEntry {
  const poolAddress = safePool(event.pair?.address)
  const amount0 = toNumber(event.amount0)
  const amount1 = toNumber(event.amount1)
  const liquidity = toNumber(event.liquidity)
  const kind = event.event_type === 'remove' ? 'Liquidity Remove' : 'Liquidity Add'

  return {
    id: `liquidity-${event.id ?? index}`,
    type: 'liquidity',
    timestamp: fallbackTimestamp(event.timestamp),
    poolAddress,
    txSignature: event.tx_sig ?? '',
    title: kind,
    subtitle: shortAddress(poolAddress),
    amountSummary: `${amount0.toFixed(2)} / ${amount1.toFixed(2)} • LP ${liquidity.toFixed(2)}`,
  }
}

export function mergeJournalEntries(input: {
  swaps: JournalSwapEvent[]
  lending: JournalLendingEvent[]
  liquidity: JournalLiquidityEvent[]
}) {
  const swapEntries = input.swaps.map((event, index) => buildSwapEntry(event, index))
  const lendingEntries = input.lending.map((event, index) => buildLendingEntry(event, index))
  const liquidityEntries = input.liquidity.map((event, index) => buildLiquidityEntry(event, index))

  return [...swapEntries, ...lendingEntries, ...liquidityEntries].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}
