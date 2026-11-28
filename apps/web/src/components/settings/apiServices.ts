import {
  type EnvironmentId,
  ProviderDriverKind,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";

import catalog from "./apiServicesCatalog.json";

export interface ApiService {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
}

const API_SERVICE_KEY_ENV = "K3_API_SERVICE_KEY";

/** よく使うもの。models.dev にないサービスもここで足す。 */
const FEATURED: ReadonlyArray<ApiService> = [
  { id: "opendesign", name: "OpenDesign", baseUrl: "https://amr-link.open-design.ai/v1" },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { id: "kinocode", name: "キノコード", baseUrl: "https://ai-runner.kinocode.jp/v1" },
  { id: "commandcode", name: "CommandCode", baseUrl: "https://api.commandcode.ai/provider/v1" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "opencode", name: "OpenCode Zen", baseUrl: "https://opencode.ai/inference/openai/v1" },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
  },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "xai", name: "xAI", baseUrl: "https://api.x.ai/v1" },
];

const featuredIds = new Set(FEATURED.map((service) => service.id));

export const API_SERVICES: ReadonlyArray<ApiService> = [
  ...FEATURED,
  ...(catalog as ReadonlyArray<ReadonlyArray<string>>).flatMap(([id, name, baseUrl]) =>
    id && name && baseUrl && !featuredIds.has(id) ? [{ id, name, baseUrl }] : [],
  ),
];

/** 検索語がなければ、よく使うものだけを返す。 */
export function searchApiServices(query: string): ReadonlyArray<ApiService> {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return FEATURED;
  return API_SERVICES.filter((service) =>
    `${service.name} ${service.id} ${service.baseUrl}`.toLocaleLowerCase().includes(needle),
  ).slice(0, 50);
}

/** サーバーの `isAllowedApiServiceUrl` と同じ条件。 */
export function isAllowedApiServiceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** 登録するインスタンス。接続先はこの時点の値で固定し、一覧が更新されても変えない。 */
export function apiServiceInstance(input: {
  readonly service: ApiService;
  readonly key: string;
}): ProviderInstanceConfig {
  return {
    driver: ProviderDriverKind.make("opencode"),
    enabled: true,
    displayName: input.service.name,
    config: {
      apiService: {
        id: input.service.id,
        name: input.service.name,
        baseUrl: input.service.baseUrl,
      },
    },
    environment: [{ name: API_SERVICE_KEY_ENV, value: input.key, sensitive: true }],
  };
}

export function readApiService(
  config: unknown,
): (ApiService & { readonly modelsRevision?: number }) | null {
  const service = (config as { readonly apiService?: unknown } | undefined)?.apiService;
  if (typeof service !== "object" || service === null) return null;
  const { id, name, baseUrl } = service as Record<string, unknown>;
  return typeof id === "string" && typeof name === "string" && typeof baseUrl === "string"
    ? (service as ApiService & { readonly modelsRevision?: number })
    : null;
}

/** モデル一覧を読み直させる。設定が変わると、サーバーがインスタンスを作り直す。 */
export function refreshedApiServiceConfig(config: unknown): Record<string, unknown> | null {
  const service = readApiService(config);
  if (service === null) return null;
  return {
    ...(config as Record<string, unknown>),
    apiService: { ...service, modelsRevision: (service.modelsRevision ?? 0) + 1 },
  };
}

/**
 * 設定の外（モデル選択欄など）から追加画面を開く合図。どの端末に追加するかを持たせ、受け取った
 * 設定画面が消す。
 */
let requestedFor: EnvironmentId | null = null;
const listeners = new Set<() => void>();
const publish = (next: EnvironmentId | null) => {
  requestedFor = next;
  for (const listener of listeners) listener();
};
export const apiServiceDialogRequest = {
  open: (environmentId: EnvironmentId) => publish(environmentId),
  clear: () => publish(null),
  get: () => requestedFor,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** 手で足すモデル名は、サーバーと同じ `k3-api/` 付きで保存し、選択欄に二重に出さない。 */
export const apiServiceModelSlug = (slug: string): string =>
  slug.startsWith("k3-api/") ? slug : `k3-api/${slug}`;

export function apiServiceInstanceId(serviceId: string, taken: ReadonlySet<string>): string {
  const base = `api_${serviceId.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 56);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
