const AppError = require("../utils/AppError");

/**
 * Runs schemas against a request before the controller sees it.
 *
 * Usage:
 *   router.post("/", validate({ body: createTaskBody }), handler)
 *
 * Two things make this worth having over hand-written checks:
 *
 * 1. Every failure is reported at once. Hand-written `if` chains return on the
 *    first problem, so a client with three bad fields has to submit three times
 *    to discover them all.
 *
 * 2. The parsed result replaces the raw input. Defaults are filled in, numbers
 *    are coerced from query strings, and unknown keys are rejected. Downstream
 *    code can therefore trust req.body without re-checking it.
 */

/** Flattens a ZodError into the `details` array the error envelope uses. */
const toDetails = (zodError) =>
  zodError.issues.map((issue) => ({
    // Empty path means the whole object failed, e.g. the "at least one field"
    // rule on PATCH.
    field: issue.path.length ? issue.path.join(".") : "body",
    issue: issue.message,
  }));

const validate = (schemas) => (req, res, next) => {
  const details = [];

  for (const source of ["params", "query", "body"]) {
    const schema = schemas[source];
    if (!schema) continue;

    // `?? {}` matters for body: without express.json() having parsed anything,
    // req.body is undefined, and a schema should report "title is required"
    // rather than crashing on a missing object.
    const result = schema.safeParse(req[source] ?? {});

    if (!result.success) {
      details.push(...toDetails(result.error));
      continue;
    }

    // Express 5 makes req.query a getter, so assigning to it throws. Redefining
    // the property works on both Express 4 and 5.
    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  if (details.length) {
    return next(AppError.badRequest("Request validation failed", details));
  }

  return next();
};

module.exports = validate;
