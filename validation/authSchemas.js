const { z } = require("zod");

/** Request shapes for registration and login. */

const MIN_PASSWORD = 8;

const registerBody = z
  .object({
    name: z
      .string({ error: "name is required" })
      .trim()
      .min(1, "name is required")
      .max(100, "name must be at most 100 characters"),
    // Email validation is deliberately permissive. Deliverability cannot be
    // proved by a pattern, only by sending mail, so this catches typos and
    // nothing more. Lowercased so Isreal@x.com and isreal@x.com are one account.
    email: z
      .string({ error: "email is required" })
      .trim()
      .toLowerCase()
      .email("a valid email is required"),
    password: z
      .string({ error: "password is required" })
      .min(MIN_PASSWORD, `password must be at least ${MIN_PASSWORD} characters`),
  })
  .strict();

/**
 * Login deliberately does NOT reuse the password rules from registration.
 *
 * Enforcing a minimum length here would reject a wrong password with
 * 400 "too short" instead of 401, telling an attacker their guess was the wrong
 * shape before any credential check ran. The only requirement is that something
 * was sent.
 */
const loginBody = z
  .object({
    email: z
      .string({ error: "email is required" })
      .trim()
      .toLowerCase()
      .min(1, "email is required"),
    password: z.string({ error: "password is required" }).min(1, "password is required"),
  })
  .strict();

module.exports = { registerBody, loginBody };
