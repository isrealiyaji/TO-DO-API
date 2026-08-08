# Todo API — REST Design

**Module 2 · Task 1** — Design REST resources, endpoints, and status codes.

This is the contract the API will be refactored to. It was written by auditing the current implementation, so every decision below is tied to something the code does today.

Companion file: [`openapi.yaml`](./openapi.yaml) — the same contract, machine-readable.

---

## 1. Resources

Two resources, one ownership relationship.

```
User (1) ──────< (many) Task
```

### Task

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `userId` | integer | Owner. From the token, never from the request body. |
| `title` | string | Required, 1–255 chars |
| `description` | string \| null | Optional |
| `completed` | boolean | Defaults to `false` |
| `createdAt` | ISO 8601 | |
| `updatedAt` | ISO 8601 | |

### User

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `name` | string | |
| `email` | string | Unique, login identifier |
| `password` | string | bcrypt hash — **never serialised** |
| `createdAt` | ISO 8601 | |

**Every task is owned.** This is the single most important rule in the design, because it is the one the current code does not enforce anywhere. `getSingleTask`, `updateTask`, and `deleteTask` all look up a task by `id` alone, so any authenticated user can read, modify, or delete another user's task by guessing an id.

Every task query must be scoped:

```sql
WHERE id = ? AND user_id = ?
```

`userId` comes from the verified JWT and is ignored if a client sends it in a body. Accepting it would let a user create or reassign tasks on someone else's behalf.

---

## 2. URL conventions

| Rule | Example |
|---|---|
| Version prefix on everything | `/api/v1/tasks` |
| Plural collection nouns | `/tasks`, not `/task` |
| Path parameter identifies one member | `/api/v1/tasks/42` |
| No verbs in paths | `DELETE /api/v1/tasks/42` |
| Filtering is a query, not a resource | `/tasks?completed=true` |

**Version from day one.** Routes currently serve from bare `/tasks`, so there is no way to ship a breaking v2 without breaking every client. `/api/v1` costs nothing now.

---

## 3. Endpoints

Base URL: `/api/v1`

### Auth

| Method | Path | Purpose | Success | Failures |
|---|---|---|---|---|
| `POST` | `/auth/register` | Create an account | `201` + `Location` | `400`, `409` |
| `POST` | `/auth/login` | Exchange credentials for a token | `200` | `400`, `401` |
| `GET` | `/users/me` | Current user's profile | `200` | `401` |

### Tasks

All require `Authorization: Bearer <token>`. All are scoped to the caller.

| Method | Path | Purpose | Success | Failures |
|---|---|---|---|---|
| `POST` | `/tasks` | Create | `201` + `Location` | `400`, `401` |
| `GET` | `/tasks` | List (filter + paginate) | `200` | `400`, `401` |
| `GET` | `/tasks/{taskId}` | Fetch one | `200` | `400`, `401`, `404` |
| `PATCH` | `/tasks/{taskId}` | Partial update | `200` | `400`, `401`, `404` |
| `PUT` | `/tasks/{taskId}` | Full replacement | `200` | `400`, `401`, `404` |
| `DELETE` | `/tasks/{taskId}` | Delete one | `204` | `400`, `401`, `404` |
| `DELETE` | `/tasks?completed=true` | Bulk delete by filter | `204` | `400`, `401` |

**List query parameters**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `completed` | boolean | *unset — all* | Filter by completion |
| `page` | integer ≥ 1 | `1` | Page number |
| `limit` | integer 1–100 | `20` | Page size |
| `sort` | `createdAt` \| `-createdAt` \| `title` \| `-title` | `-createdAt` | `-` = descending |

---

## 4. Status codes

| Code | Used for |
|---|---|
| `200` | Successful `GET`, `PATCH`, `PUT`, login |
| `201` | Resource created. Always with a `Location` header. |
| `204` | Successful `DELETE` |
| `400` | Malformed body, failed validation, bad query param |
| `401` | Missing/invalid/expired token, or bad login credentials |
| `403` | Authenticated but not permitted — reserved for future roles, unused today |
| `404` | Unknown route, or a task that is absent **or not owned** |
| `409` | Request conflicts with current state (duplicate email) |
| `429` | Rate limit exceeded |
| `500` | Unhandled fault. Logged in full; generic message returned. |

