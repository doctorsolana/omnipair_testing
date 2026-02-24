#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PROGRAM_ID = 'omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE'
const DEFAULT_SIGNATURE_LIMIT = 180
const DEFAULT_COMPUTE_BUDGET = 1_400_000
const DEFAULT_REPLAY_COUNT = 0

function printUsage() {
  console.log(
    [
      'Omnipair loop-feasibility profiler (borrow/swap/add-collateral).',
      '',
      'Usage:',
      '  node scripts/loop-feasibility.mjs [options]',
      '',
      'Options:',
      `  --program <address>       Program id (default: ${DEFAULT_PROGRAM_ID})`,
      '  --rpc <url>               RPC URL (or set VITE_SOLANA_RPC_URL in .env)',
      `  --limit <n>               Signatures to inspect (default: ${DEFAULT_SIGNATURE_LIMIT})`,
      `  --budget <cu>             Compute budget to target (default: ${DEFAULT_COMPUTE_BUDGET})`,
      `  --replay <n>              Re-simulate up to n matching txs (default: ${DEFAULT_REPLAY_COUNT})`,
      '  --help, -h                Show help',
    ].join('\n'),
  )
}

function parseArgs(argv) {
  const out = {
    programId: DEFAULT_PROGRAM_ID,
    rpcUrl: '',
    signatureLimit: DEFAULT_SIGNATURE_LIMIT,
    computeBudget: DEFAULT_COMPUTE_BUDGET,
    replayCount: DEFAULT_REPLAY_COUNT,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if ((arg === '--help' || arg === '-h') && !next) {
      printUsage()
      process.exit(0)
    }
    if (arg === '--program' && next) {
      out.programId = next
      i += 1
      continue
    }
    if (arg === '--rpc' && next) {
      out.rpcUrl = next
      i += 1
      continue
    }
    if (arg === '--limit' && next) {
      out.signatureLimit = Number(next)
      i += 1
      continue
    }
    if (arg === '--budget' && next) {
      out.computeBudget = Number(next)
      i += 1
      continue
    }
    if (arg === '--replay' && next) {
      out.replayCount = Number(next)
      i += 1
      continue
    }
  }

  if (!Number.isFinite(out.signatureLimit) || out.signatureLimit <= 0) {
    out.signatureLimit = DEFAULT_SIGNATURE_LIMIT
  }
  if (!Number.isFinite(out.computeBudget) || out.computeBudget <= 0) {
    out.computeBudget = DEFAULT_COMPUTE_BUDGET
  }
  if (!Number.isFinite(out.replayCount) || out.replayCount < 0) {
    out.replayCount = DEFAULT_REPLAY_COUNT
  }

  return out
}

function readDotEnvValue(key) {
  try {
    const filePath = path.resolve(process.cwd(), '.env')
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const name = trimmed.slice(0, eq).trim()
      if (name !== key) continue
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      return value
    }
  } catch {
    return ''
  }
  return ''
}

function resolveRpcUrl(cliUrl) {
  const candidate = cliUrl || process.env.VITE_SOLANA_RPC_URL || readDotEnvValue('VITE_SOLANA_RPC_URL')
  const trimmed = String(candidate || '').trim()
  if (!trimmed) {
    throw new Error('Missing RPC URL. Pass --rpc or set VITE_SOLANA_RPC_URL in .env.')
  }
  return trimmed
}

async function rpcCall(rpcUrl, method, params) {
  const maxAttempts = 4
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

    if (response.status === 429 && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      continue
    }

    if (!response.ok) {
      throw new Error(`RPC ${method} failed with HTTP ${response.status}`)
    }

    const json = await response.json()
    if (json.error) {
      const message = json.error.message || JSON.stringify(json.error)
      const code = Number(json.error.code)
      const isRateLimited = message.toLowerCase().includes('rate') || code === 429 || code === -32005
      if (isRateLimited && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
        continue
      }
      throw new Error(`RPC ${method} error: ${message}`)
    }
    return json.result
  }

  throw new Error(`RPC ${method} failed after retries`)
}

async function fetchSignatures(rpcUrl, programId, limit) {
  const signatures = []
  let before = undefined

  while (signatures.length < limit) {
    const pageSize = Math.min(1000, limit - signatures.length)
    const page = await rpcCall(rpcUrl, 'getSignaturesForAddress', [
      programId,
      {
        limit: pageSize,
        ...(before ? { before } : {}),
        commitment: 'confirmed',
      },
    ])

    if (!Array.isArray(page) || page.length === 0) break
    signatures.push(...page)
    before = page[page.length - 1]?.signature
    if (!before) break
  }

  return signatures
}

