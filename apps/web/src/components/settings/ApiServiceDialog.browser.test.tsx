import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../hooks/useSettings";
import { readEnvironmentScope } from "../../state/session";
import { ApiServiceDialog } from "./ApiServiceDialog";

vi.mock("../../hooks/useSettings", { spy: true });
vi.mock("../../state/session", { spy: true });

describe("API サービスの追加画面", () => {
  it("送り先を見せたうえで、キーを秘密の値として登録する", async () => {
    const persist = vi.fn().mockResolvedValue({ _tag: "Success" });
    vi.mocked(usePersistEnvironmentProviderInstanceMutation).mockReturnValue(persist);
    vi.mocked(useEnvironmentSettings).mockReturnValue({ providerInstances: {} } as never);
    vi.mocked(readEnvironmentScope).mockReturnValue(true);
    const onClose = vi.fn();
    await using screen = await render(
      <ApiServiceDialog
        environmentId={EnvironmentId.make("local")}
        environmentLabel="このパソコン"
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Mistral", exact: true }));
    await expect
      .element(screen.getByLabelText("The key is sent to"))
      .toHaveValue("https://api.mistral.ai/v1");
    await userEvent.fill(screen.getByLabelText("API key"), "secret-key");
    // 見た目の定義がないテスト画面では背景の層がボタンに重なるので、Enter で送る。
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(persist).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        operation: "create",
        instanceId: "api_mistral",
        instance: expect.objectContaining({
          driver: "opencode",
          environment: [{ name: "K3_API_SERVICE_KEY", value: "secret-key", sensitive: true }],
        }),
      }),
    );
  });
});
