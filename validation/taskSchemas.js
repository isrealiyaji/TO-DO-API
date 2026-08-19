const { z } = require("zod");

/**
 * Request shapes for the task endpoints.
 *
 * A schema describes what a valid request looks like. The validate middleware
 * checks the incoming request against it before any controller runs, so by the
 * time a service is called the data is already the right shape.
 *
 * This is "runtime" validation because the checks happen while the server is
 * running, against real request data. TypeScript would only check the code as
 * written; nothing about a compiled program stops a client sending
 * { title: 12345 }.
 *
 * Written against zod v4, where a custom message for a wrong or missing value
 * is given as `error` rather than v3's invalid_type_error / required_error.
 */

const MAX_TITLE = 255;
const MAX_LIMIT = 100;
const MAX_SEARCH = 100;

/**
 * Fields a client may sort by.
 *
 * A sort column cannot be a bound parameter — it has to be interpolated into
 * the SQL text. Validating against this fixed list here is what makes that
 * safe: nothing a client sends ever reaches the query unless it is one of
 * these exact strings.
 */
const SORT_FIELDS = ["createdAt", "updatedAt", "title", "completed"];

/** Path parameters arrive as strings, so coerce before checking the range. */
const taskIdParam = z.object({
  taskId: z.coerce
    .number({ error: "taskId must be a number" })
    .int("taskId must be a whole number")
    .positive("taskId must be greater than 0"),
});

const title = z
  .string({ error: "title is required" })
  .trim()
  .min(1, "title is required")
  .max(MAX_TITLE, `title must be at most ${MAX_TITLE} characters`);

// .nullable() allows an explicit null to clear the field.
const description = z
  .string({ error: "description must be a string or null" })
  .nullable();

const completed = z.boolean({ error: "completed must be true or false" });

const createTaskBody = z
  .object({
    title,
    description: description.default(null),
    completed: completed.default(false),
  })
  // Rejects unknown keys instead of silently dropping them. A client sending
  // { titel: "..." } is told about the typo rather than getting a confusing
  // "title is required". It also blocks userId being smuggled in via the body.
  .strict();

/**
 * PATCH body: every field optional, but at least one required.
 *
 * Because zod distinguishes a key that is absent from one set to false,
 * completed:false is applied rather than discarded — the bug the old
 * `completed || existing` guard caused.
 */
const patchTaskBody = z
  .object({
    title: title.optional(),
    description: description.optional(),
    completed: completed.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    error: "at least one of title, description, completed is required",
  });

/** PUT body: full replacement, so every field must be present. */
const replaceTaskBody = z
  .object({
    title,
    description,
    completed,
  })
  .strict();

/**
 * Parses a sort string into an ordered list of columns.
 *
 * "-completed,title" becomes
 *   [{ field: "completed", descending: true }, { field: "title", descending: false }]
 *
 * Multiple keys matter because one key rarely gives a stable order. Sorting by
 * `completed` alone leaves every unfinished task in whatever order MySQL
 * happens to return, which can differ between identical requests.
 */
const sortParam = z
  .string({ error: "sort must be a string" })
  .default("-createdAt")
  .transform((value, ctx) => {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      ctx.addIssue({ code: "custom", message: "sort cannot be empty" });
      return z.NEVER;
    }

    const parsed = [];
    const seen = new Set();

    for (const part of parts) {
      const descending = part.startsWith("-");
      const field = descending ? part.slice(1) : part;

      if (!SORT_FIELDS.includes(field)) {
        ctx.addIssue({
          code: "custom",
          message: `sort field '${field}' is not allowed. Use one of: ${SORT_FIELDS.join(", ")}, each optionally prefixed with '-' for descending`,
        });
        return z.NEVER;
      }

      // Repeating a column is meaningless and usually signals a client bug.
      if (seen.has(field)) {
        ctx.addIssue({ code: "custom", message: `sort field '${field}' is repeated` });
        return z.NEVER;
      }

      seen.add(field);
      parsed.push({ field, descending });
    }

    return parsed;
  });

/** Query strings are always strings, so booleans, numbers and dates are coerced. */
const listTasksQuery = z
  .object({
    // Filtering
    completed: z
      .enum(["true", "false"], { error: "completed must be 'true' or 'false'" })
      .transform((value) => value === "true")
      .optional(),
    createdAfter: z.coerce
      .date({ error: "createdAfter must be a date, e.g. 2026-01-31" })
      .optional(),
    createdBefore: z.coerce
      .date({ error: "createdBefore must be a date, e.g. 2026-01-31" })
      .optional(),

    // Search. Bounded because the term goes into a LIKE pattern, and an
    // unbounded string there is an easy way to make the database work hard.
    search: z
      .string({ error: "search must be a string" })
      .trim()
      .min(1, "search cannot be empty")
      .max(MAX_SEARCH, `search must be at most ${MAX_SEARCH} characters`)
      .optional(),

    // Pagination
    page: z.coerce
      .number({ error: "page must be a number" })
      .int("page must be a whole number")
      .positive("page must be 1 or more")
      .default(1),
    limit: z.coerce
      .number({ error: "limit must be a number" })
      .int("limit must be a whole number")
      .min(1, "limit must be at least 1")
      .max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`)
      .default(20),

    // Sorting
    sort: sortParam,
  })
  .strict()
  // A range that can never match is a client mistake, not an empty result.
  // Saying so costs one comparison and saves a confusing "no tasks found".
  .refine(
    (query) =>
      !query.createdAfter ||
      !query.createdBefore ||
      query.createdAfter <= query.createdBefore,
    { error: "createdAfter must be earlier than or equal to createdBefore" }
  );

/**
 * Bulk delete query: the filter is required, not optional.
 *
 * This is what removes the old unguarded DELETE /tasks, which deleted every
 * row in the table for every user. A destructive call can no longer be reached
 * by dropping a path segment.
 */
const bulkDeleteQuery = z
  .object({
    completed: z
      .enum(["true", "false"], {
        error: "completed is required, e.g. ?completed=true",
      })
      .transform((value) => value === "true"),
  })
  .strict();

module.exports = {
  taskIdParam,
  createTaskBody,
  patchTaskBody,
  replaceTaskBody,
  listTasksQuery,
  bulkDeleteQuery,
  SORT_FIELDS,
};
