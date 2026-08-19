require("dotenv").config();

const app = require("./app");
const db = require("./config/db");
const logger = require("./utils/logger");

/**
 * Server entry point.
 *
 * Checks configuration, confirms the database is reachable, starts listening,
 * and installs the process-level safety nets. Application wiring lives in
 * app.js.
 */

const PORT = process.env.PORT || 3500;

// Fail at boot rather than at the first request. Without JWT_SECRET, jwt.sign
// throws on every login and each one surfaces as a confusing 500.
const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_NAME", "JWT_SECRET"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length) {
  logger.error("Missing required environment variables", { missing });
  logger.error("Copy .env.example to .env and fill it in");
  process.exit(1);
}

const start = async () => {
  try {
    const connection = await db.getConnection();
    connection.release(); // hand it back; this was only a reachability check
    logger.info("Database connected successfully");

    const server = app.listen(PORT, () => {
      logger.info("Server started", { port: PORT, baseUrl: `http://localhost:${PORT}/api/v1` });
    });

    /**
     * Last-resort handlers.
     *
     * The error middleware only sees failures that happen inside a request. A
     * promise rejected in a background timer, or an exception thrown outside
     * any handler, never reaches it. Without these the process either dies
     * silently or keeps running in an unknown state.
     *
     * Both exit rather than continue: after an unhandled exception the process
     * may hold corrupted state, and a supervisor restarting it cleanly is safer
     * than serving from it.
     */
    const shutdown = (reason, err) => {
      logger.error(reason, { name: err?.name, message: err?.message, stack: err?.stack });
      server.close(() => process.exit(1));
      // Do not wait forever for in-flight requests to drain.
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on("unhandledRejection", (err) => shutdown("Unhandled promise rejection", err));
    process.on("uncaughtException", (err) => shutdown("Uncaught exception", err));

    // Graceful stop on Ctrl+C or a container stop signal: finish in-flight
    // requests, then close the connection pool.
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        logger.info("Shutting down", { signal });
        server.close(async () => {
          await db.end();
          process.exit(0);
        });
      });
    }
  } catch (err) {
    logger.error("Error connecting to the database", { message: err.message });
    process.exit(1);
  }
};

start();
