const db = require("../config/db");

/**
 * Database access for users.
 *
 * Two mappers, on purpose. `mapUser` is what may leave the server;
 * `mapUserWithPassword` includes the hash and is only for the login check.
 * Keeping them separate means the password hash cannot be leaked by
 * forgetting to strip it at some call site.
 */

const mapUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  createdAt: row.created_at,
});

const mapUserWithPassword = (row) => ({
  ...mapUser(row),
  passwordHash: row.password,
});

const userRepository = {
  async create({ name, email, passwordHash }) {
    const [result] = await db.query(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, passwordHash]
    );
    return userRepository.findById(result.insertId);
  },

  async findById(id) {
    const [rows] = await db.query("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
    return rows.length ? mapUser(rows[0]) : null;
  },

  async existsByEmail(email) {
    const [rows] = await db.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    return rows.length > 0;
  },

  /** Only for authenticating a login. Never use this to build a response. */
  async findByEmailWithPassword(email) {
    const [rows] = await db.query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
    return rows.length ? mapUserWithPassword(rows[0]) : null;
  },
};

module.exports = userRepository;
