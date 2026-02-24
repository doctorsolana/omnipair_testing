import { useCallback, useMemo, useState } from 'react'
import type { SignatureResult } from '@/features/market/types'
import { createRpcRequest } from '@/integrations/wallet/rpcHelpers'
import { OMNIPAIR_PROGRAM_ID } from '@/protocol/omnipair'

type UseDebugControllerParams = {
  rpcUrl: string
  hasLoadedPools: boolean
  loadPools: () => Promise<void>
}

export function useDebugController({ rpcUrl, hasLoadedPools, loadPools }: UseDebugControllerParams) {
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugError, setDebugError] = useState<string | null>(null)
  const [recentSignatures, setRecentSignatures] = useState<SignatureResult[]>([])
  const [hasLoadedDebug, setHasLoadedDebug] = useState(false)

  const rpcRequest = useMemo(() => createRpcRequest(rpcUrl), [rpcUrl])

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

  return {
    debugLoading,
    debugError,
    recentSignatures,
    hasLoadedDebug,
    loadDebugData,
  }
}
