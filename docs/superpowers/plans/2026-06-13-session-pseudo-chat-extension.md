# Session Pseudo Chat Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the existing session pseudo chat into the `packages/talk` Git submodule while preserving current API paths, UI behavior, and D10 isolation checks.

**Architecture:** `packages/talk` owns the pseudo-chat API service, API route matcher, and miniprogram components. The main repository keeps stable adapters: a backend extension registry, a backend `session-access` module for shared authorization helpers, and miniprogram extension mount files. Core session logic calls extension hooks for chat side effects instead of knowing chat table details.

**Tech Stack:** Node.js ESM, mysql2, uni-app Vue single-file components, npm workspaces, Git submodules.

**Execution Constraint:** Do not create a clean git worktree for this execution. The approved spec depends on the current dirty workspace, where D10 pseudo-chat source files are present but not all committed. Work in the current branch and keep edits scoped to the files listed below.

---

## Spec Checklist

- [ ] Add `packages/talk` as a Git submodule pointing to `git@github.com:jubenmi/talk.git`.
- [ ] Expose `@jubenmi/talk/api` and `@jubenmi/talk/miniprogram` from `packages/talk`.
- [ ] Move chat room, message, pinned-message, and system-message implementation out of `apps/api/src/modules/core/service.js`.
- [ ] Keep public API paths unchanged: `/api/sessions/:id/chat`, `/api/sessions/:id/messages`, `/api/sessions/:id/chat/pin`.
- [ ] Move detail-page chat UI into `packages/talk/miniprogram/ChatEntry.vue`.
- [ ] Move manage-page pinned message UI into `packages/talk/miniprogram/ManagePinnedMessage.vue`.
- [ ] Keep current database migrations unchanged.
- [ ] Update static checks to verify the extension/submodule boundary.
- [ ] Run `npm run check`; run `npm run d10:smoke` if the local API and database environment are available.

## Files

- Create: `.gitmodules`
- Create: `packages/talk/package.json`
- Create: `packages/talk/api/index.js`
- Create: `packages/talk/api/service.js`
- Create: `packages/talk/api/routes.js`
- Create: `packages/talk/miniprogram/index.js`
- Create: `packages/talk/miniprogram/api.js`
- Create: `packages/talk/miniprogram/ChatEntry.vue`
- Create: `packages/talk/miniprogram/ManagePinnedMessage.vue`
- Create: `apps/api/src/modules/core/session-access.js`
- Create: `apps/api/src/modules/extensions/registry.js`
- Create: `apps/api/src/modules/extensions/session-pseudo-chat/index.js`
- Create: `apps/miniprogram/src/extensions/sessionExtensions.js`
- Create: `apps/miniprogram/src/extensions/session-pseudo-chat/index.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/package.json`
- Modify: `apps/miniprogram/package.json`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `apps/miniprogram/src/pages/session/manage.vue`
- Modify: `scripts/d10-pseudo-chat-check.js`
- Modify: `scripts/check-miniprogram.js`

---

### Task 1: Add Talk Submodule And Workspace Package

**Files:**
- Create: `.gitmodules`
- Create: `packages/talk/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/package.json`
- Modify: `apps/miniprogram/package.json`

- [ ] **Step 1: Run current static check to capture RED**

Run: `node scripts/d10-pseudo-chat-check.js`

Expected before implementation: FAIL because `.gitmodules`, `packages/talk/api`, and `packages/talk/miniprogram` do not exist yet after the check script is updated in Task 2. If running before Task 2, record the current output and continue.

- [ ] **Step 2: Add submodule**

Run: `git submodule add git@github.com:jubenmi/talk.git packages/talk`

Expected: `.gitmodules` is created or updated with:

```ini
[submodule "packages/talk"]
	path = packages/talk
	url = git@github.com:jubenmi/talk.git
```

If the remote is empty and Git reports an unborn branch, initialize `packages/talk` with the package files in the next step, then commit and push inside `packages/talk`.

