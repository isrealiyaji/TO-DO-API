# Todo API

A task management REST API built with Express and MySQL. Each user has their own
tasks, authenticated with JWT, with filtering, search, sorting and pagination.

Built as the Module 2 project of a Production-Ready Node.js Backend Developer
programme: taking a working-but-rough API and making it something you could
actually deploy.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [API reference](#api-reference)
- [Errors](#errors)
- [Project structure](#project-structure)
- [Further documentation](#further-documentation)

---

## Features

- **JWT authentication** — register, log in, and every task scoped to its owner
- **Full CRUD** on tasks, with `PATCH` and `PUT` meaning different things
- **Filtering** by completion state and creation date range
- **Search** across title and description
- **Sorting** by multiple fields, ascending or descending
- **Pagination** with total counts and next/previous flags
- **Schema validation** on every request, reporting all errors at once
- **Centralized error handling** with correlation ids and structured JSON logs
- **Layered architecture** — routes, controllers, services, repositories

---

## Architecture

Four layers, each with one job. A layer only talks to the one below it.

```
Request
   │
   ▼
routes/          URL + method + auth + which schema applies
   │
   ▼
middleware/      auth (who are you), validate (is this request well-formed)
   │
   ▼
controllers/     read req, call one service, send the response
   │
   ▼
services/        business rules: ownership, existence, what a result means
   │
   ▼
repositories/    SQL, and nothing else
   │
   ▼
MySQL
```

| Layer | Knows about | Never knows about |
|---|---|---|
| Routes | URLs and methods | Data, SQL, rules |
| Controllers | `req`, `res`, status codes | SQL, business rules |
| Services | Rules, ownership | HTTP, SQL |
| Repositories | SQL, table and column names | HTTP, rules |

Two consequences worth knowing:

**Every task query is scoped by `user_id`.** There is deliberately no
`findById(id)` in the repository — only `findByIdAndUser(id, userId)`. Reading
another user's task is not a mistake you can make, because the function to do it
does not exist.

**`app.js` is separate from `index.js`.** `app.js` builds the Express app;
`index.js` connects to MySQL and listens. That lets tests import the app without
opening a port.

---

## Getting started

### Requirements

- Node.js 18+ (the app uses `crypto.randomUUID` and native `fetch`)
- MySQL 5.7+

### 1. Install

```bash
git clone https://github.com/isrealiyaji/TO-DO-API.git
cd TO-DO-API
npm install
```

### 2. Configure

Copy the example file and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DB_HOST` | yes | — | e.g. `localhost` |
| `DB_USER` | yes | — | e.g. `root` |
| `DB_PASSWORD` | no | empty | |
| `DB_NAME` | yes | — | e.g. `todo_api` |
| `JWT_SECRET` | yes | — | a long random string |
| `PORT` | no | `3500` | |
| `CORS_ORIGIN` | no | `*` | set to your frontend origin in production |

The server refuses to start if any required variable is missing, rather than
failing later on the first request.

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Create the database and tables

```sql
CREATE DATABASE todo_api;
```

```bash
npm run migrate
```

This runs every `.sql` file in `migrations/` in filename order — the schema,
then the indexes supporting sorting and filtering.

### 4. Run

```bash
npm run dev     # nodemon, reloads on change
npm start       # plain node
```

```
{"level":"info","message":"Database connected successfully", ...}
{"level":"info","message":"Server started","port":3500,"baseUrl":"http://localhost:3500/api/v1"}
```

Check it is alive:

```bash
curl http://localhost:3500/health
```

---

## API reference

**Base URL:** `http://localhost:3500/api/v1`

All task endpoints require a bearer token:

```
Authorization: Bearer <token>
```

### Response envelope

Every response uses one of two shapes.

**Success**
```json
{ "success": true, "data": { }, "meta": null }
```

**Failure**
```json
{
  "success": false,
  "error": { "code": "TASK_NOT_FOUND", "message": "Task not found", "details": [] },
  "requestId": "3f9a1c7e-6b21-4f0e-9c8d-5a2b7e1d4c33"
}
```

Branch on `error.code`, not on `message` — the code is stable, the message may be
reworded.

---

### Auth

#### `POST /auth/register`

```json
{ "name": "Isreal", "email": "isreal@example.com", "password": "password123" }
```

`201 Created`, `Location: /api/v1/users/me`

```json
{
  "success": true,
  "data": { "id": 7, "name": "Isreal", "email": "isreal@example.com", "createdAt": "2026-08-19T10:00:00.000Z" },
  "meta": null
}
```

| Code | When |
|---|---|
| `400` | Missing field, invalid email, password under 8 characters |
| `409` | Email already registered |

The password hash is never returned by any endpoint.

#### `POST /auth/login`

```json
{ "email": "isreal@example.com", "password": "password123" }
```

`200 OK`

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 3600,
    "user": { "id": 7, "name": "Isreal", "email": "isreal@example.com" }
  },
  "meta": null
}
```

| Code | When |
|---|---|
| `400` | Email or password missing |
| `401` | Wrong credentials |

An unknown email and a wrong password return an **identical** `401`, so registered
emails cannot be discovered by comparing responses.

#### `GET /users/me`

`200 OK` with the current user. `401` if the token is missing, invalid or expired.

---

### Tasks

#### `POST /tasks`

```json
{ "title": "Write documentation", "description": "Finish the README", "completed": false }
```

Only `title` is required. `201 Created`, `Location: /api/v1/tasks/42`.

Unknown fields are **rejected**, not ignored — including `userId`, which always
comes from the token.

#### `GET /tasks`

| Parameter | Type | Default | Example |
|---|---|---|---|
| `page` | integer ≥ 1 | `1` | `?page=3` |
| `limit` | integer 1–100 | `20` | `?limit=50` |
| `sort` | comma-separated | `-createdAt` | `?sort=-completed,title` |
| `completed` | `true` / `false` | all | `?completed=false` |
| `search` | string 1–100 | — | `?search=report` |
| `createdAfter` | date | — | `?createdAfter=2026-01-01` |
| `createdBefore` | date | — | `?createdBefore=2026-06-30` |

Sortable fields: `createdAt`, `updatedAt`, `title`, `completed`. A leading `-`
sorts descending.

```bash
curl "http://localhost:3500/api/v1/tasks?search=report&completed=false&sort=-createdAt&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "userId": 7,
      "title": "Write quarterly report",
      "description": null,
      "completed": false,
      "createdAt": "2026-08-19T10:00:00.000Z",
      "updatedAt": "2026-08-19T10:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 37, "totalPages": 4, "hasNextPage": true, "hasPreviousPage": false }
}
```

No matches returns `200` with an empty array, never `404`.

Search matches a substring in title **or** description, case-insensitively. `%`
and `_` are escaped, so searching `50%` finds a literal "50%".

#### `GET /tasks/{taskId}`

`200` with a single task object. `404` if it does not exist **or** belongs to
someone else — the two are indistinguishable on purpose.

#### `PATCH /tasks/{taskId}`

Partial update. Send only what changes:

```json
{ "completed": true }
```

At least one of `title`, `description`, `completed` is required. Sending
`completed: false` genuinely sets it to false.

#### `PUT /tasks/{taskId}`

Full replacement. **All three** fields are required — omitting `description` is
an error, not "leave it alone". Send `null` to clear it.

#### `DELETE /tasks/{taskId}`

`204 No Content`. `404` if absent or not owned.

#### `DELETE /tasks?completed=true`

Bulk delete by filter. `204 No Content`.

The filter is **required**. There is no way to delete every task in one call.

---

## Errors

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | A field failed validation |
| `INVALID_QUERY_PARAM` | 400 | A filter or pagination value was invalid |
| `UNAUTHENTICATED` | 401 | Token missing, invalid or expired |
| `INVALID_CREDENTIALS` | 401 | Login rejected |
| `TASK_NOT_FOUND` | 404 | Task absent or not owned |
| `ROUTE_NOT_FOUND` | 404 | No handler for that method and path |
| `EMAIL_ALREADY_EXISTS` | 409 | Email already registered |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 100kb |
| `INTERNAL_ERROR` | 500 | Unexpected fault |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable — retrying may work |

Validation errors list **every** problem at once:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "issue": "a valid email is required" },
      { "field": "password", "issue": "password must be at least 8 characters" }
    ]
  },
  "requestId": "3f9a1c7e-..."
}
```

Every response carries an `X-Request-Id` header, and the same id appears in the
error body and the server log line. Quote it when reporting a problem and the
exact request can be found.

Internal details — SQL text, table names, stack traces — are never returned. They
go to the log against the request id.

---

## Project structure

```
├── app.js                    Express app: middleware + routes (no server)
├── index.js                  Startup: config check, DB connect, listen, signals
├── config/
│   └── db.js                 MySQL connection pool
├── routes/
│   ├── index.js              Mounts every resource
│   ├── authRoutes.js         /auth/register, /auth/login
│   ├── userRoutes.js         /users/me
│   └── taskRoutes.js         /tasks
├── controllers/              Read request, call service, send response
├── services/                 Business rules. No HTTP, no SQL.
├── repositories/             SQL only. No HTTP, no rules.
├── validation/               zod schemas per request
├── middleware/
│   ├── auth.js               Verifies the token, sets req.user
│   ├── validate.js           Runs schemas against params/query/body
│   ├── requestId.js          Correlation id per request
│   └── errorHandler.js       The single place errors become responses
├── utils/
│   ├── AppError.js           Errors that carry their own status code
│   ├── asyncHandler.js       Forwards async rejections to Express
│   ├── respond.js            Success response helpers
│   └── logger.js             Structured JSON logging
├── migrations/               Schema and indexes
└── docs/                     Design and implementation notes
```

---

## Further documentation

| Document | Covers |
|---|---|
| [docs/API-DESIGN.md](docs/API-DESIGN.md) | Why the resources, URLs and status codes are what they are |
| [docs/VALIDATION-AND-ERRORS.md](docs/VALIDATION-AND-ERRORS.md) | Schema validation and the error pipeline |
| [docs/QUERYING.md](docs/QUERYING.md) | Pagination, filtering, sorting and search in depth |
| [docs/openapi.yaml](docs/openapi.yaml) | Machine-readable spec — paste into [editor.swagger.io](https://editor.swagger.io) |

---

## Known limitations

- **Offset pagination drifts.** Inserting rows while paging can make a task
  appear on two pages. Cursor pagination would fix it at the cost of
  jump-to-page.
- **Search cannot use an index.** `LIKE '%term%'` scans every row belonging to
  the user. Fine at personal scale; a `FULLTEXT` index is the fix, but it matches
  whole words and would change search behaviour.
- **No automated tests yet.** Behaviour has been verified with scripted checks,
  not a test suite. That is the next module.
- **No rate limiting.** `429` is defined in the error codes but nothing emits it.
- **Migrations are not tracked.** Re-running `npm run migrate` fails on objects
  that already exist; there is no `schema_migrations` table.
- **Tokens cannot be revoked.** A JWT is valid until it expires, one hour after
  issue. There is no logout or refresh.

---

## License

ISC
