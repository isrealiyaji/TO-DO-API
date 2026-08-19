const AppError = require("../utils/AppError");
const logger = require("../utils/logger");

/**
 * The single place a failure becomes an HTTP response.
 *
 * Every other layer either throws or calls next(err). Nothing else formats an
 * error body. That matters because the previous version built a 500 inside each
 * controller method, and those copies had drifted: three referenced `err` inside
 * a `catch (error)` block, so the error handler itself threw a ReferenceError
 * while trying to report the original failure.
 *
 * Three rules hold here:
 *   1. Expected failures (AppError) return their own code and message.
 *   2. Unexpected failures are logged in full and return a generic message.
 *   3. Nothing internal — SQL text, table names, stack traces — ever reaches
 *      the client.
 */

/**
 * Translates errors thrown by libraries into AppErrors.
 *
 * Without this, a malformed JSON body would fall through to the generic 500
 * branch, telling the client "an unexpected error occurred" when the request
 * was simply wrong. These are the failures the framework raises before any of
 * our code runs.
 */
const normalise = (err) => {
  if (err instanceof AppError) return err;

  // express.json() throws this for a body that isn't valid JSON.
  if (err.type === "entity.parse.failed") {
    return AppError.badRequest("Request body is not valid JSON", [
      { field: "body", issue: "malformed JSON" },
    ]);
  }

  // Body larger than the configured limit.
  if (err.type === "entity.too.large") {
    return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  // jsonwebtoken errors, if one escapes the auth middleware.
  if (err.name === "JsonWebTokenError") return AppError.unauthenticated("Token is invalid");
  if (err.name === "TokenExpiredError") return AppError.unauthenticated("Token has expired");

  // A unique-index violation racing past the pre-insert check. Two requests can
  // both pass "does this email exist?" before either commits, so the database
  // constraint is the real guarantee and this maps it to the same 409.
  if (err.code === "ER_DUP_ENTRY") return AppError.emailTaken();

  // Database unreachable. Surfaced as 503 rather than 500 because the request
  // is fine and retrying later may well succeed.
  if (["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"].includes(err.code)) {
    return new AppError(503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable");
  }

  return null; // genuinely unexpected
};

/** Anything reaching here matched no route. */
const notFoundHandler = (req, res, next) => {
  next(AppError.routeNotFound(req.method, req.originalUrl));
};

const errorHandler = (err, req, res, next) => {
  // If the response already started streaming, headers are gone and the only
  // correct move is to let Express tear down the connection.
  if (res.headersSent) return next(err);

  const requestId = req.id;
  const known = normalise(err);

  if (known) {
    // Client errors are noise at error level; server-side ones are not.
    const level = known.statusCode >= 500 ? "error" : "warn";
    logger[level](known.message, {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: known.statusCode,
      code: known.code,
    });

    return res.status(known.statusCode).json({
      success: false,
      error: { code: known.code, message: known.message, details: known.details },
      requestId,
    });
  }

  // Unexpected: a bug. Log everything, tell the client nothing.
  logger.error("Unhandled error", {
    requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: 500,
    name: err.name,
    message: err.message,
    stack: err.stack,
  });

  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      details: [],
    },
    requestId,
  });
};

module.exports = { notFoundHandler, errorHandler };