- [ ] **Step 3: Add package metadata inside submodule**

Create `packages/talk/package.json` with:

```json
{
  "name": "@jubenmi/talk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./api": "./api/index.js",
    "./miniprogram": "./miniprogram/index.js"
  }
}
```

- [ ] **Step 4: Register workspace and consuming dependencies**

Update root `package.json` workspaces to include:

```json
"packages/talk"
```

Update `apps/api/package.json` dependencies to include:

```json
"@jubenmi/talk": "file:../../packages/talk"
```

Update `apps/miniprogram/package.json` dependencies to include:

```json
"@jubenmi/talk": "file:../../packages/talk"
```

- [ ] **Step 5: Refresh npm lockfile**

Run: `npm install`

Expected: `package-lock.json` includes `packages/talk` and workspace links for `apps/api/node_modules/@jubenmi/talk` and `apps/miniprogram/node_modules/@jubenmi/talk`.

- [ ] **Step 6: Commit submodule initial package**

Inside `packages/talk`, run:

```bash
git add package.json
git commit -m "Initialize talk extension package"
git push -u origin HEAD
```

Expected: the remote has the initial package commit and the parent repository can record a submodule pointer.

---

### Task 2: Update Static Checks First

**Files:**
- Modify: `scripts/d10-pseudo-chat-check.js`
- Modify: `scripts/check-miniprogram.js`

- [ ] **Step 1: Update D10 check for submodule boundary**

Change `scripts/d10-pseudo-chat-check.js` so it checks:

```js
mustInclude(".gitmodules", "packages/talk");
mustInclude(".gitmodules", "git@github.com:jubenmi/talk.git");
mustInclude("package.json", "packages/talk");
mustInclude("apps/api/package.json", "@jubenmi/talk");
mustInclude("apps/miniprogram/package.json", "@jubenmi/talk");
mustInclude("packages/talk/package.json", "@jubenmi/talk");
mustInclude("packages/talk/api/index.js", "sessionPseudoChatExtension");
mustInclude("packages/talk/api/service.js", "getSessionChat");
mustInclude("packages/talk/api/routes.js", "/chat/pin");
mustInclude("packages/talk/miniprogram/ChatEntry.vue", "chat-float-button");
mustInclude("packages/talk/miniprogram/ManagePinnedMessage.vue", "/chat/pin");
mustInclude("apps/api/src/modules/extensions/registry.js", "sessionExtensions");
mustInclude("apps/miniprogram/src/extensions/sessionExtensions.js", "sessionDetailExtensions");
```

Replace old expectations that required `chat-float-button`, `chat-modal-mask`, `messages`, or `/chat/pin` to live directly in `detail.vue` or `manage.vue`.

- [ ] **Step 2: Update miniprogram static check**

Change `scripts/check-miniprogram.js` so the pseudo-chat checks expect:

```js
"apps/miniprogram/src/extensions/sessionExtensions.js"
"apps/miniprogram/src/extensions/session-pseudo-chat/index.js"
"packages/talk/miniprogram/ChatEntry.vue"
"packages/talk/miniprogram/ManagePinnedMessage.vue"
```

and keep setup/create-flow checks for `pinnedMessageText` and `/chat/pin` where they belong to session creation setup.

- [ ] **Step 3: Run RED check**

Run: `node scripts/d10-pseudo-chat-check.js`

Expected: FAIL until backend and frontend extension files are created. The failure should mention a missing extension file or moved symbol, not a JavaScript syntax error.

---

### Task 3: Extract Backend Chat Extension

**Files:**
- Create: `apps/api/src/modules/core/session-access.js`
- Create: `apps/api/src/modules/extensions/registry.js`
- Create: `apps/api/src/modules/extensions/session-pseudo-chat/index.js`
- Create: `packages/talk/api/index.js`
- Create: `packages/talk/api/service.js`
- Create: `packages/talk/api/routes.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Create core session access module**

Create `apps/api/src/modules/core/session-access.js` with exported shared helpers:

```js
import { forbidden, notFound } from "../../http/errors.js";

