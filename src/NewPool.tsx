import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AccountRole,
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit'
import { generateKeyPairSigner } from '@solana/signers'
import { useConnector } from '@solana/connector'
import { useRpc } from './solana/useRpc'
import { useSendSmartTransaction } from './solana/useSendSmartTransaction'
import {
  getInitializeInstructionAsync,
  getRateModelSize,
  OMNIPAIR_PROGRAM_ID,
} from './omnipair'

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
const WSOL_MINT = 'So11111111111111111111111111111111111111112'
const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111'
const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
const FUTARCHY_AUTHORITY_SEED = new Uint8Array([
  102, 117, 116, 97, 114, 99, 104, 121, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121,
])
const EVENT_AUTHORITY_SEED = new Uint8Array([
  95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121,
])
const METADATA_SEED = new Uint8Array([109, 101, 116, 97, 100, 97, 116, 97])
const RESERVE_VAULT_SEED = new Uint8Array([
  114, 101, 115, 101, 114, 118, 101, 95, 118, 97, 117, 108, 116,
])
const COLLATERAL_VAULT_SEED = new Uint8Array([
  99, 111, 108, 108, 97, 116, 101, 114, 97, 108, 95, 118, 97, 117, 108, 116,
])

function toBaseUnits(amount: string, decimals = 6): bigint | null {
  const normalized = amount.trim()
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) return null
  const [wholePart, fractionalPart = ''] = normalized.split('.')
  const whole = wholePart.length ? BigInt(wholePart) : 0n
  const fraction = fractionalPart.slice(0, decimals).padEnd(decimals, '0')
  const fractional = fraction.length ? BigInt(fraction) : 0n
  return whole * 10n ** BigInt(decimals) + fractional
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().replace(/^0x/, '')
  if (!clean.length) return null
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null
  if (clean.length % 2 !== 0) return null
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  if (bytes.length !== 32) return null
  return bytes
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function createAccountInstruction(
  payer: Address,
  newAccount: Address,
  lamports: bigint,
  space: bigint,
  programId: Address,
  newAccountSigner?: TransactionSigner,
): Instruction<Address> {
  const data = new Uint8Array(4 + 8 + 8 + 32)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0, true)
  view.setBigUint64(4, lamports, true)
  view.setBigUint64(12, space, true)
  data.set(getAddressEncoder().encode(programId), 20)

  return {
    programAddress: SYSTEM_PROGRAM_ID as Address,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      {
        address: newAccount,
        role: AccountRole.WRITABLE_SIGNER,
        ...(newAccountSigner ? { signer: newAccountSigner } : {}),
      },
    ],
    data,
  }
}

function createAssociatedTokenAccountInstruction(
  payer: Address,
  ata: Address,
  owner: Address,
  mint: Address,
): Instruction<Address> {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID as Address, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID as Address, role: AccountRole.READONLY },
      { address: RENT_SYSVAR as Address, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(),
  }
}

