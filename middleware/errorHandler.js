const crypto = require("crypto");
const AppError = require("../utils/AppError");

/**
 * The single place a failure becomes a response.
 *
 * Because every controller is wrapped in asyncHandler and every service throws
 * AppError, no handler formats its own error. Previously each method built its
 * own 500 body, and those copies had drifted: three of them referenced a
 * variable that did not exist in scope, so the error handler itself threw.
 *
 * Task 3 extends this with request logging and correlation across layers.
 */

/** Anything that reaches here matched no route. */
const notFoundHandler = (req, res, next) => {
  next(AppError.routeNotFound(req.method, req.originalUrl));
};

const errorHandler = (err, req, res, next) => {
  // Delegate to Express if the response has already started streaming.
  if (res.headersSent) return next(err);

  const requestId = crypto.randomUUID();

  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
      requestId,
    });
  }

  // Anything else is a bug rather than an anticipated failure. Log it in full,
  // return nothing but the id. The old code sent details: err.message, which
  // forwarded raw MySQL errors — table and column names included — to callers.
  console.error(`[${requestId}] ${req.method} ${req.originalUrl}`, err);

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
