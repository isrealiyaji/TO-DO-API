# Pagination, Filtering, Sorting & Search

**Module 2 · Task 4**

All four are query parameters on one endpoint: `GET /api/v1/tasks`. None of them
is a separate route, because none of them is a separate resource — a completed
task is still a task, and a searched task is still a task.

---

## The parameters

| Parameter | Type | Default | Example |
|---|---|---|---|
| `page` | integer ≥ 1 | `1` | `?page=3` |
| `limit` | integer 1–100 | `20` | `?limit=50` |
| `sort` | comma-separated fields | `-createdAt` | `?sort=-completed,title` |
| `completed` | `true` / `false` | *unset — all* | `?completed=false` |
| `search` | string, 1–100 chars | *unset* | `?search=report` |
| `createdAfter` | date | *unset* | `?createdAfter=2026-01-01` |
| `createdBefore` | date | *unset* | `?createdBefore=2026-06-30` |

They combine freely:

```
GET /api/v1/tasks?search=report&completed=false&sort=-createdAt&page=2&limit=10
```

Unknown parameters are **rejected**, not ignored. `?pageSize=10` returns a 400
naming the mistake rather than silently returning the default 20 and leaving the
client to wonder why their setting had no effect.

---

## Response shape

```json
{
  "success": true,
  "data": [ { "id": 42, "title": "Write docs", "completed": false } ],
  "meta": {
    "page": 2,
    "limit": 10,
    "total": 37,
    "totalPages": 4,
    "hasNextPage": true,
    "hasPreviousPage": true
  }
}
```

`hasNextPage` and `hasPreviousPage` are computed server-side. The client could
derive them from `page` and `totalPages`, but that is arithmetic every client
would have to repeat and some would get wrong at the boundaries.

---

## 1. Pagination

`page` and `limit` become `LIMIT` and `OFFSET`:

```
page=3, limit=20  →  LIMIT 20 OFFSET 40
```

**`limit` is capped at 100.** Without a cap, `?limit=999999999` is a one-request
denial of service: the database builds the whole result set and the server
serialises it into memory. The cap is a rejection rather than a silent clamp, so
a client asking for 500 learns their request was wrong instead of quietly
receiving 100.

**Two queries run, not one.** A page of 20 rows cannot tell you whether 21 or
2,100 rows matched, so `total` needs its own `COUNT(*)`. They are independent, so
they run concurrently with `Promise.all` rather than one after the other.

**An empty page is `200`, not `404`.** Asking for page 50 of 3 is a legitimate
question whose answer is "nothing". `404` would mean the endpoint does not exist.

### The limitation

Offset pagination drifts when rows are inserted while a client is paging. If a
new task is created between the request for page 1 and page 2, everything shifts
down by one and the row that was last on page 1 appears again at the top of
page 2.

Cursor pagination — "give me 20 rows after id 42" — does not have this problem,
but it cannot jump to an arbitrary page. Offset was chosen because jump-to-page
is worth more than perfect consistency for a personal task list. See the open
questions.

---

## 2. Filtering

Three filters, all optional, all combined with `AND`:

```sql
WHERE user_id = ?
  AND completed = ?          -- if ?completed= given
  AND created_at >= ?        -- if ?createdAfter= given
  AND created_at <= ?        -- if ?createdBefore= given
```

**`user_id` is never optional.** It is the first clause of every filter and
comes from the verified token. There is no code path in the repository that
reads or deletes a task without scoping it to its owner.

**An impossible date range is a `400`.** If `createdAfter` is later than
`createdBefore`, no row can ever match. Returning an empty list would be
technically correct and practically useless — the client would hunt for missing
data instead of a swapped parameter. One comparison in the schema catches it.

---

## 3. Sorting

`sort` takes a comma-separated list. A leading `-` means descending:

```
?sort=-completed,title   →  ORDER BY completed DESC, title ASC, id ASC
```

Allowed fields: `createdAt`, `updatedAt`, `title`, `completed`.

### Why sort fields are whitelisted

A sort column **cannot be a bound parameter**. `ORDER BY ?` is not valid SQL —
the column name has to be written into the query text. That makes it the one
place user input touches SQL directly, and therefore the one place SQL injection
could occur.

Two gates prevent it:

1. The schema rejects anything not in `SORT_FIELDS`.
2. The repository looks the name up in a fixed `SORT_COLUMNS` map.

`?sort=title; DROP TABLE tasks` fails at the first gate with a 400. Even if it
somehow passed, the second gate has no entry for it.

### Why `id ASC` is always appended

