# FPGA SIM: spec for accounts and projects on the server

Addendum to `docs/tz-v1.md`. Where this document differs from `tz-v1.md`, this document applies;
stage 6 moves the differences into `tz-v1.md`. The strength of the requirements is as in section 0.2
of `tz-v1.md`.

## 0. Purpose

### 0.1. Why

Today access is granted with a key: the author logs in to the VPS over SSH, runs
`fpgasim-admin key add`, copies the key (which is printed once), and sends the link himself.
Projects live only in the browser: clearing browser data or changing computers erases them.

On 2026-11-20 the author stated the goals:

1. Work is not lost: the project is saved on the server without any action from the user.
2. Two people work on one project without sending files: they sign in under one login.
3. The author is the only administrator. He adds and removes users and views their work from an
   application page, without SSH.
4. Everyone else only uses the application: sign-in with login and password.

There are few users: first two students, later a few more. The count is in single digits, ten at
most.

### 0.2. Scope

- Accounts with login and password, with the roles "admin" and "user".
- A "Users" page for the administrator: add, disable, delete, change a password, see the sign-in and
  build times, open a user's projects.
- Storing "in browser" projects on the server and moving them between devices.
- Detection of simultaneous edits to one file.
- A trash for deleted projects (30 days) and a daily database backup.

### 0.3. Out of scope

- Self-registration. Only the administrator adds a new user: in the interface he creates the account
  and gives the user the login and password.
- Sign-in through external services (Google, GitHub and others).
- Password recovery by email. The administrator replaces a lost password with a new one in the
  interface.
