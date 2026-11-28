// API キーで使うサービス。モデル一覧はサービスの `/models` から直接読み、OpenCode には環境変数で
// 設定を渡す。利用者の OpenCode の設定ファイルは書き換えない。キーは OpenCode に渡さない。
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import type { ApiServiceRelay } from "./apiServiceRelay.ts";
import { OpenCodeRuntimeError } from "./OpenCodeRuntime.ts";

/** キーを持つ環境変数の名前。インスタンスの秘密の環境変数として保存する。 */
const API_SERVICE_KEY_ENV = "K3_API_SERVICE_KEY";
/** OpenCode 内でのサービス ID。モデルは `k3-api/<モデル>` になる。 */
export const API_SERVICE_PROVIDER_ID = "k3-api";

// サービスが上限を返さないときの控えめな値。
const DEFAULT_CONTEXT = 128_000;
const DEFAULT_OUTPUT = 8_192;
const MODELS_TIMEOUT = "10 seconds";
const NOT_CHAT_MODEL = /embed|rerank|moderation|whisper|transcri|tts|ocr/i;

export interface ApiServiceModel {
  readonly id: string;
  readonly context: number;
  readonly output: number;
  readonly tools: boolean;
  readonly vision: boolean;
}

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row =>
  typeof value === "object" && value !== null ? (value as Row) : {};
const firstCount = (...values: ReadonlyArray<unknown>): number | undefined =>
  values.find((value): value is number => typeof value === "number" && value > 0);
const includes = (list: unknown, item: string): boolean | undefined =>
  Array.isArray(list) ? list.includes(item) : undefined;

export const apiServiceModel = (
  id: string,
  extra: Partial<Omit<ApiServiceModel, "id">> = {},
): ApiServiceModel => ({
  id,
  context: DEFAULT_CONTEXT,
  output: DEFAULT_OUTPUT,
  tools: true,
  vision: false,
  ...extra,
});

// 別名ごとに同じモデルが何行も返るサービス（Mistral）は、1 行にまとめる。残すのは、中身が新しく
// なっても名前が変わらない `-latest`、次に短い名前。
const preferredId = (a: string, b: string) =>
  Number(b.endsWith("-latest")) - Number(a.endsWith("-latest")) ||
  a.length - b.length ||
  a.localeCompare(b);

const withoutAliasRows = (rows: ReadonlyArray<Row>): ReadonlyArray<Row> => {
  const kept = new Set<string>();
  const aliased = new Set<string>();
  const named = rows.flatMap((row) => (typeof row.id === "string" ? [{ id: row.id, row }] : []));
  for (const { id, row } of named.toSorted((a, b) => preferredId(a.id, b.id))) {
    const aliases = Array.isArray(row.aliases) ? row.aliases : [];
    if (aliased.has(id) || aliases.some((alias) => kept.has(alias))) continue;
    kept.add(id);
    for (const alias of aliases) if (typeof alias === "string") aliased.add(alias);
  }
  return rows.filter((row) => typeof row.id === "string" && kept.delete(row.id));
};

export const parseApiServiceModels = (body: unknown): ReadonlyArray<ApiServiceModel> => {
  const data = Array.isArray(body) ? body : asRow(body).data;
  if (!Array.isArray(data)) return [];
  return withoutAliasRows(data.map(asRow)).flatMap((row) => {
    const capabilities = asRow(row.capabilities);
    const architecture = asRow(row.architecture);
    const { id } = row;
    if (typeof id !== "string" || id === "" || NOT_CHAT_MODEL.test(id)) return [];
    if (capabilities.completion_chat === false) return [];
    if (includes(architecture.output_modalities, "text") === false) return [];
    return [
      apiServiceModel(id, {
        context:
          firstCount(row.context_limit, row.context_length, row.max_context_length) ??
          DEFAULT_CONTEXT,
        output:
          firstCount(
            row.output_budget,
            asRow(row.top_provider).max_completion_tokens,
            row.max_output_tokens,
          ) ?? DEFAULT_OUTPUT,
        tools:
          capabilities.function_calling !== false &&
          includes(row.supported_parameters, "tools") !== false,
        vision:
          capabilities.vision === true || includes(architecture.input_modalities, "image") === true,
      }),
    ];
  });
};

/** キーを平文で送らないよう、http は手元のサーバーだけに許す。 */
export const isAllowedApiServiceUrl = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
};

const trimSlashes = (value: string) => value.trim().replace(/\/+$/, "");

const fetchApiServiceModels = Effect.fn("OpenCodeApiService.fetchModels")(function* (input: {
  readonly baseUrl: string;
  readonly key: string;
}) {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(`${trimSlashes(input.baseUrl)}/models`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(input.key),
  );
  const response = yield* client.execute(request).pipe(Effect.timeout(MODELS_TIMEOUT));
  const ok = response.status >= 200 && response.status < 300;
  const models = ok
    ? parseApiServiceModels(yield* response.json.pipe(Effect.timeout(MODELS_TIMEOUT)))
    : [];
  return { status: response.status, models };
});

