const state = {
  token: localStorage.getItem("sg_token") || "",
  user: null,
  meta: { categories: [], areas: [] },
  places: [],
  reports: [],
  activeCategory: "",
  map: null,
  markers: []
};

const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "حدث خطأ غير متوقع.");
  return data;
}

function notify(message, type = "success") {
  const box = $("notice");
  box.textContent = message;
  box.className = `notice ${type}`;
  window.scrollTo({ top: box.offsetTop - 90, behavior: "smooth" });
  setTimeout(() => box.classList.add("hidden"), 5000);
}

function category(id) {
  return state.meta.categories.find(c => c.id === id);
}

function area(id) {
  return state.meta.areas.find(a => a.id === id);
}

function timeAgo(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `قبل ${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.floor(hours / 24)} يوم`;
}

function statusText(status) {
  return {
    open:"مفتوح", closed:"مغلق", limited:"يعمل جزئيًا", unknown:"غير معروف",
    good:"جيدة", weak:"ضعيفة", off:"مقطوعة", available:"متوفر",
    unavailable:"غير متوفر", back:"عادت الآن"
  }[status] || status;
}

function statusClass(status) {
  if (["open","good","available","back"].includes(status)) return "green";
  if (["closed","off","unavailable"].includes(status)) return "red";
  if (["limited","weak"].includes(status)) return "yellow";
  return "gray";
}

async function loadMeta() {
  state.meta = await api("/api/meta");
  const select = $("areaSelect");
  select.innerHTML = state.meta.areas
    .filter(a => a.type === "neighborhood")
    .map(a => `<option value="${a.id}">${a.name} — أم درمان</option>`).join("");
  renderCategories();
}

function selectedAreaId() {
  return $("areaSelect").value || "al-thawra";
}

