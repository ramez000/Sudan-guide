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
    <div class="auth-panel">
      <div class="auth-heading">
        <div class="auth-logo">SG</div>
        <h2>مرحبًا بعودتك</h2>
        <p class="meta">سجّل دخولك لمتابعة خدمات دليل السودان.</p>
      </div>

      <form id="loginForm" class="form auth-form" novalidate>
        <label>
          البريد الإلكتروني
          <input
            id="loginEmail"
            name="email"
            type="email"
            maxlength="254"
            placeholder="name@example.com"
            autocomplete="email"
            required
          >
          <small id="loginEmailHint" class="field-hint">
            أدخل البريد الإلكتروني المسجل في حسابك.
          </small>
        </label>

        <label>
          كلمة المرور
          <div class="password-field">
            <input
              id="loginPassword"
              name="password"
              type="password"
              autocomplete="current-password"
              placeholder="أدخل كلمة المرور"
              required
            >
            <button
              type="button"
              id="toggleLoginPassword"
              class="password-toggle"
              aria-label="إظهار كلمة المرور"
              aria-pressed="false"
            >
              <svg class="eye-open hidden" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="eye-closed" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/>
                <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.8-.8"/>
              </svg>
            </button>
          </div>
          <small class="field-hint">أدخل كلمة المرور الخاصة بحسابك.</small>
        </label>

        <p id="loginMessage" class="auth-message hidden"></p>

        <button
          id="loginSubmit"
          type="submit"
          class="btn btn-primary auth-submit"
        >تسجيل الدخول</button>
      </form>

      <p class="auth-switch">
        ليس لديك حساب؟
        <button id="switchRegister" type="button" class="btn btn-light">
          إنشاء حساب جديد
        </button>
      </p>
    </div>
  `);

  const form = $("loginForm");
  const emailInput = $("loginEmail");
  const passwordInput = $("loginPassword");
  const message = $("loginMessage");
  const submit = $("loginSubmit");
  const toggle = $("toggleLoginPassword");

  toggle.onclick = () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";

    toggle.querySelector(".eye-open").classList.toggle("hidden", !show);
    toggle.querySelector(".eye-closed").classList.toggle("hidden", show);
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute(
      "aria-label",
      show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
    );
  };

  emailInput.addEventListener("input", () => {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim());
    const hint = $("loginEmailHint");

    hint.textContent = !emailInput.value.trim()
      ? "أدخل البريد الإلكتروني المسجل في حسابك."
      : valid
        ? "صيغة البريد الإلكتروني تبدو صحيحة."
        : "تحقق من كتابة البريد الإلكتروني بشكل صحيح.";

    hint.classList.toggle("field-error", !!emailInput.value.trim() && !valid);
  });

  $("switchRegister").onclick = showRegister;

  form.onsubmit = async event => {
    event.preventDefault();
    message.classList.add("hidden");

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      message.textContent = "أدخل بريدًا إلكترونيًا صحيحًا.";
      message.classList.remove("hidden");
      emailInput.focus();
      return;
    }

    if (!password) {
      message.textContent = "أدخل كلمة المرور.";
      message.classList.remove("hidden");
      passwordInput.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "جارٍ تسجيل الدخول...";

    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("sg_token", state.token);

      updateAuthUI();
      closeModal();
      notify(`مرحبًا ${state.user.name}`);
    } catch (error) {
      message.textContent = error.message || "تعذر تسجيل الدخول. تحقق من بياناتك.";
      message.classList.remove("hidden");
    } finally {
      submit.disabled = false;
      submit.textContent = "تسجيل الدخول";
    }
  };
}


function showRegister() {
  showModal(`
    <div class="auth-panel">
      <div class="auth-heading">
        <div class="auth-logo">SG</div>
        <h2>أنشئ حسابك في Sudan Guide</h2>
        <p class="meta">اكتشف الأماكن والخدمات وساهم في بناء دليل السودان.</p>
      </div>

      <form id="registerForm" class="form auth-form" novalidate>
        <label>
          الاسم
          <input
            name="name"
            id="registerName"
            type="text"
            minlength="2"
            maxlength="80"
            placeholder="اكتب اسمك"
            autocomplete="name"
            required
          >
          <small id="registerNameHint" class="field-hint">
            استخدم اسمًا من حرفين على الأقل.
          </small>
        </label>

        <label>
          البريد الإلكتروني
          <input
            name="email"
            id="registerEmail"
            type="email"
            maxlength="254"
            placeholder="name@example.com"
            autocomplete="email"
            required
          >
          <small id="registerEmailHint" class="field-hint">
            سنستخدمه لتسجيل الدخول إلى حسابك.
          </small>
        </label>

        <label>
          نبذة عنك
          <textarea
            name="bio"
            id="registerBio"
            maxlength="240"
            rows="3"
            placeholder="عرّف الآخرين بنفسك باختصار (اختياري)"
          ></textarea>
          <small id="registerBioHint" class="field-hint">
            يمكنك كتابة نبذة قصيرة تصل إلى 240 حرفًا.
          </small>
        </label>

        <label>
          كلمة المرور
          <div class="password-field">
            <input
              name="password"
              id="registerPassword"
              type="password"
              minlength="8"
              placeholder="8 أحرف على الأقل"
              autocomplete="new-password"
              required
            >
            
