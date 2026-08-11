const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

/**
 * Builds the Express application.
 *
 * This file only assembles middleware and routes. It does not connect to the
 * database and it does not listen on a port, so the app can be imported and
 * exercised without starting a server. That separation is what makes the
 * automated tests in a later module possible.
 */
const app = express();

app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// Cheap liveness check that touches nothing.
app.get("/health", (req, res) => res.json({ status: "ok" }));

// One versioned mount point for the whole API.
app.use("/api/v1", routes);

// Order matters. Unmatched routes become a 404 before the error handler runs,
// and the error handler must be registered last of all.
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