- Permissions on a single project and a list of project members. Joint work is a shared login (the
  author's decision).
- Simultaneous editing of one text with another person's cursor shown. Two people edit different
  files, or one file in turn.
- File version history. Extension point: a versions table next to the `files` table.
- "In folder" projects: they stay on the user's disk and do not go to the server.
- A separate accounts service (section 15.2 of `tz-v1.md` assumed one): for ten users, a SQLite
  database in the `api` service is enough.

### 0.4. What must never happen

- A silent loss of an edit: not on a network drop, not on an expired session, not on editing from
  two devices. An edit that cannot be sent stays in the browser, and the interface shows it to the
  user.
- Breaking key sign-in: `make e2e`, `make e2e-prod` and `make bench` work with a key, as now.
- A password, key or session token in the log, in a page URL or in a server response, except the
  responses named in section 3.

### 0.5. Terms

- **Account** — a login, a display name, a role, a password, an "enabled" flag.
- **Session** — one account's sign-in from one browser. One account can have several sessions at
  once.
- **Session token** — a random string that the server issues at sign-in and that the browser sends
  in every request.
- **Project revision** — an integer that the server increases on every change to the project.
- **File revision** — the project revision at the moment of the last change to that file.
- **Sync** — the exchange of changes of one project between the browser and the server.
- **Conflict** — a file is changed both in the browser and on the server, and the contents differ.

## 1. What changes in the system

| Part | Now | Will be |
|---|---|---|
| Human access | Key in the `#key=…` link | Login and password; session token |
| Script access | Key | Key, unchanged |
| Server data | `keys.toml`, cache | Plus the `accounts.db` database and its backups |
| "In browser" project | IndexedDB only | IndexedDB and a copy on the server |
| "In folder" project | User's disk | Unchanged |
| Access management | SSH and `fpgasim-admin` | "Users" page; `fpgasim-admin` — for the first administrator |

The `api` service stays a single process (section 8.1 of `tz-v1.md`). There are no new containers,
ports or domains. The content security policy (`web/public/_headers`) does not change: requests go
to the same server address.

## 2. Server data

### 2.1. Database

- A SQLite file `/var/lib/fpgasim/accounts/accounts.db`. The path comes from the setting
  `server.accounts_db` and the variable `FPGASIM_ACCOUNTS`. Journal mode WAL, `foreign_keys = ON`.
- Access is through the `sqlite3` module of the standard library. There are no new server
  dependencies.
- The schema number is `PRAGMA user_version`. At startup the service creates the database and
  brings the schema up to its own version. The service does not open a schema newer than its own
  and does not start.
- Times are integer milliseconds since the epoch, UTC.

```sql
CREATE TABLE users (
  login       TEXT PRIMARY KEY,       -- [a-z0-9_-]{1,32}
  name        TEXT NOT NULL,          -- display name, 1–64 characters
  role        TEXT NOT NULL,          -- 'admin' or 'user'
  password    TEXT NOT NULL,          -- section 2.2
  enabled     INTEGER NOT NULL DEFAULT 1,
  created     INTEGER NOT NULL,
  last_login  INTEGER,
  last_build  INTEGER                 -- last build or testbench request
);
CREATE TABLE sessions (
  token_sha256 TEXT PRIMARY KEY,
  login        TEXT NOT NULL REFERENCES users(login) ON DELETE CASCADE,
  created      INTEGER NOT NULL,
  last_used    INTEGER NOT NULL
);
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,        -- UUID, issued by the browser
  login      TEXT NOT NULL REFERENCES users(login) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  board      TEXT NOT NULL,
  rev        INTEGER NOT NULL,        -- project revision
  modified   INTEGER NOT NULL,
  deleted_at INTEGER,                 -- not NULL: the project is in the trash
  purged     INTEGER NOT NULL DEFAULT 0  -- 1: the trash period is over, files erased
);
CREATE TABLE files (
  project  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path     TEXT NOT NULL,
  content  TEXT,                      -- NULL: file deleted (the row stays for the revision)
  rev      INTEGER NOT NULL,          -- file revision
  modified INTEGER NOT NULL,
  PRIMARY KEY (project, path)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- row 'generation'
```

**Database generation** is a random string (16 bytes in base64url) in the `meta` table. The service
creates it together with the database. The command that restores from a backup (section 3.8)
replaces it with a new one. The server returns the generation in the responses of sections 3.2 and
3.3. When the generation changes, the browser learns that the database was restored from a backup
and that its revisions are invalid (section 4.4).

### 2.2. Password

- Length from 8 to 128 characters. There are no other requirements.
- The stored string is `scrypt$<n>$<r>$<p>$<salt base64>$<hash base64>`: `hashlib.scrypt`,
  `n = 2**15`, `r = 8`, `p = 1`, a 16-byte salt, a 32-byte hash, `maxmem` 128 MB. Comparison is
  `hmac.compare_digest`. The hash is computed outside the event loop (`asyncio.to_thread`).
- A password created by the server: 10 characters from the alphabet
  `abcdefghjkmnpqrstuvwxyz23456789`, in the form `xxxxx-xxxxx`, from `secrets`.
- The server shows a created password once, in the response to account creation or to a password
  change. The administrator changes a password at any time: a lost password does not need a new
  account.

### 2.3. Session

- The session token is 32 random bytes in base64url, like a key. The database holds its SHA-256.
- A session is valid for 90 days from the last request. `last_used` is updated at most once a
  minute.
- The browser stores the token in `localStorage` under the name `fpgasim.session` and sends it in
  the header `Authorization: Bearer <token>`, like a key. Cookies are not used: the static files and
  the server are at different addresses.
- The server looks up the header value first among the sessions, then among the keys.
- An account's sessions are deleted: when the account is disabled, when it is deleted, when its
  password is changed (except the session that changed the password).

### 2.4. Keys

Section 8.6 of `tz-v1.md` stays in force: the `keys.toml` file, the commands `key add`,
`key disable`, `key list`, the `#key=…` link. A key allows the build operations (`info`, `check`,
`build`, `testbench`, `artifacts`) and does not allow the operations of sections 3.2–3.5: the
response is 403 `FORBIDDEN`. Keys stay for scripts.

### 2.5. Database backups

- Once a day the service writes a copy of the database with SQLite tools (`Connection.backup`) to
  `/var/lib/fpgasim/backup/accounts-<YYYYMMDD>.db` and keeps the 14 latest copies. The first copy
  is made at startup if there is no copy for the current day.
- Once a day the cron of the user `taras` on the VPS sends the latest copy to Cloudflare R2
  (`deploy/offsite-r2.sh`): bucket `hermes-backups`, prefix `fpgasim/`, 30 days (decision 160).
- The command `make backup-accounts` on the author's Mac fetches the latest copy over SSH into
  `.fpgasim/backup/` (the `.fpgasim` folder is not stored in Git): a fallback, by hand.
- The phrase "Backups are not needed" in section 10.2 of `tz-v1.md` is cancelled.

### 2.6. Trash

- Deleting a project sets `deleted_at`. The files stay.
- Once a day the service erases the files of projects whose `deleted_at` is older than 30 days and
  sets `purged = 1` on the project. The project row stays forever: a device that was offline for a
  long time gets the answer "deleted" from it instead of creating the project again.
- Rows of deleted files (`content IS NULL`) are not erased: a device that was offline for a long
  time learns about the deletion from them.
- The administrator can restore a project from the trash (section 3.5) while `purged = 0`.

## 3. Server operations

The general rules of section 8.3 of `tz-v1.md` stay in force: JSON, the error form
`{ "error": { "code": "…", "text": "…", "args": { "reason": "…" } } }` (`args` is optional, decision 183). New codes: 401 `BAD_CREDENTIALS`, 403 `FORBIDDEN`,
409 `EXISTS`, 429 `LOGIN_LOCKED`. CORS: `PUT`, `PATCH`, `DELETE` are added to the methods.

The form of an account in responses:

```json
{ "login": "misha", "name": "Миша", "role": "user", "enabled": true,
  "created": 1795000000000, "lastLogin": 1795003600000, "lastBuild": null, "projects": 3 }
```

The field `projects` is the number of projects outside the trash. The field `password` is never in
responses.

### 3.1. Sign-in and session

**`POST /v1/auth/login`** — without the `Authorization` header.

Request: `{ "login": "misha", "password": "…" }`. Before the lookup the login is lowercased and
surrounding spaces are removed.

Response: `{ "token": "…", "user": { … } }`.

- Unknown login, wrong password, disabled account: 401 `BAD_CREDENTIALS`, with the same text. For
  an unknown login the server still computes a hash, so that the response time does not reveal
  whether the login exists.
- More than 10 failures for one login in 15 minutes, or more than 30 failures from one address in
  15 minutes: 429 `LOGIN_LOCKED` until the end of the window. The address is the `X-Real-IP` header
  (set by nginx); without it, the connection address. The counters live in process memory. A
  successful sign-in resets the login's counter.

**`POST /v1/auth/logout`** — deletes the session of the request. Response `{ "status": "ok" }`.

**`POST /v1/auth/password`** — request `{ "current": "…", "new": "…" }`. Wrong current password:
401 `BAD_CREDENTIALS`, and the failure goes into the login's counter. Success deletes the account's
other sessions.

**`GET /v1/info`** — these fields are added to the response of section 8.3 of `tz-v1.md`:

- `auth`: `"session"` or `"key"`;
- `user`: the form of the account for a session, `null` for a key.

The field `owner` stays: the login for a session, the key owner's name for a key.

An expired, deleted or unknown session: 401 `UNAUTHORIZED` on any operation. A database failure
while checking a session is 503 `BUSY`, not 401: on a 401 response the browser treats the session
as ended.

Passwords are checked one at a time: the lock check, the hash computation and the recording of a
failure run without a break for other attempts. Otherwise a burst of simultaneous requests gets
around the failure limit.

### 3.2. Project list

**`GET /v1/projects`** →

```json
{ "generation": "…",
  "projects": [ { "id": "…", "name": "blink3", "board": "tang-nano-20k",
                  "rev": 14, "modified": 1795003600000, "deleted": false } ] }
```

The projects of the account that made the request, including deleted and erased ones
(`deleted: true`): other devices learn about a deletion from them.

### 3.3. Project sync

**`POST /v1/projects/{id}/sync`** — one operation sends the browser's changes and returns the
server's changes. The server runs it in one transaction.

Request:

```json
{
  "since": 12,
  "generation": "…",
  "meta": { "name": "blink3", "board": "tang-nano-20k" },
  "changes": [
    { "path": "top.v", "content": "module top…", "baseRev": 7 },
    { "path": "old.v", "content": null, "baseRev": 3 }
  ]
}
```

- `since` — the project revision up to which the browser has already received changes; 0 — it has
  received nothing.
- `generation` — the database generation in which the browser received its revisions; `null` — the
  browser does not know the generation. A request with `since` above 0, or with `baseRev` above 0,
  and without a generation: 400. The generation does not match the server's generation: the server
  applies and creates nothing and replies `{ "stale": true, "generation": "…" }`. Reason: after a
  restore from a backup, the number of an old revision can coincide with the number of a new one,
  and an edit would overwrite someone else's without a conflict.
- At most 1000 changes in one request; `since` and `baseRev` at most 2^53.
- `meta` — the name and the board. The field is required when the project is not on the server, and
  is sent when the user has changed the name or the board. It is absent in other requests.
- `changes` — files changed in the browser. `content: null` — the file is deleted. `baseRev` — the
  file revision that the browser received from the server last; 0 — the browser has not received the
  file from the server. The array can be empty. Renaming a file is deleting the old path and
  creating a new one.

Order on the server:

1. `id` is not a UUID: 400. The project belongs to another account: 404 `NOT_FOUND`. No project and
   no `meta`: 404. No project and `meta` present: the project is created with revision 0.
2. The project is in the trash or erased: no changes are applied, and the response is
   `{ "deleted": true, "rev": …, "generation": "…" }`.
3. `meta` differs from the record: the name and the board are replaced, and the project revision
   grows by 1. With two simultaneous changes, the last one applies.
4. For each change the server takes the file's current revision (0 when there is no record of the
   file):
   - deletion (`content: null`) of a path with no record, with any `baseRev`: no record is created,
     the project revision does not grow, and the change goes into `applied` with `rev: 0`. Deletion
     of a file that is already deleted on the server, with any `baseRev`: the record does not
     change, and the change goes into `applied` with the file's current revision. Otherwise creating
     and deleting paths without end would keep growing the number of deleted-file records;
   - it equals `baseRev`, or `baseRev` is 0 and the file is deleted on the server
     (`content IS NULL`): the content is written, the project revision grows by 1 and becomes the
     file revision. The change goes into `applied`. The second half of the condition is for a file
     created again under the path of a deleted one;
   - it does not equal `baseRev`, but the content on the server matches the one sent (including
     when both are "deleted"): the record does not change, and the change goes into `applied` with
     the file's current revision;
   - otherwise the record does not change, and the file goes into `conflicts` with the server's
     content and revision.