async function fetchTransactions(rpcUrl, signatureRows) {
  const signatures = signatureRows.map((row) => row.signature).filter(Boolean)
  const out = []
  const chunkSize = 16

  for (let i = 0; i < signatures.length; i += chunkSize) {
    const slice = signatures.slice(i, i + chunkSize)
    const batch = await Promise.all(
      slice.map(async (signature) => {
        try {
          const tx = await rpcCall(rpcUrl, 'getTransaction', [
            signature,
            {
              encoding: 'json',
              maxSupportedTransactionVersion: 0,
              commitment: 'confirmed',
            },
          ])
          return { signature, tx }
        } catch {
          return { signature, tx: null }
        }
      }),
    )

    out.push(...batch)
  }

  return out
}

function parseOmnipairInvocations(logs, targetProgramId) {
  if (!Array.isArray(logs)) return []

  const stack = []
  const invocations = []

  const popByProgramId = (programId, status) => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].programId !== programId) continue
      const [entry] = stack.splice(i, 1)
      if (entry.isTarget) {
        invocations.push({
          instruction: entry.instruction || 'Unknown',
          consumed: entry.consumed || 0,
          status,
        })
      }
      return
    }
  }

  for (const line of logs) {
    const invokeMatch = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/.exec(line)
    if (invokeMatch) {
      const programId = invokeMatch[1]
      stack.push({
        programId,
        isTarget: programId === targetProgramId,
        instruction: '',
        consumed: 0,
      })
      continue
    }

    const instructionMatch = /^Program log: Instruction: ([A-Za-z0-9_]+)$/.exec(line)
    if (instructionMatch) {
      const top = stack[stack.length - 1]
      if (top && top.isTarget) {
        top.instruction = instructionMatch[1]
      }
      continue
    }

    const consumedMatch =
      /^Program ([1-9A-HJ-NP-Za-km-z]+) consumed (\d+) of \d+ compute units$/.exec(line)
    if (consumedMatch) {
      const programId = consumedMatch[1]
      const consumed = Number(consumedMatch[2])
      const top = stack[stack.length - 1]
      if (top && top.programId === programId && top.isTarget && Number.isFinite(consumed)) {
        top.consumed = consumed
      }
      continue
    }

    const successMatch = /^Program ([1-9A-HJ-NP-Za-km-z]+) success$/.exec(line)
    if (successMatch) {
      popByProgramId(successMatch[1], 'success')
      continue
    }

    const failMatch = /^Program ([1-9A-HJ-NP-Za-km-z]+) failed:/.exec(line)
    if (failMatch) {
      popByProgramId(failMatch[1], 'failed')
    }
  }

  return invocations
}

function median(values) {
  const cleaned = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!cleaned.length) return 0
  const mid = Math.floor(cleaned.length / 2)
  if (cleaned.length % 2 === 0) {
    return (cleaned[mid - 1] + cleaned[mid]) / 2
  }
  return cleaned[mid]
}

