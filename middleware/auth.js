const jwt = require("jsonwebtoken");
const AppError = require("../utils/AppError");

/**
 * Verifies the bearer token and puts the caller on `req.user`.
 *
 * This proves *who* the caller is. It does not decide what they may touch:
 * that is the service's job, which scopes every query by user_id. Treating
 * this middleware as if it also handled ownership is what allowed one user
 * to read and delete another user's tasks.
 */
const auth = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(AppError.unauthenticated("A bearer token is required"));
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) return next(AppError.unauthenticated("A bearer token is required"));

  try {
    // jwt.verify throws on an invalid or expired token, so the result is
    // either a valid payload or an exception. There is no falsy case to test.
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, email: payload.email };
    return next();
  } catch (err) {
    const message =
      err.name === "TokenExpiredError" ? "Token has expired" : "Token is invalid";
    return next(AppError.unauthenticated(message));
  }
};

module.exports = auth;