5. After step 4 the project is checked against the limits of section 3.6. A violation: the
   transaction rolls back, and the response is 413 `PROJECT_TOO_LARGE`.
6. `remote` receives the files with a revision above `since` that are not in `applied` and
   `conflicts`.

Response:

```json
{
  "deleted": false,
  "generation": "…",
  "rev": 15,
  "name": "blink3", "board": "tang-nano-20k", "modified": 1795003700000,
  "applied":   [ { "path": "top.v", "rev": 14 }, { "path": "old.v", "rev": 15 } ],
  "conflicts": [ ],
  "remote":    [ { "path": "uart.v", "rev": 13, "content": "module uart…" } ]
}
```

Paths are checked with the server's `valid_path` rule (section 2.1 of `tz-v1.md`). Content is not
written to the log.

**`DELETE /v1/projects/{id}`** — puts the project in the trash. Response `{ "status": "ok" }`. A
repeated request gets the same response.

### 3.4. Users (administrator only)

An account without the `admin` role, and a key, get 403 `FORBIDDEN`.

| Operation | Request | Response |
|---|---|---|
| `GET /v1/admin/users` | — | `{ "users": [ … ] }`, ordered by login |
| `POST /v1/admin/users` | `{ "login", "name", "role" }` | `{ "user": { … }, "password": "…" }`; login taken: 409 `EXISTS` |
| `PATCH /v1/admin/users/{login}` | any of `name`, `role`, `enabled` | `{ "user": { … } }` |
| `POST /v1/admin/users/{login}/password` | — | `{ "password": "…" }`; the account's sessions are deleted |
| `DELETE /v1/admin/users/{login}` | — | `{ "status": "ok" }`; the account, its sessions and its projects are erased |

