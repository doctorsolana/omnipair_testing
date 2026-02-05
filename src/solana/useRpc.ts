import { useMemo } from 'react'
import { createSolanaRpc } from '@solana/kit'
import { getRpcUrl } from './rpcConfig'

const RPC_URL = getRpcUrl()

export function useRpc() {
  const rpc = useMemo(() => createSolanaRpc(RPC_URL), [])
  return { rpc, rpcUrl: RPC_URL }
}