function formatInt(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function estimateLoops(perLoopCu, budgetCu, overheadCu, safetyMultiplier = 1) {
  if (!Number.isFinite(perLoopCu) || perLoopCu <= 0) return 0
  const remaining = Math.max(0, budgetCu - overheadCu)
  return Math.floor(remaining / (perLoopCu * safetyMultiplier))
}

async function replaySimulations(rpcUrl, signatures, maxCount) {
  if (!maxCount) return []
  const rows = []

  for (const signature of signatures.slice(0, maxCount)) {
    try {
      const tx = await rpcCall(rpcUrl, 'getTransaction', [
        signature,
        {
          encoding: 'base64',
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        },
      ])

      const encoded = tx?.transaction?.[0]
      if (!encoded || typeof encoded !== 'string') continue

      const sim = await rpcCall(rpcUrl, 'simulateTransaction', [
        encoded,
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'confirmed',
        },
      ])

      rows.push({
        signature,
        err: sim?.value?.err ?? null,
        unitsConsumed: Number(sim?.value?.unitsConsumed ?? 0),
      })
    } catch (error) {
      rows.push({
        signature,
        err: error instanceof Error ? error.message : 'replay failed',
        unitsConsumed: 0,
      })
    }
  }

  return rows
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rpcUrl = resolveRpcUrl(args.rpcUrl)

  console.log('Omnipair leverage-loop feasibility')
  console.log(`Program: ${args.programId}`)
  console.log(`RPC: ${rpcUrl}`)
  console.log(`Signature sample size target: ${args.signatureLimit}`)

  const signatureRows = await fetchSignatures(rpcUrl, args.programId, args.signatureLimit)
  console.log(`Fetched signatures: ${signatureRows.length}`)

  if (!signatureRows.length) {
    console.log('No signatures found; cannot profile.')
    return
  }

  const txRows = await fetchTransactions(rpcUrl, signatureRows)
  const analyzed = []

  for (const row of txRows) {
    const meta = row.tx?.meta
    if (!meta) continue

    const invocations = parseOmnipairInvocations(meta.logMessages, args.programId)
    if (!invocations.length) continue

    const totalCu = Number(meta.computeUnitsConsumed ?? 0)
    const hasError = Boolean(meta.err)
    const instructionSequence = invocations.map((ix) => ix.instruction).join(' -> ')

    analyzed.push({
      signature: row.signature,
      totalCu,
      hasError,
      invocations,
      instructionSequence,
    })
  }

  if (!analyzed.length) {
    console.log('No analyzable transactions for this program in sampled signatures.')
    return
  }

  const instructionStats = new Map()
  const overheadSamples = []

  for (const tx of analyzed) {
    const invocationCu = tx.invocations.reduce((sum, ix) => sum + (ix.consumed || 0), 0)
    if (!tx.hasError && tx.totalCu > 0 && invocationCu > 0) {
      overheadSamples.push(Math.max(0, tx.totalCu - invocationCu))
    }

    for (const ix of tx.invocations) {
      if (!instructionStats.has(ix.instruction)) {
        instructionStats.set(ix.instruction, {
          total: [],
          success: [],
        })
      }
      const bucket = instructionStats.get(ix.instruction)
      if (ix.consumed > 0) {
        bucket.total.push(ix.consumed)
        if (ix.status === 'success' && !tx.hasError) bucket.success.push(ix.consumed)
      }
    }
  }

  const relevant = ['Borrow', 'Swap', 'AddCollateral']
  console.log('\nInstruction CU profile (median):')
  for (const name of relevant) {
    const bucket = instructionStats.get(name) || { total: [], success: [] }
    const medianSuccess = median(bucket.success)
    const medianAny = median(bucket.total)
    const sampleCount = bucket.success.length || bucket.total.length
    console.log(
      `- ${name.padEnd(13)} success median ${formatInt(medianSuccess)} CU | any median ${formatInt(medianAny)} CU | samples ${sampleCount}`,
    )
  }

  const medianBorrow = median((instructionStats.get('Borrow') || { success: [] }).success)
  const medianSwap = median((instructionStats.get('Swap') || { success: [] }).success)
  const medianAddCollateral = median((instructionStats.get('AddCollateral') || { success: [] }).success)
  const medianOverhead = median(overheadSamples) || 55_000

  const perLoopBorrowSwap = medianBorrow + medianSwap
  const perLoopBorrowSwapCollateral = medianBorrow + medianSwap + medianAddCollateral

  console.log('\nLoop feasibility estimate:')
  console.log(`- Tx budget: ${formatInt(args.computeBudget)} CU`)
  console.log(`- Median overhead (compute budget ix + tx glue): ${formatInt(medianOverhead)} CU`)
  console.log(`- Borrow + Swap per loop: ${formatInt(perLoopBorrowSwap)} CU`)
  console.log(`- Borrow + Swap + AddCollateral per loop: ${formatInt(perLoopBorrowSwapCollateral)} CU`)

  const maxRawBorrowSwap = estimateLoops(perLoopBorrowSwap, args.computeBudget, medianOverhead, 1)
  const maxSafeBorrowSwap = estimateLoops(perLoopBorrowSwap, args.computeBudget, medianOverhead, 1.15)
  const maxRawFull = estimateLoops(perLoopBorrowSwapCollateral, args.computeBudget, medianOverhead, 1)
  const maxSafeFull = estimateLoops(perLoopBorrowSwapCollateral, args.computeBudget, medianOverhead, 1.15)

  console.log(`- Estimated max loops (Borrow+Swap): raw ${maxRawBorrowSwap}, safe(15%) ${maxSafeBorrowSwap}`)
  console.log(
    `- Estimated max loops (Borrow+Swap+AddCollateral): raw ${maxRawFull}, safe(15%) ${maxSafeFull}`,
  )

  const mixedExamples = analyzed
    .filter((tx) => tx.instructionSequence.includes('Borrow') && tx.instructionSequence.includes('Swap'))
    .slice(0, 5)

  if (mixedExamples.length) {
    console.log('\nRecent mixed Borrow/Swap sequences:')
    for (const tx of mixedExamples) {
      console.log(`- ${tx.signature.slice(0, 6)}… ${tx.instructionSequence} | CU ${formatInt(tx.totalCu)}`)
    }
  } else {
    console.log('\nNo recent tx in sample had both Borrow and Swap in one transaction.')
  }

  if (args.replayCount > 0) {
    const replayTargets = analyzed
      .filter((tx) => tx.instructionSequence.includes('Borrow') || tx.instructionSequence.includes('Swap'))
      .map((tx) => tx.signature)
    const replayRows = await replaySimulations(rpcUrl, replayTargets, args.replayCount)
    if (replayRows.length) {
      console.log('\nReplay simulation (historic tx bytes re-simulated):')
      for (const row of replayRows) {
        console.log(
          `- ${row.signature.slice(0, 6)}… units=${formatInt(row.unitsConsumed)} err=${row.err ? JSON.stringify(row.err) : 'null'}`,
        )
      }
    } else {
      console.log('\nReplay simulation requested, but no eligible tx found.')
    }
  }

  console.log('\nNotes:')
  console.log('- This estimates compute feasibility, not profitability or liquidation risk.')
  console.log('- Real max loops also depends on account limits, tx size, and current pool state.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