export function isAdmin(user) {
  return user.roles.includes("system_admin");
}

export async function findSessionById(connection, sessionId) {
  const [rows] = await connection.query("SELECT * FROM sessions WHERE id = ?", [
    sessionId
  ]);
  return rows[0] || null;
}

export async function requireSessionOwner(connection, sessionId, user) {
  const session = await findSessionById(connection, sessionId);
  if (!session) {
    throw notFound("Session not found");
  }
  if (!isAdmin(user) && Number(session.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
  return session;
}

export async function requireSessionParticipant(connection, sessionId, user) {
  const session = await findSessionById(connection, sessionId);
  if (!session) {
    throw notFound("Session not found");
  }
  if (isAdmin(user) || Number(session.organizer_user_id) === Number(user.user.id)) {
    return session;
  }

  const [rows] = await connection.query(
    `
      SELECT id
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND status IN ('confirmed', 'locked')
      LIMIT 1
    `,
    [sessionId, user.user.id]
  );
  if (rows.length === 0) {
    throw forbidden("Only onboard players can use session messages");
  }
  return session;
}
```

- [ ] **Step 2: Create talk API service**

Move the current chat-specific helper implementations from `apps/api/src/modules/core/service.js` into `packages/talk/api/service.js`: `messageContent`, `formatSessionDateTime`, `defaultPinnedMessageForSession`, `pinnedMessageContent`, `messageRow`, `roomRow`, `ensureSessionChatRoom`, `selectMessageById`, `listRoomMessages`, `getRoomPinnedMessage`, `upsertPinnedMessage`, `createSystemSessionMessage`, `getSessionChat`, `listSessionMessages`, `createSessionMessage`, `updateSessionPinnedMessage`, and `ensureDefaultPinnedMessage`.

`packages/talk/api/service.js` must import dependencies from the host:

```js
import { withDatabaseConnection, withTransaction } from "../../../apps/api/src/db/mysql.js";
import { badRequest } from "../../../apps/api/src/http/errors.js";
import {
  requireSessionOwner,
  requireSessionParticipant
} from "../../../apps/api/src/modules/core/session-access.js";
```

Export at least:

```js
export {
  createSystemSessionMessage,
  createSessionMessage,
  ensureDefaultPinnedMessage,
  getSessionChat,
  listSessionMessages,
  updateSessionPinnedMessage
};
```

- [ ] **Step 3: Create talk API routes**

Create `packages/talk/api/routes.js` with a route matcher that handles the four existing chat endpoints:

```js
import {
  createSessionMessage,
  getSessionChat,
  listSessionMessages,
  updateSessionPinnedMessage
} from "./service.js";

export async function routeSessionPseudoChat(context) {
  const { body, getAuthUser, idMatch, jsonResponse, request, response, url } = context;

  const sessionChatId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/chat$/);
  if (request.method === "GET" && sessionChatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await getSessionChat(user, sessionChatId)
    });
    return true;
  }

  const sessionChatPinId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/chat\/pin$/
  );
  if (request.method === "PATCH" && sessionChatPinId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateSessionPinnedMessage(user, sessionChatPinId, body)
    });
    return true;
  }

  const sessionMessagesId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/messages$/
  );
  if (request.method === "GET" && sessionMessagesId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionMessages(user, sessionMessagesId)
    });
    return true;
  }
  if (request.method === "POST" && sessionMessagesId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSessionMessage(user, sessionMessagesId, body)
    });
    return true;
  }

  return false;
}
```

- [ ] **Step 4: Create talk API extension export**

Create `packages/talk/api/index.js` with:

```js
import { routeSessionPseudoChat } from "./routes.js";
import {
  createSystemSessionMessage,
  ensureDefaultPinnedMessage
} from "./service.js";

