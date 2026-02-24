export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function shortAddress(value: string) {
  if (value.length < 12) return value
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function formatCompact(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return '--'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits,
  }).format(value)
}

export function formatPercent(value: number, maximumFractionDigits = 1) {
  if (!Number.isFinite(value)) return '--'
  return `${value.toFixed(maximumFractionDigits)}%`
}

export function formatTokenAmount(value: number, ticker: string, digits = 2) {
  if (!Number.isFinite(value)) return `-- ${ticker}`
  return `${formatCompact(value, digits)} ${ticker}`
}

export function formatIsoDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatIsoDay(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown day'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function sumNumberish(...values: unknown[]) {
  return values.reduce<number>((total, value) => total + toNumber(value), 0)
}
