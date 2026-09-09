export const readPersistedValue = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value && allowed.includes(value as T) ? value as T : fallback
