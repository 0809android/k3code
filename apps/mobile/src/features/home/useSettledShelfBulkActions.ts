import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type OlderSettledScope,
  readAllOlderSettledThreads,
  settledShelfTargets,
} from "@t3tools/client-runtime/state/threads";
import { msg } from "gt-react-native";
import { useLayoutEffect, useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { orchestrationEnvironment } from "../../state/orchestration";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells, olderSettledThreads } from "../../state/threads";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { queuedThreadKeysAtom } from "../../state/use-thread-outbox";
import {
  actionFailureTitle,
  checkThreadOperationPermission,
  useThreadActionExecutor,
} from "./useThreadListActions";

/** 一覧の範囲にある対応済みスレッドを、読み込んでいない分も含めてアーカイブ・削除する。 */
export function useSettledShelfBulkActions(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly scopes: ReadonlyArray<OlderSettledScope>;
}) {
  const executeAction = useThreadActionExecutor();
  const loadPage = useAtomQueryRunner(orchestrationEnvironment.olderSettledThreads, {
    reportFailure: false,
    refresh: true,
  });
  const running = useRef(false);

  const latestInput = useRef(input);

  // 接続していない環境は操作できないので外す。送信待ちのあるスレッドは受信箱に出るので対象にしない。
  const collect = async () => {
    const connected = new Set(appAtomRegistry.get(connectedEnvironmentIdsAtom));
    const { scopes, threads: threadsAtStart } = latestInput.current;
    const cutOf = (environmentId: EnvironmentId) =>
      appAtomRegistry.get(olderSettledThreads.olderSettledAtom(environmentId))?.before ?? null;
    const liveThreads = () =>
      new Map(
        appAtomRegistry
          .get(environmentThreadShells.threadShellsAtom)
          .map((thread) => [scopedThreadKey(thread.environmentId, thread.id), thread] as const),
      );
    const loadedAtStart = liveThreads();
    const older = await readAllOlderSettledThreads({
      scopes: scopes.filter((scope) => connected.has(scope.environmentId)),
      cutOf,
      readPage: async (environmentId, page) => {
        const result = await loadPage({ environmentId, input: page });
        return result._tag === "Success" ? result.value : null;
      },
      isLoaded: (ref) => loadedAtStart.has(scopedThreadKey(ref.environmentId, ref.threadId)),
      hiddenTagsOf: (environmentId) =>
        appAtomRegistry.get(serverEnvironment.hiddenThreadTagsAtom(environmentId)),
      hidingAnywhere: appAtomRegistry.get(environmentThreadShells.anyEnvironmentHidingAtom),
      now: new Date().toISOString(),
    });
    if (older === null) return null;
    const loaded = liveThreads();
    const queued = appAtomRegistry.get(queuedThreadKeysAtom);
    const all = settledShelfTargets({
      // 読み込み中にページが増えることがあるので、開始時と最新の両方の行を合わせる。
      loaded: [...threadsAtStart, ...latestInput.current.threads].map((thread) => ({
        environmentId: thread.environmentId,
        threadId: thread.id,
      })),
      older,
      scopes,
      currentOf: (ref) => loaded.get(scopedThreadKey(ref.environmentId, ref.threadId)) ?? null,
      now: new Date().toISOString(),
    }).filter((thread) => !queued.has(`${thread.environmentId}:${thread.id}`));
    const threads = all.filter((thread) => connected.has(thread.environmentId));
    const leftOut =
      threads.length < all.length ||
      scopes.some(
        (scope) => !connected.has(scope.environmentId) && cutOf(scope.environmentId) !== null,
      );
    return { threads, leftOut };
  };

  const apply = async (
    action: "archive" | "delete",
    targets: ReadonlyArray<EnvironmentThreadShell>,
  ) => {
    // 確認中に、ほかの端末で状況が変わることがあるので読み直し、確認した範囲だけを処理する。
    const latestTargets = await collect();
    if (latestTargets === null) {
      Dialog.alert(actionFailureTitle(action), m(msg("Could not load older threads")));
      return;
    }
    const confirmed = new Set(
      targets.map((thread) => scopedThreadKey(thread.environmentId, thread.id)),
    );
    let failed = 0;
    for (const thread of latestTargets.threads) {
      if (!confirmed.has(scopedThreadKey(thread.environmentId, thread.id))) continue;
      if (!(await executeAction(action, thread, undefined, undefined, true))) failed += 1;
    }
    if (failed > 0) {
      Dialog.alert(
        actionFailureTitle(action),
        m(
          msg("{count, plural, one {{count} thread failed.} other {{count} threads failed.}}", {
            count: failed,
          }),
        ),
      );
    }
  };

  const run = async (action: "archive" | "delete") => {
    if (running.current) return;
    running.current = true;
    const collected = await collect();
    running.current = false;
    if (collected === null) {
      Dialog.alert(actionFailureTitle(action), m(msg("Could not load older threads")));
      return;
    }
    const { threads: targets, leftOut } = collected;
    const leftOutNote = leftOut
      ? m(msg("Threads on disconnected environments are not included."))
      : null;
    if (targets.length === 0) {
      if (leftOutNote !== null) Dialog.alert(actionFailureTitle(action), leftOutNote);
      return;
    }
    if (
      !targets.every((thread) => checkThreadOperationPermission(thread, actionFailureTitle(action)))
    )
      return;
    const count = targets.length;
    // 区分全体に効くので、必ず確認する。
    Dialog.confirm({
      title:
        action === "archive"
          ? m(
              msg(
                "{count, plural, one {Archive {count} settled thread?} other {Archive {count} settled threads?}}",
                { count },
              ),
            )
          : m(
              msg(
                "{count, plural, one {Delete {count} settled thread?} other {Delete {count} settled threads?}}",
                { count },
              ),
            ),
      message: [
        action === "archive"
          ? m(msg("Archived threads can be restored from Settings."))
          : m(msg("This permanently clears conversation history for these threads.")),
        ...(leftOutNote === null ? [] : [leftOutNote]),
      ].join("\n"),
      confirmText:
        action === "archive"
          ? m(msg("Archive", { $context: "verb, thread action" }))
          : m(msg("Delete", { $context: "verb, confirms deleting a thread" })),
      destructive: action === "delete",
      onConfirm: () => {
        if (running.current) return;
        running.current = true;
        void apply(action, targets).finally(() => {
          running.current = false;
        });
      },
    });
  };

  // 見出しは使い回されるセルにあるので、押した時点の範囲を読むようにする。
  const latest = useRef(run);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- 使い回されるセルが持つ処理を、確定した最新の範囲に合わせ続ける
  useLayoutEffect(() => {
    latest.current = run;
    latestInput.current = input;
  });
  const [actions] = useState(() => ({
    archiveAll: () => void latest.current("archive"),
    deleteAll: () => void latest.current("delete"),
  }));
  return actions;
}