Prohibited actions, response 400 `BAD_REQUEST` with a clear text:

- disabling, deleting or demoting your own account;
- disabling, deleting or demoting the last enabled administrator.

An invalid login (`[a-z0-9_-]{1,32}`), name or role: 400.

### 3.5. Users' projects (administrator only)

| Operation | Response |
|---|---|
| `GET /v1/admin/users/{login}/projects` | A list of the form of section 3.2, including the trash; a project in the trash has `deletedAt`; the field `purged` — the trash period is over, files erased |
| `GET /v1/admin/projects/{id}` | `{ "id", "login", "name", "board", "rev", "modified", "files": [ { "path", "content" } ] }`, without deleted files |
| `POST /v1/admin/projects/{id}/restore` | Clears `deleted_at`, the project revision grows by 1; `{ "status": "ok" }`. An erased project (`purged = 1`): 404 |

The administrator cannot edit someone else's project: he makes a copy for himself (section 5.6).

### 3.6. Limits

| What | Value |
|---|---|
| Files in a project, file size, project size | As in section 8.5 of `tz-v1.md`: 200, 512 KB, 2 MB |
| Projects of an account outside the trash | 100 |
| Projects of an account in the trash | 100; above the limit, the files of the earliest-deleted projects are erased |
| Projects of an account over all time, including erased | 10,000 |
| File records of a project, including records of deleted files | 1000 |
| Sync requests from one account | 120 per minute |
| Other requests of sections 3.1–3.5 from one account | 60 per minute |

The values are in `Limits` (`server/fpgasim_server/config.py`) and are returned in `/v1/info`.
Exceeding the number of projects: 413 `PROJECT_TOO_LARGE` with a text about the number of projects.
Exceeding the number of file records after the changes: rollback and 413 `PROJECT_TOO_LARGE` with a
text about the number of file records.

### 3.7. Log

A log line (section 8.7 of `tz-v1.md`) gets the field `auth` (`session`, `key` or `null`). The field
`owner` is the login or the key owner's name. New values of `op`: `login`, `logout`, `password`,
`projects`, `sync`, `project-delete`, `admin-…`; lines of the daily job are `trash-purge` and
`backup`. For `sync`, the field `projectBytes` is the size of the changes sent. Passwords, tokens
and file content do not go into the log. A failed sign-in writes the login from the request into
the field `login`, not into `owner`.

`build` and `testbench` requests from a session update the account's `last_build`.

### 3.8. The `fpgasim-admin` utility

These are added to the `key …` commands:

