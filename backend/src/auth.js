const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_PRODUCTION";

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
    } catch (_) {}
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "يجب تسجيل الدخول أولاً." });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "ليس لديك صلاحية لهذه العملية." });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, signUser, optionalAuth, requireAuth, requireRole };