export const sessionPseudoChatExtension = {
  id: "session-pseudo-chat",
  route: routeSessionPseudoChat,
  hooks: {
    async afterSessionCreated({ connection, session, pinnedMessageText }) {
      await ensureDefaultPinnedMessage(connection, session, pinnedMessageText);
    },
    async afterSessionSeatKicked({ connection, sessionId, senderUserId, content }) {
      await createSystemSessionMessage(connection, sessionId, senderUserId, content);
    },
    async afterSessionCancelled({ connection, sessionId, senderUserId, content }) {
      await createSystemSessionMessage(connection, sessionId, senderUserId, content);
    }
  }
};
```

- [ ] **Step 5: Create host backend adapter and registry**

Create `apps/api/src/modules/extensions/session-pseudo-chat/index.js`:

```js
export { sessionPseudoChatExtension } from "@jubenmi/talk/api";
```

Create `apps/api/src/modules/extensions/registry.js`:

```js
import { sessionPseudoChatExtension } from "./session-pseudo-chat/index.js";

export const sessionExtensions = [sessionPseudoChatExtension];

export async function routeExtensions(context) {
  for (const extension of sessionExtensions) {
    const handled = await extension.route?.(context);
    if (handled) {
      return true;
    }
  }
  return false;
}

export async function runSessionExtensionHook(name, payload) {
  for (const extension of sessionExtensions) {
    const hook = extension.hooks?.[name];
    if (hook) {
      await hook(payload);
    }
  }
}
```

- [ ] **Step 6: Refactor core service hooks**

In `apps/api/src/modules/core/service.js`, import:

```js
import {
  findSessionById,
  isAdmin,
  requireSessionOwner
} from "./session-access.js";
import { runSessionExtensionHook } from "../extensions/registry.js";
```

Remove direct exports and implementation of chat API functions from core service. Replace chat side effects:

```js
await runSessionExtensionHook("afterSessionCreated", {
  connection,
  session,
  pinnedMessageText: body.pinnedMessageText
});
```

```js
await runSessionExtensionHook("afterSessionSeatKicked", {
  connection,
  sessionId: seat.session_id,
  senderUserId: user.user.id,
  content
});
```

```js
await runSessionExtensionHook("afterSessionCancelled", {
  connection,
  sessionId,
  senderUserId: user.user.id,
  content
});
```

Keep non-chat helpers such as `assertMessageTextSafe` in core if they are still used for kick/cancel reason validation.

- [ ] **Step 7: Refactor server route dispatch**

In `apps/api/src/server.js`, remove imports of chat service functions from core service. Import:

```js
import { routeExtensions } from "./modules/extensions/registry.js";
```

After the base session `GET`/`PATCH` routes and before cancellation routes, add:

```js
  if (
    await routeExtensions({
      body,
      getAuthUser,
      idMatch,
      jsonResponse,
      request,
      response,
      url
    })
  ) {
    return;
  }
