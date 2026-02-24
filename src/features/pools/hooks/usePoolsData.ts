import { useMemo } from 'react'
import type { PoolView, PoolSelectOption } from '@/features/market/types'

export function usePoolsData(pools: PoolView[]) {
  const poolSelectOptions = useMemo<PoolSelectOption[]>(() => {
    return pools.map((pool) => ({
      address: pool.address,
      symbol: pool.symbol,
      name: pool.name,
      token0Ticker: pool.token0Ticker,
      token1Ticker: pool.token1Ticker,
      token0LogoUrl: pool.token0LogoUrl,
      token1LogoUrl: pool.token1LogoUrl,
    }))
  }, [pools])

  return { poolSelectOptions }
}
