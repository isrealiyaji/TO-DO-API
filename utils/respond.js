/**
 * The single place a success response is built.
 *
 * Every endpoint answers with the same envelope, so a client never has to
 * guess which shape it is reading.
 */

/** 200 with a resource or a collection. */
const ok = (res, data, meta = null) => res.status(200).json({ success: true, data, meta });

/** 201 with a Location header pointing at the new resource. */
const created = (res, data, location) => {
  if (location) res.set("Location", location);
  return res.status(201).json({ success: true, data, meta: null });
};

/** 204 for a successful delete. No body, because there is nothing left to send. */
const noContent = (res) => res.status(204).end();

module.exports = { ok, created, noContent };
