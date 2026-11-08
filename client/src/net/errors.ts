export function errorMessage(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}
