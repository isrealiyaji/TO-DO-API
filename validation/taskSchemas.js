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
 * Without it a client is told "Invalid input: expected string, received
 * undefined", which leaks the validator's vocabulary instead of explaining the
 * problem.
 */

const MAX_TITLE = 255;
const MAX_LIMIT = 100;

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

/** Query strings are always strings, so booleans and numbers are coerced. */
const listTasksQuery = z
  .object({
    completed: z
      .enum(["true", "false"], { error: "completed must be 'true' or 'false'" })
      .transform((value) => value === "true")
      .optional(),
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
    sort: z
      .enum(["createdAt", "-createdAt", "title", "-title"], {
        error: "sort must be one of createdAt, -createdAt, title, -title",
      })
      .default("-createdAt"),
  })
  .strict();

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
};