- `user add <login> [--name <name>] [--admin]` — creates an account and prints the password once;
- `user passwd <login>` — creates a new password and prints it;
- `user disable <login>`, `user enable <login>`;
- `user list` — login, role, state, time of last sign-in;
- `db restore <backup file>` — checks that the file is a database of this schema, replaces the
  database with it, writes a new generation and erases the sessions that came from the backup: users
  sign in again. The service is stopped before the command (the procedure is in
  `docs/deploy-server.md`).

- `assistant key` — reads the Anthropic key from standard input into the assistant key file (decision 175);
- `assistant usage [--days N]` — assistant tokens and approximate cost per UTC day, owner and model, and a total
  per day (decision 175).

The utility writes to the same database as the service. The author uses it once to create his
administrator account. Everything else is done from the "Users" page.

## 4. Storage in the browser

### 4.1. IndexedDB records

The version of the `fpgasim` database does not change: the new fields are optional, and there are
no new stores.

`ProjectRecord` gets these fields:

- `account?: string` — the owner's login. Without the field the project belongs to no one (created
  before sign-in or during key sign-in);
- `sync?: { rev; generation; meta; deletes; trashed? }` — present on an "in browser" project that has
  an owner:
  - `rev: number` — the value of `since` for the next request;
  - `generation: string` — the database generation from the last response; an empty string — there
    has been no response yet;
  - `meta: boolean` — the project is not on the server, or the name or board was changed and not
    sent;
  - `deletes: { path; baseRev; conflict?; sent?; asked? }[]` — files deleted in the browser that the
    server does not yet know about: `baseRev: number`;
    `conflict?: { rev: number; content: string | null }` — the server's version, when the file was
    changed on the server; `sent?: string` — the file's content from a send that got no response;
    `asked?: boolean` — a request with this deletion was sent, and the response is not parsed;
  - `asked?: boolean` — a `sync` request of the project was sent: the server may know the project
    even without a parsed response;
  - `trashed?: boolean` — the user deleted the project, and the `DELETE` request has not gone
    through yet (such a project is not shown in the list).
- `viewOf?: { login: string; id: string }` — a temporary copy of someone else's project (section
  5.6).

The state of section 4.5 is not stored: it is computed from the file fields and from the outcome of
the last request.

`FileRecord` gets these fields:

- `serverRev?: number` — the revision of the server version that the file's content derives from;
  it is also the `baseRev` in the request. Without the field the server does not know the file, and
  `baseRev` is 0;
- `dirty?: boolean` — the saved content differs from the content sent;
- `sent?: string` — the content of the earliest send whose response is not yet parsed;
- `sentDeleted?: boolean` — the file was created under a path whose deletion was sent, and the
  response is not parsed;
- `conflict?: { rev: number; content: string | null }` — the server's version at a conflict;
- `remoteSeq?: number` — a counter of replacements of the content by the server's version;
- `prevRev?: number` — the value of `serverRev` before the last such replacement;
- `draftSeq?: number` — the value of `remoteSeq` at which the unsaved editor edit was started.

**An edit started on an old version of a file.** The workspace keeps the files of the open project
in memory and remembers, for each file, the value of `remoteSeq` that it has seen. It states this
value on every save and on every write of an editor edit. A save with a stale value means: the text
was started before the server replaced the content. Then the file's `serverRev` goes back to
`prevRev`, the request goes out with the old revision, and the server replies with a conflict. This
way a save does not overwrite someone else's change. The workspace updates its value only when it
has shown the new content in the editor (a file with no unsaved edit).

The saved content (`content`) is what syncs. The unsaved editor edit (`draft`) and the original
content (`base`, decision 98) stay in the browser. For a project received from the server, `base`
equals the content at first receipt.

**A send without a response.** A request could reach the server while the response was lost. So the
browser remembers what it sent (`sent`, `sentDeleted`, `asked`) until the response is parsed, and
acts as if the server had accepted the send: the deletion of a project or file after a lost
response goes to the server; a server version equal to its own send is not counted as a conflict.

**Unsent work of a project** is at least one of: a file with `dirty`, a file with `conflict`, a
non-empty `deletes`, `sync.meta`. **Unsaved work of a project** is unsent work or a file with an
editor edit (`draft`).

### 4.2. Which projects are visible

| Sign-in | In the project list |
|---|---|
| Session of account `L` | "In browser" projects with `account = L` and all "in folder" projects |
| Key | "In browser" projects without `account` and all "in folder" projects |

At every sign-in with login and password, "in browser" projects that belong to no one get the
`account` of the account that signed in; from stage 4 they go to the server. The interface reports
the number of projects taken in one line. So after the first deployment, projects created before it
do not vanish for the user who signs in.

Signing out of an account does not erase local copies: they are hidden until the same account signs
in again.

### 4.3. When sync runs

"In browser" projects sync during a session sign-in. During a key sign-in there is no sync.

