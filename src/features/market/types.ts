export type AppTab = 'Pools' | 'Trade' | 'Borrow' | 'Positions' | 'Debug'

export const APP_TABS: AppTab[] = ['Pools', 'Trade', 'Borrow', 'Positions', 'Debug']

export type ProgramAccountResult = {
  pubkey: string
}

export type SignatureResult = {
  signature: string
  slot: number
  err: unknown
  blockTime: number | null
}

export type TradeTokenOption = {
  mint: string
  ticker: string
  name: string
  logo: string
  color: string
  logoUrl?: string | null
}

export const DEFAULT_TRADE_TOKEN: TradeTokenOption = {
  mint: '',
  ticker: 'TOKN',
  name: 'Token',
  logo: 'T',
  color: 'linear-gradient(135deg, #9db8e4, #6f90c5)',
  logoUrl: null,
}

export type PoolSelectOption = {
  address: string
  symbol: string
  name: string
  token0Ticker: string
  token1Ticker: string
  token0LogoUrl: string | null
  token1LogoUrl: string | null
}

export type PoolView = {
  address: string
  lpMint: string
  token0Ticker: string
  token1Ticker: string
  token0Mint: string
  token1Mint: string
  token0LogoUrl: string | null
  token1LogoUrl: string | null
  token0Decimals: number
  token1Decimals: number
  rateModel: string
  fixedCfBps: number | null
  swapFeeBps: number
  price: number
  totalDebt0: bigint
  totalDebt1: bigint
  totalDebt0Shares: bigint
  totalDebt1Shares: bigint
  totalCollateral0: bigint
  totalCollateral1: bigint
  cashReserve0: bigint
  cashReserve1: bigint
  symbol: string
  name: string
  priceLabel: string
  priceSubLabel: string
  utilizationPct: number
  utilizationLabel: string
  feeLabel: string
  tvlUsd: number | null
  reserveLabel: string
  reserveTooltip: string
  statusLabel: 'Active' | 'Reduce-only'
  trend: 'up' | 'down'
}

export type LoanPositionView = {
  poolAddress: string
  symbol: string
  rateModel: string
  token0Mint: string
  token1Mint: string
  token0Ticker: string
  token1Ticker: string
  token0Decimals: number
  token1Decimals: number
  token0LogoUrl: string | null
  token1LogoUrl: string | null
  collateral0: number
  collateral1: number
  debt0: number
  debt1: number
  cf0: number | null
  cf1: number | null
}

export type LpPositionView = {
  poolAddress: string
  symbol: string
  lpBalance: number
  lpBalanceLabel: string
}

export type TokenInfo = {
  symbol: string
  name: string
}

export type BorrowHealthSnapshot = {
  collateralValueToken0: number
  debtValueToken0: number
  weightedCollateralValueToken0: number
  maxBorrowValueToken0: number
  availableBorrowValueToken0: number
  ltv: number | null
  borrowUtilization: number | null
  healthFactor: number | null
}
