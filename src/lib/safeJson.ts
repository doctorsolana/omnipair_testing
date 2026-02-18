export function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    )
  } catch {
    try {
      return String(value)
    } catch {
      return '[unserializable]'
    }
  }
}