- List (`GET /v1/projects`): at sign-in, on opening the projects screen, when the network returns.
- Project (`sync`): 2 s after saving, deleting or renaming a file, or changing the name or board;
  on opening the project; every 30 s while the project is open and the tab is visible; when the
  network returns (`online`); on `syncNow()` (section 5.7).
- A project that is not in the browser is downloaded in full when the list is received.
- One tab syncs at a time: the `navigator.locks` lock named `fpgasim-sync`.
- During a session sign-in, an "in browser" project is open in only one browser tab: the tab holds
  the lock `fpgasim-project-<id>`. A second tab does not open the project: it stays on the projects
  screen and shows the line "Project is open in another tab". Reason: a tab keeps the project's
  files in memory and does not see the changes that the other tab received from the server. The
  sync of a project open in another tab is done by that tab.

### 4.4. Parsing a `sync` response

1. `applied`: the file gets `serverRev = rev`; `dirty` is cleared if the content has not changed
   since the send; `sent` is erased. The deletion that was sent is removed from `deletes`. The file
   was deleted while the request was in flight: its deletion goes into `deletes` with the new
   revision.
2. `remote`:
   - the file in the browser is not `dirty`: the server's content is written by the same path as new
     content from disk for an "in folder" project (`diskContent`): an unsaved editor edit stays, an
     open file with no edit is re-read. `content: null` deletes the file;
   - the file is `dirty` (changed while the request was in flight): a conflict, as in item 3;
   - the path is in `deletes` (the file was deleted while the request was in flight) and `content`
     is not `null`: a conflict, and the server's version is written to `conflict` of the `deletes`
     record.
   A replacement of content increases the file's `remoteSeq` and writes the previous revision to
   `prevRev` (section 4.1). `content: null` for a file with an unsaved editor edit does not delete
   the file: it is a conflict with the version "file deleted".
3. `conflicts`:
   - the server's version equals the file's `sent` field: this is an earlier send from this same
     browser, and its response was lost. There is no conflict: `serverRev = rev` from `conflicts`,
     the file stays `dirty` and goes out in the next request;
   - otherwise the server's version is written to the file's `conflict` field, and for a file
     deleted in the browser, to `conflict` of the `deletes` record. The browser's content does not
     change. A file with a conflict is not sent until the user chooses a version (section 5.5).
4. `name` and `board` from the response are accepted when `sync.meta` is false.
5. `sync.rev` = `rev` from the response.

   Before parsing a response, the workspace writes to storage the editor edits of the open project
   that are still waiting to be written (the write runs 300 ms after typing): otherwise the parsing
   would not see the edit. A stopped exchange (sign-out, change of sign-in) sends no requests and
   parses no responses; requests go through the client of the sign-in under which the exchange was
   started.
6. `deleted: true`: the project was deleted on another device. There is no unsaved work (section
   4.1): the local copy is erased; an open project is closed with a message. There is unsaved work:
   the project gets a new identifier, resets `serverRev` and `sync`, and goes to the server as a new
   one; the editor edits stay; the interface reports it.
7. The response `stale: true`, or a `generation` from `GET /v1/projects` that differs from
   `sync.generation` (the database was restored from a backup): the browser resets `serverRev` of
   all the project's files and the revisions of unsent deletions, marks all files `dirty`, sets
   `sync.rev = 0`, remembers the new generation, and repeats the request with `meta`, `since: 0` and
   `baseRev: 0` for all files. The server accepts the files that match or that it does not have, and
   returns the ones that differ as conflicts: the user chooses a version. A project that is not in
   the restored database is created again.

Failures:

- No network, a 5xx response, or no response in 30 s: state `offline`, retry after 5, 15, 60 s, then
  every 60 s. Editing continues.
- The server did not answer at page load: the projects of the saved session are visible and editing
  works; sign-in repeats on its own when the network returns and every 30 s, and the exchange
  starts after it.
- 401: the session ended. Section 5.2.
- 413 and 400: state `error` with the server's text. The retry comes after the next change to the
  project or its opening; the 30 s poll skips such a project.
- 404 with `since > 0`: the server does not know the project. The browser acts as in item 7.

### 4.5. Sync state of a project

`synced` — everything is sent and received; `pending` — there is unsent work; `syncing` — a request
is in flight; `offline` — the server is unreachable; `conflict` — there is a file with a conflict;
`error` — the server refused. The state `conflict` outranks the others.

## 5. Interface

Strings live only in `web/src/i18n/ru.json`. The look comes from `web/src/app/kit.tsx` and the
shadcn components, and colors are theme variables (`CLAUDE.md`, section "Style").

### 5.1. Sign-in

The projects screen without a valid session and without a key shows a sign-in form instead of the
key form:

```
┌──────────────────────────────────────────────┐
│ Sign in                                      │
│ Login     [ misha                      ]     │
│ Password  [ ••••••••••                 ]     │
│                                [ Sign in ]   │
│ Your teacher provides the login and password │
└──────────────────────────────────────────────┘
```

