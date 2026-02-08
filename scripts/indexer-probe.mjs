#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://api.indexer.omnipair.fi'
const DEFAULT_LIMIT = 3
const DEFAULT_PREVIEW_CHARS = 700

function parseArgs(argv) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    limit: DEFAULT_LIMIT,
    poolAddress: '',
    positionId: '',
    userAddress: '',
    previewChars: DEFAULT_PREVIEW_CHARS,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if ((arg === '--base' || arg === '-b') && next) {
      out.baseUrl = next
      i += 1
      continue
    }
    if ((arg === '--limit' || arg === '-l') && next) {
      out.limit = Number(next)
      i += 1
      continue
    }
    if (arg === '--pool' && next) {
      out.poolAddress = next
      i += 1
      continue
    }
    if (arg === '--position' && next) {
      out.positionId = next
      i += 1
      continue
    }
    if (arg === '--user' && next) {
      out.userAddress = next
      i += 1
      continue
    }
    if ((arg === '--preview' || arg === '-p') && next) {
      out.previewChars = Number(next)
      i += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
  }

  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = DEFAULT_LIMIT
  if (!Number.isFinite(out.previewChars) || out.previewChars <= 0) {
    out.previewChars = DEFAULT_PREVIEW_CHARS
  }

  out.baseUrl = out.baseUrl.replace(/\/+$/, '')
  return out
}

function printUsage() {
  console.log(
    [
      'Indexer probe for Omnipair.',
      '',
      'Usage:',
      '  node scripts/indexer-probe.mjs [options]',
      '',
      'Options:',
      `  --base, -b      Base URL (default: ${DEFAULT_BASE_URL})`,
      `  --limit, -l     Limit for list endpoints (default: ${DEFAULT_LIMIT})`,
      '  --pool          Optional explicit pool address',
      '  --user          Optional explicit user address',
      '  --position      Optional explicit position id/address',
      `  --preview, -p   Preview chars per response (default: ${DEFAULT_PREVIEW_CHARS})`,
      '  --help, -h      Show this help',
    ].join('\n'),
  )
}

async function fetchJson(baseUrl, path) {
  const url = new URL(path, `${baseUrl}/`).toString()
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    text,
    body,
  }
}

function firstObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value)
}

function summarizeBody(body) {
  if (Array.isArray(body)) {
    return {
      type: 'array',
      count: body.length,
      firstItemKeys: body.length ? firstObjectKeys(body[0]) : [],
    }
  }

  if (!body || typeof body !== 'object') {
    return { type: typeof body }
  }

  const summary = {
    type: 'object',
    topLevelKeys: Object.keys(body),
  }

  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    const dataEntries = {}
    for (const [key, value] of Object.entries(body.data)) {
      if (Array.isArray(value)) {
        dataEntries[key] = {
          type: 'array',
          count: value.length,
          firstItemKeys: value.length ? firstObjectKeys(value[0]) : [],
        }
      } else if (value && typeof value === 'object') {
        dataEntries[key] = {
          type: 'object',
          keys: Object.keys(value),
        }
      } else {
        dataEntries[key] = { type: typeof value, value }
      }
    }
    summary.data = dataEntries
  }

  return summary
}