```

Delete the inline chat route blocks from `server.js`.

- [ ] **Step 8: Run backend checks**

Run: `npm --workspace apps/api run check`

Expected: exit 0.

---

### Task 4: Extract Miniprogram Chat Components

**Files:**
- Create: `packages/talk/miniprogram/index.js`
- Create: `packages/talk/miniprogram/api.js`
- Create: `packages/talk/miniprogram/ChatEntry.vue`
- Create: `packages/talk/miniprogram/ManagePinnedMessage.vue`
- Create: `apps/miniprogram/src/extensions/sessionExtensions.js`
- Create: `apps/miniprogram/src/extensions/session-pseudo-chat/index.js`
- Modify: `apps/miniprogram/src/pages/session/detail.vue`
- Modify: `apps/miniprogram/src/pages/session/manage.vue`

- [ ] **Step 1: Create talk miniprogram API helper**

Create `packages/talk/miniprogram/api.js`:

```js
export function chatApi({ dataOf, request }) {
  return {
    async loadChat(sessionId) {
      const response = await request({ url: `/api/sessions/${sessionId}/chat` });
      return dataOf(response) || {};
    },
    async sendMessage(sessionId, content) {
      const response = await request({
        url: `/api/sessions/${sessionId}/messages`,
        method: "POST",
        data: { content }
      });
      return dataOf(response);
    },
    async updatePinnedMessage(sessionId, pinnedMessageText) {
      const response = await request({
        url: `/api/sessions/${sessionId}/chat/pin`,
        method: "PATCH",
        data: { pinnedMessageText }
      });
      return dataOf(response) || {};
    }
  };
}
```

- [ ] **Step 2: Extract `ChatEntry.vue`**

Create `packages/talk/miniprogram/ChatEntry.vue` using the chat template, methods, and scoped styles currently in `apps/miniprogram/src/pages/session/detail.vue`:

- Template block from the `<button v-if="showChatEntry" class="chat-float-button">` through the closing `</view>` of `chat-modal-mask`.
- Data fields: `pinnedMessage`, `messages`, `draftMessage`, `messageStatusText`, `canChat`, `chatModalOpen`, `unreadCount`, `lastSeenMessageId`, `messageTimer`.
- Computed fields: `canSendMessage`, `showChatEntry`, `unreadBadgeText`.
- Methods: `startMessagePolling`, `stopMessagePolling`, `pollMessages`, `loadChat`, `openChatModal`, `closeChatModal`, `updateUnreadCount`, `markChatRead`, `latestMessageId`, `messageErrorText`, `sendMessage`, `ensureLogin`, `isMine`, `timeText`.
- Styles: `.chat-float-button` through `.chat-modal .message-compose`.

The component props must be:

```js
props: {
  sessionId: { type: [String, Number], default: "" },
  session: { type: Object, default: () => ({}) },
  currentUserId: { type: [String, Number], default: "" },
  focusChatOnLoad: { type: Boolean, default: false },
  authTools: { type: Object, required: true }
}
```

The component must call `this.authTools.ensureLoggedIn`, `this.authTools.dataOf`, and `this.authTools.request` instead of importing host utilities directly.

- [ ] **Step 3: Extract `ManagePinnedMessage.vue`**

Create `packages/talk/miniprogram/ManagePinnedMessage.vue` using the pinned-message section from `apps/miniprogram/src/pages/session/manage.vue`.

The component props must be:

```js
props: {
  sessionId: { type: [String, Number], default: "" },
  session: { type: Object, default: () => ({}) },
  busy: { type: Boolean, default: false },
  authTools: { type: Object, required: true }
}
```

It must emit:

```js
emits: ["updated", "status"]
```

It must load `/api/sessions/:id/chat`, bind `pinnedMessageText`, save via `/api/sessions/:id/chat/pin`, emit `status` with `"置顶信息已更新。"` on success, and emit `updated` after a successful save.

- [ ] **Step 4: Export talk miniprogram components**

Create `packages/talk/miniprogram/index.js`:

```js
import ChatEntry from "./ChatEntry.vue";
import ManagePinnedMessage from "./ManagePinnedMessage.vue";

export { ChatEntry, ManagePinnedMessage };
```

- [ ] **Step 5: Create host miniprogram adapters**

Create `apps/miniprogram/src/extensions/session-pseudo-chat/index.js`:

```js
export { ChatEntry, ManagePinnedMessage } from "@jubenmi/talk/miniprogram";
```

Create `apps/miniprogram/src/extensions/sessionExtensions.js`:

```js
import { ChatEntry, ManagePinnedMessage } from "./session-pseudo-chat/index.js";

export const sessionDetailExtensions = [
  {
    id: "session-pseudo-chat",
    component: ChatEntry
  }
];