- The fields have `autocomplete="username"` and `current-password`: the browser's password manager
  works.
- Failure: "Wrong login or password"; on `LOGIN_LOCKED` — "Too many attempts, try again in 15
  minutes"; server unreachable — the text and a "Retry" button, as in the key form.
- The key form is removed from the screen. The `#key=…` link works as before: the key from it is
  saved, and the application works without an account.
- The browser stores one of two things: a session token or a key. A key from the link erases the
  saved session token; signing in with a login erases the saved key; "Sign out" erases whatever is
  saved.
- Order at startup: the key from the link; otherwise the saved session token; otherwise the saved
  key; otherwise the sign-in form. A browser in which a key was saved before this work keeps working
  with the key until "Sign out" is pressed.
- A key from the link that the server did not accept: the sign-in form with the text "The key from
  the link is not valid".
- The end-to-end test "without a key the key input is shown; a wrong key is rejected with an
  explanation" (`e2e/tests/stage4.spec.ts`) checks the removed form. It is replaced by a test with
  the same intent: without a key and a session the sign-in form is visible; a wrong key from the
  link is rejected with an explanation. This is a replacement because the requirement changed, not a
  weakening of the test.

### 5.2. The session ended during work

A 401 response to any request while a project is open: the project stays open, and editing and
saving in the browser keep working. A bar appears above the workspace: "Session ended. Sign in again
to build and save to the server", with a "Sign in" button. The button opens the sign-in form in a
dialog. After the same account signs in, sync continues. After a different account signs in, the
open project is closed, and its local copy stays with the previous account.

### 5.3. Account menu

At the top right of the projects screen, instead of the key status line, there is a button with the
user's name and a menu: "Change password", "Users" (administrator only), "Sign out". The server
status is shown as before. In key mode the button shows the key owner's name, and the menu has only
"Sign out".

"Change password": a dialog with the fields "Current password", "New password", "Repeat new
password".

"Sign out" with unsent work (section 4.1): a dialog "Not everything is saved on the server" with the
buttons "Upload and sign out" and "Stay". When the server is unreachable, "Upload and sign out"
reports the failure and does not sign out.

### 5.4. Sync indicators

- In the project list, an "in browser" project during a session sign-in has a state icon with a
  tooltip: "Saved on server", "Uploading", "Offline: saved in browser", "Conflict", "Server
  refused: …".
- In the workspace status bar, the same indicator as text. Clicking the "Conflict" indicator opens
  the dialog of section 5.5; clicking the "Offline" indicator repeats the request.
- In the file list, a file with a conflict is marked.

### 5.5. Conflict

A dialog for one file: "File `top.v` was changed on another device". Two read-only fields side by
side: "My version" and "Server version". A file deleted on either side shows the line "File
deleted"; for a file deleted in the browser, "Take server's" returns the file to the project. The
buttons:

- "Keep mine" — the file is sent with the `baseRev` of the server's version;
- "Take server's" — the server's content replaces the browser's content and the unsaved edit;
- "Download both" — two files to disk, the dialog stays;
- "Later" — the dialog closes, the conflict stays.

The dialog opens by itself when a conflict first appears in the open project. With several files,
the dialogs come one after another.

### 5.6. The "Users" page

Screen 3, opened from the account menu; available only to the administrator.

```
‹ Projects       Users                                                       [ + User ]
┌────────┬────────┬───────────────┬──────────┬─────────────────┬─────────────────┬────────┬───┐
│ Login  │ Name   │ Role          │ State    │ Sign-in         │ Build           │Projects│   │
├────────┼────────┼───────────────┼──────────┼─────────────────┼─────────────────┼────────┼───┤
│ taras  │ Taras  │ admin         │ enabled  │ today           │ today           │ 12     │ ⋯ │
│ misha  │ Misha  │ user          │ enabled  │ yesterday 18:40 │ yesterday 18:52 │ 3      │ ⋯ │
└────────┴────────┴───────────────┴──────────┴─────────────────┴─────────────────┴────────┴───┘
```

- "+ User": a dialog with the fields "Login", "Name", "Role". After creation the dialog shows the
  login and password with a "Copy" button and the text "The password is shown once. A lost password
  is replaced with a new one".
- Row menu: "Projects", "New password" (with confirmation; the result is the same password display),
  "Edit" (name, role), "Disable" / "Enable", "Delete".
- "Delete" requires typing the user's login and states the number of projects that will be erased.
- The prohibited actions of section 3.4 are disabled in the menu, with an explanation.

"Projects" opens the user's project list: name, board, modification time, the "in trash" flag and
the time until erasure. Actions:

