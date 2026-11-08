import type { ApiArgs, ApiName, ApiResult } from '@shared/api'

/** Appel typé vers le processus principal (SQLite). */
export function call<K extends ApiName>(
  name: K,
  ...args: ApiArgs<K>
): Promise<Awaited<ApiResult<K>>> {
  return window.mnemo.invoke(name, ...args) as Promise<Awaited<ApiResult<K>>>
}
