// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - 手元の偽のサービスを node:http で立て、素の要求を送る。
import * as NodeHttp from "node:http";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { makeApiServiceRelay } from "./apiServiceRelay.ts";

/** 届いた要求を覚えて、2 回に分けて返事を流す偽のサービス。 */
const fakeService = Effect.gen(function* () {
  const received: Array<{ url: string; authorization: string; body: string }> = [];
  const server = yield* Effect.acquireRelease(
    Effect.callback<NodeHttp.Server>((resume) => {
      const instance = NodeHttp.createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          received.push({
            url: request.url ?? "",
            authorization: request.headers.authorization ?? "",
            body,
          });
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.write("data: one\n\n");
          response.end("data: two\n\n");
        });
      });
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
  return { received, baseUrl: `http://127.0.0.1:${port}/v1` };
});

const send = (url: string, token: string) =>
  Effect.promise(async () => {
    const response = await fetch(`${url}/chat/completions?x=1`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: '{"model":"m"}',
    });
    return { status: response.status, text: await response.text() };
  });

describe("makeApiServiceRelay", () => {
  it.live("合言葉を持つ要求にだけキーを足して、返事をそのまま返す", () =>
    Effect.gen(function* () {
      const service = yield* fakeService;
      const relay = yield* makeApiServiceRelay({ baseUrl: `${service.baseUrl}/`, key: "real-key" });

      expect(yield* send(relay.url, relay.token)).toEqual({
        status: 200,
        text: "data: one\n\ndata: two\n\n",
      });
      expect(service.received).toEqual([
        {
          url: "/v1/chat/completions?x=1",
          authorization: "Bearer real-key",
          body: '{"model":"m"}',
        },
      ]);

      expect((yield* send(relay.url, "wrong")).status).toBe(401);
      expect(service.received).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeCrypto.layer)),
  );

  it.live("接続できないサービスは、キーを含まない失敗にする", () =>
    Effect.gen(function* () {
      const relay = yield* makeApiServiceRelay({ baseUrl: "http://127.0.0.1:1", key: "real-key" });
      const answer = yield* send(relay.url, relay.token);
      expect(answer.status).toBe(502);
      expect(answer.text).not.toContain("real-key");
    }).pipe(Effect.scoped, Effect.provide(NodeCrypto.layer)),
  );
});
