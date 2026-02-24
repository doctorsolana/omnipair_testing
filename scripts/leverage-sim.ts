#!/usr/bin/env tsx

import fs from 'node:fs'
import path from 'node:path'
import bs58 from 'bs58'
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit'
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
} from '@solana/signers'
import {
  getAddCollateralInstructionAsync,
  getBorrowInstructionAsync,
  getOmnipairErrorInfo,
  getPairDecoder,
  getSwapInstructionAsync,
  getUserPositionDecoder,
  OMNIPAIR_PROGRAM_ID,
  POSITION_SEED_PREFIX,
  type Pair,
} from '../src/protocol/omnipair/index.ts'

const DEFAULT_POOL = 'Cp2nGCWWfqkUmPR3pPKoR376Fti8wuYRFrSWJZq1a9SA'
const DEFAULT_TARGET_LEVERAGE = 1.05
const DEFAULT_INITIAL_COLLATERAL = 5
const DEFAULT_MAX_LOOPS = 3
const DEFAULT_RISK_CAP = 0.85
const DEFAULT_COMPUTE_LIMIT = 1_400_000
const DEFAULT_MAX_CF_BPS = 8075

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

const SEED_COLLATERAL_BUFFER = 0.95
const LOOP_COLLATERAL_BUFFER = 0.95
const FIRST_LOOP_BORROW_SAFETY = 0.82
const FOLLOWUP_LOOP_BORROW_SAFETY = 0.92
const MIN_REMAINING_TARGET_RATIO = 0.01

type Args = {
  rpcUrl: string
  pool: string
  direction: 'long' | 'short'
  assetSide: 'token0' | 'token1'
  collateralSide: 'token0' | 'token1'
  initialCollateral: number
  targetLeverage: number
  maxLoops: number
  riskCap: number
  owner: string
  keypair: string
  send: boolean
}

type LeverageStep = {
  step: number
  borrowAmount: number
  borrowAmountBase: bigint
  collateralAmount: number
  collateralAmountBase: bigint
}

type PlannedLeverage = {
  seedUsesSwap: boolean
  seedSwapInAmount: number
  seedSwapOutAmount: number
  seedCollateralAmount: number
  seedCollateralAmountBase: bigint
  steps: LeverageStep[]
  achievedLeverage: number
  projectedUtilization: number | null
}

type RpcRequest = <T>(method: string, params?: unknown[]) => Promise<T>

function printUsage() {
  console.log(
    [
      'Omnipair leverage simulator (plan + on-chain simulation, optional send).',
      '',
      'Usage:',
      '  pnpm leverage:sim [options]',
      '',
      'Required:',
      '  --owner <address> or OMNIPAIR_TEST_KEYPAIR in .env',
      '',
      'Options:',
      `  --pool <address>           Pool address (default: ${DEFAULT_POOL})`,
      '  --direction <long|short>   Trade direction (default: long)',
      '  --asset <token0|token1>    Exposure asset side (default: token0)',
      '  --collateral <token0|token1> Start collateral side (default: opposite of asset)',
      `  --initial <amount>         Initial collateral amount (default: ${DEFAULT_INITIAL_COLLATERAL})`,
      `  --target <x>               Target leverage multiple (default: ${DEFAULT_TARGET_LEVERAGE})`,
      `  --loops <n>                Max loops (default: ${DEFAULT_MAX_LOOPS})`,
      `  --risk-cap <0-1>           Borrow utilization cap (default: ${DEFAULT_RISK_CAP})`,
      '  --rpc <url>                RPC URL (or VITE_SOLANA_RPC_URL in .env)',
      '  --owner <address>          Owner wallet address for simulation',
      '  --keypair <json|base58>    Private key material (optional; enables send)',
      '  --send                     Send tx after successful simulation',
      '  --help, -h                 Show help',
    ].join('\n'),
  )
}

