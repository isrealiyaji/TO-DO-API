const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const requestId = require("./middleware/requestId");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

/**
 * Builds the Express application.
 *
 * Only assembles middleware and routes. It does not connect to the database and
 * does not listen on a port, so the app can be imported and exercised without
 * starting a server — which is what makes automated tests possible later.
 *
 * Middleware order is not cosmetic here:
 *   requestId  first, so every later log line and error body can carry the id
 *   json/cors  next, to parse and permit the request
 *   routes     the application itself
 *   notFound   only reached when no route matched
 *   errorHandler last, because Express only treats a 4-argument function as an
 *                error handler and only consults ones registered after the
 *                middleware that might throw
 */
const app = express();

app.use(requestId);

// A body limit is a denial-of-service guard: without one, a client can stream
// an arbitrarily large payload and exhaust memory. Oversized bodies are turned
// into a 413 by the error handler.
app.use(express.json({ limit: "100kb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// Cheap liveness check that touches nothing.
app.get("/health", (req, res) => res.json({ status: "ok", requestId: req.id }));

// One versioned mount point for the whole API.
app.use("/api/v1", routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
