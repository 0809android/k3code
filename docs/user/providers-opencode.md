# OpenCode

Install and authenticate OpenCode on the machine running your environment, then
enable it in **Settings > Providers**. See [provider setup](./install.md#providers).
K3 Code requires OpenCode 1.14.19 or newer, including when you connect an existing
OpenCode server.

## OpenCode 2

K3 Code supports OpenCode 2.0.18 and newer. It detects the version on its own, so
the same provider settings work for OpenCode 1.x and 2.x. OpenCode 1.x shows
**Limited support** in its provider settings.

OpenCode 2 is a separate package, `@opencode/cli`. To move from 1.x, install it
yourself, for example `npm install -g @opencode/cli`. Then refresh provider status.
K3 Code's update button updates whichever package you have installed. It never
switches a 1.x install to 2.x.

OpenCode 2 converts the shared OpenCode database to its own format the first time it
runs. Don't run OpenCode 1.x and 2.x side by side on the same machine. Threads you
started on 1.x continue on 2.x.

## Compaction

OpenCode compacts long conversations itself, and K3 Code has no setting for it. On
OpenCode 2, change it under `compaction` in an OpenCode configuration file, such as
`opencode.json`: `auto` turns
automatic compaction on or off, `buffer` sets the token headroom, and `keep.tokens`
sets how much recent context stays. OpenCode 1.x configures compaction differently.
Send `/compact` to compact a thread yourself.

## Local or external server

Leave **Server URL** empty to let K3 Code start OpenCode locally. A password in
provider settings applies to both that server and K3 Code's connection. With no
password setting, the local server uses `OPENCODE_SERVER_PASSWORD` from its
environment.

To use an existing OpenCode server, set **Server URL** and its password in provider
settings. K3 Code uses only that configured password for an external server; it
does not forward a local `OPENCODE_SERVER_PASSWORD`. If connection or version checks
fail, check the URL, credentials, and OpenCode version, then refresh provider status.

When **Server URL** points to a locally running server (such as `127.0.0.1`),
the update button upgrades its installed CLI. If that server is this machine's
OpenCode background service, K3 Code then restarts it on the new version. The URL
must use the service's own protocol, host, and port. For a service listening on
`0.0.0.0` use `127.0.0.1`, and for `[::]` use `[::1]`.

Restarting interrupts running turns, and the service then runs with K3 Code's
environment. Set any variables it needs with `opencode service set env <name> <value>`.

K3 Code does not restart any other server, including the background service
reached through `localhost`. That server can still report the previous version
until you restart it. For a loopback URL, K3 Code shows that restart requirement
instead of treating the CLI update as a failure.

K3 Code waits for a local server it started to recover after a lost connection.
You can stop the turn while it reconnects. If the server exits or an external
connection cannot be restored, send another prompt to resume the same OpenCode
session.

## Approvals

OpenCode follows the shared [permission modes](./permission-modes.md). **Auto** has
the same rules as **Supervised** because OpenCode has no AI approval reviewer.
Environment files such as `.env` and `.env.local` need approval in restricted
modes even though normal file reads do not; `.env.example` is allowed.

**Allow for workspace** applies to matching requests in other OpenCode sessions
using the same workspace. It is broader than the current thread, especially on a
shared external server. Use **Allow once** for a single request. Denying an action
does not stop the whole turn.

## Refresh models, commands, and skills

After changing an OpenCode login or configuration, use **Refresh provider status**
in **Settings > Providers** for that environment. On mobile, use **Refresh models**
in the thread settings. Reconnecting also refreshes the catalog; periodic provider
health checks do not.

Credential changes are read on refresh. Native OpenCode configuration can remain
cached while the local helper is running. Let it sit for 30 seconds without model
refreshes or text-generation work, then refresh again to reload the files. Repeated
refreshes keep the helper alive. An external server may need its own reload or
restart before K3 Code can see configuration changes.

Models defined in a project's own `opencode.json` appear only in that project's
model picker, after K3 Code reads the project's catalog the first time the picker
opens there.

Existing threads keep their selected model and options even when it disappears
from the catalog. If OpenCode rejects that model, select an available one and retry.

## API キーで使うサービス

OpenDesign、Mistral、キノコードなどの API サービスは、**設定 → プロバイダー**の**API サービスを追加**
から、サービスを選んでキーを貼るだけで使えます。モデル選択欄の下からも開けます。一覧にない OpenAI
互換のサービスは、接続先の URL を入力して追加します。OpenCode 2 が必要です。

- モデルは裏で OpenCode が動かします。手元の OpenCode の設定ファイルは書き換えません。
- キーは K3 Code のサーバーに保存し、表示した接続先にだけ送ります。接続先は登録後に変わりません。
  OpenCode や、エージェントが実行するコマンドには渡しません。
- モデル一覧はサービスから読みます。新しいモデルが出たら、設定のカードの**モデル一覧を更新**を押して
  ください。一覧を返さないサービスは、モデル名を手で追加します。
- 同じモデルの別名は 1 つにまとめて表示します。ほかの名前を使いたいときは、手で追加します。
- どのサービスでもエージェントが正しく動くとは限りません。ツールを呼び出せないモデルもあります。
