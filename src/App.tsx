import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useConnector } from '@solana/connector'
import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from '@solana/kit'
import { ConnectWallet } from './solana/ConnectWallet'
import PoolDetail from './PoolDetail'
import NewPool from './NewPool'
import PoolsTab from './components/tabs/PoolsTab'
import TradeTab from './components/tabs/TradeTab'
import BorrowTab from './components/tabs/BorrowTab'
import PositionsTab from './components/tabs/PositionsTab'
import DebugTab from './components/tabs/DebugTab'
import { fetchPoolsForHeatmap } from './lib/indexerClient'
import { formatActionError, formatSimulationError } from './lib/simulationError'
import {
  getAddCollateralInstructionAsync,
  getBorrowInstructionAsync,
  getPairDecoder,
  getRepayInstructionAsync,
  getSwapInstructionAsync,
  getUserPositionDecoder,
  OMNIPAIR_PROGRAM_ID,
  PAIR_DISCRIMINATOR_B58,
  POSITION_SEED_PREFIX,
  type Pair,
  type UserPosition,
} from './omnipair'
import { useRpc } from './solana/useRpc'
import { useSendSmartTransaction } from './solana/useSendSmartTransaction'
import {
  APP_TABS,
  type BorrowHealthSnapshot,
  DEFAULT_TRADE_TOKEN,
  type AppTab,
  type LoanPositionView,
  type LpPositionView,
  type PoolSelectOption,
  type PoolView,
  type ProgramAccountResult,
  type SignatureResult,
  type TradeTokenOption,
} from './features/market/types'
import {
  applyDebtFromShares,
  base64ToBytes,
  computeBorrowHealthSnapshot,
  formatCompact,
  getIndexerPoolTvlUsdMap,
  getIndexerTokenLogoMap,
  getTokenColor,
  mapPairToPoolView,
  shortAddress,
  toBaseUnits,
  toDisplayNumber,
} from './features/market/utils'

type ProgramAccountWithData = {
  pubkey: string
  account: {
    data: [string, string] | string
  }
}

type RpcTokenAccountsResult = {
  value: Array<{
    pubkey: string
  }>
}

