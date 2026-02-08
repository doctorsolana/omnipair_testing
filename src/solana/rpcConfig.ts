export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com'

export function getRpcUrl() {
  const fromEnv = (import.meta as { env?: { VITE_SOLANA_RPC_URL?: string } })?.env
    ?.VITE_SOLANA_RPC_URL
  return fromEnv || DEFAULT_RPC_URL
}