function parseNumber(input: string, fallback: number) {
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    rpcUrl: '',
    pool: DEFAULT_POOL,
    direction: 'long',
    assetSide: 'token0',
    collateralSide: 'token1',
    initialCollateral: DEFAULT_INITIAL_COLLATERAL,
    targetLeverage: DEFAULT_TARGET_LEVERAGE,
    maxLoops: DEFAULT_MAX_LOOPS,
    riskCap: DEFAULT_RISK_CAP,
    owner: '',
    keypair: '',
    send: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--pool' && next) {
      out.pool = next
      i += 1
      continue
    }
    if (arg === '--direction' && next) {
      out.direction = next === 'short' ? 'short' : 'long'
      i += 1
      continue
    }
    if (arg === '--asset' && next) {
      out.assetSide = next === 'token1' ? 'token1' : 'token0'
      i += 1
      continue
    }
    if (arg === '--collateral' && next) {
      out.collateralSide = next === 'token0' ? 'token0' : 'token1'
      i += 1
      continue
    }
    if (arg === '--initial' && next) {
      out.initialCollateral = parseNumber(next, DEFAULT_INITIAL_COLLATERAL)
      i += 1
      continue
    }
    if (arg === '--target' && next) {
      out.targetLeverage = parseNumber(next, DEFAULT_TARGET_LEVERAGE)
      i += 1
      continue
    }
    if (arg === '--loops' && next) {
      out.maxLoops = Math.max(1, Math.floor(parseNumber(next, DEFAULT_MAX_LOOPS)))
      i += 1
      continue
    }
    if (arg === '--risk-cap' && next) {
      out.riskCap = Math.max(0, Math.min(1, parseNumber(next, DEFAULT_RISK_CAP)))
      i += 1
      continue
    }
    if (arg === '--rpc' && next) {
      out.rpcUrl = next
      i += 1
      continue
    }
    if (arg === '--owner' && next) {
      out.owner = next
      i += 1
      continue
    }
    if (arg === '--keypair' && next) {
      out.keypair = next
      i += 1
      continue
    }
    if (arg === '--send') {
      out.send = true
      continue
    }
  }

  if (out.collateralSide === out.assetSide) {
    out.collateralSide = out.assetSide === 'token0' ? 'token1' : 'token0'
  }

  return out
}

function readDotEnvValue(key: string) {
  try {
    const envPath = path.resolve(process.cwd(), '.env')
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const splitIndex = trimmed.indexOf('=')
      if (splitIndex <= 0) continue
      const name = trimmed.slice(0, splitIndex).trim()
      if (name !== key) continue
      return trimmed.slice(splitIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    }
  } catch {
    return ''
  }
  return ''
}

function resolveEnvOrArg(primary: string, envKeys: string[]) {
  const fromArg = primary.trim()
  if (fromArg) return fromArg
  for (const key of envKeys) {
    const fromEnv = (process.env[key] || readDotEnvValue(key) || '').trim()
    if (fromEnv) return fromEnv
  }
  return ''
}

function toBaseUnitsFloor(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return 0n
  const safeDecimals = Math.max(0, decimals)
  const precision = Math.min(9, safeDecimals)
  const whole = Math.floor(value)
  const fractional = Math.max(0, value - whole)
  const scaledFraction = Math.floor((fractional + Number.EPSILON) * 10 ** precision)
  const wholeBase = BigInt(whole) * 10n ** BigInt(safeDecimals)
  const fractionBase = BigInt(scaledFraction) * 10n ** BigInt(safeDecimals - precision)
  return wholeBase + fractionBase
}

function toDisplayUnits(amount: bigint, decimals: number) {
  return Number(amount) / 10 ** decimals
}

function unwrapOptionNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'object' && value && '__option' in value) {
    const optionValue = value as { __option: 'Some' | 'None'; value?: number }
    if (optionValue.__option === 'Some' && Number.isFinite(optionValue.value)) {
      return optionValue.value ?? null
    }
    return null
  }
  return null
}

function estimateMaxBorrowCfBps(liquidationCfBps: number | null, fixedCfBps: number | null) {
  if (liquidationCfBps && liquidationCfBps > 0) {
    return Math.floor(liquidationCfBps * 0.95)
  }
  if (fixedCfBps && fixedCfBps > 0) {
    return Math.floor(fixedCfBps)
  }
  return DEFAULT_MAX_CF_BPS
}

function estimateSwapOut(params: {
  amountIn: number
  reserveIn: number
  reserveOut: number
  feeBps: number
}) {
  const { amountIn, reserveIn, reserveOut, feeBps } = params
  if (!Number.isFinite(amountIn) || amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) {
    return {
      amountOut: 0,
      nextReserveIn: reserveIn + Math.max(0, amountIn),
      nextReserveOut: reserveOut,
    }
  }

  const feeFactor = Math.max(0, 1 - feeBps / 10_000)
  const effectiveIn = amountIn * feeFactor
  const amountOut = (reserveOut * effectiveIn) / (reserveIn + effectiveIn)
  const sanitizedOut = Math.max(0, Math.min(reserveOut * 0.999999, amountOut))
  return {
    amountOut: sanitizedOut,
    nextReserveIn: reserveIn + amountIn,
    nextReserveOut: Math.max(0, reserveOut - sanitizedOut),
  }
}