**`401` vs `403`.** `401` = "I don't know who you are" → authenticate. `403` = "I know who you are and you still may not" → retrying won't help. A single-role todo API has no way to be authenticated yet forbidden, so `403` stays unused.

**`404`, not `403`, for another user's task.** `403` would confirm the task exists, leaking the id space to anyone probing. `404` makes "doesn't exist" and "not yours" indistinguishable from outside.

**`400` for all validation failures; `422` unused.** Both are defensible. One code plus a structured `details` array gives clients everything they need without drawing a line the ecosystem draws inconsistently.

**An empty list is `200`, never `404`.** The collection exists and was retrieved; it has no members. `404` would force clients to treat "no todos yet" as an error path.

**`500` never carries `err.message`.** The current controllers return `details: err.message`, forwarding raw MySQL errors — table and column names — to any caller. The design logs the full error against a `requestId` and returns only that id.

---

## 5. Response envelope

One shape for success, one for failure.

**Success — single resource**
```json
{ "success": true, "data": { "id": 42, "title": "Write docs", "completed": false }, "meta": null }
```

**Success — collection**
```json
{
  "success": true,
  "data": [ { "id": 42, "title": "Write docs", "completed": false } ],
  "meta": { "page": 1, "limit": 20, "total": 37, "totalPages": 2 }
}
```

