export function logError(error: unknown): void {
  if (!process.env.AKRAMCODE_INK_DEBUG_ERRORS) {
    return
  }

  console.error(error)
}
