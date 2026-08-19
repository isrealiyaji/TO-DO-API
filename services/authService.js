const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userRepository = require("../repositories/userRepository");
const AppError = require("../utils/AppError");

/**
 * Business rules for accounts.
 *
 * Field shapes are checked by the validate middleware. What remains here is the
 * part that needs the database or a secret: uniqueness, password comparison,
 * and token signing.
 */

const BCRYPT_ROUNDS = 10;
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });

const authService = {
  async register({ name, email, password }) {
    // 409, not 400. The request is well formed; it conflicts with stored state.
    // The client can act on that difference: 400 means "fix your input",
    // 409 means "choose another email or log in".
    //
    // This check is not the real guarantee — two requests can both pass it
    // before either commits. The unique index on users.email is, and the error
    // handler maps ER_DUP_ENTRY to this same 409.
    if (await userRepository.existsByEmail(email)) {
      throw AppError.emailTaken();
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return userRepository.create({ name, email, passwordHash });
  },

  async login({ email, password }) {
    const user = await userRepository.findByEmailWithPassword(email);

    // Both branches raise the identical error. Distinguishing "no such user"
    // from "wrong password" would let anyone discover which emails have
    // accounts by comparing responses.
    if (!user) throw AppError.invalidCredentials();
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw AppError.invalidCredentials();
    }

    const { passwordHash, ...safeUser } = user;
    return { token: signToken(safeUser), expiresIn: TOKEN_TTL_SECONDS, user: safeUser };
  },

  async getProfile(userId) {
    const user = await userRepository.findById(userId);
    // The token verified but the account is gone. That makes the credential
    // itself invalid, so 401 rather than 404.
    if (!user) throw AppError.unauthenticated("Account no longer exists");
    return user;
  },
};

module.exports = authService;