type RpcParsedTokenAccountsResult = {
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

type RpcMultipleAccountInfoResult = {
  value: Array<
    | {
        data: [string, string] | string
      }
    | null
  >
}

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

function App() {
  const { account, isConnected } = useConnector()
  const { rpcUrl } = useRpc()
  const { signer, simulate, send } = useSendSmartTransaction()

  const [walletOpen, setWalletOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('Pools')
  const activeTabIndex = Math.max(0, APP_TABS.indexOf(activeTab))
  const walletDropdownRef = useRef<HTMLDivElement | null>(null)
  const lastBorrowPoolAddressRef = useRef<string | null>(null)

  const [poolsLoading, setPoolsLoading] = useState(false)
  const [poolsError, setPoolsError] = useState<string | null>(null)
  const [pools, setPools] = useState<PoolView[]>([])
  const [poolAccounts, setPoolAccounts] = useState<ProgramAccountResult[]>([])
  const [hasLoadedPools, setHasLoadedPools] = useState(false)

  const [debugLoading, setDebugLoading] = useState(false)
  const [debugError, setDebugError] = useState<string | null>(null)
  const [recentSignatures, setRecentSignatures] = useState<SignatureResult[]>([])
  const [hasLoadedDebug, setHasLoadedDebug] = useState(false)

  const [tradeFromAmount, setTradeFromAmount] = useState('1.0')
  const [tradeToAmount, setTradeToAmount] = useState('')
  const [tradeFromToken, setTradeFromToken] = useState('')
  const [tradeToToken, setTradeToToken] = useState('')
  const [tradeSubmitting, setTradeSubmitting] = useState(false)
  const [tradeStatus, setTradeStatus] = useState<string | null>(null)
  const [tradeError, setTradeError] = useState<string | null>(null)

  const [borrowPool, setBorrowPool] = useState('')
  const [borrowToken, setBorrowToken] = useState('')
  const [borrowAmount, setBorrowAmount] = useState('')
  const [collateralToken, setCollateralToken] = useState('')
  const [collateralAmount, setCollateralAmount] = useState('')
  const [borrowTokenBalances, setBorrowTokenBalances] = useState<Record<string, number>>({})
  const [borrowSubmitting, setBorrowSubmitting] = useState(false)
  const [borrowStatus, setBorrowStatus] = useState<string | null>(null)
  const [borrowError, setBorrowError] = useState<string | null>(null)

  const [positionsLoading, setPositionsLoading] = useState(false)
  const [positionsError, setPositionsError] = useState<string | null>(null)
  const [loanPositions, setLoanPositions] = useState<LoanPositionView[]>([])
  const [lpPositions, setLpPositions] = useState<LpPositionView[]>([])

  const walletLabel = useMemo(() => {
    if (!isConnected || !account) return 'Connect Wallet'
    return `${account.slice(0, 4)}…${account.slice(-4)}`
  }, [account, isConnected])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!walletOpen) return
      const target = event.target as Node | null
      if (target && walletDropdownRef.current?.contains(target)) return
      setWalletOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [walletOpen])

  const tradeTokenOptions = useMemo<TradeTokenOption[]>(() => {
    const map = new Map<string, TradeTokenOption>()

    const upsertTokenOption = (token: TradeTokenOption) => {
      const existing = map.get(token.mint)
      if (!existing) {
        map.set(token.mint, token)
        return
      }
      if (!existing.logoUrl && token.logoUrl) {
        map.set(token.mint, {
          ...existing,
          logoUrl: token.logoUrl,
        })
      }
    }

    for (const pool of pools) {
      upsertTokenOption({
        mint: pool.token0Mint,
        ticker: pool.token0Ticker,
        name: pool.token0Ticker,
        logo: pool.token0Ticker.slice(0, 1),
        color: getTokenColor(pool.token0Mint),
        logoUrl: pool.token0LogoUrl,
      })
      upsertTokenOption({
        mint: pool.token1Mint,
        ticker: pool.token1Ticker,
        name: pool.token1Ticker,
        logo: pool.token1Ticker.slice(0, 1),
        color: getTokenColor(pool.token1Mint),
        logoUrl: pool.token1LogoUrl,
      })
    }
    return [...map.values()].sort((a, b) => a.ticker.localeCompare(b.ticker))
  }, [pools])

  const selectedTradePool = useMemo(() => {
    return (
      pools.find((pool) => pool.token0Mint === tradeFromToken && pool.token1Mint === tradeToToken) ??
      pools.find((pool) => pool.token0Mint === tradeToToken && pool.token1Mint === tradeFromToken) ??
      null
    )
  }, [pools, tradeFromToken, tradeToToken])

  const selectedBorrowPool = useMemo(() => {
    return pools.find((pool) => pool.address === borrowPool) ?? pools[0] ?? null
  }, [borrowPool, pools])

  const poolSymbolsByAddress = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const pool of pools) {
      map[pool.address] = pool.symbol
    }
    return map
  }, [pools])

  const borrowTokenOptions = useMemo<TradeTokenOption[]>(() => {
    if (!selectedBorrowPool) return []
    return [
      {
        mint: selectedBorrowPool.token0Mint,
        ticker: selectedBorrowPool.token0Ticker,
        name: selectedBorrowPool.token0Ticker,
        logo: selectedBorrowPool.token0Ticker.slice(0, 1),
        color: getTokenColor(selectedBorrowPool.token0Mint),
        logoUrl: selectedBorrowPool.token0LogoUrl,
      },
      {
        mint: selectedBorrowPool.token1Mint,
        ticker: selectedBorrowPool.token1Ticker,
        name: selectedBorrowPool.token1Ticker,
        logo: selectedBorrowPool.token1Ticker.slice(0, 1),
        color: getTokenColor(selectedBorrowPool.token1Mint),
        logoUrl: selectedBorrowPool.token1LogoUrl,
      },
    ]
  }, [selectedBorrowPool])

  const collateralTokenOptions = borrowTokenOptions

  const tradeFromTokenInfo = useMemo(
    () =>
      tradeTokenOptions.find((token) => token.mint === tradeFromToken) ??
      tradeTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [tradeFromToken, tradeTokenOptions],
  )

  const borrowTokenInfo = useMemo(
    () =>
      borrowTokenOptions.find((token) => token.mint === borrowToken) ??
      borrowTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [borrowToken, borrowTokenOptions],
  )

  const collateralTokenInfo = useMemo(
    () =>
      collateralTokenOptions.find((token) => token.mint === collateralToken) ??
      collateralTokenOptions[0] ??
      DEFAULT_TRADE_TOKEN,
    [collateralToken, collateralTokenOptions],
  )

  const selectedBorrowLoanPosition = useMemo(() => {
    if (!selectedBorrowPool) return null
    return loanPositions.find((position) => position.poolAddress === selectedBorrowPool.address) ?? null
  }, [loanPositions, selectedBorrowPool])

  const estimatedCf0Bps = useMemo(() => {
    if (selectedBorrowLoanPosition?.cf0) return selectedBorrowLoanPosition.cf0
    if (selectedBorrowPool?.fixedCfBps) return selectedBorrowPool.fixedCfBps
    return 5000
  }, [selectedBorrowLoanPosition, selectedBorrowPool])

  const estimatedCf1Bps = useMemo(() => {
    if (selectedBorrowLoanPosition?.cf1) return selectedBorrowLoanPosition.cf1
    if (selectedBorrowPool?.fixedCfBps) return selectedBorrowPool.fixedCfBps
    return 5000
  }, [selectedBorrowLoanPosition, selectedBorrowPool])

  const currentBorrowHealth = useMemo<BorrowHealthSnapshot | null>(() => {
    if (!selectedBorrowPool) return null

    return computeBorrowHealthSnapshot({
      priceToken1PerToken0: selectedBorrowPool.price,
      collateral0: selectedBorrowLoanPosition?.collateral0 ?? 0,
      collateral1: selectedBorrowLoanPosition?.collateral1 ?? 0,
      debt0: selectedBorrowLoanPosition?.debt0 ?? 0,
      debt1: selectedBorrowLoanPosition?.debt1 ?? 0,
      cf0Bps: estimatedCf0Bps,
      cf1Bps: estimatedCf1Bps,
    })
  }, [estimatedCf0Bps, estimatedCf1Bps, selectedBorrowLoanPosition, selectedBorrowPool])

  const projectedBorrowHealth = useMemo<BorrowHealthSnapshot | null>(() => {
    if (!selectedBorrowPool || !currentBorrowHealth) return null

    let collateral0 = selectedBorrowLoanPosition?.collateral0 ?? 0
    let collateral1 = selectedBorrowLoanPosition?.collateral1 ?? 0
    let debt0 = selectedBorrowLoanPosition?.debt0 ?? 0
    let debt1 = selectedBorrowLoanPosition?.debt1 ?? 0

    const collateralIsToken0 = selectedBorrowPool.token0Mint === collateralToken
    const collateralDecimals = collateralIsToken0
      ? selectedBorrowPool.token0Decimals
      : selectedBorrowPool.token1Decimals
    const collateralBase = collateralToken && collateralAmount.trim()
      ? toBaseUnits(collateralAmount, collateralDecimals)
      : 0n
    const collateralValue =
      collateralBase && collateralBase > 0n ? toDisplayNumber(collateralBase, collateralDecimals) : 0
    if (collateralValue > 0) {
      if (collateralIsToken0) {
        collateral0 += collateralValue
      } else {
        collateral1 += collateralValue
      }
    }

    const borrowIsToken0 = selectedBorrowPool.token0Mint === borrowToken
    const borrowDecimals = borrowIsToken0
      ? selectedBorrowPool.token0Decimals
      : selectedBorrowPool.token1Decimals
    const borrowBase = borrowToken ? toBaseUnits(borrowAmount, borrowDecimals) : 0n
    const borrowValue = borrowBase && borrowBase > 0n ? toDisplayNumber(borrowBase, borrowDecimals) : 0
    if (borrowValue > 0) {
      if (borrowIsToken0) {
        debt0 += borrowValue
      } else {
        debt1 += borrowValue
      }
    }

    return computeBorrowHealthSnapshot({
      priceToken1PerToken0: selectedBorrowPool.price,
      collateral0,
      collateral1,
      debt0,
      debt1,
      cf0Bps: estimatedCf0Bps,
      cf1Bps: estimatedCf1Bps,
    })
  }, [
    borrowAmount,
    borrowToken,
    collateralAmount,
    collateralToken,
    currentBorrowHealth,
    estimatedCf0Bps,
    estimatedCf1Bps,
    selectedBorrowLoanPosition,
    selectedBorrowPool,
  ])

  const collateralBalanceLabel = useMemo(() => {
    if (!collateralTokenInfo.mint) return '--'
    const balance = borrowTokenBalances[collateralTokenInfo.mint] ?? 0
    return `${formatCompact(balance, 4)} ${collateralTokenInfo.ticker}`
  }, [borrowTokenBalances, collateralTokenInfo])

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

  const rpcRequest = useCallback(
    async <T,>(method: string, params: unknown[] = []) => {
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
    },
    [rpcUrl],
  )

  const findAssociatedTokenAddress = useCallback(async (owner: string, mint: string) => {
    return getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
      seeds: [
        getAddressEncoder().encode(owner as Address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ID as Address),
        getAddressEncoder().encode(mint as Address),
      ],
    })
  }, [])

  const findUserPositionAddress = useCallback(async (pairAddress: string, owner: string) => {
    return getProgramDerivedAddress({
      programAddress: OMNIPAIR_PROGRAM_ID as Address,
      seeds: [
        getBytesEncoder().encode(POSITION_SEED_PREFIX),
        getAddressEncoder().encode(pairAddress as Address),
        getAddressEncoder().encode(owner as Address),
      ],
    })
  }, [])

  const getOwnedTokenAccount = useCallback(
    async (owner: string, mint: string) => {
      const result = await rpcRequest<RpcTokenAccountsResult>('getTokenAccountsByOwner', [
        owner,
        { mint },
        { commitment: 'confirmed', encoding: 'base64' },
      ])
      return result.value[0]?.pubkey ?? null
    },
    [rpcRequest],
  )

  const loadBorrowTokenBalances = useCallback(async () => {
    if (!account || !isConnected || !selectedBorrowPool) {
      setBorrowTokenBalances({})
      return
    }

    try {
      const [tokenkegAccounts, token2022Accounts] = await Promise.all([
        rpcRequest<RpcParsedTokenAccountsResult>('getTokenAccountsByOwner', [
          account,
          { programId: TOKEN_PROGRAM_ID },
          { commitment: 'confirmed', encoding: 'jsonParsed' },
        ]),
        rpcRequest<RpcParsedTokenAccountsResult>('getTokenAccountsByOwner', [
          account,
          { programId: TOKEN_2022_PROGRAM_ID },
          { commitment: 'confirmed', encoding: 'jsonParsed' },
        ]).catch(() => ({ value: [] })),
      ])

      const nextBalances: Record<string, number> = {
        [selectedBorrowPool.token0Mint]: 0,
        [selectedBorrowPool.token1Mint]: 0,
      }

      const allAccounts = [...tokenkegAccounts.value, ...token2022Accounts.value]
      for (const tokenAccount of allAccounts) {
        const info = tokenAccount.account?.data?.parsed?.info
        const mint = info?.mint
        if (!mint || !(mint in nextBalances)) continue
        const amount = info.tokenAmount?.uiAmount ?? Number(info.tokenAmount?.uiAmountString ?? '0')
        if (!Number.isFinite(amount) || amount <= 0) continue
        nextBalances[mint] = (nextBalances[mint] ?? 0) + amount
      }

      setBorrowTokenBalances(nextBalances)
    } catch {
      setBorrowTokenBalances({})
    }
  }, [account, isConnected, rpcRequest, selectedBorrowPool])

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

  const loadPositionsData = useCallback(async () => {
    if (!account || !isConnected) {
      setLoanPositions([])
      setLpPositions([])
      setPositionsError(null)
      return
    }

    if (!pools.length) {
      setLoanPositions([])
      setLpPositions([])
      return
    }

    setPositionsLoading(true)
    setPositionsError(null)

    try {
      const decoder = getUserPositionDecoder()
      const [positionAddresses, tokenBalancesByMint] = await Promise.all([
        Promise.all(
          pools.map(async (pool) => {
            const [positionAddress] = await findUserPositionAddress(pool.address, account)
            return String(positionAddress)
          }),
        ),
        (async () => {
          const [tokenkegAccounts, token2022Accounts] = await Promise.all([
            rpcRequest<RpcParsedTokenAccountsResult>('getTokenAccountsByOwner', [
              account,
              { programId: TOKEN_PROGRAM_ID },
              { commitment: 'confirmed', encoding: 'jsonParsed' },
            ]),
            rpcRequest<RpcParsedTokenAccountsResult>('getTokenAccountsByOwner', [
              account,
              { programId: TOKEN_2022_PROGRAM_ID },
              { commitment: 'confirmed', encoding: 'jsonParsed' },
            ]).catch(() => ({ value: [] })),
          ])

          const balanceByMint = new Map<string, number>()
          const allAccounts = [...tokenkegAccounts.value, ...token2022Accounts.value]
          for (const tokenAccount of allAccounts) {
            const info = tokenAccount.account?.data?.parsed?.info
            const mint = info?.mint
            if (!mint) continue
            const amount = info.tokenAmount?.uiAmount ?? Number(info.tokenAmount?.uiAmountString ?? '0')
            if (!Number.isFinite(amount) || amount <= 0) continue
            balanceByMint.set(mint, (balanceByMint.get(mint) ?? 0) + amount)
          }
          return balanceByMint
        })(),
      ])

      const positionInfos = await rpcRequest<RpcMultipleAccountInfoResult>('getMultipleAccounts', [
        positionAddresses,
        { encoding: 'base64', commitment: 'confirmed' },
      ])

      const entries = pools.map((pool, index) => {
        let loanPosition: LoanPositionView | null = null
        const accountInfo = positionInfos.value[index]

        if (accountInfo?.data) {
          const encodedData = accountInfo.data
          const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData

          if (typeof base64Data === 'string') {
            try {
              const userPosition = decoder.decode(base64ToBytes(base64Data)) as UserPosition
              const collateral0 = toDisplayNumber(userPosition.collateral0, pool.token0Decimals)
              const collateral1 = toDisplayNumber(userPosition.collateral1, pool.token1Decimals)
              const debt0 = toDisplayNumber(
                applyDebtFromShares(userPosition.debt0Shares, pool.totalDebt0, pool.totalDebt0Shares),
                pool.token0Decimals,
              )
              const debt1 = toDisplayNumber(
                applyDebtFromShares(userPosition.debt1Shares, pool.totalDebt1, pool.totalDebt1Shares),
                pool.token1Decimals,
              )

              if (collateral0 > 0 || collateral1 > 0 || debt0 > 0 || debt1 > 0) {
                loanPosition = {
                  poolAddress: pool.address,
                  symbol: pool.symbol,
                  rateModel: pool.rateModel,
                  token0Mint: pool.token0Mint,
                  token1Mint: pool.token1Mint,
                  token0Ticker: pool.token0Ticker,
                  token1Ticker: pool.token1Ticker,
                  token0Decimals: pool.token0Decimals,
                  token1Decimals: pool.token1Decimals,
                  token0LogoUrl: pool.token0LogoUrl,
                  token1LogoUrl: pool.token1LogoUrl,
                  collateral0,
                  collateral1,
                  debt0,
                  debt1,
                  cf0: userPosition.collateral0LiquidationCfBps,
                  cf1: userPosition.collateral1LiquidationCfBps,
                }
              }
            } catch {
              loanPosition = null
            }
          }
        }

        const lpBalance = tokenBalancesByMint.get(pool.lpMint) ?? 0
        const lpPosition: LpPositionView | null =
          lpBalance > 0
            ? {
                poolAddress: pool.address,
                symbol: pool.symbol,
                lpBalance,
                lpBalanceLabel: formatCompact(lpBalance, 4),
              }
            : null

        return { loanPosition, lpPosition }
      })

      setLoanPositions(
        entries
          .map((entry) => entry.loanPosition)
          .filter((entry): entry is LoanPositionView => Boolean(entry)),
      )
      setLpPositions(
        entries
          .map((entry) => entry.lpPosition)
          .filter((entry): entry is LpPositionView => Boolean(entry)),
      )
    } catch (error) {
      setPositionsError(error instanceof Error ? error.message : 'Unable to load positions')
    } finally {
      setPositionsLoading(false)
    }
  }, [account, findUserPositionAddress, isConnected, pools, rpcRequest])

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

  useEffect(() => {
    if (activeTab !== 'Pools' && activeTab !== 'Trade' && activeTab !== 'Borrow' && activeTab !== 'Positions') {
      return
    }
    if (hasLoadedPools) return
    void loadPools()
  }, [activeTab, hasLoadedPools, loadPools])

  useEffect(() => {
    if (activeTab !== 'Debug') return
    if (hasLoadedDebug) return
    void loadDebugData()
  }, [activeTab, hasLoadedDebug, loadDebugData])

  useEffect(() => {
    if (activeTab !== 'Positions' && activeTab !== 'Borrow') return
    if (!isConnected || !account || !pools.length) {
      setLoanPositions([])
      setLpPositions([])
      return
    }
    void loadPositionsData()
  }, [account, activeTab, isConnected, loadPositionsData, pools.length])

  useEffect(() => {
    if (!tradeTokenOptions.length) return
    if (!tradeFromToken) {
      setTradeFromToken(tradeTokenOptions[0].mint)
    }
    if (!tradeToToken) {
      const fallback = tradeTokenOptions[1]?.mint ?? tradeTokenOptions[0].mint
      setTradeToToken(fallback)
    }
  }, [tradeFromToken, tradeToToken, tradeTokenOptions])

  useEffect(() => {
    if (!tradeFromToken || !tradeToToken) return
    if (tradeFromToken !== tradeToToken) return
    const alternative = tradeTokenOptions.find((token) => token.mint !== tradeFromToken)?.mint
    if (alternative) setTradeToToken(alternative)
  }, [tradeFromToken, tradeToToken, tradeTokenOptions])

  useEffect(() => {
    if (!pools.length) return
    if (!borrowPool) {
      setBorrowPool(pools[0].address)
    }
  }, [borrowPool, pools])

  useEffect(() => {
    if (!selectedBorrowPool) return
    if (lastBorrowPoolAddressRef.current === selectedBorrowPool.address) return
    lastBorrowPoolAddressRef.current = selectedBorrowPool.address

    setBorrowToken(selectedBorrowPool.token0Mint)
    setCollateralToken(selectedBorrowPool.token1Mint)
  }, [selectedBorrowPool])

  useEffect(() => {
    if (!borrowTokenOptions.length) return

    const hasMint = (mint: string) => borrowTokenOptions.some((option) => option.mint === mint)
    const firstMint = borrowTokenOptions[0].mint

    let nextBorrowToken = borrowToken
    let nextCollateralToken = collateralToken

    if (!nextBorrowToken || !hasMint(nextBorrowToken)) {
      nextBorrowToken = firstMint
    }
    if (!nextCollateralToken || !hasMint(nextCollateralToken)) {
      nextCollateralToken =
        borrowTokenOptions.find((option) => option.mint !== nextBorrowToken)?.mint ?? firstMint
    }

    if (nextBorrowToken === nextCollateralToken) {
      const alternateMint =
        borrowTokenOptions.find((option) => option.mint !== nextBorrowToken)?.mint ?? nextBorrowToken
      nextCollateralToken = alternateMint
    }

    if (nextBorrowToken !== borrowToken) {
      setBorrowToken(nextBorrowToken)
    }
    if (nextCollateralToken !== collateralToken) {
      setCollateralToken(nextCollateralToken)
    }
  }, [borrowToken, borrowTokenOptions, collateralToken])

  useEffect(() => {
    if (activeTab !== 'Borrow') return
    void loadBorrowTokenBalances()
  }, [activeTab, loadBorrowTokenBalances])

  useEffect(() => {
    if (!selectedTradePool) return
    if (!tradeFromAmount || Number.isNaN(Number(tradeFromAmount))) return

    const isDirect = selectedTradePool.token0Mint === tradeFromToken
    const numericFrom = Number(tradeFromAmount)
    if (!Number.isFinite(numericFrom) || numericFrom <= 0) return

    const [priceAmount] = selectedTradePool.priceLabel.split(' ')
    const parsedPrice = Number(priceAmount)
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return

    const nextOut = isDirect ? numericFrom * parsedPrice : numericFrom / parsedPrice
    if (!Number.isFinite(nextOut)) return
    setTradeToAmount(nextOut.toFixed(nextOut >= 1 ? 4 : 6))
  }, [selectedTradePool, tradeFromAmount, tradeFromToken])

  const switchTradeDirection = useCallback(() => {
    setTradeFromToken((currentFrom) => {
      const currentTo = tradeToToken
      setTradeToToken(currentFrom)
      return currentTo
    })

    setTradeFromAmount((currentFromAmount) => {
      const currentToAmount = tradeToAmount
      setTradeToAmount(currentFromAmount)
      return currentToAmount
    })
  }, [tradeToAmount, tradeToToken])

  const setBorrowTokenWithPairing = useCallback(
    (nextBorrowToken: string) => {
      setBorrowToken(nextBorrowToken)
      if (nextBorrowToken === collateralToken) {
        const alternateToken = borrowTokenOptions.find((token) => token.mint !== nextBorrowToken)?.mint
        if (alternateToken) {
          setCollateralToken(alternateToken)
        }
      }
    },
    [borrowTokenOptions, collateralToken],
  )

  const setCollateralTokenWithPairing = useCallback(
    (nextCollateralToken: string) => {
      setCollateralToken(nextCollateralToken)
      if (nextCollateralToken === borrowToken) {
        const alternateToken = collateralTokenOptions.find((token) => token.mint !== nextCollateralToken)?.mint
        if (alternateToken) {
          setBorrowToken(alternateToken)
        }
      }
    },
    [borrowToken, collateralTokenOptions],
  )

  const switchBorrowDirection = useCallback(() => {
    if (!borrowTokenOptions.length) return
    const nextBorrowToken =
      collateralToken ||
      borrowTokenOptions.find((token) => token.mint !== borrowToken)?.mint ||
      borrowToken
    const nextCollateralToken = borrowToken
    if (!nextBorrowToken || !nextCollateralToken || nextBorrowToken === nextCollateralToken) return

    setBorrowToken(nextBorrowToken)
    setCollateralToken(nextCollateralToken)
  }, [borrowToken, borrowTokenOptions, collateralToken])

  const executeTrade = useCallback(async () => {
    setTradeError(null)
    setTradeStatus(null)

    if (!account || !isConnected || !signer) {
      setTradeError('Connect wallet to place a swap.')
      return
    }

    if (tradeFromToken === tradeToToken) {
      setTradeError('Select two different tokens.')
      return
    }

    if (!selectedTradePool) {
      setTradeError('No matching Omnipair pool for selected tokens.')
      return
    }

    const isDirect = selectedTradePool.token0Mint === tradeFromToken
    const tokenInMint = isDirect ? selectedTradePool.token0Mint : selectedTradePool.token1Mint
    const tokenOutMint = isDirect ? selectedTradePool.token1Mint : selectedTradePool.token0Mint
    const tokenInDecimals = isDirect ? selectedTradePool.token0Decimals : selectedTradePool.token1Decimals

    const amountIn = toBaseUnits(tradeFromAmount, tokenInDecimals)
    if (!amountIn || amountIn <= 0n) {
      setTradeError('Enter a valid amount.')
      return
    }

    setTradeSubmitting(true)

    try {
      const userTokenInAccount = await getOwnedTokenAccount(account, tokenInMint)
      if (!userTokenInAccount) {
        setTradeError(`No token account found for ${tradeFromTokenInfo.ticker}.`)
        return
      }

      const existingOutAccount = await getOwnedTokenAccount(account, tokenOutMint)
      const userTokenOutAccount = existingOutAccount ?? (await findAssociatedTokenAddress(account, tokenOutMint))

      const swapInstruction = await getSwapInstructionAsync({
        pair: selectedTradePool.address as Address,
        rateModel: selectedTradePool.rateModel as Address,
        userTokenInAccount: userTokenInAccount as Address,
        userTokenOutAccount: userTokenOutAccount as Address,
        tokenInMint: tokenInMint as Address,
        tokenOutMint: tokenOutMint as Address,
        user: signer as any,
        program: OMNIPAIR_PROGRAM_ID as Address,
        amountIn,
        minAmountOut: 0n,
      })

      const simulation = await simulate([swapInstruction as any])
      if (simulation?.value?.err) {
        setTradeError(`Simulation failed: ${formatSimulationError(simulation.value.err)}`)
        return
      }

      const signature = await send([swapInstruction as any])
      setTradeStatus(`Swap submitted: ${shortAddress(signature)}`)
    } catch (error) {
      setTradeError(formatActionError(error, 'Swap failed'))
    } finally {
      setTradeSubmitting(false)
    }
  }, [
    account,
    findAssociatedTokenAddress,
    getOwnedTokenAccount,
    isConnected,
    selectedTradePool,
    send,
    signer,
    simulate,
    tradeFromAmount,
    tradeFromToken,
    tradeFromTokenInfo,
    tradeToToken,
  ])

  const executeBorrow = useCallback(async () => {
    setBorrowError(null)
    setBorrowStatus(null)

    if (!account || !isConnected || !signer) {
      setBorrowError('Connect wallet to borrow.')
      return
    }

    if (!selectedBorrowPool) {
      setBorrowError('Select a pool to borrow from.')
      return
    }

    if (!borrowToken) {
      setBorrowError('Select a token to borrow.')
      return
    }

    if (borrowToken === collateralToken) {
      setBorrowError('Borrow token and collateral token must be different in this pool.')
      return
    }

    if (!collateralToken) {
      setBorrowError('Select a collateral token.')
      return
    }

    const isToken0 = selectedBorrowPool.token0Mint === borrowToken
    const borrowDecimals = isToken0 ? selectedBorrowPool.token0Decimals : selectedBorrowPool.token1Decimals
    const amount = toBaseUnits(borrowAmount, borrowDecimals)

    if (!amount || amount <= 0n) {
      setBorrowError('Enter a valid borrow amount.')
      return
    }

    const collateralIsToken0 = selectedBorrowPool.token0Mint === collateralToken
    const collateralDecimals = collateralIsToken0
      ? selectedBorrowPool.token0Decimals
      : selectedBorrowPool.token1Decimals
    const normalizedCollateralInput = collateralAmount.trim()
    const collateralBaseAmount = normalizedCollateralInput
      ? toBaseUnits(normalizedCollateralInput, collateralDecimals)
      : 0n
    if (normalizedCollateralInput && collateralBaseAmount === null) {
      setBorrowError('Enter a valid collateral amount.')
      return
    }
    const shouldAddCollateral = typeof collateralBaseAmount === 'bigint' && collateralBaseAmount > 0n

    setBorrowSubmitting(true)

    try {
      const userReserveTokenAccount = await getOwnedTokenAccount(account, borrowToken)
      if (!userReserveTokenAccount) {
        setBorrowError(`No token account found for ${borrowTokenInfo.ticker}.`)
        return
      }

      const transactionInstructions: Array<any> = []
      if (shouldAddCollateral) {
        const userCollateralTokenAccount = await getOwnedTokenAccount(account, collateralToken)
        if (!userCollateralTokenAccount) {
          setBorrowError(`No token account found for ${collateralTokenInfo.ticker}.`)
          return
        }

        const addCollateralInstruction = await getAddCollateralInstructionAsync({
          pair: selectedBorrowPool.address as Address,
          rateModel: selectedBorrowPool.rateModel as Address,
          userCollateralTokenAccount: userCollateralTokenAccount as Address,
          collateralTokenMint: collateralToken as Address,
          user: signer as any,
          program: OMNIPAIR_PROGRAM_ID as Address,
          args: { amount: collateralBaseAmount },
        })
        transactionInstructions.push(addCollateralInstruction as any)
      }

      const borrowInstruction = await getBorrowInstructionAsync({
        pair: selectedBorrowPool.address as Address,
        rateModel: selectedBorrowPool.rateModel as Address,
        userReserveTokenAccount: userReserveTokenAccount as Address,
        reserveTokenMint: borrowToken as Address,
        user: signer as any,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount },
      })
      transactionInstructions.push(borrowInstruction as any)

      const simulation = await simulate(transactionInstructions)
      if (simulation?.value?.err) {
        setBorrowError(`Simulation failed: ${formatSimulationError(simulation.value.err)}`)
        return
      }

      const signature = await send(transactionInstructions)
      setBorrowStatus(
        `${shouldAddCollateral ? 'Collateral + borrow' : 'Borrow'} submitted: ${shortAddress(signature)}`,
      )
      setCollateralAmount('')
      void loadPools()
      void loadPositionsData()
      void loadBorrowTokenBalances()
    } catch (error) {
      setBorrowError(formatActionError(error, 'Borrow failed'))
    } finally {
      setBorrowSubmitting(false)
    }
  }, [
    account,
    borrowAmount,
    borrowToken,
    borrowTokenInfo,
    collateralAmount,
    collateralToken,
    collateralTokenInfo,
    getOwnedTokenAccount,
    isConnected,
    loadBorrowTokenBalances,
    loadPools,
    loadPositionsData,
    selectedBorrowPool,
    send,
    signer,
    simulate,
  ])

  const executeRepayLoan = useCallback(
    async (poolAddress: string, reserveTokenMint: string, amountInput: string) => {
      if (!account || !isConnected || !signer) {
        throw new Error('Connect wallet to repay.')
      }

      const pool = pools.find((item) => item.address === poolAddress)
      if (!pool) {
        throw new Error('Pool not found for this position.')
      }

      const reserveIsToken0 = reserveTokenMint === pool.token0Mint
      const reserveIsToken1 = reserveTokenMint === pool.token1Mint
      if (!reserveIsToken0 && !reserveIsToken1) {
        throw new Error('Selected repay token does not belong to this pool.')
      }

      const reserveDecimals = reserveIsToken0 ? pool.token0Decimals : pool.token1Decimals
      const repayAmount = toBaseUnits(amountInput, reserveDecimals)
      if (!repayAmount || repayAmount <= 0n) {
        throw new Error('Enter a valid repay amount.')
      }

      const userReserveTokenAccount = await getOwnedTokenAccount(account, reserveTokenMint)
      if (!userReserveTokenAccount) {
        const tokenLabel = reserveIsToken0 ? pool.token0Ticker : pool.token1Ticker
        throw new Error(`No token account found for ${tokenLabel}.`)
      }

      const repayInstruction = await getRepayInstructionAsync({
        pair: pool.address as Address,
        rateModel: pool.rateModel as Address,
        userReserveTokenAccount: userReserveTokenAccount as Address,
        reserveTokenMint: reserveTokenMint as Address,
        user: signer as any,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount: repayAmount },
      })

      const simulation = await simulate([repayInstruction as any])
      if (simulation?.value?.err) {
        throw new Error(`Simulation failed: ${formatSimulationError(simulation.value.err)}`)
      }

      const signature = await send([repayInstruction as any])
      void loadPools()
      void loadPositionsData()
      void loadBorrowTokenBalances()
      return signature
    },
    [
      account,
      getOwnedTokenAccount,
      isConnected,
      loadBorrowTokenBalances,
      loadPools,
      loadPositionsData,
      pools,
      send,
      signer,
      simulate,
    ],
  )

  const mainContent = (
    <main className="content">
      <section className="market-shell">
        <div className="market-shell-card">
          <div className="market-header market-header-empty" />

          <div className="market-tabs-rail">
            <span className="tabs-rule" />
            <div className="market-tabs">
              <span
                className="tab-indicator"
                style={{
                  width: `${100 / APP_TABS.length}%`,
                  transform: `translateX(${activeTabIndex * 100}%)`,
                  borderTopLeftRadius: activeTabIndex === 0 ? '999px' : '0',
                  borderBottomLeftRadius: activeTabIndex === 0 ? '999px' : '0',
                  borderTopRightRadius: activeTabIndex === APP_TABS.length - 1 ? '999px' : '0',
                  borderBottomRightRadius: activeTabIndex === APP_TABS.length - 1 ? '999px' : '0',
                }}
                aria-hidden="true"
              />
              {APP_TABS.map((tab) => (
                <button
                  key={tab}
                  className={`tab-button ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <span className="tabs-rule" />
          </div>

          <div className="market-content-card">
            {activeTab === 'Pools' && (
              <PoolsTab pools={pools} poolsLoading={poolsLoading} poolsError={poolsError} />
            )}

            {activeTab === 'Trade' && (
              <TradeTab
                tradeTokenOptions={tradeTokenOptions}
                tradeFromAmount={tradeFromAmount}
                tradeToAmount={tradeToAmount}
                tradeFromToken={tradeFromToken}
                tradeToToken={tradeToToken}
                tradeError={tradeError}
                tradeStatus={tradeStatus}
                tradeSubmitting={tradeSubmitting}
                hasDirectPool={Boolean(selectedTradePool)}
                setTradeFromAmount={setTradeFromAmount}
                setTradeToAmount={setTradeToAmount}
                setTradeFromToken={setTradeFromToken}
                setTradeToToken={setTradeToToken}
                switchTradeDirection={switchTradeDirection}
                executeTrade={executeTrade}
              />
            )}

            {activeTab === 'Borrow' && (
              <BorrowTab
                isWalletConnected={Boolean(isConnected && account)}
                pools={pools}
                poolSelectOptions={poolSelectOptions}
                borrowPool={borrowPool}
                borrowAmount={borrowAmount}
                borrowToken={borrowToken}
                borrowTokenOptions={borrowTokenOptions}
                collateralAmount={collateralAmount}
                collateralToken={collateralToken}
                collateralTokenOptions={collateralTokenOptions}
                selectedBorrowPool={selectedBorrowPool}
                currentBorrowHealth={currentBorrowHealth}
                projectedBorrowHealth={projectedBorrowHealth}
                estimatedCf0Bps={estimatedCf0Bps}
                estimatedCf1Bps={estimatedCf1Bps}
                collateralBalanceLabel={collateralBalanceLabel}
                borrowError={borrowError}
                borrowStatus={borrowStatus}
                borrowSubmitting={borrowSubmitting}
                setBorrowPool={setBorrowPool}
                setBorrowAmount={setBorrowAmount}
                setBorrowToken={setBorrowTokenWithPairing}
                setCollateralAmount={setCollateralAmount}
                setCollateralToken={setCollateralTokenWithPairing}
                switchBorrowDirection={switchBorrowDirection}
                executeBorrow={executeBorrow}
              />
            )}

            {activeTab === 'Positions' && (
              <PositionsTab
                isConnected={isConnected}
                account={account ?? null}
                positionsLoading={positionsLoading}
                positionsError={positionsError}
                lpPositions={lpPositions}
                loanPositions={loanPositions}
                poolSymbolsByAddress={poolSymbolsByAddress}
                onRepayLoan={executeRepayLoan}
              />
            )}

            {activeTab === 'Debug' && (
              <DebugTab
                rpcUrl={rpcUrl}
                debugLoading={debugLoading}
                debugError={debugError}
                poolAccounts={poolAccounts}
                recentSignatures={recentSignatures}
                loadDebugData={() => {
                  void loadDebugData()
                }}
              />
            )}

            <div className="market-footer">
              {activeTab === 'Pools' ? (
                <button
                  className="link-button"
                  onClick={() => {
                    void loadPools()
                  }}
                  disabled={poolsLoading}
                >
                  {poolsLoading ? 'Refreshing Pools…' : 'Refresh Pools'}
                </button>
              ) : (
                <button className="link-button">View All Markets →</button>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  )

  return (
    <div className="page">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon" aria-hidden>
              ☁️
            </span>
            <span className="brand-name">omni_test</span>
          </div>
          <div className="header-actions">
            <div ref={walletDropdownRef} className={`wallet-dropdown ${walletOpen ? 'open' : ''}`}>
              <button className="wallet-pill" onClick={() => setWalletOpen((value) => !value)}>
                {walletLabel}
              </button>
              <div className="wallet-panel">
                <ConnectWallet />
              </div>
            </div>
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={mainContent} />
        <Route path="/pools/:address" element={<PoolDetail />} />
        <Route path="/pools/new" element={<NewPool />} />
      </Routes>
    </div>
  )
}

export default App
