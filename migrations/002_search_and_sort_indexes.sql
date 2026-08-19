-- Indexes supporting filtering, sorting and search on /api/v1/tasks
--
-- Every list query is scoped by user_id, so every index here leads with it.
-- An index is only usable when the query filters on its leftmost column, which
-- makes user_id the natural prefix for all of them.

-- Sorting by newest within a user's tasks, the default order.
-- Covers: WHERE user_id = ? ORDER BY created_at
CREATE INDEX idx_tasks_user_created
  ON tasks (user_id, created_at);

-- Sorting by recently changed.
CREATE INDEX idx_tasks_user_updated
  ON tasks (user_id, updated_at);

-- Sorting alphabetically, and the ?sort=title case.
CREATE INDEX idx_tasks_user_title
  ON tasks (user_id, title);

-- The common combination: unfinished tasks, newest first.
-- Covers: WHERE user_id = ? AND completed = ? ORDER BY created_at
CREATE INDEX idx_tasks_user_completed_created
  ON tasks (user_id, completed, created_at);

-- Search.
--
-- The search filter uses LIKE '%term%'. A leading wildcard means a normal
-- B-tree index cannot be used at all: an index is ordered by how values start,
-- and "find anything containing this" gives the database no starting point. So
-- none of the indexes above help search, and MySQL scans every row belonging to
-- the user.
--
-- That is acceptable at the scale of one person's task list. A FULLTEXT index
-- is the proper fix once it is not:
--
--   ALTER TABLE tasks ADD FULLTEXT INDEX ft_tasks_search (title, description);
--
-- It is not enabled here because it changes the meaning of a search rather than
-- just its speed. FULLTEXT matches whole words, so searching "port" would stop
-- finding "Import report" — the substring behaviour clients get today. Making
-- that switch is a deliberate product decision, not a performance tweak.
