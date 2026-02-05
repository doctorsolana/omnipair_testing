export const DEFAULT_RPC_URL =
  'https://mainnet.helius-rpc.com/?api-key=3385dee8-f4a4-4c1f-8d0c-c545a6fa4135'

export function getRpcUrl() {
  const fromEnv = (import.meta as { env?: { VITE_SOLANA_RPC_URL?: string } })?.env
    ?.VITE_SOLANA_RPC_URL
  return fromEnv || DEFAULT_RPC_URL
}
