const express = require("express");
const path = require("path");
const cors = require("cors");
const { readDb, writeDb, id } = require("./db");
const {
  hashPassword,
  verifyPassword,
  signUser,
  optionalAuth,
  requireAuth,
  requireRole
} = require("./auth");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "../../frontend")));
app.use(optionalAuth);

function now() {
  return new Date().toISOString();
}


function ensureAdminAccount() {
  const db = readDb();
  let admin = db.users.find(u => u.email === "admin@sudanguide.local");
  if (!admin) {
    admin = {
      id: id("u_admin"),
      name: "Sudan Guide Admin",
      email: "admin@sudanguide.local",
      passwordHash: hashPassword("ChangeMe123!"),
      role: "admin",
      trust: 100,
      createdAt: now()
    };
    db.users.push(admin);
    writeDb(db);
  }
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    trust: user.trust,
    createdAt: user.createdAt
  };
}

function findById(items, value) {
  return items.find(x => x.id === value);
}

function validStatus(status) {
  return ["open", "closed", "limited", "unknown", "good", "weak", "off", "available", "unavailable", "back"].includes(status);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Sudan Guide API", version: "1.0.0" });
});

app.get("/api/meta", (req, res) => {
  const db = readDb();
  res.json({
    city: db.settings.initialCity,
    categories: db.categories,
    areas: db.areas
  });
});

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "الاسم والبريد وكلمة المرور مطلوبة." });
  if (String(password).length < 8) return res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." });

  const db = readDb();
  const normalized = String(email).trim().toLowerCase();
  if (db.users.some(u => u.email === normalized)) {
    return res.status(409).json({ error: "البريد مستخدم بالفعل." });
  }

  const user = {
    id: id("u"),
    name: String(name).trim().slice(0, 80),
    email: normalized,
    passwordHash: hashPassword(String(password)),
    role: "user",
    trust: 50,
    createdAt: now()
  };
  db.users.push(user);
  writeDb(db);

  res.status(201).json({ token: signUser(user), user: safeUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const db = readDb();
  const user = db.users.find(u => u.email === String(email || "").trim().toLowerCase());
  if (!user || !verifyPassword(String(password || ""), user.passwordHash)) {
    return res.status(401).json({ error: "البريد أو كلمة المرور غير صحيحة." });
  }
  res.json({ token: signUser(user), user: safeUser(user) });
});

app.get("/api/me", requireAuth, (req, res) => {
  const db = readDb();
  const user = findById(db.users, req.user.id);
  if (!user) return res.status(401).json({ error: "الحساب غير موجود." });
  res.json({ user: safeUser(user) });
});

app.get("/api/places", (req, res) => {
  const db = readDb();
  const { areaId, categoryId, q, status, limit = 100 } = req.query;
  let places = db.places.slice();

  if (areaId) places = places.filter(p => p.areaId === areaId);
  if (categoryId) places = places.filter(p => p.categoryId === categoryId);
  if (status) places = places.filter(p => p.status === status);
  if (q) {
    const query = String(q).trim().toLowerCase();
    places = places.filter(p =>
      [p.name, p.description, p.phone, p.whatsapp].some(v => String(v || "").toLowerCase().includes(query))
    );
  }

  places = places
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 200));

  res.json({ places, total: places.length });
});

app.post("/api/places", requireAuth, (req, res) => {
  const {
    name, categoryId, areaId, description = "", phone = "", whatsapp = "",
    lat = null, lng = null, status = "unknown"
  } = req.body || {};

  if (!name || !categoryId || !areaId) {
    return res.status(400).json({ error: "اسم النشاط والتصنيف والمنطقة مطلوبة." });
  }

  const db = readDb();
  if (!findById(db.categories, categoryId)) return res.status(400).json({ error: "التصنيف غير صحيح." });
  if (!findById(db.areas, areaId)) return res.status(400).json({ error: "المنطقة غير صحيحة." });
  if (!validStatus(status)) return res.status(400).json({ error: "حالة غير صحيحة." });

  const place = {
    id: id("p"),
    name: String(name).trim().slice(0, 120),
    categoryId,
    areaId,
    description: String(description).trim().slice(0, 1000),
    phone: String(phone).trim().slice(0, 40),
    whatsapp: String(whatsapp).trim().slice(0, 40),
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
    status,
    verified: false,
    ownerId: req.user.id,
    createdAt: now(),
    updatedAt: now()
  };

  db.places.push(place);
  writeDb(db);
  res.status(201).json({ place });
});