<button
  type="button"
  id="toggleRegisterPassword"
  class="password-toggle"
  aria-label="إظهار كلمة المرور"
  aria-pressed="false"
>
  <svg class="eye-open hidden" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
  <svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/>
    <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.8-.8"/>
  </svg>
</button>

          </div>
          <small id="registerPasswordHint" class="field-hint">
            اجعل كلمة المرور 8 أحرف على الأقل.
          </small>
        </label>

        <p id="registerMessage" class="auth-message hidden"></p>

        <button
          id="registerSubmit"
          type="submit"
          class="btn btn-primary auth-submit"
        >إنشاء الحساب</button>
      </form>

      <p class="auth-switch">
        لديك حساب بالفعل؟
        <button id="switchLogin" type="button" class="btn btn-light">
          تسجيل الدخول
        </button>
      </p>
    </div>
  `);

  const form = $("registerForm");
  const nameInput = $("registerName");
  const emailInput = $("registerEmail");
  const bioInput = $("registerBio");
  const passwordInput = $("registerPassword");
  const message = $("registerMessage");
  const submit = $("registerSubmit");

  function setHint(id, text, error = false) {
    const hint = $(id);
    hint.textContent = text;
    hint.classList.toggle("field-error", error);
  }

  nameInput.addEventListener("input", () => {
    const value = nameInput.value.trim();

    if (!value) {
      setHint("registerNameHint", "اكتب الاسم الذي سيظهر في ملفك الشخصي.");
    } else if (value.length < 2) {
      setHint("registerNameHint", "الاسم قصير جدًا؛ أدخل حرفين على الأقل.", true);
    } else {
      setHint("registerNameHint", "ممتاز، سيظهر هذا الاسم في حسابك.");
    }
  });

  emailInput.addEventListener("input", () => {
    const value = emailInput.value.trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

    if (!value) {
      setHint("registerEmailHint", "أدخل بريدك الإلكتروني.");
    } else if (!valid) {
      setHint("registerEmailHint", "تحقق من كتابة البريد بالشكل الصحيح.", true);
    } else {
      setHint("registerEmailHint", "صيغة البريد تبدو صحيحة.");
    }
  });

  bioInput.addEventListener("input", () => {
    const remaining = 240 - bioInput.value.length;
    setHint("registerBioHint", `متبقي ${remaining} حرفًا.`);
  });

  passwordInput.addEventListener("input", () => {
    const length = passwordInput.value.length;

    if (length === 0) {
      setHint("registerPasswordHint", "اجعل كلمة المرور 8 أحرف على الأقل.");
    } else if (length < 8) {
      setHint("registerPasswordHint", `تحتاج إلى ${8 - length} أحرف إضافية على الأقل.`, true);
    } else {
      setHint("registerPasswordHint", "طول كلمة المرور مناسب.");
    }
  });

  
$("toggleRegisterPassword").onclick = () => {
  const hidden = passwordInput.type === "password";

  passwordInput.type = hidden ? "text" : "password";

  const button = $("toggleRegisterPassword");
  button.querySelector(".eye-open").classList.toggle("hidden", !hidden);
  button.querySelector(".eye-closed").classList.toggle("hidden", hidden);
  button.setAttribute("aria-pressed", String(hidden));
  button.setAttribute(
    "aria-label",
    hidden ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
  );
};


  $("switchLogin").onclick = showLogin;

  form.onsubmit = async event => {
    event.preventDefault();
    message.classList.add("hidden");

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const bio = bioInput.value.trim();
    const password = passwordInput.value;

    if (name.length < 2 || name.length > 80) {
      message.textContent = "أدخل اسمًا يتراوح بين حرفين و80 حرفًا.";
      message.classList.remove("hidden");
      nameInput.focus();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      message.textContent = "أدخل بريدًا إلكترونيًا صحيحًا.";
      message.classList.remove("hidden");
      emailInput.focus();
      return;
    }

    if (bio.length > 240) {
      message.textContent = "النبذة يجب ألا تتجاوز 240 حرفًا.";
      message.classList.remove("hidden");
      bioInput.focus();
      return;
    }

    if (password.length < 8) {
      message.textContent = "كلمة المرور يجب أن تكون 8 أحرف على الأقل.";
      message.classList.remove("hidden");
      passwordInput.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "جارٍ إنشاء الحساب...";

    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, bio, password })
      });

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("sg_token", state.token);

      updateAuthUI();
      closeModal();
      notify("تم إنشاء الحساب بنجاح.");
    } catch (error) {
      message.textContent = error.message || "تعذر إنشاء الحساب.";
      message.classList.remove("hidden");
    } finally {
      submit.disabled = false;
      submit.textContent = "إنشاء الحساب";
    }
  };
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
  $("profileBtn").classList.toggle("hidden", !state.user);
  $("logoutBtn").classList.toggle("hidden", !state.user);
}


function showProfile() {
  if (!state.user) {
    showLogin();
    return;
  }

  const user = state.user;
  const name = (user.name || "مستخدم").trim();
  const initial = escapeHtml(name.charAt(0).toUpperCase());
  const role = user.role === "admin" ? "مدير النظام" : "مستخدم";

  showModal(`
    <div class="account-view">
      <header class="account-view-heading">
        <h2>معلومات الحساب</h2>
        <p>عرض وإدارة بيانات حسابك في دليل السودان.</p>
      </header>

      <section class="account-card">
        <div class="account-summary">
          <div class="account-avatar">${initial}</div>

          <div class="account-summary-info">
            <h3>${escapeHtml(name)}</h3>
            <p>${escapeHtml(user.bio || "لم تضف نبذة شخصية بعد.")}</p>
          </div>

          <button
            type="button"
            id="editProfileBtn"
            class="account-edit-button"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>
            </svg>
            <span>تعديل الحساب</span>
          </button>
        </div>

        <div class="account-detail">
          <div class="account-detail-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 21v-2a8 8 0 0 1 16 0v2"/>
            </svg>
          </div>
          <div class="account-detail-content">
            <span class="account-detail-label">اسم الحساب</span>
            <p>${escapeHtml(user.name || "")}</p>
          </div>
        </div>

        <div class="account-detail">
          <div class="account-detail-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <path d="m3 7 9 6 9-6"/>
            </svg>
          </div>
          <div class="account-detail-content">
            <span class="account-detail-label">البريد الإلكتروني</span>
            <p dir="ltr">${escapeHtml(user.email || "")}</p>
          </div>
        </div>

        <div class="account-detail">
          <div class="account-detail-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3 7 21M17 3l-2 18M4 9h17M3 15h17"/>
            </svg>
          </div>
          <div class="account-detail-content">
            <span class="account-detail-label">معرّف الحساب</span>
            <p class="account-id-value" dir="ltr">${escapeHtml(user.id || "غير متوفر")}</p>
          </div>
        </div>

        <div class="account-detail">
          <div class="account-detail-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="4"/>
              <path d="M2 21v-2a7 7 0 0 1 14 0v2"/>
              <path d="M19 8v6M16 11h6"/>
            </svg>
          </div>
          <div class="account-detail-content">
            <span class="account-detail-label">نوع الحساب</span>
            <span class="account-role">${role}</span>
          </div>
        </div>
      </section>

      <div class="account-view-footer">
        <button type="button" id="closeProfileBtn" class="btn btn-light">
          إغلاق
        </button>
      </div>
    </div>
  `);

  $("editProfileBtn").onclick = showEditProfile;
  $("closeProfileBtn").onclick = closeModal;
}


function showEditProfile() {
  if (!state.user) {
    showLogin();
    return;
  }

  const user = state.user;
  const role = user.role === "admin" ? "مدير النظام" : "مستخدم";

  showModal(`
    <div class="account-edit-view">
      <header class="account-view-heading">
        <button type="button" id="backToProfile" class="account-back-button">
          العودة إلى الحساب
        </button>
        <h2>تعديل الحساب</h2>
        <p>حدّث بياناتك الشخصية ثم اضغط حفظ التغييرات.</p>
      </header>

      <section class="account-card account-edit-card">
        <form id="editProfileForm" class="auth-form" novalidate>
          <label for="editProfileName">
            اسم الحساب
            <input
              id="editProfileName"
              name="name"
              type="text"
              value="${escapeHtml(user.name || "")}"
              minlength="2"
              maxlength="80"
              autocomplete="name"
              required
            >
          </label>

          <label for="editProfileEmail">
            البريد الإلكتروني
            <input
              id="editProfileEmail"
              name="email"
              type="email"
              value="${escapeHtml(user.email || "")}"
              maxlength="254"
              autocomplete="email"
              dir="ltr"
              required
            >
          </label>

          <label for="editProfileBio">
            النبذة الشخصية
            <textarea
              id="editProfileBio"
              name="bio"
              rows="4"
              maxlength="240"
              placeholder="اكتب نبذة قصيرة عن نفسك..."
            >${escapeHtml(user.bio || "")}</textarea>
            <small class="field-hint">بحد أقصى 240 حرفًا.</small>
          </label>

          <div class="account-readonly-details">
            <div>
              <span class="account-detail-label">معرّف الحساب</span>
              <p dir="ltr">${escapeHtml(user.id || "غير متوفر")}</p>
            </div>
            <div>
              <span class="account-detail-label">نوع الحساب</span>
              <p>${role}</p>
            </div>
          </div>

          <p id="editProfileMessage" class="auth-message hidden"></p>

          
          <section class="password-change-section">
            <div class="password-change-heading">
              <h3>تغيير كلمة المرور</h3>
              <p>استخدم كلمة مرور قوية لا تقل عن 8 أحرف.</p>
            </div>

            <label for="currentPassword">كلمة المرور الحالية</label>
            <div class="password-field">
              <input
                id="currentPassword"
                type="password"
                autocomplete="current-password"
                placeholder="أدخل كلمة المرور الحالية"
              >
              <button
                type="button"
                class="password-toggle"
                data-password-target="currentPassword"
                aria-label="إظهار كلمة المرور"
                aria-pressed="false"
              >
                <svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12c2.5 3 5.8 4.5 10 4.5s7.5-1.5 10-4.5"/>
                </svg>
                <svg class="eye-open hidden" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>

            <label for="newPassword">كلمة المرور الجديدة</label>
            <div class="password-field">
              <input
                id="newPassword"
                type="password"
                autocomplete="new-password"
                minlength="8"
                maxlength="128"
                placeholder="أدخل كلمة المرور الجديدة"
              >
              <button
                type="button"
                class="password-toggle"
                data-password-target="newPassword"
                aria-label="إظهار كلمة المرور"
                aria-pressed="false"
              >
                <svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12c2.5 3 5.8 4.5 10 4.5s7.5-1.5 10-4.5"/>
                </svg>
                <svg class="eye-open hidden" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>

            <label for="confirmNewPassword">تأكيد كلمة المرور الجديدة</label>
            <div class="password-field">
              <input
                id="confirmNewPassword"
                type="password"
                autocomplete="new-password"
                maxlength="128"
                placeholder="أعد كتابة كلمة المرور الجديدة"
              >
              <button
                type="button"
                class="password-toggle"
                data-password-target="confirmNewPassword"
                aria-label="إظهار كلمة المرور"
                aria-pressed="false"
              >
                <svg class="eye-closed" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12c2.5 3 5.8 4.5 10 4.5s7.5-1.5 10-4.5"/>
                </svg>
                <svg class="eye-open hidden" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>

            <p id="passwordChangeMessage" class="auth-message hidden"></p>

            <button
              type="button"
              id="changePasswordBtn"
              class="btn btn-primary auth-submit"
            >
              تغيير كلمة المرور
            </button>
          </section>


          <div class="account-edit-actions">
            <button
              type="submit"
              id="saveProfileBtn"
              class="btn btn-primary auth-submit"
            >
              حفظ التغييرات
            </button>

            <button
              type="button"
              id="cancelProfileBtn"
              class="btn btn-light"
            >
              إلغاء
            </button>
          </div>
        </form>
      </section>
    </div>
  `);

  $("backToProfile").onclick = showProfile;
  $("cancelProfileBtn").onclick = showProfile;

  const form = $("editProfileForm");
  const message = $("editProfileMessage");
  const saveButton = $("saveProfileBtn");

  form.onsubmit = async event => {
    event.preventDefault();
    message.classList.add("hidden");

    const name = $("editProfileName").value.trim();
    const email = $("editProfileEmail").value.trim();
    const bio = $("editProfileBio").value.trim();

    if (name.length < 2 || name.length > 80) {
      message.textContent = "يجب أن يكون الاسم بين حرفين و80 حرفًا.";
      message.classList.remove("hidden");
      $("editProfileName").focus();
      return;
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      message.textContent = "أدخل بريدًا إلكترونيًا صحيحًا.";
      message.classList.remove("hidden");
      $("editProfileEmail").focus();
      return;
    }

    if (bio.length > 240) {
      message.textContent = "النبذة الشخصية يجب ألا تتجاوز 240 حرفًا.";
      message.classList.remove("hidden");
      $("editProfileBio").focus();
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "جارٍ الحفظ...";

    try {
      const data = await api("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ name, email, bio })
      });

      state.user = {
        ...state.user,
        ...(data.user || {}),
        name,
        email,
        bio
      };

      updateAuthUI();
      showProfile();
      notify("تم حفظ تغييرات الحساب بنجاح.");
    } catch (error) {
      message.textContent = error.message || "تعذر حفظ التغييرات.";
      message.classList.remove("hidden");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "حفظ التغييرات";
    }
  };
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
$("profileBtn").onclick = showProfile;
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