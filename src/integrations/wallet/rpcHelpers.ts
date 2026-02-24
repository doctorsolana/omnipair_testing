import { getAddressEncoder, getBytesEncoder, getProgramDerivedAddress, type Address } from '@solana/kit'
import { OMNIPAIR_PROGRAM_ID, POSITION_SEED_PREFIX } from '@/protocol/omnipair'

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

export type ProgramAccountWithData = {
  pubkey: string
  account: {
    data: [string, string] | string
  }
}

export type RpcTokenAccountsResult = {
  value: Array<{
    pubkey: string
  }>
}

export type RpcParsedTokenAccountsResult = {
  value: Array<{
    account?: {
      data?: {
        parsed?: {
          info?: {
            mint?: string
            tokenAmount?: {
              uiAmount?: number | null
              uiAmountString?: string
            }
          }
        }
      }
    }
  }>
}

export type RpcMultipleAccountInfoResult = {
  value: Array<
    | {
        data: [string, string] | string
      }
    | null
  >
}

export type RpcRequest = <T>(method: string, params?: unknown[]) => Promise<T>

export function createRpcRequest(rpcUrl: string): RpcRequest {
  return async <T,>(method: string, params: unknown[] = []) => {
    let response: Response
    try {
      response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
      })
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : 'Failed to fetch'
      throw new Error(`RPC network error: ${message}`)
    }

    if (!response.ok) throw new Error(`RPC request failed: ${response.status}`)
    const json = (await response.json()) as { result?: T; error?: { message?: string } }
    if (json.error) throw new Error(json.error.message || 'Unknown RPC error')
    if (json.result === undefined) throw new Error(`RPC returned no result for ${method}`)
    return json.result
  }
}

export async function getOwnedTokenAccount(
  rpcRequest: RpcRequest,
  owner: string,
  mint: string,
): Promise<string | null> {
  const result = await rpcRequest<RpcTokenAccountsResult>('getTokenAccountsByOwner', [
    owner,
    { mint },
    { commitment: 'confirmed', encoding: 'base64' },
  ])
  return result.value[0]?.pubkey ?? null
}

export async function findAssociatedTokenAddress(owner: string, mint: string): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
    seeds: [
      getAddressEncoder().encode(owner as Address),
      getAddressEncoder().encode(TOKEN_PROGRAM_ID as Address),
      getAddressEncoder().encode(mint as Address),
    ],
  })
  return address
}

export async function findUserPositionAddress(pairAddress: string, owner: string): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: OMNIPAIR_PROGRAM_ID as Address,
    seeds: [
      getBytesEncoder().encode(POSITION_SEED_PREFIX),
      getAddressEncoder().encode(pairAddress as Address),
      getAddressEncoder().encode(owner as Address),
    ],
  })
  return address
}

function readTokenBalanceFromParsedAccount(account: RpcParsedTokenAccountsResult['value'][number]) {
  const info = account.account?.data?.parsed?.info
  const mint = info?.mint
  if (!mint) return null
  const amount = info.tokenAmount?.uiAmount ?? Number(info.tokenAmount?.uiAmountString ?? '0')
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { mint, amount }
}

export async function fetchWalletTokenBalances(
  rpcRequest: RpcRequest,
  owner: string,
): Promise<Map<string, number>> {
  const [tokenkegAccounts, token2022Accounts] = await Promise.all([
    rpcRequest<RpcParsedTokenAccountsResult>('getTokenAccountsByOwner', [
      owner,
      { programId: TOKEN_PROGRAM_ID },
      { commitment: 'confirmed', encoding: 'jsonParsed' },
    ]),
    rpcRequest<RpcParsedTokenAccountsResult>('getTokenAccountsByOwner', [
      owner,
      { programId: TOKEN_2022_PROGRAM_ID },
      { commitment: 'confirmed', encoding: 'jsonParsed' },
    ]).catch(() => ({ value: [] })),
  ])

  const balances = new Map<string, number>()
  const allAccounts = [...tokenkegAccounts.value, ...token2022Accounts.value]
  for (const tokenAccount of allAccounts) {
    const parsed = readTokenBalanceFromParsedAccount(tokenAccount)
    if (!parsed) continue
    balances.set(parsed.mint, (balances.get(parsed.mint) ?? 0) + parsed.amount)
  }

  return balances
}
