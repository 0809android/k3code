// @effect-diagnostics nodeBuiltinImport:off - 手元だけで待ち受け、応答を流したまま返すために node:http を使う。
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeStream from "node:stream";

import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";

import { OpenCodeRuntimeError } from "./OpenCodeRuntime.ts";

// 接続そのものに属する項目は、中継の先へ持ち越さない。
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const endToEnd = (headers: NodeHttp.IncomingHttpHeaders): NodeHttp.OutgoingHttpHeaders =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_HEADERS.has(name)));

const refuse = (response: NodeHttp.ServerResponse, status: number, message: string) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message } }));
};

/**
 * OpenCode には本物のキーを渡さない。環境変数で渡すと、エージェントが実行するコマンドや MCP
 * サーバーにも引き継がれる。代わりに OpenCode をこの中継へ向け、合言葉を持つ要求にだけキーを足す。
 * 中継の先は登録した接続先だけで、スコープが閉じると止まる。
 */
export const makeApiServiceRelay = Effect.fn("OpenCodeApiService.relay")(function* (input: {
  readonly baseUrl: string;
  readonly key: string;
}) {
  const random = yield* SecureRandom.SecureRandom;
  const token = Base64Url.encode(yield* random.randomBytes(32));
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const origin = URL.parse(base)?.origin;

  const forward = (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      return refuse(response, 401, "中継の合言葉が違います。");
    }
    // 経路は接続先の後ろに足すだけにして、別のホストへキーが向かないようにする。
    const path = request.url ?? "";
    const target = path.startsWith("/") ? URL.parse(`${base}${path}`) : null;
    if (target === null || target.origin !== origin) {
      return refuse(response, 400, "中継できない宛先です。");
    }
    const { host: _host, authorization: _token, ...headers } = request.headers;
    const upstream = (target.protocol === "https:" ? NodeHttps : NodeHttp).request(target, {
      method: request.method,
      headers: { ...endToEnd(headers), authorization: `Bearer ${input.key}` },
    });
    upstream.once("response", (answer) => {
      response.writeHead(answer.statusCode ?? 502, endToEnd(answer.headers));
      response.flushHeaders();
      NodeStream.pipeline(answer, response, () => {});
    });
    upstream.on("error", () => {
      if (response.headersSent) response.destroy();
      else refuse(response, 502, "API サービスに接続できませんでした。");
    });
    // 途中で止められたら、サービス側の生成も止める。
    response.once("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
  };

  const server = yield* Effect.acquireRelease(
    Effect.callback<NodeHttp.Server, OpenCodeRuntimeError>((resume) => {
      const instance = NodeHttp.createServer(forward);
      instance.once("error", (cause) =>
        resume(
          Effect.fail(
            new OpenCodeRuntimeError({
              operation: "apiService.relay",
              detail: "API サービスへの中継を始められませんでした。",
              cause,
            }),
          ),
        ),
      );
      instance.listen(0, "127.0.0.1", () => resume(Effect.succeed(instance)));
    }),
    (instance) =>
      Effect.sync(() => {
        instance.closeAllConnections();
        instance.close();
      }),
  );
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, token };
});

export type ApiServiceRelay = Effect.Success<ReturnType<typeof makeApiServiceRelay>>;
