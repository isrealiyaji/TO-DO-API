require("dotenv").config();

const app = require("./app");
const db = require("./config/db");

/**
 * Server entry point.
 *
 * The only job here is to check the required configuration, confirm the
 * database is reachable, and start listening. Application wiring lives in
 * app.js.
 */

const PORT = process.env.PORT || 3500;

// Fail loudly at boot rather than at the first login attempt. Without a secret,
// jwt.sign throws per-request and every auth route returns 500.
const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_NAME", "JWT_SECRET"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const start = async () => {
  try {
    const connection = await db.getConnection();
    connection.release(); // hand it back, it was only a reachability check
    console.log("Database connected successfully");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`API base URL: http://localhost:${PORT}/api/v1`);
    });
  } catch (err) {
    console.error("Error connecting to the database:", err.message);
    process.exit(1);
  }
};

start();