function renderCategories() {
  $("categoryFilters").innerHTML =
    `<button class="chip active" data-cat="">الكل</button>` +
    state.meta.categories.map(c => `<button class="chip" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join("");
  document.querySelectorAll("[data-cat]").forEach(btn => {
    btn.onclick = () => {
      state.activeCategory = btn.dataset.cat;
      document.querySelectorAll("[data-cat]").forEach(b => b.classList.toggle("active", b === btn));
      loadPlaces();
    };
  });
}

async function loadPlaces() {
  const params = new URLSearchParams({ areaId: selectedAreaId(), limit: "100" });
  if (state.activeCategory) params.set("categoryId", state.activeCategory);
  const q = $("searchInput").value.trim();
  if (q) params.set("q", q);

  const data = await api(`/api/places?${params}`);
  state.places = data.places;
  renderPlaces();
  renderMap();
}

async function loadReports() {
  const data = await api(`/api/reports?areaId=${encodeURIComponent(selectedAreaId())}&limit=50`);
  state.reports = data.reports;
  renderReports();
  renderStatusGrid();
}

function renderPlaces() {
  if (!state.places.length) {
    $("placesGrid").innerHTML = `<div class="notice">لا توجد نتائج حاليًا. يمكنك إضافة نشاط جديد.</div>`;
    return;
  }

  $("placesGrid").innerHTML = state.places.map(p => {
    const c = category(p.categoryId);
    return `
      <article class="place-card">
        <div class="place-body">
          <div class="place-top">
            <div>
              <div class="meta">${c?.icon || "📍"} ${c?.name || "خدمة"}</div>
              <h3>${escapeHtml(p.name)}</h3>
            </div>
            <span class="badge ${statusClass(p.status)}">${statusText(p.status)}</span>
          </div>
          <p>${escapeHtml(p.description || "لا يوجد وصف.")}</p>
          <div class="meta">📍 ${escapeHtml(area(p.areaId)?.name || "أم درمان")} • ${timeAgo(p.updatedAt)}</div>
          <div class="place-actions" style="margin-top:12px">
            ${p.phone ? `<a class="btn btn-light" href="tel:${encodeURIComponent(p.phone)}">📞 اتصال</a>` : ""}
            ${p.whatsapp ? `<a class="btn btn-light" target="_blank" href="https://wa.me/${encodeURIComponent(p.whatsapp.replace(/[^0-9]/g,''))}">💬 واتساب</a>` : ""}
            <button class="btn btn-light" onclick="openMessageModal('${p.id}')">✉️ رسالة</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

function renderReports() {
  if (!state.reports.length) {
    $("reportsList").innerHTML = `<div class="notice">لا توجد بلاغات حديثة في هذه المنطقة.</div>`;
    return;
  }

  $("reportsList").innerHTML = state.reports.map(r => {
    const c = category(r.categoryId);
    const score = r.confirmations + r.denials;
    const confidence = score ? Math.round((r.confirmations / score) * 100) : 0;
    return `
      <article class="report-card">
        <div class="report-header">
          <div><strong>${c?.icon || "📢"} ${c?.name || "بلاغ"}</strong>
          <span class="badge ${statusClass(r.status)}">${statusText(r.status)}</span>
        </div>
        <div class="report-note">${escapeHtml(r.note || "لا توجد ملاحظة.")}</div>
        <div class="meta">🕐 ${timeAgo(r.updatedAt)} • ${confidence ? `ثقة المجتمع ${confidence}%` : "لم يؤكد بعد"}</div>
        <div class="vote-row" style="margin-top:12px">
          <button class="btn btn-light" onclick="voteReport('${r.id}','confirm')">👍 تأكيد (${r.confirmations})</button>
          <button class="btn btn-light" onclick="voteReport('${r.id}','deny')">👎 غير صحيح (${r.denials})</button>
        </div>
      </article>`;
  }).join("");
}

function renderStatusGrid() {
  const core = ["electricity","water","network","banking"];
  $("statusGrid").innerHTML = core.map(id => {
    const c = category(id);
    const reports = state.reports.filter(r => r.categoryId === id);
    const latest = reports[0];
    return `
      <article class="status-card">
        <div class="icon">${c?.icon || "📍"}</div>
        <h3>${c?.name || id}</h3>
        <div class="status-line">
          <span class="badge ${statusClass(latest?.status || "unknown")}">${statusText(latest?.status || "unknown")}</span>
          <span class="meta">${latest ? timeAgo(latest.updatedAt) : "لا توجد بيانات"}</span>
        </div>
      </article>`;
  }).join("");
}

function renderMap() {
  if (!state.map) {
    state.map = L.map("map").setView([15.6505, 32.4789], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(state.map);
  }

  state.markers.forEach(m => m.remove());
  state.markers = [];

  state.places.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)).forEach(p => {
    const marker = L.marker([p.lat, p.lng]).addTo(state.map);
    marker.bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(statusText(p.status))}`);
    state.markers.push(marker);
  });

  state.reports.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)).forEach(r => {
    const c = category(r.categoryId);
    const marker = L.circleMarker([r.lat, r.lng], { radius: 8, weight: 2 }).addTo(state.map);
    marker.bindPopup(`<strong>${escapeHtml(c?.name || "بلاغ")}</strong><br>${escapeHtml(statusText(r.status))}`);
    state.markers.push(marker);
  });
}

function showModal(html) {
  $("modalContent").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function closeModal() {
  $("modal").classList.add("hidden");
}

function authRequired(action) {
  if (!state.token) {
    showLogin();
    return false;
  }
  return true;
}

function showLogin() {
  showModal(`
    <h2>تسجيل الدخول</h2>
    <form id="loginForm" class="form">
      <label>البريد الإلكتروني<input name="email" type="email" required></label>
      <label>كلمة المرور<input name="password" type="password" required></label>
      <button class="btn btn-primary">دخول</button>
    </form>
    <p class="meta">ليس لديك حساب؟ <button id="switchRegister" class="btn btn-light">إنشاء حساب</button></p>
  `);
  $("loginForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const form = new FormData(e.target);
      const data = await api("/api/auth/login", {
        method:"POST",
        body:JSON.stringify(Object.fromEntries(form))
      });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("sg_token", state.token);
      updateAuthUI();
      closeModal();
      notify(`مرحبًا ${state.user.name}`);
    } catch (err) { notify(err.message, "error"); }
  };
  $("switchRegister").onclick = showRegister;
}

function showRegister() {
  showModal(`
    <h2>إنشاء حساب</h2>
    <form id="registerForm" class="form">
      <label>الاسم<input name="name" maxlength="80" required></label>
      <label>البريد الإلكتروني<input name="email" type="email" required></label>
      <label>كلمة المرور<input name="password" type="password" minlength="8" required></label>
      <button class="btn btn-primary">إنشاء الحساب</button>
    </form>
    <p class="meta">لديك حساب؟ <button id="switchLogin" class="btn btn-light">تسجيل الدخول</button></p>
  `);
  $("registerForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const form = new FormData(e.target);
      const data = await api("/api/auth/register", {
        method:"POST",
        body:JSON.stringify(Object.fromEntries(form))
      });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("sg_token", state.token);
      updateAuthUI();
      closeModal();
      notify("تم إنشاء الحساب بنجاح.");
    } catch (err) { notify(err.message, "error"); }
  };
  $("switchLogin").onclick = showLogin;
}

function showReport() {
  if (!authRequired()) return;
  const categories = state.meta.categories.filter(c => c.kind === "status");
  showModal(`
    <h2>أبلغ عن حالة</h2>
    <p class="meta">لا تنشر معلومات لا تستطيع تأكيدها. البلاغات القديمة تفقد صلاحيتها مع الوقت.</p>
    <form id="reportForm" class="form">
      <label>الخدمة<select name="categoryId" required>${categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("")}</select></label>
      <label>الحالة<select name="status" required>
        <option value="open">تعمل / متوفرة</option>
        <option value="off">مقطوعة</option>
        <option value="weak">ضعيفة</option>
        <option value="limited">متذبذبة / جزئية</option>
        <option value="back">عادت الآن</option>
      </select></label>
      <label>ملاحظة<textarea name="note" maxlength="500" placeholder="مثلاً: الكهرباء مقطوعة منذ الساعة 6..."></textarea></label>
      <button class="btn btn-primary">نشر البلاغ</button>
    </form>
  `);

  $("reportForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(e.target));
      data.areaId = selectedAreaId();
      const result = await api("/api/reports", { method:"POST", body:JSON.stringify(data) });
      closeModal();
      notify("تم نشر البلاغ.");
      await loadReports();
    } catch (err) { notify(err.message, "error"); }
  };
}

function showAddPlace() {
  if (!authRequired()) return;
  showModal(`
    <h2>إضافة نشاط أو مكان</h2>
    <form id="placeForm" class="form">
      <label>اسم النشاط<input name="name" maxlength="120" required placeholder="مثلاً: بقالة النيل"></label>
      <label>التصنيف<select name="categoryId" required>${state.meta.categories.filter(c=>c.kind==="place").map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("")}</select></label>
      <label>الوصف<textarea name="description" maxlength="1000"></textarea></label>
      <label>رقم الهاتف<input name="phone" maxlength="40"></label>
      <label>رقم واتساب<input name="whatsapp" maxlength="40"></label>
      <label>الحالة<select name="status">
        <option value="open">مفتوح</option><option value="closed">مغلق</option><option value="limited">يعمل جزئيًا</option><option value="unknown">غير معروف</option>
      </select></label>
      <button class="btn btn-primary">إضافة النشاط</button>
    </form>
  `);

  $("placeForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(e.target));
      data.areaId = selectedAreaId();
      const result = await api("/api/places", { method:"POST", body:JSON.stringify(data) });
      closeModal();
      notify("تمت إضافة النشاط. سيظهر للمستخدمين، ويمكن للإدارة توثيقه لاحقًا.");
      await loadPlaces();
    } catch (err) { notify(err.message, "error"); }
  };
}

function openMessageModal(placeId) {
  if (!authRequired()) return;
  const place = state.places.find(p => p.id === placeId);
  showModal(`
    <h2>التواصل مع ${escapeHtml(place?.name || "النشاط")}</h2>
    <p class="meta">هذه النسخة ترسل الرسالة إلى صندوق رسائل النشاط. يمكن تطوير الإشعارات وواتساب لاحقًا.</p>
    <form id="messageForm" class="form">
      <textarea name="text" maxlength="1000" required placeholder="اكتب استفسارك..."></textarea>
      <button class="btn btn-primary">إرسال</button>
    </form>
  `);
  $("messageForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const text = new FormData(e.target).get("text");
      await api("/api/messages", { method:"POST", body:JSON.stringify({ placeId, text }) });
      closeModal();
      notify("تم إرسال الرسالة.");
    } catch (err) { notify(err.message, "error"); }
  };
}

async function voteReport(reportId, value) {
  if (!authRequired()) return;
  try {
    await api(`/api/reports/${reportId}/vote`, { method:"POST", body:JSON.stringify({ value }) });
    notify("تم تسجيل تصويتك.");
    await loadReports();
  } catch (err) { notify(err.message, "error"); }
}

function updateAuthUI() {
  $("loginBtn").classList.toggle("hidden", !!state.user);
  $("registerBtn").classList.toggle("hidden", !!state.user);
  $("logoutBtn").classList.toggle("hidden", !state.user);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

async function locateUser() {
  if (!navigator.geolocation) return notify("المتصفح لا يدعم تحديد الموقع.", "error");
  navigator.geolocation.getCurrentPosition(
    pos => {
      notify(`تم الحصول على موقعك: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
      state.userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (state.map) state.map.setView([pos.coords.latitude, pos.coords.longitude], 15);
    },
    () => notify("تعذر الحصول على الموقع. يمكنك اختيار الحي يدويًا.", "error"),
    { enableHighAccuracy:true, timeout:10000 }
  );
}

