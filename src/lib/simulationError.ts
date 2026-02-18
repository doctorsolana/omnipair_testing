import { safeJsonStringify } from './safeJson'
import { getOmnipairErrorInfo } from '../omnipair'

type ParsedInstructionError = {
  instructionIndex: number | null
  kind: 'custom' | 'named' | 'unknown'
  customCode: number | null
  raw: unknown
}

function toNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') {
    const asNumber = Number(value)
    return Number.isSafeInteger(asNumber) ? asNumber : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseJson(input: string): unknown | null {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

function parseJsonFromMessage(input: string): unknown | null {
  const trimmed = input.trim()
  if (!trimmed.length) return null

  const direct = parseJson(trimmed)
  if (direct !== null) return direct

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = trimmed.slice(firstBrace, lastBrace + 1)
    const fromSlice = parseJson(sliced)
    if (fromSlice !== null) return fromSlice
  }

  return null
}

function getInstructionErrorNode(err: unknown): unknown {
  if (!err || typeof err !== 'object') return null
  const record = err as Record<string, unknown>
  if ('InstructionError' in record) return record.InstructionError
  if ('instructionError' in record) return record.instructionError
  return null
}

function parseInstructionError(err: unknown): ParsedInstructionError | null {
  const instructionError = getInstructionErrorNode(err)
  if (!Array.isArray(instructionError) || instructionError.length < 2) return null

  const instructionIndex = toNumberLike(instructionError[0])
  const detail = instructionError[1]

  if (
    detail &&
    typeof detail === 'object' &&
    ('Custom' in (detail as Record<string, unknown>) ||
      'custom' in (detail as Record<string, unknown>))
  ) {
    const detailRecord = detail as Record<string, unknown>
    const customCode = toNumberLike(detailRecord.Custom ?? detailRecord.custom)
    return {
      instructionIndex,
      kind: 'custom',
      customCode,
      raw: detail,
    }
  }

  if (typeof detail === 'string') {
    return {
      instructionIndex,
      kind: 'named',
      customCode: null,
      raw: detail,
    }
  }

  return {
    instructionIndex,
    kind: 'unknown',
    customCode: null,
    raw: detail,
  }
}

function extractSimulationError(value: unknown, depth = 0): unknown | null {
  if (depth > 5) return null

  if (parseInstructionError(value)) return value

  if (typeof value === 'string') {
    const parsed = parseJsonFromMessage(value)
    if (parsed !== null) return extractSimulationError(parsed, depth + 1)
    return null
  }

  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  const likelyKeys = ['err', 'error', 'value', 'data', 'cause', 'details', 'message']
  for (const key of likelyKeys) {
    if (!(key in record)) continue
    const candidate = extractSimulationError(record[key], depth + 1)
    if (candidate) return candidate
  }

  return null
}

function parseInstructionIndexFromMessage(message: string): number | null {
  const match = /instruction\s+(\d+)/i.exec(message)
  return match ? toNumberLike(match[1]) : null
}

function parseCustomProgramCodeFromMessage(message: string): number | null {
  const hexMatch = /custom program error[:\s]+0x([0-9a-f]+)/i.exec(message)
  if (hexMatch) return parseInt(hexMatch[1], 16)

  const decMatch = /custom program error[:\s]+(\d+)/i.exec(message)
  if (decMatch) return toNumberLike(decMatch[1])

  const customField = /["']?Custom["']?\s*[:=]\s*["']?(\d+)["']?/i.exec(message)
  if (customField) return toNumberLike(customField[1])

  return null
}

function formatCustomProgramError(customCode: number, instructionIndex: number | null) {
  const info = getOmnipairErrorInfo(customCode)
  const prefix = instructionIndex !== null ? `Instruction ${instructionIndex}: ` : ''

  if (!info) {
    return `${prefix}Custom program error #${customCode}.`
  }

  const hint = info.hint ? ` ${info.hint}` : ''
  const msg = info.msg.trim()
  const punctuated = msg.endsWith('.') || msg.endsWith('!') || msg.endsWith('?') ? msg : `${msg}.`
  return `${prefix}${info.name} (Omnipair #${info.code}): ${punctuated}${hint}`
}

export function formatSimulationError(err: unknown) {
  const normalized = extractSimulationError(err) ?? err
  const parsed = parseInstructionError(normalized)
  if (parsed?.kind === 'custom' && parsed.customCode !== null) {
    return formatCustomProgramError(parsed.customCode, parsed.instructionIndex)
  }

  if (parsed?.kind === 'named') {
    const prefix = parsed.instructionIndex !== null ? `Instruction ${parsed.instructionIndex}: ` : ''
    return `${prefix}${String(parsed.raw)}`
  }

  if (typeof err === 'string') {
    const code = parseCustomProgramCodeFromMessage(err)
    if (code !== null) {
      return formatCustomProgramError(code, parseInstructionIndexFromMessage(err))
    }
    return err
  }

  const json = safeJsonStringify(normalized)
  const code = parseCustomProgramCodeFromMessage(json)
  if (code !== null) {
    return formatCustomProgramError(code, parseInstructionIndexFromMessage(json))
  }
  return json
}

export function formatActionError(error: unknown, fallbackMessage: string) {
  const structured = extractSimulationError(error)
  if (structured) {
    return `Simulation failed: ${formatSimulationError(structured)}`
  }

  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message) {
      const fromMessage = extractSimulationError(message)
      if (fromMessage) {
        return `Simulation failed: ${formatSimulationError(fromMessage)}`
      }

      const customCode = parseCustomProgramCodeFromMessage(message)
      if (customCode !== null) {
        const decoded = formatCustomProgramError(
          customCode,
          parseInstructionIndexFromMessage(message),
        )
        return `Simulation failed: ${decoded}`
      }

      return message
    }
    return fallbackMessage
  }

  if (typeof error === 'string') {
    const message = error.trim()
    if (!message.length) return fallbackMessage

    const fromMessage = extractSimulationError(message)
    if (fromMessage) {
      return `Simulation failed: ${formatSimulationError(fromMessage)}`
    }

    const customCode = parseCustomProgramCodeFromMessage(message)
    if (customCode !== null) {
      const decoded = formatCustomProgramError(customCode, parseInstructionIndexFromMessage(message))
      return `Simulation failed: ${decoded}`
    }

    return message
  }

  const json = safeJsonStringify(error)
  return json === 'undefined' ? fallbackMessage : json
}