const encodeConfig = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** OpenCode 2 の設定。このインスタンスには、このサービスのモデルだけを出す。 */
export const apiServiceConfigContent = (input: {
  readonly name: string;
  readonly relay: ApiServiceRelay;
  readonly models: ReadonlyArray<ApiServiceModel>;
}): string =>
  encodeConfig({
    providers: {
      [API_SERVICE_PROVIDER_ID]: {
        name: input.name,
        package: "@opencode/ai/providers/openai-compatible",
        // 本物の接続先とキーは中継だけが持つ。
        settings: { baseURL: input.relay.url, apiKey: input.relay.token },
        models: Object.fromEntries(
          input.models.map((model) => [
            model.id,
            {
              name: model.id,
              limit: { context: model.context, output: model.output },
              capabilities: {
                tools: model.tools,
                input: model.vision ? ["text", "image"] : ["text"],
                output: ["text"],
              },
            },
          ]),
        ),
      },
    },
    policies: [
      { action: "provider.use", resource: "*", effect: "deny" },
      { action: "provider.use", resource: API_SERVICE_PROVIDER_ID, effect: "allow" },
    ],
  });

// Linux は環境変数 1 つが約 128 KiB を超えると起動できないので、余裕を残して切る。
const MAX_MODEL_BYTES = 96 * 1024;
const BYTES_PER_MODEL_ENTRY = 170;
export const withinEnvironmentLimit = (
  models: ReadonlyArray<ApiServiceModel>,
): ReadonlyArray<ApiServiceModel> => {
  let bytes = 0;
  return models.filter((model) => {
    // モデル名は設定のキーと名前の 2 か所に入る。
    bytes += BYTES_PER_MODEL_ENTRY + new TextEncoder().encode(model.id).length * 2;
    return bytes <= MAX_MODEL_BYTES;
  });
};

/** 手で足すモデル名は `k3-api/` を付けても付けなくても、同じモデルを指す。 */
export const apiServiceModelId = (value: string): string =>
  value.startsWith(`${API_SERVICE_PROVIDER_ID}/`)
    ? value.slice(API_SERVICE_PROVIDER_ID.length + 1)
    : value;

/**
 * 環境変数からキーを抜き取る。残りだけを子プロセスに渡す。Windows の環境変数名は大文字と小文字を
 * 区別しないので、表記違いも落とす。
 */
export const isApiServiceKeyName = (name: string) => name.toUpperCase() === API_SERVICE_KEY_ENV;
export const takeApiServiceKey = (environment: NodeJS.ProcessEnv) => {
  const entries = Object.entries(environment);
  return {
    key: entries.find(([name]) => isApiServiceKeyName(name))?.[1] ?? "",
    environment: Object.fromEntries(
      entries.filter(([name]) => !isApiServiceKeyName(name)),
    ) as NodeJS.ProcessEnv,
  };
};

// 利用者の HTTP プロキシ設定があっても、手元の中継へは直接つなぐ。
const bypassingProxy = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const current = environment["NO_PROXY"] ?? environment["no_proxy"];
  const value = current ? `${current},127.0.0.1` : "127.0.0.1";
  return { ...environment, NO_PROXY: value, no_proxy: value };
};

/**
 * OpenCode を起動する直前に呼ぶ。起動のたびに一覧を読むので、失敗は次の起動でやり直され、理由は
 * プロバイダーの状態に出る。一覧を持たないサービス（404・405）は、手で足したモデルだけで動かす。
 */
export const apiServiceStartEnvironment = Effect.fn("OpenCodeApiService.startEnvironment")(
  function* (input: {
    readonly service: { readonly name: string; readonly baseUrl: string };
    readonly customModels: ReadonlyArray<string>;
    readonly key: string;
    readonly relay: ApiServiceRelay;
    readonly environment: NodeJS.ProcessEnv;
  }) {
    const { name, baseUrl } = input.service;
    const { key, relay } = input;
    const fail = (detail: string) =>
      Effect.fail(
        new OpenCodeRuntimeError({ operation: "apiService.models", detail: `${name}: ${detail}` }),
      );
    if (!isAllowedApiServiceUrl(baseUrl)) {
      return yield* fail("接続先の URL が使えません。https の URL を指定してください。");
    }
    if (key === "") return yield* fail("API キーが登録されていません。");
    // 元の失敗にはキーを含む要求が入るので、外へは出さない。
    const { status, models: listed } = yield* fetchApiServiceModels({ baseUrl, key }).pipe(
      Effect.catch(() => fail("モデル一覧を取得できませんでした。接続を確認してください。")),
    );
    const noList = status === 404 || status === 405;
    if (status === 401 || status === 403) {
      return yield* fail(`API キーが認証されませんでした（HTTP ${status}）。`);
    }
    if (!noList && (status < 200 || status >= 300)) {
      return yield* fail(`モデル一覧を取得できませんでした（HTTP ${status}）。`);
    }
    const known = new Set(listed.map((model) => model.id));
    // 手で足したモデルを先にして、上限で切れないようにする。
    const models = withinEnvironmentLimit([
      ...input.customModels
        .map(apiServiceModelId)
        .filter((id) => !known.has(id))
        .map((id) => apiServiceModel(id)),
      ...listed,
    ]);
    if (models.length === 0) {
      return yield* fail("使えるモデルがありません。モデル名を手で追加してください。");
    }
    return {
      ...bypassingProxy(takeApiServiceKey(input.environment).environment),
      OPENCODE_CONFIG_CONTENT: apiServiceConfigContent({ name, relay, models }),
    } as NodeJS.ProcessEnv;
  },
);