async function init() {
  try {
    await loadMeta();

    if (state.token) {
      try {
        const me = await api("/api/me");
        state.user = me.user;
      } catch (_) {
        state.token = "";
        localStorage.removeItem("sg_token");
      }
    }

    updateAuthUI();
    await Promise.all([loadPlaces(), loadReports()]);
    renderMap();
  } catch (err) {
    notify(err.message, "error");
  }
}

$("closeModal").onclick = closeModal;
$("modal").onclick = e => { if (e.target === $("modal")) closeModal(); };
$("loginBtn").onclick = showLogin;
$("registerBtn").onclick = showRegister;
$("logoutBtn").onclick = () => {
  state.token = "";
  state.user = null;
  localStorage.removeItem("sg_token");
  updateAuthUI();
  notify("تم تسجيل الخروج.");
};
$("reportBtn").onclick = showReport;
$("addPlaceBtn").onclick = showAddPlace;
$("searchBtn").onclick = loadPlaces;
$("searchInput").addEventListener("keydown", e => { if (e.key === "Enter") loadPlaces(); });
$("areaSelect").onchange = async () => {
  await Promise.all([loadPlaces(), loadReports()]);
};

$("nearMeBtn").onclick = locateUser;

window.voteReport = voteReport;
window.openMessageModal = openMessageModal;

init();