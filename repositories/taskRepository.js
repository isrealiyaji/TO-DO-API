const db = require("../config/db");

/**
 * Database access for tasks.
 *
 * The only place that knows SQL or that the columns are named snake_case. It
 * takes and returns plain camelCase objects, so if the storage ever changes,
 * nothing above this layer has to.
 *
 * No business rules and no HTTP knowledge. It does not decide whether a missing
 * task is a 404; it just reports that there was no row.
 */

/** Turns a database row into the shape the rest of the app uses. */
const mapTask = (row) => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  description: row.description,
  completed: Boolean(row.completed), // MySQL gives back 0/1, not true/false
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Maps the API's field names onto real columns.
 *
 * A sort column cannot be a bound parameter — it has to be written into the SQL
 * text. Looking it up here, from a fixed map, is what keeps that safe. The
 * schema has already rejected anything not in this list, so this is the second
 * of two gates.
 */
const SORT_COLUMNS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  title: "title",
  completed: "completed",
};

/**
 * Escapes the characters that mean something special inside a LIKE pattern.
 *
 * A bound parameter protects against SQL injection, but it does not stop `%`
 * and `_` being treated as wildcards. Without this, searching for "50%" matches
 * anything starting with "50", and a search of just "%" matches every row.
 * Backslash is escaped first, otherwise it would double-escape the ones added
 * after it.
 */
const escapeLike = (term) => term.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Builds the WHERE clause shared by list, count and bulk delete.
 *
 * Every branch is optional except user_id, which is never optional. That is the
 * ownership guarantee: there is no code path here that reads or deletes a row
 * without scoping it to its owner.
 */
const buildFilter = (userId, { completed, search, createdAfter, createdBefore } = {}) => {
  const clauses = ["user_id = ?"];
  const params = [userId];

  if (completed !== undefined) {
    clauses.push("completed = ?");
    params.push(completed ? 1 : 0);
  }

  if (search) {
    // Substring match across both text fields. The leading wildcard is what
    // makes "port" find "Import report", and also what stops a normal index
    // being usable — see docs/QUERYING.md.
    const pattern = `%${escapeLike(search)}%`;
    clauses.push("(title LIKE ? OR description LIKE ?)");
    params.push(pattern, pattern);
  }

  if (createdAfter) {
    clauses.push("created_at >= ?");
    params.push(createdAfter);
  }

  if (createdBefore) {
    clauses.push("created_at <= ?");
    params.push(createdBefore);
  }

  return { where: clauses.join(" AND "), params };
};

/**
 * Builds ORDER BY from the validated sort list.
 *
 * `id` is appended as a final tiebreaker. Without it, rows with equal sort
 * values have no defined order, and MySQL is free to return them differently
 * between two identical queries — which makes a row appear on both page 1 and
 * page 2, or on neither.
 */
const buildOrderBy = (sort) => {
  const parts = sort.map(
    ({ field, descending }) => `${SORT_COLUMNS[field]} ${descending ? "DESC" : "ASC"}`
  );
  parts.push("id ASC");
  return parts.join(", ");
};

const taskRepository = {
  async create({ userId, title, description = null, completed = false }) {
    const [result] = await db.query(
      "INSERT INTO tasks (user_id, title, description, completed) VALUES (?, ?, ?, ?)",
      [userId, title, description, completed ? 1 : 0]
    );
    return taskRepository.findByIdAndUser(result.insertId, userId);
  },

  /**
   * Looks up one task, scoped to its owner.
   *
   * There is deliberately no findById(id). Every read is scoped by user_id so
   * one user can never reach another user's row, even by accident.
   */
  async findByIdAndUser(id, userId) {
    const [rows] = await db.query(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ? LIMIT 1",
      [id, userId]
    );
    return rows.length ? mapTask(rows[0]) : null;
  },

  async findAllByUser(userId, { filters, limit, offset, sort }) {
    const { where, params } = buildFilter(userId, filters);

    const [rows] = await db.query(
      `SELECT * FROM tasks WHERE ${where} ORDER BY ${buildOrderBy(sort)} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows.map(mapTask);
  },

  /**
   * Counts rows matching the same filters, for the pagination total.
   *
   * This runs as a second query rather than being derived from the page, since
   * a page of 20 cannot tell you whether 21 or 2100 rows matched.
   */
  async countByUser(userId, filters) {
    const { where, params } = buildFilter(userId, filters);
    const [rows] = await db.query(
      `SELECT COUNT(*) AS total FROM tasks WHERE ${where}`,
      params
    );
    return rows[0].total;
  },

  /**
   * Updates only the columns present in `fields`.
   *
   * `fields` has already been reduced by the schema to the keys the caller
   * actually sent, which is what allows completed:false to be written instead
   * of being mistaken for "not supplied".
   */
  async update(id, userId, fields) {
    const columns = {
      title: "title",
      description: "description",
      completed: "completed",
    };

    const assignments = [];
    const params = [];

    for (const [key, column] of Object.entries(columns)) {
      if (key in fields) {
        assignments.push(`${column} = ?`);
        params.push(key === "completed" ? (fields[key] ? 1 : 0) : fields[key]);
      }
    }

    if (assignments.length === 0) return taskRepository.findByIdAndUser(id, userId);

    await db.query(
      `UPDATE tasks SET ${assignments.join(", ")} WHERE id = ? AND user_id = ?`,
      [...params, id, userId]
    );
    return taskRepository.findByIdAndUser(id, userId);
  },

  /** Returns the number of rows removed, so the service can tell 404 from success. */
  async remove(id, userId) {
    const [result] = await db.query(
      "DELETE FROM tasks WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    return result.affectedRows;
  },

  async removeByCompleted(userId, completed) {
    const { where, params } = buildFilter(userId, { completed });
    const [result] = await db.query(`DELETE FROM tasks WHERE ${where}`, params);
    return result.affectedRows;
  },
};

module.exports = { taskRepository, SORT_COLUMNS, escapeLike };
