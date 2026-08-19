const crypto = require("crypto");

/**
 * Gives every request an id and echoes it back in a header.
 *
 * The same id is written to the log line and returned in any error body, so a
 * user reporting "I got an error" can quote one string that leads straight to
 * the matching server log entry. Without it, matching a report to a log means
 * guessing from timestamps.
 *
 * An incoming X-Request-Id is honoured so an id assigned by a load balancer or
 * gateway survives across services rather than being replaced here.
 */
const requestId = (req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
};

module.exports = requestId;