export const sessionManageExtensions = [
  {
    id: "session-pseudo-chat",
    component: ManagePinnedMessage
  }
];
```

- [ ] **Step 6: Refactor detail page mount**

In `apps/miniprogram/src/pages/session/detail.vue`, remove the inline chat template, data, computed fields, methods, and styles listed in Step 2. Import `sessionDetailExtensions`, register component(s), and render them near the end of the root `<view>`:

```vue
<component
  v-for="extension in sessionDetailExtensions"
  :is="extension.component"
  :key="extension.id"
  ref="sessionDetailExtensionRefs"
  :session-id="sessionId"
  :session="session"
  :current-user-id="currentUserId"
  :focus-chat-on-load="focusChatOnLoad"
  :auth-tools="authTools"
/>
```

Add:

```js
import { sessionDetailExtensions } from "../../extensions/sessionExtensions.js";
```

Expose:

```js
data() {
  return {
    sessionDetailExtensions,
    ...
  };
},
computed: {
  authTools() {
    return { dataOf, ensureLoggedIn, request };
  }
}
```

Update `onHide` and `onUnload` to call a local `stopDetailExtensions()` method that invokes `stop()` on extension refs.

- [ ] **Step 7: Refactor manage page mount**

In `apps/miniprogram/src/pages/session/manage.vue`, remove the inline pinned-message section, `pinnedMessage`, `pinnedMessageText`, `loadChat`, and `savePinnedMessage`.

Render management extension:

```vue
<component
  v-for="extension in sessionManageExtensions"
  :is="extension.component"
  :key="extension.id"
  :session-id="sessionId"
  :session="session"
  :busy="busyAction"
  :auth-tools="authTools"
  @status="setStatus"
  @updated="reload"
/>
```

Add:

```js
import { sessionManageExtensions } from "../../extensions/sessionExtensions.js";
```

Expose:

```js
data() {
  return {
    sessionManageExtensions,
    ...
  };
},
computed: {
  authTools() {
    return { dataOf, request };
  }
}
```

Add `setStatus(statusText) { this.statusText = statusText; }`.

- [ ] **Step 8: Run syntax checks**

Run: `npm run check`

Expected: exit 0 or only failures caused by known missing runtime services. JavaScript syntax checks must pass.

---

### Task 5: Verify, Commit, And Push

**Files:**
- Modify: task files touched by Tasks 1-4

- [ ] **Step 1: Run full static verification**

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 2: Run D10 smoke if environment is available**

Run: `npm run d10:smoke`

Expected when API/database are running: exit 0. If it cannot connect to the local API or database, record the connection failure and do not claim smoke passed.

- [ ] **Step 3: Commit talk submodule changes**

Inside `packages/talk`, run:

```bash
git status --short
git add package.json api miniprogram
git commit -m "Extract session pseudo chat extension"
git push
```

Expected: `packages/talk` is clean after push.

- [ ] **Step 4: Commit parent repository changes**

From the parent repository, run:

```bash
git status --short
git add .gitmodules package.json package-lock.json apps/api/package.json apps/miniprogram/package.json apps/api/src/modules/core/session-access.js apps/api/src/modules/extensions apps/api/src/modules/core/service.js apps/api/src/server.js apps/miniprogram/src/extensions apps/miniprogram/src/pages/session/detail.vue apps/miniprogram/src/pages/session/manage.vue scripts/d10-pseudo-chat-check.js scripts/check-miniprogram.js packages/talk docs/superpowers/plans/2026-06-13-session-pseudo-chat-extension.md
git commit -m "Extract pseudo chat into talk extension"
```

Expected: staged files include only spec-related implementation files and the `packages/talk` submodule pointer.

- [ ] **Step 5: Final review**

Run:

```bash
git show --stat --oneline HEAD
git -C packages/talk status --short
git diff --cached --name-only
```

Expected: parent commit exists, talk submodule is clean, and no staged files remain.
