import { useCallback, useMemo, useState } from 'react'
import { fetchPoolsForHeatmap } from '@/integrations/indexer/pools'
import { createRpcRequest, type ProgramAccountWithData } from '@/integrations/wallet/rpcHelpers'
import {
  getPairDecoder,
  type Pair,
  OMNIPAIR_PROGRAM_ID,
  PAIR_DISCRIMINATOR_B58,
} from '@/protocol/omnipair'
import type { PoolView, ProgramAccountResult } from '@/features/market/types'
import {
  base64ToBytes,
  getIndexerPoolTvlUsdMap,
  getIndexerTokenLogoMap,
  mapPairToPoolView,
} from '@/features/market/utils'
import { usePoolsData } from './usePoolsData'

type UsePoolsControllerParams = {
  rpcUrl: string
}

export function usePoolsController({ rpcUrl }: UsePoolsControllerParams) {
  const [poolsLoading, setPoolsLoading] = useState(false)
  const [poolsError, setPoolsError] = useState<string | null>(null)
  const [pools, setPools] = useState<PoolView[]>([])
  const [poolAccounts, setPoolAccounts] = useState<ProgramAccountResult[]>([])
  const [hasLoadedPools, setHasLoadedPools] = useState(false)

  const rpcRequest = useMemo(() => createRpcRequest(rpcUrl), [rpcUrl])
  const { poolSelectOptions } = usePoolsData(pools)

  const loadPools = useCallback(async () => {
    setPoolsLoading(true)
    setPoolsError(null)
    try {
      const [accounts, indexerPools] = await Promise.all([
        rpcRequest<ProgramAccountWithData[]>('getProgramAccounts', [
          OMNIPAIR_PROGRAM_ID,
          {
            encoding: 'base64',
            commitment: 'confirmed',
            filters: [{ memcmp: { offset: 0, bytes: PAIR_DISCRIMINATOR_B58 } }],
          },
        ]),
        fetchPoolsForHeatmap().catch(() => []),
      ])

      const decoder = getPairDecoder()
      const tokenLogoMap = getIndexerTokenLogoMap(indexerPools)
      const poolTvlUsdMap = getIndexerPoolTvlUsdMap(indexerPools)
      const decodedPools = accounts
        .map((accountItem) => {
          const encodedData = accountItem.account.data
          const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData
          if (typeof base64Data !== 'string') throw new Error('Invalid account data encoding')
          const pair = decoder.decode(base64ToBytes(base64Data)) as Pair
          return mapPairToPoolView(accountItem.pubkey, pair, tokenLogoMap, poolTvlUsdMap)
        })
        .sort((a, b) => {
          const aHasTvl = (a.tvlUsd ?? 0) > 0
          const bHasTvl = (b.tvlUsd ?? 0) > 0
          if (aHasTvl !== bHasTvl) {
            return aHasTvl ? -1 : 1
          }
          if (aHasTvl && bHasTvl) {
            return (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)
          }
          return b.utilizationPct - a.utilizationPct
        })

      setPoolAccounts(accounts.map(({ pubkey }) => ({ pubkey })))
      setPools(decodedPools)
      setHasLoadedPools(true)
    } catch (error) {
      setPoolsError(error instanceof Error ? error.message : 'Unable to load pools')
    } finally {
      setPoolsLoading(false)
    }
  }, [rpcRequest])

  return {
    poolsLoading,
    poolsError,
    pools,
    poolAccounts,
    hasLoadedPools,
    poolSelectOptions,
    loadPools,
  }
}
