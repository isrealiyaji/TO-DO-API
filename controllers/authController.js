const authService = require("../services/authService");
const { ok, created } = require("../utils/respond");

/** HTTP layer for registration, login and the current user's profile. */
const authController = {
  async register(req, res) {
    const user = await authService.register(req.body);
    return created(res, user, "/api/v1/users/me");
  },

  async login(req, res) {
    // 200, not 201. A token is a credential, not a resource with a URL, so
    // there is nothing the client could go and GET.
    const result = await authService.login(req.body);
    return ok(res, result);
  },

  async me(req, res) {
    const user = await authService.getProfile(req.user.id);
    return ok(res, user);
  },
};

module.exports = authController;