function NewPool() {
  const { account, isConnected } = useConnector()
  const { rpc } = useRpc()
  const { simulate, send, signer } = useSendSmartTransaction()

  const [token0, setToken0] = useState('')
  const [token1, setToken1] = useState('')
  const [amount0, setAmount0] = useState('0')
  const [amount1, setAmount1] = useState('0')
  const [swapFeeBps, setSwapFeeBps] = useState('25')
  const [halfLife, setHalfLife] = useState('3600000')
  const [fixedCfBps, setFixedCfBps] = useState('5000')
  const [paramsHash, setParamsHash] = useState('')
  const [version, setVersion] = useState('0')
  const [lpName, setLpName] = useState('Omnipair LP')
  const [lpSymbol, setLpSymbol] = useState('OMNI-LP')
  const [lpUri, setLpUri] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [rateTargetStart, setRateTargetStart] = useState('7000')
  const [rateTargetEnd, setRateTargetEnd] = useState('9000')
  const [rateHalfLifeMs, setRateHalfLifeMs] = useState('3600000')
  const [minRateBps, setMinRateBps] = useState('100')
  const [maxRateBps, setMaxRateBps] = useState('0')
  const [initialRateBps, setInitialRateBps] = useState('500')

  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const derivedParamsHash = useMemo(() => {
    if (paramsHash.trim().length) return paramsHash.trim()
    const input = `${token0}|${token1}|${swapFeeBps}|${halfLife}|${fixedCfBps}|${rateTargetStart}|${rateTargetEnd}|${rateHalfLifeMs}|${minRateBps}|${maxRateBps}|${initialRateBps}`
    return input
  }, [
    fixedCfBps,
    halfLife,
    initialRateBps,
    maxRateBps,
    minRateBps,
    paramsHash,
    rateHalfLifeMs,
    rateTargetEnd,
    rateTargetStart,
    swapFeeBps,
    token0,
    token1,
  ])

  const resolveParamsHash = useCallback(async () => {
    const manual = hexToBytes(paramsHash)
    if (manual) return manual

    const encoder = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(derivedParamsHash))
    return new Uint8Array(digest)
  }, [derivedParamsHash, paramsHash])

  const findAssociatedTokenAddress = useCallback(async (owner: string, mint: string) => {
    const [ata] = await getProgramDerivedAddress({
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
      seeds: [
        getAddressEncoder().encode(owner as Address),
        getAddressEncoder().encode(TOKEN_PROGRAM_ID as Address),
        getAddressEncoder().encode(mint as Address),
      ],
    })
    return ata
  }, [])

  const getTokenAccount = useCallback(
    async (owner: string, mint: string) => {
      const result = await rpc
        .getTokenAccountsByOwner(owner as Address, { mint: mint as Address })
        .send()
      return result.value[0]?.pubkey ?? null
    },
    [rpc],
  )

  const resolvePairPda = useCallback(async (token0Mint: string, token1Mint: string, hash: Uint8Array) => {
    const [pair] = await getProgramDerivedAddress({
      programAddress: OMNIPAIR_PROGRAM_ID as Address,
      seeds: [
        getBytesEncoder().encode(new Uint8Array([103, 97, 109, 109, 95, 112, 97, 105, 114])),
        getAddressEncoder().encode(token0Mint as Address),
        getAddressEncoder().encode(token1Mint as Address),
        hash,
      ],
    })
    return pair
  }, [])

  const createPool = useCallback(async () => {
    setError(null)
    setStatus(null)

    if (!account || !isConnected || !signer) {
      setError('Connect your wallet to create a pool.')
      return
    }

    if (!token0 || !token1) {
      setError('Provide both token mints.')
      return
    }

    if (token0 === token1) {
      setError('Token mints must be different.')
      return
    }

    const amount0Base = toBaseUnits(amount0, 6)
    const amount1Base = toBaseUnits(amount1, 6)
    if (!amount0Base || !amount1Base) {
      setError('Enter valid bootstrap amounts.')
      return
    }

    const fee = Number(swapFeeBps)
    if (!Number.isFinite(fee)) {
      setError('Swap fee must be a number.')
      return
    }

    const halfLifeValue = BigInt(halfLife || '0')

    setSubmitting(true)

    try {
      const paramsHashBytes = await resolveParamsHash()
      const pairAddress = await resolvePairPda(token0, token1, paramsHashBytes)

      const rateModelSigner = await generateKeyPairSigner()
      const lpMintSigner = await generateKeyPairSigner()

      const rateModelSpace = BigInt(getRateModelSize())
      const lpMintSpace = BigInt(82)

  const rateModelLamports = BigInt(
    await rpc.getMinimumBalanceForRentExemption(rateModelSpace).send(),
  )
  const lpMintLamports = BigInt(
    await rpc.getMinimumBalanceForRentExemption(lpMintSpace).send(),
  )

      const deployerToken0 = await getTokenAccount(account, token0)
      const deployerToken1 = await getTokenAccount(account, token1)
      if (!deployerToken0 || !deployerToken1) {
        setError('Deployer token accounts for both mints are required.')
        return
      }

      const lpAta = await findAssociatedTokenAddress(account, lpMintSigner.address)
      const wsolAta = await findAssociatedTokenAddress(account, WSOL_MINT)

      const [futarchyAuthority] = await getProgramDerivedAddress({
        programAddress: OMNIPAIR_PROGRAM_ID as Address,
        seeds: [getBytesEncoder().encode(FUTARCHY_AUTHORITY_SEED)],
      })

      const [eventAuthority] = await getProgramDerivedAddress({
        programAddress: OMNIPAIR_PROGRAM_ID as Address,
        seeds: [getBytesEncoder().encode(EVENT_AUTHORITY_SEED)],
      })

      const [reserve0Vault] = await getProgramDerivedAddress({
        programAddress: OMNIPAIR_PROGRAM_ID as Address,
        seeds: [
          getBytesEncoder().encode(RESERVE_VAULT_SEED),
          getAddressEncoder().encode(pairAddress as Address),
          getAddressEncoder().encode(token0 as Address),
        ],
      })

      const [reserve1Vault] = await getProgramDerivedAddress({
        programAddress: OMNIPAIR_PROGRAM_ID as Address,
        seeds: [
          getBytesEncoder().encode(RESERVE_VAULT_SEED),
          getAddressEncoder().encode(pairAddress as Address),
          getAddressEncoder().encode(token1 as Address),
        ],
      })

      const [collateral0Vault] = await getProgramDerivedAddress({
        programAddress: OMNIPAIR_PROGRAM_ID as Address,
        seeds: [
          getBytesEncoder().encode(COLLATERAL_VAULT_SEED),
          getAddressEncoder().encode(pairAddress as Address),
          getAddressEncoder().encode(token0 as Address),
        ],
      })

      const [collateral1Vault] = await getProgramDerivedAddress({
        programAddress: OMNIPAIR_PROGRAM_ID as Address,
        seeds: [
          getBytesEncoder().encode(COLLATERAL_VAULT_SEED),
          getAddressEncoder().encode(pairAddress as Address),
          getAddressEncoder().encode(token1 as Address),
        ],
      })

      const [lpTokenMetadata] = await getProgramDerivedAddress({
        programAddress: TOKEN_METADATA_PROGRAM_ID as Address,
        seeds: [
          getBytesEncoder().encode(METADATA_SEED),
          getAddressEncoder().encode(TOKEN_METADATA_PROGRAM_ID as Address),
          getAddressEncoder().encode(lpMintSigner.address as Address),
        ],
      })

      const lpAtaInfo = await rpc
        .getAccountInfo(lpAta as Address, { commitment: 'confirmed' })
        .send()
      const wsolInfo = await rpc
        .getAccountInfo(wsolAta as Address, { commitment: 'confirmed' })
        .send()

      const instructions: Instruction<Address>[] = []

      instructions.push(
        createAccountInstruction(
          account as Address,
          rateModelSigner.address as Address,
          rateModelLamports,
          rateModelSpace,
          OMNIPAIR_PROGRAM_ID as Address,
          rateModelSigner,
        ),
      )

      instructions.push(
        createAccountInstruction(
          account as Address,
          lpMintSigner.address as Address,
          lpMintLamports,
          lpMintSpace,
          TOKEN_PROGRAM_ID as Address,
          lpMintSigner,
        ),
      )

      if (!lpAtaInfo.value) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            account as Address,
            lpAta as Address,
            account as Address,
            lpMintSigner.address as Address,
          ),
        )
      }

      if (!wsolInfo.value) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            account as Address,
            wsolAta as Address,
            account as Address,
            WSOL_MINT as Address,
          ),
        )
      }

      const initializeIx = await getInitializeInstructionAsync({
        deployer: signer,
        token0Mint: token0 as Address,
        token1Mint: token1 as Address,
        pair: pairAddress as Address,
        futarchyAuthority: futarchyAuthority as Address,
        rateModel: rateModelSigner,
        lpMint: lpMintSigner.address as Address,
        lpTokenMetadata: lpTokenMetadata as Address,
        deployerLpTokenAccount: lpAta as Address,
        reserve0Vault: reserve0Vault as Address,
        reserve1Vault: reserve1Vault as Address,
        collateral0Vault: collateral0Vault as Address,
        collateral1Vault: collateral1Vault as Address,
        deployerToken0Account: deployerToken0 as Address,
        deployerToken1Account: deployerToken1 as Address,
        authorityWsolAccount: wsolAta as Address,
        eventAuthority: eventAuthority as Address,
        program: OMNIPAIR_PROGRAM_ID as Address,
        swapFeeBps: fee,
        halfLife: halfLifeValue,
        fixedCfBps: fixedCfBps ? Number(fixedCfBps) : null,
        targetUtilStartBps: advanced ? BigInt(rateTargetStart) : null,
        targetUtilEndBps: advanced ? BigInt(rateTargetEnd) : null,
        rateHalfLifeMs: advanced ? BigInt(rateHalfLifeMs) : null,
        minRateBps: advanced ? BigInt(minRateBps) : null,
        maxRateBps: advanced ? BigInt(maxRateBps) : null,
        initialRateBps: advanced ? BigInt(initialRateBps) : null,
        paramsHash: paramsHashBytes,
        version: Number(version),
        amount0In: amount0Base,
        amount1In: amount1Base,
        minLiquidityOut: 0n,
        lpName,
        lpSymbol,
        lpUri,
      })

      instructions.push(initializeIx as Instruction<Address>)

      const simulation = await simulate(instructions)
      if (simulation?.value?.err) {
        setError(`Simulation failed: ${JSON.stringify(simulation.value.err)}`)
        return
      }

      const signature = await send(instructions)
      setStatus(`Pool created: ${signature}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create pool failed')
    } finally {
      setSubmitting(false)
    }
  }, [
    account,
    advanced,
    amount0,
    amount1,
    fixedCfBps,
    getTokenAccount,
    halfLife,
    initialRateBps,
    isConnected,
    lpName,
    lpSymbol,
    lpUri,
    maxRateBps,
    minRateBps,
    rateHalfLifeMs,
    rateTargetEnd,
    rateTargetStart,
    resolvePairPda,
    resolveParamsHash,
    rpc,
    signer,
    simulate,
    send,
    swapFeeBps,
    token0,
    token1,
    version,
    findAssociatedTokenAddress,
  ])

  return (
    <main className="content">
      <section className="pool-detail-shell">
        <div className="pool-detail-header">
          <Link to="/" className="back-link">
            ← Back to Pools
          </Link>
        </div>

        <div className="pool-detail-card new-pool-card">
          <div className="pool-detail-top">
            <div className="pool-detail-title">
              <div>
                <h2>Create New Pool</h2>
                <p>Bootstrap a pair with initial liquidity and a rate model.</p>
              </div>
            </div>
          </div>

          <div className="new-pool-grid">
            <div className="field">
              <label className="field-label">Token 0 Mint</label>
              <input
                className="field-input"
                value={token0}
                onChange={(event) => setToken0(event.target.value.trim())}
                placeholder="Token mint address"
              />
            </div>
            <div className="field">
              <label className="field-label">Token 1 Mint</label>
              <input
                className="field-input"
                value={token1}
                onChange={(event) => setToken1(event.target.value.trim())}
                placeholder="Token mint address"
              />
            </div>

            <div className="field">
              <label className="field-label">Bootstrap Amount 0</label>
              <input
                className="field-input"
                value={amount0}
                onChange={(event) => setAmount0(event.target.value)}
                placeholder="0.0"
              />
            </div>
            <div className="field">
              <label className="field-label">Bootstrap Amount 1</label>
              <input
                className="field-input"
                value={amount1}
                onChange={(event) => setAmount1(event.target.value)}
                placeholder="0.0"
              />
            </div>

            <div className="field">
              <label className="field-label">Swap Fee (bps)</label>
              <input
                className="field-input"
                value={swapFeeBps}
                onChange={(event) => setSwapFeeBps(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Half Life (ms)</label>
              <input
                className="field-input"
                value={halfLife}
                onChange={(event) => setHalfLife(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">Fixed CF (bps)</label>
              <input
                className="field-input"
                value={fixedCfBps}
                onChange={(event) => setFixedCfBps(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Version</label>
              <input
                className="field-input"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">LP Name</label>
              <input className="field-input" value={lpName} onChange={(e) => setLpName(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">LP Symbol</label>
              <input className="field-input" value={lpSymbol} onChange={(e) => setLpSymbol(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">LP URI</label>
              <input className="field-input" value={lpUri} onChange={(e) => setLpUri(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Params Hash (32-byte hex, optional)</label>
              <input
                className="field-input"
                value={paramsHash}
                onChange={(event) => setParamsHash(event.target.value)}
                placeholder={bytesToHex(new Uint8Array(32))}
              />
            </div>
          </div>

          <button type="button" className="ghost-button" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? 'Hide Rate Model' : 'Advanced Rate Model'}
          </button>

          {advanced && (
            <div className="new-pool-grid new-pool-advanced">
              <div className="field">
                <label className="field-label">Target Util Start (bps)</label>
                <input
                  className="field-input"
                  value={rateTargetStart}
                  onChange={(event) => setRateTargetStart(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">Target Util End (bps)</label>
                <input
                  className="field-input"
                  value={rateTargetEnd}
                  onChange={(event) => setRateTargetEnd(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">Rate Half Life (ms)</label>
                <input
                  className="field-input"
                  value={rateHalfLifeMs}
                  onChange={(event) => setRateHalfLifeMs(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">Min Rate (bps)</label>
                <input
                  className="field-input"
                  value={minRateBps}
                  onChange={(event) => setMinRateBps(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">Max Rate (bps)</label>
                <input
                  className="field-input"
                  value={maxRateBps}
                  onChange={(event) => setMaxRateBps(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label">Initial Rate (bps)</label>
                <input
                  className="field-input"
                  value={initialRateBps}
                  onChange={(event) => setInitialRateBps(event.target.value)}
                />
              </div>
            </div>
          )}

          {error && <div className="status-block error">{error}</div>}
          {status && <div className="status-block">{status}</div>}

          <button type="button" className="primary-button" onClick={createPool} disabled={submitting}>
            {submitting ? 'Creating Pool…' : 'Create Pool'}
          </button>
        </div>
      </section>
    </main>
  )
}

export default NewPool