- "Open to view" — the project is loaded into the administrator's browser as a temporary copy. It
  belongs to the administrator and does not go to the server (it has no `sync`); in the project list
  it stands in the "Viewing" group with the owner's login. Opening the same project again replaces
  the copy. Build, run and editing work in the copy; edits do not affect the user's project;
- "Make my own copy" (on a project of the "Viewing" group) — the copy becomes an ordinary project of
  the administrator with a new identifier and goes to the server;
- "Restore from trash" — the `restore` operation.

The mark of a temporary copy: the field `viewOf?: { login: string; id: string }` in `ProjectRecord`.

### 5.7. Tools for automated checks

`window.__fpgasim` (section 9.7 of `tz-v1.md`) gets:

| Method | Returns |
|---|---|
| `account()` | The kind of sign-in (`none`, `key`, `session`), login, name, role |
| `sync()` | The open project: the state of section 4.5, `rev`, paths of unsent files, paths of files with a conflict, the text of the last refusal; `null` without sync |
| `syncNow()` | Starts the sync of the list and of the open project; the promise completes after the response is parsed |
| `users()` | The rows of the table on the "Users" page |
| `projects()` | The list of the projects screen: identifier, name, kind, sync state |
| `busyProject()` | The name of the project that did not open because it is open in another tab |

`project()` gets the field `view` — the owner's login for a temporary copy; other projects do not
have the field. The stage 5 methods (the conflict dialog, the sign-out dialog, a user's projects)
are in `web/src/debug/api.ts`.

## 6. Verification

- Server tests (`server/tests/test_accounts.py`, `test_projects.py`): pytest with a temporary
  database.
- Interface unit tests (Vitest): the sync mechanism against an in-memory fake server,
  `fake-indexeddb`, as in `web/src/project/store.test.ts`.
- End-to-end tests (`e2e/tests/accounts.spec.ts`, `sync.spec.ts`): the `e2e/run.sh` rig creates an
  administrator and a user with the `fpgasim-admin` utility and passes the logins and passwords to
  the tests in environment variables, as it passes the key now. Two devices are two browser
  contexts.
- The existing end-to-end tests sign in with a key and do not change, except one test of the key
  form (section 5.1). Their number does not decrease.
- `make e2e-prod`: the account `e2e` on the production server; the password is in the keychain of
  the author's Mac (service `fpgasim-e2e-prod-user`), next to the key. The test creates a project,
  checks it in a second context and deletes it.

## 7. Work stages

The stages are done and deployed on 2026-11-20; the course and the merges are in `docs/progress.md`,
section "After acceptance". The detailed plan (what is done, acceptance criteria, checks for the
author) was removed from the file in the cleanup of 2026-11-22. To get it:
`git show 921c53a:docs/tz-accounts.md`, section 7.

Stage numbers remain in code and test comments:

| Stage | What |
|---|---|
| 1 | Server: accounts and sessions |
| 2 | Interface: sign-in and the "Users" page |
| 3 | Server: projects, trash, database backups |
| 4 | Interface: the sync mechanism |
| 5 | Interface: indicators, conflict, viewing work |
| 6 | Documents, help, deployment |

## 8. Decisions of this document

They are moved to `docs/decisions.md`, starting with decision 117.

The author's decisions (2026-11-20):

1. Sign-in with login and password; there is one administrator, and he grants access himself.
2. Joint work is one login for two people.
3. The administrator views users' projects and copies them for himself; he does not edit in place.
4. All "in browser" projects go to the server, without any action from the user.

Decisions of the spec's implementer (the author can change them):

5. A SQLite database in the `api` service, not a separate service. Reason: up to ten users; a
   separate service adds a container, a deployment and a point of failure with no benefit.
6. The session token in `localStorage` and the `Authorization` header, without cookies. Reason: the
   client already sends the key this way; the static files and the server are at different
   addresses.
7. Keys stay for scripts and for sign-in by link. Reason: 35 end-to-end tests and the benchmarks
   work with a key.
8. Viewing someone else's project is a temporary copy in the administrator's browser, not a
   "read-only" mode in the workspace. Reason: the administrator needs to build and run the project; a
   read-only mode would need changes to all the workspace's actions.
9. A 30-day trash and daily database backups on the VPS; the off-VPS copy is a daily one in R2
   (decision 160) and, by hand, the command `make backup-accounts`.
10. There is no file version history.
11. Local copies of projects stay hidden in the browser after sign-out.
12. A project is open in one browser tab. Reason: a second tab would overwrite the changes that the
    first received from the server.
13. The server does not forget the identifiers of deleted projects and the paths of deleted files.
    Reason: a device that was offline for a long time would otherwise bring back the deleted.
14. The key form is removed; the key-form test is replaced by a sign-in-form test (section 5.1).

## 9. Open items

- The 90-day session period and the limit of 10 failed sign-ins: values chosen by the implementer of
  the spec.