```sql
ORDER BY completed DESC, id ASC
```

Sorting by `completed` alone leaves every unfinished task tied. SQL does not
promise any particular order for tied rows, and MySQL is free to return them
differently between two identical queries.

That is not a cosmetic problem — it **breaks pagination**. If the order shifts
between the request for page 1 and page 2, a row can appear on both pages, or on
neither. Appending the unique `id` guarantees a total order, so the sequence is
identical every time.

### Repeated fields are rejected

`?sort=title,-title` is contradictory and almost always a client bug, so it
returns a 400 rather than silently using whichever came first.

---

## 4. Search

`?search=report` matches a substring in **either** the title or the description:

```sql
AND (title LIKE ? OR description LIKE ?)   -- both bound to '%report%'
```

Case-insensitive, because MySQL's default collation is.

### Escaping the wildcards

This is the part that is easy to get wrong. A bound parameter stops SQL
injection, but it does **not** stop `%` and `_` from being treated as wildcards
inside a `LIKE` pattern.

Without escaping:

| Search for | Actually matches |
|---|---|
| `50%` | anything starting with "50" |
| `a_b` | "aXb", "a1b", any single character between |
| `%` | **every row** |

So the term is escaped before it becomes a pattern:

```js
const escapeLike = (term) => term.replace(/[\\%_]/g, (char) => `\\${char}`);
```

Backslash is handled first in the character class — escaping it after `%` and `_`
would double-escape the backslashes just added.

### Why search is slow, and why that is fine for now

`LIKE '%term%'` **cannot use an index**. An index is sorted by how values
*start*, so it can answer "everything beginning with report" instantly. "Anything
*containing* report" gives it no starting point, and the database reads every row
belonging to the user.

For one person's task list, that is a scan of a few hundred rows and is fine.
The proper fix at scale is a `FULLTEXT` index:

```sql
ALTER TABLE tasks ADD FULLTEXT INDEX ft_tasks_search (title, description);
```

It is documented in `migrations/002` but deliberately **not enabled**, because it
changes the *meaning* of search rather than just its speed. `FULLTEXT` matches
whole words, so `?search=port` would stop finding "Import report". That is a
product decision, not a performance tweak.

---

## Indexes

`migrations/002_search_and_sort_indexes.sql` adds four:

```sql
(user_id, created_at)              -- default sort
(user_id, updated_at)              -- ?sort=updatedAt
(user_id, title)                   -- ?sort=title
(user_id, completed, created_at)   -- ?completed=false&sort=-createdAt
```

**Every one leads with `user_id`.** An index can only be used when the query
filters on its leftmost column, and every list query is scoped to a user. An
index on `created_at` alone would be unusable here.

Run them with:

```bash
npm run migrate
```

The runner now executes every `.sql` file in `migrations/` in filename order,
which is why they are numbered. It does not yet track which have already been
applied, so re-running fails on existing indexes.

---

## Verified behaviour

35 checks against the real schemas, no database required:

```
== defaults ==        empty query valid; page=1, limit=20, sort=-createdAt
== coercion ==        "3" → 3;  "true" → true;  "false" → false
== bounds ==          page=0, page=-1, page=abc, page=1.5, limit=0, limit=101 all rejected
== sorting ==         multi-field order preserved; unknown field rejected;
                      "title; DROP TABLE tasks" rejected; repeated field rejected
== search ==          trimmed; empty rejected; over-100-chars rejected
== LIKE escaping ==   "50%" → "50\%";  "a_b" → "a\_b";  "a\b" → "a\\b";  "%" → "\%"
== dates ==           bad date rejected; inverted range rejected
== unknown params ==  ?pageSize=10 rejected

35 passed, 0 failed
```

---

## Open questions

- **Offset vs cursor pagination.** Offset drifts when rows are inserted mid-page.
  Cursor is stable but cannot jump to page 7. Unclear at what list size the
  trade flips.
- **Whether `COUNT(*)` on every request is worth it.** It doubles the queries per
  list call. Many APIs drop `total` entirely and return only `hasNextPage`,
  which needs no count — fetch `limit + 1` rows and check whether the extra one
  exists.
- **Whether search should cover the description at all.** Matching it makes the
  scan wider and can surface tasks whose titles look irrelevant to the user.
- **Whether to switch to `FULLTEXT`.** It is much faster but stops matching
  partial words, and I do not know which behaviour users would actually expect.
- **No relevance ranking.** Results come back in whatever `sort` says, so a title
  that exactly matches the search term is not ranked above a description that
  mentions it in passing.
