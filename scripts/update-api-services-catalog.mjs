// models.dev から「API サービスを追加」の一覧を作り直す。使い方: node scripts/update-api-services-catalog.mjs
// 接続先はキーの送り先になるので、実行後は差分を確認してから取り込む。
import * as NodeFS from "node:fs";

const response = await fetch("https://models.dev/api.json");
if (!response.ok) throw new Error(`models.dev: HTTP ${response.status}`);

const services = Object.entries(await response.json())
  .flatMap(([id, provider]) => {
    const { name, api, npm } = provider;
    // OpenAI 互換で、接続先が固定のものだけを載せる。
    const compatible = npm === "@ai-sdk/openai-compatible" || npm === "@openrouter/ai-sdk-provider";
    if (
      !compatible ||
      typeof api !== "string" ||
      !api.startsWith("https://") ||
      api.includes("${")
    ) {
      return [];
    }
    return [[id, name, api.replace(/\/+$/, "")]];
  })
  .toSorted((left, right) => left[1].localeCompare(right[1], "en"));

const target = new URL(
  "../apps/web/src/components/settings/apiServicesCatalog.json",
  import.meta.url,
);
NodeFS.writeFileSync(
  target,
  `[\n${services.map((row) => `  ${JSON.stringify(row)}`).join(",\n")}\n]\n`,
);
console.log(`${services.length} 件を書き出しました`);
