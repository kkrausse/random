# Integration handoff

Owned scope: only `browser-container-poc/opencode-chat/`.

Package is `@vivari/opencode-chat@0.1.0`, ESM, locally packable with Bun. It has
no VM/workspace dependency. Pin: **OpenCode dev-19167 / d7a7256bb6b0952f486c95718cfbf460b1570a56**.

```tsx
import { createChatController, type ChatController } from '@vivari/opencode-chat';
import { ChatView } from '@vivari/opencode-chat/react';
import '@vivari/opencode-chat/styles.css';

const controller = createChatController({
  endpoint: {url: endpoint.url, fetch: (input, init) => endpoint.fetch(input, init)},
  directory: '/workspace', // use the host's real hidden directory
  // sessionID, // optional; otherwise selects first existing session
  // autoCreateSession: true, // opt-in only, default false
});
await controller.ready;

<ChatView controller={controller} showSessions showModels onOpenFile={openFile} />;
// openFile: (path:string, selection?:{startLine:number,endLine:number}) => void
// Give the containing panel a bounded height; .oc-chat fills it.

// On host endpoint replacement/reset/exit, dispose the old local controller:
controller.dispose();
```

Keep a controller per endpoint scope; do not recreate inside React render.
View cleanup only unsubscribes. The controller never disposes/stops endpoint,
workspace or server and never interrupts on unmount. `interrupt()` is explicit.
Catch `ready` for host startup errors; snapshot also carries visible errors.
Root works without React installed. `/react` has React >=18 optional peer.
CSS is explicit and scoped. No directory picker or shell routes/actions.

Public controller: `getSnapshot`, `subscribe`, `ready`, `selectSession`,
`createSession`, `loadOlder`, `send({text})`, `selectModel({providerID,id})`,
`interrupt`, `reconnect`, `replyPermission`, `replyQuestion`, `rejectQuestion`,
`clearError`, `dispose`. Full field definitions are in `src/types.ts` and built
declarations. All actions are promises except subscribe/snapshot/clear/dispose.

`ChatView` props are exactly `{controller,showSessions?,showModels?,onOpenFile?}`.
Useful optional exports: `useChatSnapshot`, `Transcript`, `Composer`,
`MessagePart`, `ToolCard`, `PermissionCard`, `QuestionCard`, `Markdown`, `CodeBlock`.
Native file/tool path callbacks open host files; no attachment upload controls.
Selecting `undefined` model rejects (pinned API cannot reset a session model).

Checks: `bun run typecheck`, `bun test`, `bun run build`,
`bun test/consumer-smoke.ts`. The last packs the package and installs separate
headless-without-React and React consumers outside the repository; it checks
declarations, browser bundle/CSS closure and React SSR.

Latest verification: **21 tests passed / 73 assertions**, typecheck and build
passed; packed headless consumer compiled with full declaration checking and
without React installed; packed React consumer bundled and SSR-rendered.

Fixture-tested native reducer, bootstrap/selection races, overlapping history
without duplicated deltas, pending requests/failure/retry, authoritative
interruption, disconnect/reconnect, pagination, disposal and markup safety.

Fresh QA should verify real pinned guest streaming/tools, file callback,
permission/question replies, stop/reconnect, clipboard, IME, scrolling and
visual layout. No live browser/guest validation was claimed here. Browser
extension disconnected per parent update. No attachment uploads, syntax
highlighting, virtualization or worker Markdown pipeline are implemented.
