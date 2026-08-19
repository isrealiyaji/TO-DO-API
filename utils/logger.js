/**
 * Minimal structured logger.
 *
 * Logs are emitted as single-line JSON because that is what log aggregators
 * (CloudWatch, Datadog, Loki) can index and query. A multi-line console.log is
 * fine on a laptop and close to useless in production, where you need to search
 * "show me every 500 with this requestId".
 *
 * Deliberately dependency-free. A real deployment would swap this for pino or
 * winston; the call sites would not change.
 */

const write = (level, message, meta = {}) => {
  const entry = { level, message, timestamp: new Date().toISOString(), ...meta };
  const line = JSON.stringify(entry);

  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

module.exports = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