function toToken0Equivalent(amount0: number, amount1: number, priceToken1PerToken0: number) {
  if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) {
    return Math.max(0, amount0)
  }
  return Math.max(0, amount0) + Math.max(0, amount1) / priceToken1PerToken0
}

function computeBorrowHealth(params: {
  priceToken1PerToken0: number
  collateral0: number
  collateral1: number
  debt0: number
  debt1: number
  cf0Bps: number
  cf1Bps: number
}) {
  const collateralValueToken0 = toToken0Equivalent(
    params.collateral0,
    params.collateral1,
    params.priceToken1PerToken0,
  )
  const debtValueToken0 = toToken0Equivalent(
    params.debt0,
    params.debt1,
    params.priceToken1PerToken0,
  )
  const weightedCollateralValueToken0 = toToken0Equivalent(
    params.collateral0 * params.cf0Bps / 10_000,
    params.collateral1 * params.cf1Bps / 10_000,
    params.priceToken1PerToken0,
  )
  const maxBorrowValueToken0 = weightedCollateralValueToken0
  const availableBorrowValueToken0 = Math.max(0, maxBorrowValueToken0 - debtValueToken0)
  const borrowUtilization =
    weightedCollateralValueToken0 > 0 ? debtValueToken0 / weightedCollateralValueToken0 : null

  return {
    collateralValueToken0,
    debtValueToken0,
    maxBorrowValueToken0,
    availableBorrowValueToken0,
    borrowUtilization,
  }
}

function createRpcRequest(rpcUrl: string): RpcRequest {
  return async <T,>(method: string, params: unknown[] = []) => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
    })

    if (!response.ok) {
      throw new Error(`RPC ${method} failed with HTTP ${response.status}`)
    }
    const json = await response.json() as { result?: T; error?: { message?: string } }
    if (json.error) {
      throw new Error(json.error.message || `RPC ${method} failed`)
    }
    if (json.result === undefined) {
      throw new Error(`RPC ${method} returned no result`)
    }
    return json.result
  }
}

async function getOwnedTokenAccount(
  rpcRequest: RpcRequest,
  owner: string,
  mint: string,
) {
  const result = await rpcRequest<{ value: Array<{ pubkey: string }> }>('getTokenAccountsByOwner', [
    owner,
    { mint },
    { commitment: 'confirmed', encoding: 'base64' },
  ])
  return result.value[0]?.pubkey ?? null
}

async function findAssociatedTokenAddress(owner: string, mint: string) {
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

function parsePrivateKeyBytes(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as number[]
    return new Uint8Array(parsed)
  }
  return bs58.decode(trimmed)
}

async function buildSigner(params: { keypairRaw: string; ownerRaw: string }) {
  const keypairRaw = params.keypairRaw.trim()
  if (keypairRaw) {
    const secretBytes = parsePrivateKeyBytes(keypairRaw)
    if (!secretBytes) throw new Error('Unable to parse keypair bytes')
    if (secretBytes.length === 64) {
      return await createKeyPairSignerFromBytes(secretBytes)
    }
    if (secretBytes.length === 32) {
      return await createKeyPairSignerFromPrivateKeyBytes(secretBytes)
    }
    throw new Error(`Unsupported keypair length: ${secretBytes.length} bytes`)
  }

  const ownerRaw = params.ownerRaw.trim()
  if (!ownerRaw) {
    throw new Error('Missing signer context. Provide --owner or OMNIPAIR_TEST_KEYPAIR.')
  }
  return createNoopSigner(ownerRaw as Address)
}

function createSetComputeUnitLimitInstruction(units: number): Instruction<Address> {
  const data = new Uint8Array(5)
  data[0] = 2
  data[1] = units & 0xff
  data[2] = (units >> 8) & 0xff
  data[3] = (units >> 16) & 0xff
  data[4] = (units >> 24) & 0xff

  return {
    programAddress: 'ComputeBudget111111111111111111111111111111' as Address,
    accounts: [],
    data,
  }
}

