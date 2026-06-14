export const normalizeAuthIndex = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

export type ConfigApiKeyProvider = 'gemini' | 'claude' | 'codex';

// Maps the management UI brand to the backend's apiPrefix used in Auth.indexSeed.
// Must match sdk/cliproxy/auth/types.go indexSeed() for the api-key branch.
const API_PREFIX_MAP: Record<ConfigApiKeyProvider, string> = {
  gemini: 'gemini-api-key',
  claude: 'claude-api-key',
  codex: 'codex-api-key',
};

const textEncoder = new TextEncoder();

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Bytes = async (value: string): Promise<Uint8Array> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return new Uint8Array(digest);
};

/**
 * Mirrors the v7 backend's Auth.EnsureIndex for the api-key branch:
 *   seed = `${apiPrefix}:${trim(baseURL)}+${trim(apiKey)}`
 *   index = hex(sha256(trim(seed))[:8])  // 16 hex chars
 *
 * proxyURL and entry source do NOT participate; duplicate entries sharing
 * baseURL + apiKey deliberately collapse to the same auth_index (per backend
 * test TestEnsureIndexUsesCredentialIdentity).
 */
export async function calculateConfigApiKeyAuthIndex(params: {
  provider: ConfigApiKeyProvider;
  baseUrl: string;
  apiKey: string;
}): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) {
    return undefined;
  }
  const apiKey = (params.apiKey ?? '').trim();
  if (!apiKey) {
    return undefined;
  }
  try {
    const baseUrl = (params.baseUrl ?? '').trim();
    const apiPrefix = API_PREFIX_MAP[params.provider];
    const seed = `${apiPrefix}:${baseUrl}+${apiKey}`;
    return toHex((await sha256Bytes(seed)).slice(0, 8));
  } catch (error) {
    console.warn('Failed to calculate config auth_index:', error);
    return undefined;
  }
}