function truncate(value, max) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n... (truncated)`
}

function printResponse(label, result, previewChars) {
  console.log(`\n=== ${label} ===`)
  console.log(`GET ${result.url}`)
  console.log(`Status: ${result.status} (${result.ok ? 'ok' : 'error'})`)
  console.log(`Content-Type: ${result.contentType || 'unknown'}`)

  if (result.body !== null) {
    console.log('Shape summary:')
    console.log(JSON.stringify(summarizeBody(result.body), null, 2))
    console.log('Preview:')
    console.log(truncate(JSON.stringify(result.body, null, 2), previewChars))
    return
  }

  console.log('Preview:')
  console.log(truncate(result.text, previewChars))
}

function pickFirstPoolAddress(poolsBody) {
  const firstPool = poolsBody?.data?.pools?.[0]
  if (!firstPool || typeof firstPool !== 'object') return ''
  return (
    firstPool.pair_address ||
    firstPool.pairAddress ||
    firstPool.pool_address ||
    firstPool.poolAddress ||
    firstPool.address ||
    ''
  )
}

function pickFirstPositionId(positionsBody) {
  const firstPosition = positionsBody?.data?.positions?.[0]
  if (!firstPosition || typeof firstPosition !== 'object') return ''
  return (
    firstPosition.position ||
    firstPosition.position_id ||
    firstPosition.positionId ||
    firstPosition.id ||
    ''
  )
}

function pickFirstUserAddress(positionsBody) {
  const firstPosition = positionsBody?.data?.positions?.[0]
  if (!firstPosition || typeof firstPosition !== 'object') return ''
  return firstPosition.signer || firstPosition.userAddress || firstPosition.user_address || ''
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log('Omnipair indexer probe')
  console.log(`Base URL: ${args.baseUrl}`)

  const root = await fetchJson(args.baseUrl, '/')
  printResponse('Root', root, args.previewChars)

  if (!root.ok || !root.body || typeof root.body !== 'object') {
    process.exitCode = 1
    return
  }

  const apiBase = typeof root.body.baseUrl === 'string' ? root.body.baseUrl : '/api/v1'
  const poolsPath = `${apiBase}/pools?limit=${args.limit}&offset=0`
  const positionsPath = `${apiBase}/positions?limit=${args.limit}&offset=0`

  const pools = await fetchJson(args.baseUrl, poolsPath)
  printResponse('Pools list', pools, args.previewChars)

  const positions = await fetchJson(args.baseUrl, positionsPath)
  printResponse('Positions list', positions, args.previewChars)

  const poolAddress = args.poolAddress || pickFirstPoolAddress(pools.body)
  const positionId = args.positionId || pickFirstPositionId(positions.body)
  const userAddress = args.userAddress || pickFirstUserAddress(positions.body)

  if (poolAddress) {
    const poolEndpoints = [
      `${apiBase}/pools/${poolAddress}`,
      `${apiBase}/pools/${poolAddress}/stats?windowHours=24`,
      `${apiBase}/pools/${poolAddress}/volume?windowHours=24`,
      `${apiBase}/pools/${poolAddress}/fees?windowHours=24`,
      `${apiBase}/pools/${poolAddress}/price-chart?windowHours=24`,
      `${apiBase}/pools/${poolAddress}/swaps?limit=${args.limit}&offset=0`,
    ]

    for (const endpoint of poolEndpoints) {
      const result = await fetchJson(args.baseUrl, endpoint)
      printResponse(`Pool endpoint (${endpoint.replace(`${apiBase}/`, '')})`, result, args.previewChars)
    }
  } else {
    console.log('\nNo pool address discovered. Pass --pool to probe pool-specific endpoints.')
  }

  if (positionId) {
    const singlePosition = await fetchJson(args.baseUrl, `${apiBase}/positions/${positionId}`)
    printResponse('Single position', singlePosition, args.previewChars)
  } else {
    console.log('\nNo position id discovered. Pass --position to probe single-position endpoint.')
  }

  if (userAddress) {
    const userEndpoints = [
      `${apiBase}/users/${userAddress}/positions?limit=${args.limit}&offset=0`,
      `${apiBase}/users/${userAddress}/swaps?limit=${args.limit}&offset=0`,
      `${apiBase}/users/${userAddress}/liquidity-events?limit=${args.limit}&offset=0`,
      `${apiBase}/users/${userAddress}/lending-events?limit=${args.limit}&offset=0`,
    ]

    for (const endpoint of userEndpoints) {
      const result = await fetchJson(args.baseUrl, endpoint)
      printResponse(`User endpoint (${endpoint.replace(`${apiBase}/`, '')})`, result, args.previewChars)
    }
  } else {
    console.log('\nNo user address discovered. Pass --user to probe user endpoints.')
  }
}

main().catch((error) => {
  console.error('\nProbe failed:')
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
