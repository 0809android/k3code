import {
  EnvironmentId,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { scopeThreadShell } from "./models.ts";
import { readAllOlderSettledThreads, settledShelfTargets } from "./olderSettledThreads.ts";

const environmentId = EnvironmentId.make("env");
const at = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const row = (id: string, tags?: ReadonlyArray<string>) =>
  ({
    id: ThreadId.make(id),
    tags,
    settledAt: at,
    createdAt: at,
    updatedAt: at,
    activityRunStartedAt: null,
    autoSettleDisabledAt: null,
    lastVisitedAt: null,
    latestRunCompletedAt: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestUserAuthoredMessageAt: null,
    latestUserMessageAt: null,
    pinnedAt: null,
    unsettledAt: null,
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    lineage: { parentThreadId: null },
    pendingRuntimeRequest: null,
    snoozedUntil: null,
    snoozedAt: null,
    archivedAt: null,
    deletedAt: null,
    status: "idle",
  }) as unknown as OrchestrationV2ThreadShell;
const rows = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => row(`t${from + index}`));
const page = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) => ({
  snapshotSequence: 1,
  threads: [...threads],
  counts: [],
});
const base = {
  scopes: [{ environmentId, projectIds: null }],
  cutOf: () => "2026-02-01T00:00:00.000Z",
  isLoaded: () => false,
  hiddenTagsOf: () => null,
  hidingAnywhere: false,
  now: "2026-03-01T00:00:00.000Z",
};

describe("readAllOlderSettledThreads", () => {
  it("区切りより古い分を、最後の行を起点に全ページ読む", async () => {
    const cursors: Array<unknown> = [];
    const result = await readAllOlderSettledThreads({
      ...base,
      readPage: async (_, input) => {
        cursors.push(input.before);
        return page(cursors.length === 1 ? rows(0, 50) : rows(50, 3));
      },
    });
    expect(result).toHaveLength(53);
    expect(cursors).toEqual([
      { settledAt: "2026-02-01T00:00:00.000Z" },
      { settledAt: "2026-01-01T00:00:00.000Z", threadId: "t49" },
    ]);
  });

  it("タグで隠したものと、一覧に出ない委任タスクは除く", async () => {
    const delegated = (id: string, parent: string) =>
      ({
        ...row(id),
        delegatedFrom: { environmentId, threadId: ThreadId.make(parent) },
      }) as OrchestrationV2ThreadShell;
    const read = (hidingAnywhere: boolean) =>
      readAllOlderSettledThreads({
        ...base,
        isLoaded: (ref) => ref.threadId === "parent",
        hiddenTagsOf: () => (hidingAnywhere ? ["secret"] : null),
        hidingAnywhere,
        readPage: async () =>
          page([
            row("hidden", ["secret"]),
            delegated("under-loaded", "parent"),
            delegated("orphan", "missing"),
          ]),
      });
    expect((await read(false))?.map((thread) => thread.id)).toEqual(["hidden", "orphan"]);
    expect((await read(true))?.map((thread) => thread.id)).toEqual([]);
  });

  it("一覧に出ないワークフローの工程は除く", async () => {
    const step = {
      ...row("step"),
      lineage: { parentThreadId: ThreadId.make("parent"), workflowStep: true },
    } as unknown as OrchestrationV2ThreadShell;
    const result = await readAllOlderSettledThreads({
      ...base,
      readPage: async () => page([step, row("kept")]),
    });
    expect(result?.map((thread) => thread.id)).toEqual(["kept"]);
  });

  it("途中のページで失敗したら、何も対象にしない", async () => {
    let reads = 0;
    const result = await readAllOlderSettledThreads({
      ...base,
      readPage: async () => (++reads === 1 ? page(rows(0, 50)) : null),
    });
    expect(result).toBeNull();
  });
});

describe("settledShelfTargets", () => {
  it("重複なく合わせ、外れたものと、手元になく古い分にも出ないものは除く", () => {
    const shell = (id: string, settled: boolean, projectId = "project") =>
      scopeThreadShell(environmentId, {
        ...row(id),
        projectId: ProjectId.make(projectId),
        settledOverride: settled ? "settled" : null,
      } as OrchestrationV2ThreadShell);
    const loaded = new Map([
      ["kept", shell("kept", true)],
      ["unsettled", shell("unsettled", false)],
    ]);
    const result = settledShelfTargets({
      loaded: ["kept", "unsettled", "archived", "older"].map((id) => ({
        environmentId,
        threadId: ThreadId.make(id),
      })),
      currentOf: (ref) => loaded.get(ref.threadId) ?? null,
      older: [shell("older", true), shell("kept", true), shell("other-project", true, "other")],
      scopes: [{ environmentId, projectIds: [ProjectId.make("project")] }],
      now: "2026-03-01T00:00:00.000Z",
    });
    expect(result.map((thread) => thread.id)).toEqual(["kept", "older"]);
  });
});
