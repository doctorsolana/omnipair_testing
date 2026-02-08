type RpcEnv = {
  VITE_SOLANA_RPC_URL?: string
  VITE_RPC_URL?: string
}

function toNonEmpty(value?: string) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function getRpcUrl() {
  const env = import.meta.env as RpcEnv
  const rpcUrl = toNonEmpty(env.VITE_SOLANA_RPC_URL) ?? toNonEmpty(env.VITE_RPC_URL)
  if (!rpcUrl) {
    throw new Error(
      'Missing RPC URL. Set VITE_SOLANA_RPC_URL in .env (or VITE_RPC_URL) before starting the app.',
    )
  }
  return rpcUrl
}