app.patch("/api/places/:id/status", requireAuth, (req, res) => {
  const db = readDb();
  const place = findById(db.places, req.params.id);
  if (!place) return res.status(404).json({ error: "النشاط غير موجود." });

  if (req.user.role !== "admin" && place.ownerId !== req.user.id) {
    return res.status(403).json({ error: "فقط صاحب النشاط أو الإدارة يمكنه تعديل حالته." });
  }

  const { status } = req.body || {};
  if (!validStatus(status)) return res.status(400).json({ error: "حالة غير صحيحة." });

  place.status = status;
  place.updatedAt = now();
  writeDb(db);
  res.json({ place });
});

app.get("/api/reports", (req, res) => {
  const db = readDb();
  const { areaId, categoryId, limit = 100 } = req.query;
  let reports = db.reports.slice();

  if (areaId) reports = reports.filter(r => r.areaId === areaId);
  if (categoryId) reports = reports.filter(r => r.categoryId === categoryId);

  reports = reports
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 200));

  res.json({ reports, total: reports.length });
});

app.post("/api/reports", requireAuth, (req, res) => {
  const { categoryId, areaId, status, note = "", lat = null, lng = null } = req.body || {};
  if (!categoryId || !areaId || !status) return res.status(400).json({ error: "التصنيف والمنطقة والحالة مطلوبة." });
  if (!validStatus(status)) return res.status(400).json({ error: "حالة غير صحيحة." });

  const db = readDb();
  if (!findById(db.categories, categoryId) || !findById(db.areas, areaId)) {
    return res.status(400).json({ error: "التصنيف أو المنطقة غير صحيح." });
  }

  const report = {
    id: id("r"),
    userId: req.user.id,
    categoryId,
    areaId,
    status,
    note: String(note).trim().slice(0, 500),
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
    confirmations: 0,
    denials: 0,
    createdAt: now(),
    updatedAt: now()
  };

  db.reports.push(report);
  writeDb(db);
  res.status(201).json({ report });
});

app.post("/api/reports/:id/vote", requireAuth, (req, res) => {
  const { value } = req.body || {};
  if (!["confirm", "deny"].includes(value)) return res.status(400).json({ error: "التصويت غير صحيح." });

  const db = readDb();
  const report = findById(db.reports, req.params.id);
  if (!report) return res.status(404).json({ error: "البلاغ غير موجود." });

  const existing = db.reportVotes.find(v => v.reportId === report.id && v.userId === req.user.id);
  if (existing) return res.status(409).json({ error: "لقد صوتت على هذا البلاغ مسبقًا." });

  db.reportVotes.push({ id: id("v"), reportId: report.id, userId: req.user.id, value, createdAt: now() });
  if (value === "confirm") report.confirmations += 1;
  else report.denials += 1;
  report.updatedAt = now();

  const user = findById(db.users, req.user.id);
  if (user) {
    user.trust = Math.max(0, Math.min(100, user.trust + (value === "confirm" ? 0.2 : -0.1)));
  }

  writeDb(db);
  res.json({ report });
});

app.post("/api/messages", requireAuth, (req, res) => {
  const { placeId, text } = req.body || {};
  if (!placeId || !text) return res.status(400).json({ error: "النشاط والرسالة مطلوبان." });

  const db = readDb();
  const place = findById(db.places, placeId);
  if (!place) return res.status(404).json({ error: "النشاط غير موجود." });

  const message = {
    id: id("m"),
    placeId,
    senderId: req.user.id,
    text: String(text).trim().slice(0, 1000),
    createdAt: now()
  };
  db.messages.push(message);
  writeDb(db);
  res.status(201).json({ message });
});

app.get("/api/places/:id/messages", requireAuth, (req, res) => {
  const db = readDb();
  const messages = db.messages
    .filter(m => m.placeId === req.params.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-100);
  res.json({ messages });
});

app.get("/api/dashboard", requireAuth, requireRole("admin"), (req, res) => {
  const db = readDb();
  res.json({
    users: db.users.length,
    places: db.places.length,
    reports: db.reports.length,
    messages: db.messages.length,
    verifiedPlaces: db.places.filter(p => p.verified).length
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "حدث خطأ داخلي في الخادم." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/index.html"));
});

ensureAdminAccount();

app.listen(PORT, () => {
  console.log(`Sudan Guide running on http://localhost:${PORT}`);
});