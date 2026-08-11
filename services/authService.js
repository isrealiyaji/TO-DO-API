const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userRepository = require("../repositories/userRepository");
const AppError = require("../utils/AppError");

/**
 * Business rules for registration, login and the current user.
 *
 * Hashing and token signing live here rather than in a controller, because
 * they are rules about accounts, not about HTTP.
 */

const BCRYPT_ROUNDS = 10;
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const MIN_PASSWORD = 8;

// A single, deliberately loose check. Real deliverability cannot be proved by
// a regex, only by sending mail, so this rejects obvious typos and no more.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });

const authService = {
  async register(body) {
    const { name, email, password } = body ?? {};
    const details = [];

    if (typeof name !== "string" || name.trim().length === 0) {
      details.push({ field: "name", issue: "name is required" });
    }
    if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
      details.push({ field: "email", issue: "a valid email is required" });
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      details.push({ field: "password", issue: `password must be at least ${MIN_PASSWORD} characters` });
    }

    if (details.length) throw AppError.badRequest("Request validation failed", details);

    const normalisedEmail = email.trim().toLowerCase();

    // 409, not 400. The request is well formed; it conflicts with existing
    // state. A client can act on that difference: 400 means "fix your input",
    // 409 means "pick another email or go log in".
    if (await userRepository.existsByEmail(normalisedEmail)) {
      throw AppError.emailTaken();
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return userRepository.create({ name: name.trim(), email: normalisedEmail, passwordHash });
  },

  async login(body) {
    const { email, password } = body ?? {};
    const details = [];

    if (typeof email !== "string" || email.trim().length === 0) {
      details.push({ field: "email", issue: "email is required" });
    }
    if (typeof password !== "string" || password.length === 0) {
      details.push({ field: "password", issue: "password is required" });
    }
    if (details.length) throw AppError.badRequest("Request validation failed", details);

    const user = await userRepository.findByEmailWithPassword(email.trim().toLowerCase());

    // Both branches raise the same error. Reporting "user not found" separately
    // would let anyone discover which emails have accounts.
    if (!user) throw AppError.invalidCredentials();
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw AppError.invalidCredentials();
    }

    const { passwordHash, ...safeUser } = user;
    return { token: signToken(safeUser), expiresIn: TOKEN_TTL_SECONDS, user: safeUser };
  },

  async getProfile(userId) {
    const user = await userRepository.findById(userId);
    // The token verified, but the account is gone. Treat it as unauthenticated
    // rather than 404, because the credential itself is no longer valid.
    if (!user) throw AppError.unauthenticated("Account no longer exists");
    return user;
  },
};

module.exports = authService;
