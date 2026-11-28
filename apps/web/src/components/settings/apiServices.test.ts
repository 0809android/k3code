import { describe, expect, it } from "vite-plus/test";

import {
  API_SERVICES,
  apiServiceInstance,
  apiServiceInstanceId,
  isAllowedApiServiceUrl,
  readApiService,
  refreshedApiServiceConfig,
  searchApiServices,
} from "./apiServices";

describe("API サービスの一覧", () => {
  it("何も入力しなければ、よく使うものを出す", () => {
    expect(
      searchApiServices("")
        .slice(0, 3)
        .map((service) => service.id),
    ).toEqual(["opendesign", "mistral", "kinocode"]);
  });

  it("全サービスから検索でき、接続先はすべて許可できる形で、ID は重複しない", () => {
    expect(searchApiServices("openrouter").map((service) => service.id)).toContain("openrouter");
    expect(API_SERVICES.length).toBeGreaterThan(100);
    expect(API_SERVICES.filter((service) => !isAllowedApiServiceUrl(service.baseUrl))).toEqual([]);
    expect(new Set(API_SERVICES.map((service) => service.id)).size).toBe(API_SERVICES.length);
  });
});

describe("apiServiceInstance", () => {
  it("キーは設定に入れず、秘密の環境変数にする", () => {
    const instance = apiServiceInstance({
      service: { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
      key: "secret",
    });
    expect(instance.driver).toBe("opencode");
    expect(JSON.stringify(instance.config)).not.toContain("secret");
    expect(instance.environment).toEqual([
      { name: "K3_API_SERVICE_KEY", value: "secret", sensitive: true },
    ]);
  });

  it("使われているインスタンス ID を避ける", () => {
    expect(apiServiceInstanceId("zai.coding", new Set())).toBe("api_zai-coding");
    expect(apiServiceInstanceId("mistral", new Set(["api_mistral", "api_mistral_2"]))).toBe(
      "api_mistral_3",
    );
  });
});

describe("refreshedApiServiceConfig", () => {
  it("接続先を変えずに、読み直しの番号だけを増やす", () => {
    const config = { apiService: { id: "a", name: "A", baseUrl: "https://a.example/v1" } };
    const next = refreshedApiServiceConfig(refreshedApiServiceConfig(config));
    expect(readApiService(next)).toEqual({ ...config.apiService, modelsRevision: 2 });
    expect(refreshedApiServiceConfig({})).toBeNull();
  });
});
