/**
 * Wraps an async route handler so a rejected promise reaches Express.
 *
 * Express 4 does not catch rejections from async functions. Without this,
 * a failed `await` inside a controller becomes an unhandled rejection and
 * the request hangs. Wrapping means controllers need no try/catch at all.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