function extractSimulationCode(err: unknown) {
  if (!err || typeof err !== 'object') return null
  const asRecord = err as Record<string, unknown>
  const instructionError = asRecord.InstructionError ?? asRecord.instructionError
  if (!Array.isArray(instructionError) || instructionError.length < 2) return null
  const details = instructionError[1]
  if (!details || typeof details !== 'object') return null
  const detailRecord = details as Record<string, unknown>
  const code = detailRecord.Custom ?? detailRecord.custom
  if (typeof code === 'number' && Number.isFinite(code)) return code
  if (typeof code === 'bigint') {
    const asNumber = Number(code)
    return Number.isFinite(asNumber) ? asNumber : null
  }
  if (typeof code === 'string') {
    const parsed = Number(code)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatSimulationError(err: unknown) {
  const code = extractSimulationCode(err)
  if (code !== null) {
    const info = getOmnipairErrorInfo(code)
    if (info) return `${info.name} (#${info.code}): ${info.msg}`
    return `Custom program error #${code}`
  }
  try {
    return JSON.stringify(err, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
  } catch {
    return String(err)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const rpcUrl = resolveEnvOrArg(args.rpcUrl, ['VITE_SOLANA_RPC_URL'])
  if (!rpcUrl) {
    throw new Error('Missing RPC URL. Pass --rpc or set VITE_SOLANA_RPC_URL in .env')
  }

  const keypairRaw = resolveEnvOrArg(args.keypair, ['OMNIPAIR_TEST_KEYPAIR', 'SOLANA_KEYPAIR'])
  const ownerRaw = resolveEnvOrArg(args.owner, ['OMNIPAIR_TEST_OWNER'])
  const signer = await buildSigner({ keypairRaw, ownerRaw })
  const ownerAddress = String(signer.address)

  const rpc = createSolanaRpc(rpcUrl)
  const rpcRequest = createRpcRequest(rpcUrl)

  const accountInfo = await rpcRequest<{
    value: {
      data: [string, string] | string
    } | null
  }>('getAccountInfo', [
    args.pool,
    { encoding: 'base64', commitment: 'confirmed' },
  ])

  if (!accountInfo.value?.data) {
    throw new Error(`Pool account not found: ${args.pool}`)
  }

  const encodedData = accountInfo.value.data
  const base64Data = Array.isArray(encodedData) ? encodedData[0] : encodedData
  const pair = getPairDecoder().decode(Uint8Array.from(Buffer.from(base64Data, 'base64'))) as Pair

  const token0Mint = String(pair.token0)
  const token1Mint = String(pair.token1)
  const token0Decimals = pair.token0Decimals
  const token1Decimals = pair.token1Decimals
  const swapFeeBps = pair.swapFeeBps

  const assetMint = args.assetSide === 'token0' ? token0Mint : token1Mint
  const startCollateralMint = args.collateralSide === 'token0' ? token0Mint : token1Mint
  const assetIsToken0 = assetMint === token0Mint

  const borrowMint =
    args.direction === 'long'
      ? assetIsToken0
        ? token1Mint
        : token0Mint
      : assetMint
  const loopCollateralMint =
    args.direction === 'long'
      ? assetMint
      : assetIsToken0
        ? token1Mint
        : token0Mint

  const startCollateralIsToken0 = startCollateralMint === token0Mint
  const borrowIsToken0 = borrowMint === token0Mint
  const loopCollateralIsToken0 = loopCollateralMint === token0Mint

  const startCollateralDecimals = startCollateralIsToken0 ? token0Decimals : token1Decimals
  const borrowDecimals = borrowIsToken0 ? token0Decimals : token1Decimals
  const loopCollateralDecimals = loopCollateralIsToken0 ? token0Decimals : token1Decimals

  const reserve0Start = toDisplayUnits(pair.cashReserve0, token0Decimals)
  const reserve1Start = toDisplayUnits(pair.cashReserve1, token1Decimals)
  const priceStart = reserve0Start > 0 && reserve1Start > 0 ? reserve1Start / reserve0Start : 0

  const [userPositionPda] = await getProgramDerivedAddress({
    programAddress: OMNIPAIR_PROGRAM_ID as Address,
    seeds: [
      getBytesEncoder().encode(POSITION_SEED_PREFIX),
      getAddressEncoder().encode(args.pool as Address),
      getAddressEncoder().encode(ownerAddress as Address),
    ],
  })

  const userPositionInfo = await rpcRequest<{
    value: {
      data: [string, string] | string
    } | null
  }>('getAccountInfo', [
    String(userPositionPda),
    { encoding: 'base64', commitment: 'confirmed' },
  ])

  let currentCollateral0 = 0
  let currentCollateral1 = 0
  let currentDebt0 = 0
  let currentDebt1 = 0
  let liquidationCf0Bps: number | null = null
  let liquidationCf1Bps: number | null = null

  if (userPositionInfo.value?.data) {
    const encoded = userPositionInfo.value.data
    const positionBase64 = Array.isArray(encoded) ? encoded[0] : encoded
    const decoded = getUserPositionDecoder().decode(
      Uint8Array.from(Buffer.from(positionBase64, 'base64')),
    )

    const debt0Raw =
      pair.totalDebt0Shares > 0n ? (decoded.debt0Shares * pair.totalDebt0) / pair.totalDebt0Shares : 0n
    const debt1Raw =
      pair.totalDebt1Shares > 0n ? (decoded.debt1Shares * pair.totalDebt1) / pair.totalDebt1Shares : 0n

    currentCollateral0 = toDisplayUnits(decoded.collateral0, token0Decimals)
    currentCollateral1 = toDisplayUnits(decoded.collateral1, token1Decimals)
    currentDebt0 = toDisplayUnits(debt0Raw, token0Decimals)
    currentDebt1 = toDisplayUnits(debt1Raw, token1Decimals)
    liquidationCf0Bps = decoded.collateral0LiquidationCfBps
    liquidationCf1Bps = decoded.collateral1LiquidationCfBps
  }

  const fixedCfBps = unwrapOptionNumber(pair.fixedCfBps)
  const cf0Bps = estimateMaxBorrowCfBps(liquidationCf0Bps, fixedCfBps)
  const cf1Bps = estimateMaxBorrowCfBps(liquidationCf1Bps, fixedCfBps)

  let collateral0 = currentCollateral0
  let collateral1 = currentCollateral1
  let debt0 = currentDebt0
  let debt1 = currentDebt1
  let reserve0 = reserve0Start
  let reserve1 = reserve1Start
  let price = priceStart

  const currentHealth = computeBorrowHealth({
    priceToken1PerToken0: price,
    collateral0,
    collateral1,
    debt0,
    debt1,
    cf0Bps,
    cf1Bps,
  })

  let seedUsesSwap = false
  let seedSwapInAmount = 0
  let seedSwapOutAmount = 0
  let seedCollateralAmount = 0
  let seedCollateralAmountBase = 0n

  if (args.initialCollateral > 0) {
    if (startCollateralMint !== loopCollateralMint) {
      seedUsesSwap = true
      seedSwapInAmount = args.initialCollateral
      const seedSwapEstimate = startCollateralIsToken0
        ? estimateSwapOut({
            amountIn: args.initialCollateral,
            reserveIn: reserve0,
            reserveOut: reserve1,
            feeBps: swapFeeBps,
          })
        : estimateSwapOut({
            amountIn: args.initialCollateral,
            reserveIn: reserve1,
            reserveOut: reserve0,
            feeBps: swapFeeBps,
          })

      seedSwapOutAmount = seedSwapEstimate.amountOut
      seedCollateralAmount = seedSwapOutAmount * SEED_COLLATERAL_BUFFER
      seedCollateralAmountBase = toBaseUnitsFloor(seedCollateralAmount, loopCollateralDecimals)

      if (loopCollateralIsToken0) {
        collateral0 += seedCollateralAmount
      } else {
        collateral1 += seedCollateralAmount
      }

      if (startCollateralIsToken0) {
        reserve0 = seedSwapEstimate.nextReserveIn
        reserve1 = seedSwapEstimate.nextReserveOut
      } else {
        reserve1 = seedSwapEstimate.nextReserveIn
        reserve0 = seedSwapEstimate.nextReserveOut
      }
      price = reserve0 > 0 && reserve1 > 0 ? reserve1 / reserve0 : price
    } else if (startCollateralIsToken0) {
      collateral0 += args.initialCollateral
    } else {
      collateral1 += args.initialCollateral
    }
  }

  const startHealth = computeBorrowHealth({
    priceToken1PerToken0: price,
    collateral0,
    collateral1,
    debt0,
    debt1,
    cf0Bps,
    cf1Bps,
  })

  const inputCollateralValueToken0 = Math.max(
    0,
    startHealth.collateralValueToken0 - currentHealth.collateralValueToken0,
  )
  const targetIncrementalCollateralToken0 =
    inputCollateralValueToken0 * Math.max(0, args.targetLeverage - 1)

  const steps: LeverageStep[] = []

  for (let index = 0; index < args.maxLoops; index += 1) {
    const loopHealth = computeBorrowHealth({
      priceToken1PerToken0: price,
      collateral0,
      collateral1,
      debt0,
      debt1,
      cf0Bps,
      cf1Bps,
    })

    const incrementalCollateralToken0 = Math.max(
      0,
      loopHealth.collateralValueToken0 - startHealth.collateralValueToken0,
    )
    const remainingTargetIncrementalToken0 = Math.max(
      0,
      targetIncrementalCollateralToken0 - incrementalCollateralToken0,
    )

    if (remainingTargetIncrementalToken0 <= inputCollateralValueToken0 * MIN_REMAINING_TARGET_RATIO) {
      break
    }

    const hardBorrowHeadroom = loopHealth.availableBorrowValueToken0
    const borrowHeadroomToSafetyCap =
      loopHealth.maxBorrowValueToken0 * args.riskCap - loopHealth.debtValueToken0

    const borrowValueCapByRisk = Math.max(
      0,
      Math.min(hardBorrowHeadroom, borrowHeadroomToSafetyCap) * 0.97,
    )
    const borrowValueCapByTarget = remainingTargetIncrementalToken0 / LOOP_COLLATERAL_BUFFER
    const borrowSafety = index === 0 ? FIRST_LOOP_BORROW_SAFETY : FOLLOWUP_LOOP_BORROW_SAFETY
    const borrowValueToken0 = Math.min(borrowValueCapByRisk, borrowValueCapByTarget) * borrowSafety
    if (!Number.isFinite(borrowValueToken0) || borrowValueToken0 <= 0) break

    const borrowAmount = borrowIsToken0 ? borrowValueToken0 : borrowValueToken0 * price
    if (!Number.isFinite(borrowAmount) || borrowAmount <= 0) break

    const swapEstimate = borrowIsToken0
      ? estimateSwapOut({
          amountIn: borrowAmount,
          reserveIn: reserve0,
          reserveOut: reserve1,
          feeBps: swapFeeBps,
        })
      : estimateSwapOut({
          amountIn: borrowAmount,
          reserveIn: reserve1,
          reserveOut: reserve0,
          feeBps: swapFeeBps,
        })

    const collateralAmount = swapEstimate.amountOut * LOOP_COLLATERAL_BUFFER
    const borrowAmountBase = toBaseUnitsFloor(borrowAmount, borrowDecimals)
    const collateralAmountBase = toBaseUnitsFloor(collateralAmount, loopCollateralDecimals)
    if (borrowAmountBase <= 0n || collateralAmountBase <= 0n) break

    if (borrowIsToken0) {
      debt0 += borrowAmount
      if (loopCollateralIsToken0) collateral0 += collateralAmount
      else collateral1 += collateralAmount
      reserve0 = swapEstimate.nextReserveIn
      reserve1 = swapEstimate.nextReserveOut
    } else {
      debt1 += borrowAmount
      if (loopCollateralIsToken0) collateral0 += collateralAmount
      else collateral1 += collateralAmount
      reserve1 = swapEstimate.nextReserveIn
      reserve0 = swapEstimate.nextReserveOut
    }
    price = reserve0 > 0 && reserve1 > 0 ? reserve1 / reserve0 : price

    steps.push({
      step: index + 1,
      borrowAmount,
      borrowAmountBase,
      collateralAmount,
      collateralAmountBase,
    })
  }

  const projectedHealth = computeBorrowHealth({
    priceToken1PerToken0: price,
    collateral0,
    collateral1,
    debt0,
    debt1,
    cf0Bps,
    cf1Bps,
  })
  const achievedLeverage =
    inputCollateralValueToken0 > 0
      ? 1 + Math.max(0, projectedHealth.collateralValueToken0 - startHealth.collateralValueToken0) / inputCollateralValueToken0
      : 1

  const preview: PlannedLeverage = {
    seedUsesSwap,
    seedSwapInAmount,
    seedSwapOutAmount,
    seedCollateralAmount,
    seedCollateralAmountBase,
    steps,
    achievedLeverage,
    projectedUtilization: projectedHealth.borrowUtilization,
  }

  const startCollateralAccount = await getOwnedTokenAccount(rpcRequest, ownerAddress, startCollateralMint)
  if (!startCollateralAccount) {
    throw new Error('Missing start collateral token account for owner.')
  }
  const borrowTokenAccount = await getOwnedTokenAccount(rpcRequest, ownerAddress, borrowMint)
  if (!borrowTokenAccount) {
    throw new Error('Missing borrow token account for owner.')
  }
  const loopCollateralAccountExisting = await getOwnedTokenAccount(rpcRequest, ownerAddress, loopCollateralMint)
  if (!loopCollateralAccountExisting && seedUsesSwap) {
    throw new Error('Missing loop-collateral token account. Create ATA first, then retry.')
  }
  const loopCollateralAccount = loopCollateralAccountExisting ??
    String(await findAssociatedTokenAddress(ownerAddress, loopCollateralMint))

  const initialCollateralBase = toBaseUnitsFloor(args.initialCollateral, startCollateralDecimals)
  if (initialCollateralBase <= 0n) {
    throw new Error('Initial collateral must be > 0')
  }
  if (!preview.steps.length) {
    console.log('\nPlanner note: no borrow loops needed/executable for this setup.')
  }

  const makePlanInstructions = async (scaleBps: number) => {
    const instructions: Instruction<Address>[] = []

    const scaledSeedCollateralBase =
      preview.seedUsesSwap
        ? (preview.seedCollateralAmountBase * BigInt(scaleBps)) / 10_000n
        : 0n

    if (preview.seedUsesSwap) {
      const seedSwapIx = await getSwapInstructionAsync({
        pair: args.pool as Address,
        rateModel: String(pair.rateModel) as Address,
        userTokenInAccount: startCollateralAccount as Address,
        userTokenOutAccount: loopCollateralAccount as Address,
        tokenInMint: startCollateralMint as Address,
        tokenOutMint: loopCollateralMint as Address,
        user: signer as TransactionSigner<string>,
        program: OMNIPAIR_PROGRAM_ID as Address,
        amountIn: initialCollateralBase,
        minAmountOut: 0n,
      })
      instructions.push(seedSwapIx)

      const seedAddCollateralIx = await getAddCollateralInstructionAsync({
        pair: args.pool as Address,
        rateModel: String(pair.rateModel) as Address,
        userCollateralTokenAccount: loopCollateralAccount as Address,
        collateralTokenMint: loopCollateralMint as Address,
        user: signer as TransactionSigner<string>,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount: scaledSeedCollateralBase },
      })
      instructions.push(seedAddCollateralIx)
    } else {
      const seedAddCollateralIx = await getAddCollateralInstructionAsync({
        pair: args.pool as Address,
        rateModel: String(pair.rateModel) as Address,
        userCollateralTokenAccount: startCollateralAccount as Address,
        collateralTokenMint: startCollateralMint as Address,
        user: signer as TransactionSigner<string>,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount: initialCollateralBase },
      })
      instructions.push(seedAddCollateralIx)
    }

    for (const step of preview.steps) {
      const scaledBorrowBase = (step.borrowAmountBase * BigInt(scaleBps)) / 10_000n
      const scaledCollateralBase = (step.collateralAmountBase * BigInt(scaleBps)) / 10_000n
      if (scaledBorrowBase <= 0n || scaledCollateralBase <= 0n) continue

      const borrowIx = await getBorrowInstructionAsync({
        pair: args.pool as Address,
        rateModel: String(pair.rateModel) as Address,
        userReserveTokenAccount: borrowTokenAccount as Address,
        reserveTokenMint: borrowMint as Address,
        user: signer as TransactionSigner<string>,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount: scaledBorrowBase },
      })
      instructions.push(borrowIx)

      const swapIx = await getSwapInstructionAsync({
        pair: args.pool as Address,
        rateModel: String(pair.rateModel) as Address,
        userTokenInAccount: borrowTokenAccount as Address,
        userTokenOutAccount: loopCollateralAccount as Address,
        tokenInMint: borrowMint as Address,
        tokenOutMint: loopCollateralMint as Address,
        user: signer as TransactionSigner<string>,
        program: OMNIPAIR_PROGRAM_ID as Address,
        amountIn: scaledBorrowBase,
        minAmountOut: 0n,
      })
      instructions.push(swapIx)

      const addCollateralIx = await getAddCollateralInstructionAsync({
        pair: args.pool as Address,
        rateModel: String(pair.rateModel) as Address,
        userCollateralTokenAccount: loopCollateralAccount as Address,
        collateralTokenMint: loopCollateralMint as Address,
        user: signer as TransactionSigner<string>,
        program: OMNIPAIR_PROGRAM_ID as Address,
        args: { amount: scaledCollateralBase },
      })
      instructions.push(addCollateralIx)
    }

    return instructions
  }

  const simulate = async (instructions: Instruction<Address>[]) => {
    const computeIx = createSetComputeUnitLimitInstruction(DEFAULT_COMPUTE_LIMIT)
    const allInstructions = [computeIx, ...instructions]
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayerSigner(signer as TransactionSigner<string>, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions(allInstructions, m),
    )
    const compiled = compileTransaction(message)
    const txBytes = getTransactionEncoder().encode(compiled)
    const base64 = Buffer.from(txBytes).toString('base64')

    const sim = await rpc
      .simulateTransaction(base64 as never, {
        encoding: 'base64',
        commitment: 'confirmed',
        sigVerify: false,
      })
      .send()

    return { sim, message, allInstructions }
  }

  console.log('\nLeverage sim config')
  console.log(`RPC: ${rpcUrl}`)
  console.log(`Owner: ${ownerAddress}`)
  console.log(`Pool: ${args.pool}`)
  console.log(`Direction: ${args.direction}`)
  console.log(`Asset side: ${args.assetSide}`)
  console.log(`Collateral side: ${args.collateralSide}`)
  console.log(`Initial collateral: ${args.initialCollateral}`)
  console.log(`Target leverage: ${args.targetLeverage.toFixed(2)}x`)
  console.log(`Planned loops: ${preview.steps.length}`)
  console.log(`Achieved leverage (est): ${preview.achievedLeverage.toFixed(4)}x`)
  console.log(
    `Projected util (est): ${
      preview.projectedUtilization === null ? '--' : `${(preview.projectedUtilization * 100).toFixed(2)}%`
    }`,
  )
  if (preview.seedUsesSwap) {
    console.log(
      `Seed: swap ${preview.seedSwapInAmount.toFixed(6)} -> ${preview.seedSwapOutAmount.toFixed(6)}, add ${preview.seedCollateralAmount.toFixed(6)}`,
    )
  }
  for (const step of preview.steps) {
    console.log(
      `Loop ${step.step}: borrow ${step.borrowAmount.toFixed(6)}, add collateral ${step.collateralAmount.toFixed(6)}`,
    )
  }

  let successScale = 0
  let successMessage: ReturnType<typeof simulate> extends Promise<infer U> ? U['message'] : never

  for (const scale of [10_000, 9_500, 9_000, 8_500, 8_000, 7_500]) {
    const instructions = await makePlanInstructions(scale)
    const result = await simulate(instructions)
    const err = result.sim.value.err
    const units = result.sim.value.unitsConsumed

    if (!err) {
      successScale = scale
      successMessage = result.message
      console.log(`\nSimulation pass at ${(scale / 100).toFixed(2)}% sizing (${units ?? 0} CU).`)
      break
    }

    const code = extractSimulationCode(err)
    const decoded = formatSimulationError(err)
    console.log(`\nSimulation fail at ${(scale / 100).toFixed(2)}% sizing.`)
    console.log(`Error: ${decoded}`)
    if (code !== 6010 && code !== 6023) {
      break
    }
  }

  if (!successScale) {
    console.log('\nNo executable sizing found within fallback range.')
    process.exitCode = 1
    return
  }

  if (!args.send) {
    console.log('\nDone. (simulate only)')
    return
  }

  if (!keypairRaw.trim()) {
    console.log('\nSkipping send: provide --keypair or OMNIPAIR_TEST_KEYPAIR to sign and send.')
    return
  }

  if (!successMessage) {
    throw new Error('Internal: missing successful message for send phase.')
  }

  const signed = await signTransactionMessageWithSigners(successMessage)
  const signedBytes = getTransactionEncoder().encode(signed)
  const signedBase64 = Buffer.from(signedBytes).toString('base64')

  const signature = await rpc
    .sendTransaction(signedBase64 as never, {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    .send()

  console.log(`\nSent: ${String(signature)}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\nFailed: ${message}`)
  process.exit(1)
})
