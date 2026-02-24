#!/usr/bin/env node

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const IDL_PATH = path.join(ROOT, 'idl', 'omnipair.json')
const OUT_PATH = path.join(ROOT, 'src', 'protocol', 'omnipair', 'errors.generated.ts')

function toIdentifier(name) {
  // Keep stable and readable identifiers for export.
  return name.replace(/[^a-zA-Z0-9_]/g, '')
}

function main() {
  const raw = fs.readFileSync(IDL_PATH, 'utf8')
  const idl = JSON.parse(raw)
  const errors = Array.isArray(idl.errors) ? idl.errors : []

  if (!errors.length) {
    throw new Error(`No errors found in ${IDL_PATH}`)
  }

  const lines = []
  lines.push('// This file is AUTO-GENERATED. Do not edit by hand.')
  lines.push('// Regenerate via: node scripts/gen-omnipair-error-map.mjs')
  lines.push('')
  lines.push('export type OmnipairIdlError = {')
  lines.push('  code: number')
  lines.push('  name: string')
  lines.push('  msg: string')
  lines.push('}')
  lines.push('')
  lines.push('export const OMNIPAIR_IDL_ERRORS: Record<number, OmnipairIdlError> = {')

  const sorted = [...errors].sort((a, b) => Number(a.code) - Number(b.code))
  for (const entry of sorted) {
    const code = Number(entry.code)
    const name = toIdentifier(String(entry.name ?? 'Unknown'))
    const msg = String(entry.msg ?? '')
    if (!Number.isFinite(code)) continue
    lines.push(`  ${code}: { code: ${code}, name: ${JSON.stringify(name)}, msg: ${JSON.stringify(msg)} },`)
  }

  lines.push('}')
  lines.push('')
  lines.push('export function getOmnipairIdlError(code: number): OmnipairIdlError | null {')
  lines.push('  return OMNIPAIR_IDL_ERRORS[code] ?? null')
  lines.push('}')
  lines.push('')

  fs.writeFileSync(OUT_PATH, `${lines.join('\n')}\n`, 'utf8')
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${sorted.length} errors)`)
}

main()