**Failure**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [ { "field": "title", "issue": "title is required" } ]
  },
  "requestId": "3f9a1c7e-6b21-4f0e-9c8d-5a2b7e1d4c33"
}
```

`message` is for humans and may be reworded freely. `code` is the stable contract clients branch on — without it, special-casing "email taken" means string-matching a message that breaks the moment the copy changes.

`requestId` appears on every error and matches the server log line, so a reported failure can be traced without guessing from timestamps.

**Single resources return objects, not arrays.** `createTask` returns `data: newTask` where `newTask` is `[{...}]`, and `getSingleTask` returns `data: rows` — the raw driver array. A member endpoint must return an object.

### Error codes

| `error.code` | HTTP |
|---|---|
| `VALIDATION_ERROR` | 400 |
| `INVALID_QUERY_PARAM` | 400 |
| `UNAUTHENTICATED` | 401 |
| `INVALID_CREDENTIALS` | 401 |
| `TASK_NOT_FOUND` | 404 |
| `ROUTE_NOT_FOUND` | 404 |
| `EMAIL_ALREADY_EXISTS` | 409 |
| `RATE_LIMITED` | 429 |
| `INTERNAL_ERROR` | 500 |

---

## 6. Audit — what the current code does

Design decisions above are not stylistic preferences. Each corrects something specific.

### Endpoints that cannot succeed

The schema creates a table named `tasks`. Five queries reference `task`:

| Location | Query |
|---|---|
| `tasksController.js:58` | `SELECT * FROM task` |
| `tasksController.js:92` | `SELECT * FROM task WHERE completed = ?` |
| `tasksController.js:170` | `DELETE FROM task WHERE completed = ?` |
| `tasksController.js:191`, `:204` | `SELECT` / `DELETE FROM task WHERE id = ?` |
| `tasksController.js:224` | `DELETE FROM task` |

Every delete endpoint and `getAllCompletedTasks` throws on every call.

### Catch blocks that throw

Three handlers catch `(error)` but reference `err.message`:

- `tasksController.js:68` (`getAllTasks`)
- `tasksController.js:216` (`deleteTask`)
- `tasksController.js:234` (`deleteAllTask`)

`err` is not defined in those scopes. So `DELETE /tasks/:taskId` fails on the bad table name, then throws a `ReferenceError` while trying to report the failure. The client gets Express's default handler, not the intended `500`.

This is why the design puts error handling in one central place rather than a `try/catch` copy-pasted into every method — copies drift, and these already have.

### Missing ownership checks

`getSingleTask`, `updateTask`, and `deleteTask` query by `id` only. `getallUnfinishedTasks`, `getAllCompletedTasks`, `deleteAllCompletedTask`, and `deleteAllTask` have no `user_id` filter at all — they read and delete across every user's rows.

### A task can never be un-completed

`tasksController.js:146`:

```js
completed || getTask[0].completed
```

`false || true` is `true`. Sending `completed: false` silently keeps the old value. The same `||` guard on `title` and `description` blocks clearing them. The fix is checking `!== undefined`, not truthiness — and it is exactly why `PATCH` needs defined semantics for "field present but falsy".

### Status codes that misreport

| Location | Current | Should be |
|---|---|---|
| `usersController.js:27` | `400` duplicate email | `409` |
| `usersController.js:59` | `400` "User not found" | `401`, identical to a wrong password |
| `tasksController.js:114` | `200` + array when not found | `404` |
| `tasksController.js:43` | `201` with `data` as an array | `201` with an object |

`loginUser` returning a distinguishable response for an unknown email lets anyone enumerate which emails are registered.

### Unhandled rejections

`createUser` (`usersController.js:17`) and `getallUnfinishedTasks` (`tasksController.js:74`) have no `try/catch`. Any DB error becomes an unhandled promise rejection.

### Duplicated auth

`createTask` re-verifies the JWT inline (`tasksController.js:19-34`) although the `auth` middleware already ran and set `req.user`. Because `jwt.verify` **throws** rather than returning falsy, the `if (!verifiedToken)` branch is unreachable and a bad token produces `500` instead of the intended `401`.

### Dead code

`tasksController.js:1` — `const tasks = []`, left from the in-memory version.

---

## 7. Migration map

| Current | Designed | Reason |
|---|---|---|
| `POST /users` | `POST /api/v1/auth/register` | Registration is an auth action |
| `POST /users/login` | `POST /api/v1/auth/login` | Grouped with register |
| `GET /users/tasks` | `GET /api/v1/tasks` | Redundant — the token already scopes tasks |
| `POST /tasks` | `POST /api/v1/tasks` | Version prefix, `Location` header, object not array |
| `GET /tasks` | `GET /api/v1/tasks?completed=&page=&limit=&sort=` | Filtering and pagination |
| `GET /tasks/unfinished` | `GET /api/v1/tasks?completed=false` | Filter, not a resource |
| `GET /tasks/completed` | `GET /api/v1/tasks?completed=true` | Filter, not a resource |
| `GET /tasks/:taskId` | `GET /api/v1/tasks/{taskId}` | Object, real `404`, ownership scope |
| `PUT /tasks/:taskId` | `PATCH /api/v1/tasks/{taskId}` | Partial update is `PATCH`; fixes the `\|\|` bug |
| `DELETE /tasks/:taskId` | `DELETE /api/v1/tasks/{taskId}` | `204`, ownership scope, working table name |
| `DELETE /tasks/completed` | `DELETE /api/v1/tasks?completed=true` | Filter, not a resource |
| `DELETE /tasks` | *removed* | Unguarded wipe across all users |
| `{ error, details: err.message }` | one envelope + `requestId` | Stop leaking driver errors |

**`/tasks/completed` and `/tasks/unfinished` are also fragile.** They only work because they are registered above `/tasks/:taskId` in `tasksRoute.js`. Reorder those lines and `"completed"` is parsed as a task id. Query parameters remove the ordering dependency entirely and scale to more filters without new routes.

**Breaking changes.** Every path changes, `PUT` becomes `PATCH`, deletes return `204`, and the error shape changes. With no external consumers yet, this ships as a clean cut to `v1` rather than a compatibility layer.

---

## 8. Open questions

- **`400` vs `422`.** Chose `400` for everything. Not certain when splitting them genuinely helps a team.
- **Offset vs cursor pagination.** Offset (`page`/`limit`) is simple and supports jump-to-page but drifts when rows are inserted mid-scroll. Unclear at what scale that stops being acceptable.
- **Is the `{success, data, meta}` envelope worth it?** Every client unwraps `.data`, and the HTTP status already signals success. Some APIs return the bare resource.
- **Soft delete.** A real `DELETE` is unrecoverable. `deletedAt` plus an `includeDeleted` filter would fix that but touches every query.
- **Bulk delete semantics.** `DELETE /tasks?completed=true` returns `204` even when nothing matched. Consistent with idempotency, but a client can't tell "cleared 12" from "nothing to clear" — and returning a count means `200` with a body, contradicting the `204` rule.
