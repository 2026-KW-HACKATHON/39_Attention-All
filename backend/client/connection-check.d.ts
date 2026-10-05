export type ConnectionReport = {
  ok: boolean;
  authenticated: boolean;
  checks: {name: string; ok: boolean; code?: string}[];
};
export function checkConnection(
  call: (name: string, payload: Record<string, unknown>) => Promise<unknown>,
  options?: {authenticated?: boolean},
): Promise<ConnectionReport>;
