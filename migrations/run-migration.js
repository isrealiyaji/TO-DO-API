const mysql = require("mysql2/promise");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

/**
 * Runs every .sql file in this folder, in filename order.
 *
 * Previously this ran one hardcoded file, so adding 002 meant editing the
 * runner. Sorting by filename is why migrations are numbered: 001 before 002,
 * and the order is the same on every machine.
 *
 * This is still a simple runner — it does not record which migrations have
 * already been applied, so re-running it will fail on objects that already
 * exist. A real migration tool keeps a schema_migrations table; that is a
 * later module's job.
 */
async function runMigration() {
  console.log("Starting database migration...");

  const requiredEnvVars = ["DB_HOST", "DB_USER", "DB_NAME"];
  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error("Missing required environment variables:", missingVars.join(", "));
    console.error("Please check your .env file");
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  try {
    console.log("Connected to database successfully");

    const entries = await fs.readdir(__dirname);
    const migrations = entries.filter((name) => name.endsWith(".sql")).sort();

    if (migrations.length === 0) {
      console.log("No .sql migrations found");
      return;
    }

    for (const file of migrations) {
      const sql = await fs.readFile(path.join(__dirname, file), "utf8");

      // A file of nothing but comments has no statements to send.
      if (!sql.replace(/--.*$/gm, "").trim()) {
        console.log(`Skipping ${file} (no statements)`);
        continue;
      }

      console.log(`Executing migration: ${file}`);
      // query(), not execute(): prepared statements cannot carry multiple
      // statements, and each migration file contains several.
      await connection.query(sql);
      console.log(`  done`);
    }

    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error.message);

    if (error.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("Database access denied. Please check your credentials.");
    } else if (error.code === "ECONNREFUSED") {
      console.error("Could not connect to database. Please check your connection settings.");
    } else if (error.code === "ER_BAD_DB_ERROR") {
      console.error("Database does not exist. Please create the database first.");
    } else if (error.code === "ER_DUP_KEYNAME" || error.code === "ER_TABLE_EXISTS_ERROR") {
      console.error("This migration has already been applied.");
    }

    process.exit(1);
  } finally {
    await connection.end();
    console.log("Database connection closed");
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
