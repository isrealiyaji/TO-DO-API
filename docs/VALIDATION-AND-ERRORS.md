# Request Validation & Centralized Error Handling

**Module 2 · Task 3**

Every request is checked against a schema before a controller runs, and every
failure — expected or not — becomes a response in one place.

---

## 1. Why runtime validation

The server cannot trust anything a client sends. A request can arrive with a
missing field, a number where a string belongs, a `limit` of 5000, or a key
nobody planned for. Those checks have to happen **while the server is running**,
against the real request. That is what "runtime" means here: TypeScript would
check the code as written, but nothing about compiled code stops a client
sending `{ "title": 12345 }`.

Before this task, validation was hand-written `if` statements at the top of each
controller:

```js
if (!title) {
  return res.status(400).json({ success: false, message: "Title is required" });
}
```

Three problems with that:

1. **It stops at the first error.** A client with three bad fields submits three
   times to discover all three.
2. **It was inconsistent.** `createTask` checked `title`. Nothing checked that
   `completed` was a boolean, that `taskId` was a number, or that `limit` was
   sane.
3. **It mixed concerns.** "Is this a string?" sat in the same function as
   "does this task exist?" and "run this SQL".

## 2. Schemas

Shapes are declared in [`validation/`](../validation) using
[zod](https://zod.dev) v4.

```js
const createTaskBody = z
  .object({
    title: z.string({ error: "title is required" }).trim().min(1).max(255),
    description: z.string().nullable().default(null),
    completed: z.boolean().default(false),
  })
  .strict();
```

A schema does four jobs at once:

| Job | Example |
|---|---|
| **Type checking** | `completed` must be a boolean, not `"yes"` |
| **Range checking** | `title` 1–255 chars, `limit` 1–100 |
| **Coercion** | `"42"` from a URL becomes the number `42` |
| **Defaults** | omitted `page` becomes `1` |

### `.strict()` — unknown keys are rejected

```json
POST /api/v1/auth/register
{ "name": "Isreal", "email": "a@b.com", "password": "password123", "isAdmin": true }
```

```json
400 { "field": "body", "issue": "Unrecognized key: \"isAdmin\"" }
```

Two reasons this matters. A typo like `titel` gets named instead of producing a
confusing "title is required". And a client cannot smuggle in a field the server
never intended to accept — `userId` on a task body, for instance, which would
otherwise be a way to create a task owned by someone else.

### PATCH vs PUT, expressed as schemas

The difference between the two methods is now a difference between two schemas,
not a comment:

```js
// PATCH: all optional, but at least one must be present
patchTaskBody = z.object({ ... all .optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    error: "at least one of title, description, completed is required",
  });

// PUT: full replacement, so every field is required
replaceTaskBody = z.object({ title, description, completed }).strict();
```

**This is where the `completed: false` bug dies.** The old code merged updates
with `completed || existing`, and because `false` is falsy it was always
discarded — a task could never be un-completed. A schema distinguishes *a key
that was not sent* from *a key set to false*, so only the keys the client
actually sent reach the update.

### Bulk delete needs a filter

```js
bulkDeleteQuery = z.object({
  completed: z.enum(["true", "false"], {
    error: "completed is required, e.g. ?completed=true",
  }).transform((v) => v === "true"),
}).strict();
```

The old `DELETE /tasks` took no parameters and deleted every row in the table
for every user. Making the filter **required in the schema** means the
destructive call cannot be reached by dropping a path segment.

## 3. The validate middleware

[`middleware/validate.js`](../middleware/validate.js) applies schemas to
`params`, `query` and `body`:

```js
router.post("/", validate({ body: createTaskBody }), asyncHandler(controller.create));
```

Two design decisions:

**All three sources are checked before returning.** The middleware collects
errors from `params`, `query` and `body`, then reports them together. A client
fixing a request should learn everything wrong with it in one round trip.

**The parsed result replaces the raw input.** After validation, `req.body` is
the *validated* object — trimmed, coerced, defaults applied, unknown keys gone.
Downstream code can use it without re-checking, which is why the service layer
no longer contains a single type check.

## 4. What stayed in the services

Validation moved out; judgment stayed in. The split:

| Question | Where | Why |
|---|---|---|
| Is `title` a string under 255 chars? | schema | A fact about the request. No database needed. |
| Is `taskId` a positive integer? | schema | Same. |
| Does task 42 exist? | service | Needs a query. |
| Does task 42 belong to *this* user? | service | Needs a query and a rule. |
| Is this email already taken? | service | Needs a query. |

A schema can describe the shape of a request. It cannot know who owns a row.

## 5. Centralized error handling

Every failure ends up in
[`middleware/errorHandler.js`](../middleware/errorHandler.js). Nothing else
formats an error body.

### How errors get there

| Source | Mechanism |
|---|---|
| A service | `throw AppError.taskNotFound()` |
| Validation | `next(AppError.badRequest(...))` |
| An async controller | `asyncHandler` catches the rejection and calls `next(err)` |
| An unmatched URL | `notFoundHandler` |
| A library (express, jwt, mysql) | throws; normalised in the handler |

`asyncHandler` matters more than it looks. Express 4 does not catch rejected
promises from async handlers — without the wrapper, a failed `await` becomes an
unhandled rejection and **the request hangs forever**.

### Two paths out

```js
const known = normalise(err);

if (known) {
  // Expected. Return its own code and message.
  return res.status(known.statusCode).json({ ... });
}

// Unexpected: a bug. Log everything, return nothing.
logger.error("Unhandled error", { requestId, stack: err.stack, ... });
return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
```

The old code did this instead:

```js
res.status(500).json({ error: "Error creating task", details: err.message });
```

That forwarded **raw MySQL errors** — table names, column names, SQL fragments —
to anyone who could trigger one. Internal detail now goes to the log and only a
correlation id comes back.

### Library errors are translated, not swallowed

`normalise()` maps framework failures onto the right status code:

| Thrown by | Becomes |
|---|---|
| `express.json()` on bad JSON | `400 VALIDATION_ERROR` — "Request body is not valid JSON" |
| body over the 100kb limit | `413 PAYLOAD_TOO_LARGE` |
| `jsonwebtoken` | `401 UNAUTHENTICATED` |
| MySQL `ER_DUP_ENTRY` | `409 EMAIL_ALREADY_EXISTS` |
| MySQL `ECONNREFUSED` | `503 SERVICE_UNAVAILABLE` |

Without this, malformed JSON produced a generic 500 — "an unexpected error
occurred" — when the request was simply wrong and the client could have fixed it.

The `ER_DUP_ENTRY` mapping closes a real race. Two concurrent registrations can
both pass the "does this email exist?" check before either commits. The unique
index on `users.email` is the actual guarantee, and this turns that database
error into the same 409 the pre-check would have produced.

### Why 503 for a dead database

`500` says "I broke". `503` says "I am temporarily unavailable" — the request was
fine and retrying later may work. That difference tells a client whether a retry
is worth attempting.

## 6. Request ids

[`middleware/requestId.js`](../middleware/requestId.js) assigns every request a
UUID, returns it as `X-Request-Id`, and includes it in the error body **and** the
log line:

```json
{"level":"warn","message":"Request validation failed","requestId":"7d8aadc7-...","method":"POST","path":"/api/v1/auth/register","statusCode":400}
```

```json
{ "success": false, "error": { ... }, "requestId": "7d8aadc7-..." }
```

A user reporting "I got an error" can quote one string that leads straight to the
matching log entry, instead of you guessing from timestamps. An incoming
`X-Request-Id` is honoured so an id assigned upstream survives.

## 7. Process-level safety nets

The error middleware only sees failures **inside a request**. A promise rejected
in a background timer never reaches it. [`index.js`](../index.js) adds:

```js
process.on("unhandledRejection", (err) => shutdown(...));
process.on("uncaughtException", (err) => shutdown(...));
```

Both log and then exit. After an uncaught exception the process may hold
corrupted state, so letting a supervisor restart it cleanly is safer than
continuing to serve from it. `SIGINT`/`SIGTERM` shut down gracefully instead —
finish in-flight requests, then close the connection pool.

## 8. Verified behaviour

Run against the real app, no database required (all of these fail before any
query runs):

| Request | Status | Response |
|---|---|---|
| `GET /health` | `200` | `{"status":"ok","requestId":"..."}` |
| `GET /api/v1/nope` | `404` | `ROUTE_NOT_FOUND` — "Cannot GET /api/v1/nope" |
| `GET /api/v1/tasks` (no token) | `401` | `UNAUTHENTICATED` — "A bearer token is required" |
| `POST /auth/register` `{}` | `400` | three errors at once: name, email, password all required |
| `POST /auth/register` bad email + short password | `400` | "a valid email is required", "password must be at least 8 characters" |
| `POST /auth/register` with `isAdmin: true` | `400` | `Unrecognized key: "isAdmin"` |
| `POST /auth/register` with `{ this is not json` | `400` | "Request body is not valid JSON" — **not** a 500 |

## 9. Open questions

- **Whether `.strict()` everywhere is too harsh.** It catches typos and blocks
  smuggled fields, but it also means adding an optional field to a client before
  the server knows about it is a hard 400 rather than a silent ignore.
- **Whether zod's default messages should be surfaced at all.** Each one is
  overridden by hand today, which is precise but repetitive; a global error map
  would be less code and less control.
- **Where to draw the line on 503.** Only a few MySQL error codes are mapped.
  Others still become 500, and it is not obvious which of them a client could
  usefully retry.
- **Log volume.** Every 4xx currently logs at `warn`. A client looping on a bad
  request would fill the log with noise, so this probably needs rate limiting or
  sampling before production.
