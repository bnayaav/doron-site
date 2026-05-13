/**
 * doron-api — Cloudflare Worker (LMS edition)
 * ============================================
 * Single KV binding: KV
 *
 * Key schema:
 *   auth:doron                          → admin credentials  { user, hash }
 *   session:<token>                     → admin session
 *   user_session:<token>                → student session
 *   courses:catalog                     → published+draft courses array
 *   videos:<courseId>                   → videos for a course
 *   articles:list                       → articles array
 *   materials:<courseId>                → downloadable PDFs/files
 *   user:<userId>                       → student record
 *   user_email:<email>                  → email→userId index
 *   user_progress:<userId>              → { [courseId_videoId]: timestamp }
 *   chat:<userId>                       → message thread
 *   order:<orderId>                     → order record
 *   icount_config                       → iCount API credentials
 *   resend_config                       → Resend API key + from email
 *   site_config                         → general site config
 */

const DEFAULT_USER = "doron";
const DEFAULT_PASS = "12345678";
const SESSION_TTL = 60 * 60 * 24 * 30;

async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function rid(prefix = "") {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return prefix + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function token() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function genPassword() {
  const cons = "bcdfghjkmnpqrstvwxyz";
  const vow = "aeiou";
  const dig = "23456789";
  let pw = "";
  for (let i = 0; i < 3; i++) {
    pw += cons[Math.floor(Math.random() * cons.length)];
    pw += vow[Math.floor(Math.random() * vow.length)];
  }
  pw += dig[Math.floor(Math.random() * dig.length)] + dig[Math.floor(Math.random() * dig.length)];
  return pw;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "*";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
  const allow = allowed.includes("*") ? "*" : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function ensureDefaults(env) {
  const existing = await env.KV.get("auth:doron");
  if (!existing) {
    const hash = await sha256(DEFAULT_PASS);
    await env.KV.put("auth:doron", JSON.stringify({ user: DEFAULT_USER, hash }));
  }
  const cfg = await env.KV.get("site_config");
  if (!cfg) {
    await env.KV.put("site_config", JSON.stringify({ currency: "₪", brandName: "דורון" }));
  }
}

async function requireAdmin(request, env) {
  const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  const raw = await env.KV.get(`session:${t}`);
  if (!raw) return null;
  try { return { ...JSON.parse(raw), token: t }; } catch { return null; }
}

async function requireUser(request, env) {
  const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  const adminRaw = await env.KV.get(`session:${t}`);
  if (adminRaw) { try { return { ...JSON.parse(adminRaw), token: t, role: "admin" }; } catch {} }
  const studentRaw = await env.KV.get(`user_session:${t}`);
  if (studentRaw) { try { return { ...JSON.parse(studentRaw), token: t, role: "student" }; } catch {} }
  return null;
}

async function sendEmail(env, to, subject, html) {
  const cfgRaw = await env.KV.get("resend_config");
  if (!cfgRaw) return { ok: false, reason: "Resend לא הוגדר" };
  const cfg = JSON.parse(cfgRaw);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.from || "דורון <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: data.message || "שליחת מייל נכשלה" };
  return { ok: true, id: data.id };
}

function welcomeEmail(fullName, email, password, courseTitle, loginUrl) {
  return `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;background:#FAF7F2;padding:30px;color:#1a1a1a"><div style="max-width:560px;margin:0 auto;background:white;border-radius:14px;padding:32px;box-shadow:0 4px 14px rgba(0,0,0,.06)"><h1 style="color:#14213D;font-family:Georgia,serif;margin:0 0 8px">ברוך הבא, ${fullName}!</h1><p style="color:#A68940;font-weight:600;letter-spacing:.1em;font-size:13px;margin:0 0 24px">דורון · אימון חיים באמונה</p><p style="font-size:16px;line-height:1.7">תודה על הרכישה של <strong>${courseTitle}</strong>. אני ממש שמח שהצטרפת.</p><div style="background:#FAF7F2;border:1px solid #EBE2D3;border-radius:10px;padding:20px;margin:22px 0"><h3 style="margin:0 0 10px;color:#14213D;font-family:Georgia,serif">פרטי הגישה שלך</h3><p style="margin:6px 0;font-size:15px"><strong>שם משתמש:</strong> ${email}</p><p style="margin:6px 0;font-size:15px"><strong>סיסמה:</strong> <code style="background:white;padding:4px 10px;border-radius:6px;font-family:monospace;font-size:16px;color:#14213D">${password}</code></p></div><p style="font-size:15px;line-height:1.7">היכנס לאזור האישי שלך, צפה בסרטוני הקורס, עקוב אחר ההתקדמות, ושלח לי שאלות בכל זמן:</p><div style="text-align:center;margin:28px 0"><a href="${loginUrl}" style="background:#14213D;color:#F5EFE6;text-decoration:none;padding:14px 32px;border-radius:100px;font-weight:600;display:inline-block">כניסה לאזור האישי</a></div><p style="font-size:14px;color:#888;line-height:1.7">מומלץ לשנות את הסיסמה לאחר הכניסה הראשונה. אם יש לך שאלות, אני זמין דרך המערכת.</p><hr style="border:none;border-top:1px solid #EBE2D3;margin:28px 0"><p style="font-size:13px;color:#888;text-align:center">דורון · אימון חיים באמונה</p></div></body></html>`;
}

async function createOrUpdateUser(env, { fullName, email, phone, courseIds }) {
  const lc = email.toLowerCase();
  let userId = await env.KV.get(`user_email:${lc}`);
  let password = null;
  let user;
  if (userId) {
    const raw = await env.KV.get(`user:${userId}`);
    user = raw ? JSON.parse(raw) : null;
  }
  if (!user) {
    userId = rid("u_");
    password = genPassword();
    user = { email: lc, fullName, phone: phone || "", hash: await sha256(password), courseAccess: [], createdAt: Date.now() };
    await env.KV.put(`user_email:${lc}`, userId);
  }
  if (fullName) user.fullName = fullName;
  if (phone !== undefined) user.phone = phone;
  user.courseAccess = [...new Set([...(user.courseAccess || []), ...(courseIds || [])])];
  await env.KV.put(`user:${userId}`, JSON.stringify(user));
  return { userId, email: lc, fullName: user.fullName, password };
}

async function activateOrder(env, orderId, loginUrl) {
  const raw = await env.KV.get(`order:${orderId}`);
  if (!raw) throw new Error("הזמנה לא נמצאה");
  const order = JSON.parse(raw);
  if (order.status === "paid") return { alreadyActivated: true, order };
  order.status = "paid";
  order.paidAt = Date.now();
  const u = await createOrUpdateUser(env, {
    fullName: order.fullName, email: order.email, phone: order.phone, courseIds: [order.courseId],
  });
  order.userId = u.userId;
  await env.KV.put(`order:${orderId}`, JSON.stringify(order));
  let emailResult = null;
  if (u.password) {
    emailResult = await sendEmail(env, u.email, "ברוך הבא לקורס - דורון",
      welcomeEmail(u.fullName, u.email, u.password, order.courseTitle, loginUrl || "https://doron-site.pages.dev"));
  } else {
    emailResult = await sendEmail(env, u.email, "קורס חדש נוסף לחשבון שלך",
      `<div style="font-family:Arial,sans-serif;padding:20px"><p>שלום ${u.fullName},</p><p>הקורס <strong>${order.courseTitle}</strong> נוסף לאזור האישי שלך.</p><p><a href="${loginUrl || 'https://doron-site.pages.dev'}">היכנס לאזור האישי</a></p></div>`);
  }
  return { order, user: u, emailResult };
}

function buildPaypageUrl(course, order, returnUrl) {
  // course.paypageUrl is the dedicated iCount paypage URL set per-course in admin
  if (!course.paypageUrl) {
    throw new Error("דף תשלום לא הוגדר עבור קורס זה. אנא צור קשר.");
  }
  // Pass customer details + orderId through query params so iCount pre-fills the form
  // and we can match the order back to a customer on success_url return
  const sep = course.paypageUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    cs: order.fullName || "",      // customer name (iCount param)
    em: order.email || "",          // email
    ph: order.phone || "",          // phone
    custom: order.id,                // our order ID — we'll get it back via success_url
    success_url: returnUrl || "",
  });
  return course.paypageUrl + sep + params.toString();
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    
    const wrap = (resp) => {
      const h = new Headers(resp.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(resp.body, { status: resp.status, headers: h });
    };

    try {
      await ensureDefaults(env);
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // ============ PUBLIC ============

      if (path === "/" || path === "/api/health") {
        return wrap(json({ ok: true, service: "doron-api", time: Date.now() }));
      }

      // Public site content (theme, texts, contact info, section visibility)
      if (path === "/api/site/content" && method === "GET") {
        const raw = await env.KV.get("site_content");
        return wrap(json(raw ? JSON.parse(raw) : getDefaultSiteContent()));
      }

      if (path === "/api/catalog" && method === "GET") {
        const raw = await env.KV.get("courses:catalog");
        const list = raw ? JSON.parse(raw) : [];
        return wrap(json(list.filter(c => c.published)));
      }

      if (path === "/api/content/articles" && method === "GET") {
        const raw = await env.KV.get("articles:list");
        return wrap(json(raw ? JSON.parse(raw) : []));
      }

      const videosMatch = path.match(/^\/api\/content\/videos\/([^\/]+)$/);
      if (videosMatch && method === "GET") {
        const courseId = videosMatch[1];
        const u = await requireUser(request, env);
        const catRaw = await env.KV.get("courses:catalog");
        const catalog = catRaw ? JSON.parse(catRaw) : [];
        const course = catalog.find(c => c.id === courseId);
        if (!course) return wrap(json({ error: "קורס לא נמצא" }, 404));
        let hasAccess = course.free || course.price === 0;
        if (u && u.role === "admin") hasAccess = true;
        if (u && u.role === "student") {
          const ur = await env.KV.get(`user:${u.userId}`);
          if (ur) {
            const ud = JSON.parse(ur);
            if ((ud.courseAccess || []).includes(courseId)) hasAccess = true;
          }
        }
        if (!hasAccess) return wrap(json({ error: "אין לך גישה לקורס זה", needPurchase: true, course }, 403));
        const raw = await env.KV.get(`videos:${courseId}`);
        return wrap(json(raw ? JSON.parse(raw) : []));
      }

      // Single course detail (public)
      const courseDetMatch = path.match(/^\/api\/catalog\/([^\/]+)$/);
      if (courseDetMatch && method === "GET") {
        const raw = await env.KV.get("courses:catalog");
        const list = raw ? JSON.parse(raw) : [];
        const c = list.find(c => c.id === courseDetMatch[1] && c.published);
        if (!c) return wrap(json({ error: "קורס לא נמצא" }, 404));
        // include video count for the course detail page
        const vRaw = await env.KV.get(`videos:${c.id}`);
        const vids = vRaw ? JSON.parse(vRaw) : [];
        return wrap(json({ ...c, videoCount: vids.length }));
      }

      // ============ AUTH ============

      if (path === "/api/auth/admin-login" && method === "POST") {
        const { user, password } = await request.json().catch(() => ({}));
        if (!user || !password) return wrap(json({ error: "חסרים פרטים" }, 400));
        const raw = await env.KV.get("auth:doron");
        const auth = raw ? JSON.parse(raw) : null;
        if (!auth || auth.user !== user) return wrap(json({ error: "פרטי התחברות שגויים" }, 401));
        if ((await sha256(password)) !== auth.hash) return wrap(json({ error: "פרטי התחברות שגויים" }, 401));
        const t = token();
        await env.KV.put(`session:${t}`, JSON.stringify({ user, role: "admin", created: Date.now() }), { expirationTtl: SESSION_TTL });
        return wrap(json({ token: t, role: "admin", user }));
      }

      if (path === "/api/auth/student-login" && method === "POST") {
        const { email, password } = await request.json().catch(() => ({}));
        if (!email || !password) return wrap(json({ error: "חסרים פרטים" }, 400));
        const userId = await env.KV.get(`user_email:${email.toLowerCase()}`);
        if (!userId) return wrap(json({ error: "פרטי התחברות שגויים" }, 401));
        const raw = await env.KV.get(`user:${userId}`);
        if (!raw) return wrap(json({ error: "פרטי התחברות שגויים" }, 401));
        const u = JSON.parse(raw);
        if ((await sha256(password)) !== u.hash) return wrap(json({ error: "פרטי התחברות שגויים" }, 401));
        const t = token();
        await env.KV.put(`user_session:${t}`, JSON.stringify({ userId, role: "student", created: Date.now() }), { expirationTtl: SESSION_TTL });
        return wrap(json({ token: t, role: "student", user: { id: userId, email: u.email, fullName: u.fullName } }));
      }

      if (path === "/api/auth/logout" && method === "POST") {
        const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
        if (t) { await env.KV.delete(`session:${t}`); await env.KV.delete(`user_session:${t}`); }
        return wrap(json({ ok: true }));
      }

      // ============ STUDENT SELF-SERVICE ============

      if (path === "/api/me" && method === "GET") {
        const u = await requireUser(request, env);
        if (!u) return wrap(json({ error: "לא מחובר" }, 401));
        if (u.role === "admin") return wrap(json({ role: "admin", user: u.user }));
        const raw = await env.KV.get(`user:${u.userId}`);
        if (!raw) return wrap(json({ error: "משתמש לא נמצא" }, 404));
        const data = JSON.parse(raw);
        const pRaw = await env.KV.get(`user_progress:${u.userId}`);
        const progress = pRaw ? JSON.parse(pRaw) : {};
        const cRaw = await env.KV.get("courses:catalog");
        const catalog = cRaw ? JSON.parse(cRaw) : [];
        const myCourses = catalog.filter(c => (data.courseAccess || []).includes(c.id));
        for (const c of myCourses) {
          const vRaw = await env.KV.get(`videos:${c.id}`);
          const vids = vRaw ? JSON.parse(vRaw) : [];
          c.totalVideos = vids.length;
          c.completedVideos = vids.filter(v => progress[`${c.id}_${v.id}`]).length;
          c.progressPct = vids.length ? Math.round((c.completedVideos / vids.length) * 100) : 0;
        }
        return wrap(json({
          role: "student",
          user: { id: u.userId, email: data.email, fullName: data.fullName, phone: data.phone },
          courses: myCourses,
          progress,
        }));
      }

      if (path === "/api/me/change-password" && method === "POST") {
        const u = await requireUser(request, env);
        if (!u || u.role !== "student") return wrap(json({ error: "לא מחובר" }, 401));
        const { oldPassword, newPassword } = await request.json().catch(() => ({}));
        if (!oldPassword || !newPassword) return wrap(json({ error: "חסרים שדות" }, 400));
        if (newPassword.length < 6) return wrap(json({ error: "סיסמה קצרה" }, 400));
        const raw = await env.KV.get(`user:${u.userId}`);
        const data = JSON.parse(raw);
        if ((await sha256(oldPassword)) !== data.hash) return wrap(json({ error: "סיסמה נוכחית שגויה" }, 400));
        data.hash = await sha256(newPassword);
        await env.KV.put(`user:${u.userId}`, JSON.stringify(data));
        return wrap(json({ ok: true }));
      }

      if (path === "/api/me/progress" && method === "POST") {
        const u = await requireUser(request, env);
        if (!u || u.role !== "student") return wrap(json({ error: "לא מחובר" }, 401));
        const { courseId, videoId, completed } = await request.json().catch(() => ({}));
        const key = `user_progress:${u.userId}`;
        const raw = await env.KV.get(key);
        const progress = raw ? JSON.parse(raw) : {};
        const k = `${courseId}_${videoId}`;
        if (completed) progress[k] = Date.now(); else delete progress[k];
        await env.KV.put(key, JSON.stringify(progress));
        return wrap(json({ ok: true, progress }));
      }

      const matMatch = path.match(/^\/api\/me\/materials\/([^\/]+)$/);
      if (matMatch && method === "GET") {
        const u = await requireUser(request, env);
        if (!u) return wrap(json({ error: "לא מחובר" }, 401));
        const courseId = matMatch[1];
        if (u.role === "student") {
          const raw = await env.KV.get(`user:${u.userId}`);
          const data = raw ? JSON.parse(raw) : null;
          if (!data || !(data.courseAccess || []).includes(courseId)) return wrap(json({ error: "אין גישה" }, 403));
        }
        const raw = await env.KV.get(`materials:${courseId}`);
        return wrap(json(raw ? JSON.parse(raw) : []));
      }

      // Certificate (auto-generated for completed courses)
      const certMatch = path.match(/^\/api\/me\/certificate\/([^\/]+)$/);
      if (certMatch && method === "GET") {
        const u = await requireUser(request, env);
        if (!u || u.role !== "student") return wrap(json({ error: "לא מחובר" }, 401));
        const courseId = certMatch[1];
        const userRaw = await env.KV.get(`user:${u.userId}`);
        const user = userRaw ? JSON.parse(userRaw) : null;
        if (!user || !(user.courseAccess || []).includes(courseId)) return wrap(json({ error: "אין גישה" }, 403));
        const cRaw = await env.KV.get("courses:catalog");
        const catalog = cRaw ? JSON.parse(cRaw) : [];
        const course = catalog.find(c => c.id === courseId);
        if (!course) return wrap(json({ error: "קורס לא נמצא" }, 404));
        const vRaw = await env.KV.get(`videos:${courseId}`);
        const vids = vRaw ? JSON.parse(vRaw) : [];
        const pRaw = await env.KV.get(`user_progress:${u.userId}`);
        const progress = pRaw ? JSON.parse(pRaw) : {};
        const completed = vids.filter(v => progress[`${courseId}_${v.id}`]).length;
        const pct = vids.length ? (completed / vids.length) * 100 : 0;
        if (pct < 100) return wrap(json({ error: "השלמת הקורס נדרשת לקבלת תעודה", progressPct: Math.round(pct) }, 400));
        return wrap(json({
          ok: true,
          certificate: {
            studentName: user.fullName,
            courseTitle: course.title,
            issuedAt: Date.now(),
            certificateId: rid("cert_"),
          },
        }));
      }

      // Chat — student
      if (path === "/api/me/chat" && method === "GET") {
        const u = await requireUser(request, env);
        if (!u || u.role !== "student") return wrap(json({ error: "לא מחובר" }, 401));
        const raw = await env.KV.get(`chat:${u.userId}`);
        return wrap(json(raw ? JSON.parse(raw) : []));
      }
      if (path === "/api/me/chat" && method === "POST") {
        const u = await requireUser(request, env);
        if (!u || u.role !== "student") return wrap(json({ error: "לא מחובר" }, 401));
        const { message } = await request.json().catch(() => ({}));
        if (!message || !message.trim()) return wrap(json({ error: "הודעה ריקה" }, 400));
        const key = `chat:${u.userId}`;
        const raw = await env.KV.get(key);
        const thread = raw ? JSON.parse(raw) : [];
        thread.push({ id: rid("m_"), from: "student", text: message.trim().slice(0, 5000), time: Date.now(), read: false });
        await env.KV.put(key, JSON.stringify(thread));
        return wrap(json({ ok: true, thread }));
      }

      // ============ CHECKOUT ============

      if (path === "/api/checkout" && method === "POST") {
        const { courseId, fullName, email, phone, returnUrl } = await request.json().catch(() => ({}));
        if (!courseId || !fullName || !email) return wrap(json({ error: "חסרים פרטים" }, 400));
        const cRaw = await env.KV.get("courses:catalog");
        const catalog = cRaw ? JSON.parse(cRaw) : [];
        const course = catalog.find(c => c.id === courseId && c.published);
        if (!course) return wrap(json({ error: "קורס לא נמצא" }, 404));
        const orderId = rid("o_");
        const order = {
          id: orderId, courseId, courseTitle: course.title,
          amount: course.price || 0,
          fullName: String(fullName).slice(0, 120),
          email: String(email).toLowerCase().slice(0, 200),
          phone: String(phone || "").slice(0, 30),
          status: "pending", createdAt: Date.now(),
        };
        await env.KV.put(`order:${orderId}`, JSON.stringify(order));
        if (course.free || course.price === 0) {
          const r = await activateOrder(env, orderId, returnUrl);
          return wrap(json({ ok: true, free: true, ...r }));
        }
        // Auto-paypage flow (when admin sets course.paypageUrl)
        if (course.paypageUrl) {
          try {
            const payUrl = buildPaypageUrl(course, order, returnUrl || `https://${url.host}/?paid=${orderId}`);
            order.payUrl = payUrl;
            await env.KV.put(`order:${orderId}`, JSON.stringify(order));
            return wrap(json({ ok: true, orderId, payUrl }));
          } catch (e) { /* fall through to manual */ }
        }
        // Manual flow — order is saved, admin will follow up with a payment link.
        // Notify admin + send customer confirmation email (don't await — fire & forget).
        try {
          const siteCfgRaw = await env.KV.get("site_config");
          const siteCfg = siteCfgRaw ? JSON.parse(siteCfgRaw) : {};
          const adminEmail = siteCfg.adminEmail;
          if (adminEmail) {
            await sendEmail(env, adminEmail, "🎉 הזמנה חדשה באתר!", `
              <div dir="rtl" style="font-family:Arial,sans-serif;background:#FAF7F2;padding:30px;color:#1a1a1a">
                <div style="max-width:560px;margin:0 auto;background:white;border-radius:14px;padding:28px">
                  <h2 style="color:#14213D;font-family:Georgia,serif;margin:0 0 16px">הזמנה חדשה ממתינה לתשלום</h2>
                  <table style="width:100%;border-collapse:collapse;font-size:15px">
                    <tr><td style="padding:8px 0;color:#888;width:30%">קורס:</td><td style="padding:8px 0;font-weight:600">${order.courseTitle}</td></tr>
                    <tr><td style="padding:8px 0;color:#888">סכום:</td><td style="padding:8px 0;font-weight:600">${order.amount} ₪</td></tr>
                    <tr><td style="padding:8px 0;color:#888">לקוח:</td><td style="padding:8px 0;font-weight:600">${order.fullName}</td></tr>
                    <tr><td style="padding:8px 0;color:#888">אימייל:</td><td style="padding:8px 0"><a href="mailto:${order.email}" style="color:#14213D">${order.email}</a></td></tr>
                    <tr><td style="padding:8px 0;color:#888">טלפון:</td><td style="padding:8px 0"><a href="tel:${order.phone}" style="color:#14213D">${order.phone || '-'}</a></td></tr>
                  </table>
                  <p style="margin-top:20px;font-size:14px;color:#888">היכנס לפאנל הניהול → הזמנות, ושלח ללקוח לינק תשלום. לאחר התשלום לחץ "הפעל ידנית" כדי לפתוח את הקורס במייל אוטומטי.</p>
                </div>
              </div>`);
          }
          // Customer confirmation
          await sendEmail(env, order.email, "קיבלנו את ההזמנה שלך - דורון", `
            <div dir="rtl" style="font-family:Arial,sans-serif;background:#FAF7F2;padding:30px;color:#1a1a1a">
              <div style="max-width:560px;margin:0 auto;background:white;border-radius:14px;padding:32px">
                <h1 style="color:#14213D;font-family:Georgia,serif;margin:0 0 8px">תודה ${order.fullName}!</h1>
                <p style="color:#A68940;font-weight:600;letter-spacing:.1em;font-size:13px;margin:0 0 24px">דורון · אימון חיים באמונה</p>
                <p style="font-size:16px;line-height:1.7">קיבלנו את הבקשה שלך לקורס <strong>${order.courseTitle}</strong>.</p>
                <div style="background:#FAF7F2;border:1px solid #EBE2D3;border-radius:10px;padding:18px;margin:20px 0">
                  <strong style="color:#14213D">מה הלאה?</strong>
                  <p style="margin:8px 0 0;font-size:14.5px;line-height:1.7">אחזור אליך תוך מספר שעות עם לינק תשלום מאובטח. לאחר התשלום תקבל מייל נוסף עם פרטי גישה לאזור האישי שלך.</p>
                </div>
                <p style="font-size:14px;color:#888;line-height:1.7">אם יש לך שאלות, פשוט השב למייל הזה.</p>
                <hr style="border:none;border-top:1px solid #EBE2D3;margin:24px 0">
                <p style="font-size:13px;color:#888;text-align:center">דורון · אימון חיים באמונה</p>
              </div>
            </div>`);
        } catch (e) { console.error("notification error:", e); }
        return wrap(json({ ok: true, orderId, manual: true, order }));
      }

      if (path === "/api/checkout/icount-webhook" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const orderId = body.custom_info || body.custom || body.orderId;
        if (!orderId) return wrap(json({ error: "no orderId" }, 400));
        const r = await activateOrder(env, orderId, null);
        return wrap(json({ ok: true, ...r }));
      }

      if (path === "/api/checkout/check" && method === "GET") {
        const orderId = url.searchParams.get("o");
        if (!orderId) return wrap(json({ error: "no orderId" }, 400));
        const raw = await env.KV.get(`order:${orderId}`);
        if (!raw) return wrap(json({ error: "order not found" }, 404));
        const order = JSON.parse(raw);
        return wrap(json({ status: order.status, courseTitle: order.courseTitle, email: order.email }));
      }

      // ============ ADMIN ============

      const admin = await requireAdmin(request, env);

      if (path === "/api/admin/articles" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { article } = await request.json().catch(() => ({}));
        if (!article || !article.title || !article.content) return wrap(json({ error: "חסרים שדות" }, 400));
        const raw = await env.KV.get("articles:list");
        const list = raw ? JSON.parse(raw) : [];
        list.push({
          id: rid("a_"),
          title: String(article.title).slice(0, 200),
          content: String(article.content).slice(0, 30000),
          category: article.category === "opinion" ? "opinion" : "foundation",
          date: Date.now(),
        });
        await env.KV.put("articles:list", JSON.stringify(list));
        return wrap(json({ ok: true }));
      }
      const artDel = path.match(/^\/api\/admin\/articles\/([^\/]+)$/);
      if (artDel && method === "DELETE") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const raw = await env.KV.get("articles:list");
        const list = raw ? JSON.parse(raw) : [];
        await env.KV.put("articles:list", JSON.stringify(list.filter(a => a.id !== artDel[1])));
        return wrap(json({ ok: true }));
      }

      if (path === "/api/admin/catalog" && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const raw = await env.KV.get("courses:catalog");
        return wrap(json(raw ? JSON.parse(raw) : []));
      }
      if (path === "/api/admin/catalog" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { course } = await request.json().catch(() => ({}));
        if (!course || !course.title) return wrap(json({ error: "חסרים שדות" }, 400));
        const raw = await env.KV.get("courses:catalog");
        const list = raw ? JSON.parse(raw) : [];
        if (course.id) {
          const idx = list.findIndex(c => c.id === course.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...course };
          else list.push(course);
        } else {
          course.id = rid("c_");
          course.createdAt = Date.now();
          list.push(course);
        }
        await env.KV.put("courses:catalog", JSON.stringify(list));
        return wrap(json({ ok: true, course: list.find(c => c.id === course.id) }));
      }
      const courseDel = path.match(/^\/api\/admin\/catalog\/([^\/]+)$/);
      if (courseDel && method === "DELETE") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const raw = await env.KV.get("courses:catalog");
        const list = raw ? JSON.parse(raw) : [];
        await env.KV.put("courses:catalog", JSON.stringify(list.filter(c => c.id !== courseDel[1])));
        return wrap(json({ ok: true }));
      }

      const advid = path.match(/^\/api\/admin\/videos\/([^\/]+)$/);
      if (advid && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const raw = await env.KV.get(`videos:${advid[1]}`);
        return wrap(json(raw ? JSON.parse(raw) : []));
      }
      if (advid && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { video } = await request.json().catch(() => ({}));
        if (!video || !video.title || !video.url) return wrap(json({ error: "חסרים שדות" }, 400));
        const courseId = advid[1];
        const raw = await env.KV.get(`videos:${courseId}`);
        const list = raw ? JSON.parse(raw) : [];
        list.push({
          id: rid("v_"),
          title: String(video.title).slice(0, 200),
          url: String(video.url).slice(0, 500),
          description: String(video.description || "").slice(0, 2000),
          addedAt: Date.now(),
        });
        await env.KV.put(`videos:${courseId}`, JSON.stringify(list));
        return wrap(json({ ok: true, videos: list }));
      }
      const advidDel = path.match(/^\/api\/admin\/videos\/([^\/]+)\/([^\/]+)$/);
      if (advidDel && method === "DELETE") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const [, courseId, videoId] = advidDel;
        const raw = await env.KV.get(`videos:${courseId}`);
        const list = raw ? JSON.parse(raw) : [];
        await env.KV.put(`videos:${courseId}`, JSON.stringify(list.filter(v => v.id !== videoId)));
        return wrap(json({ ok: true }));
      }

      const admat = path.match(/^\/api\/admin\/materials\/([^\/]+)$/);
      if (admat && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const raw = await env.KV.get(`materials:${admat[1]}`);
        return wrap(json(raw ? JSON.parse(raw) : []));
      }
      if (admat && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { material } = await request.json().catch(() => ({}));
        if (!material || !material.title || !material.url) return wrap(json({ error: "חסרים שדות" }, 400));
        const courseId = admat[1];
        const raw = await env.KV.get(`materials:${courseId}`);
        const list = raw ? JSON.parse(raw) : [];
        list.push({
          id: rid("mat_"),
          title: String(material.title).slice(0, 200),
          url: String(material.url).slice(0, 1000),
          fileType: material.fileType || "pdf",
          addedAt: Date.now(),
        });
        await env.KV.put(`materials:${courseId}`, JSON.stringify(list));
        return wrap(json({ ok: true }));
      }
      const admatDel = path.match(/^\/api\/admin\/materials\/([^\/]+)\/([^\/]+)$/);
      if (admatDel && method === "DELETE") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const [, courseId, matId] = admatDel;
        const raw = await env.KV.get(`materials:${courseId}`);
        const list = raw ? JSON.parse(raw) : [];
        await env.KV.put(`materials:${courseId}`, JSON.stringify(list.filter(m => m.id !== matId)));
        return wrap(json({ ok: true }));
      }

      if (path === "/api/admin/users" && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const list = await env.KV.list({ prefix: "user:" });
        const users = [];
        for (const k of list.keys) {
          const raw = await env.KV.get(k.name);
          if (raw) {
            const u = JSON.parse(raw);
            users.push({
              id: k.name.replace("user:", ""),
              email: u.email, fullName: u.fullName, phone: u.phone,
              courseAccess: u.courseAccess || [], createdAt: u.createdAt,
            });
          }
        }
        return wrap(json(users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
      }

      if (path === "/api/admin/users" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { fullName, email, phone, courseIds, sendWelcomeEmail, loginUrl } = await request.json().catch(() => ({}));
        if (!email || !fullName) return wrap(json({ error: "חסרים שדות" }, 400));
        const r = await createOrUpdateUser(env, { fullName, email, phone, courseIds: courseIds || [] });
        if (sendWelcomeEmail && r.password) {
          const cRaw = await env.KV.get("courses:catalog");
          const cat = cRaw ? JSON.parse(cRaw) : [];
          const titles = (courseIds || []).map(id => (cat.find(c => c.id === id) || {}).title).filter(Boolean).join(", ") || "הקורסים שלך";
          await sendEmail(env, r.email, "ברוך הבא לקורסים של דורון",
            welcomeEmail(r.fullName, r.email, r.password, titles, loginUrl || "https://doron-site.pages.dev"));
        }
        return wrap(json({ ok: true, ...r }));
      }

      const userUpd = path.match(/^\/api\/admin\/users\/([^\/]+)$/);
      if (userUpd && method === "PUT") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const userId = userUpd[1];
        const { courseIds, fullName, phone, resetPassword, sendWelcomeEmail, loginUrl } = await request.json().catch(() => ({}));
        const raw = await env.KV.get(`user:${userId}`);
        if (!raw) return wrap(json({ error: "משתמש לא נמצא" }, 404));
        const u = JSON.parse(raw);
        if (Array.isArray(courseIds)) u.courseAccess = courseIds;
        if (fullName) u.fullName = fullName;
        if (phone !== undefined) u.phone = phone;
        let newPassword = null;
        if (resetPassword) { newPassword = genPassword(); u.hash = await sha256(newPassword); }
        await env.KV.put(`user:${userId}`, JSON.stringify(u));
        if (sendWelcomeEmail && newPassword) {
          await sendEmail(env, u.email, "פרטי הגישה שלך עודכנו",
            welcomeEmail(u.fullName, u.email, newPassword, "האזור האישי שלך", loginUrl || "https://doron-site.pages.dev"));
        }
        return wrap(json({ ok: true, password: newPassword }));
      }
      
      if (userUpd && method === "DELETE") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const userId = userUpd[1];
        const raw = await env.KV.get(`user:${userId}`);
        if (raw) {
          const u = JSON.parse(raw);
          await env.KV.delete(`user_email:${u.email}`);
        }
        await env.KV.delete(`user:${userId}`);
        await env.KV.delete(`user_progress:${userId}`);
        await env.KV.delete(`chat:${userId}`);
        return wrap(json({ ok: true }));
      }

      if (path === "/api/admin/orders" && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const list = await env.KV.list({ prefix: "order:" });
        const orders = [];
        for (const k of list.keys) {
          const raw = await env.KV.get(k.name);
          if (raw) orders.push(JSON.parse(raw));
        }
        return wrap(json(orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))));
      }

      const orderActMatch = path.match(/^\/api\/admin\/orders\/([^\/]+)\/activate$/);
      if (orderActMatch && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { loginUrl } = await request.json().catch(() => ({}));
        const r = await activateOrder(env, orderActMatch[1], loginUrl);
        return wrap(json({ ok: true, ...r }));
      }

      if (path === "/api/admin/chats" && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const list = await env.KV.list({ prefix: "chat:" });
        const threads = [];
        for (const k of list.keys) {
          const userId = k.name.replace("chat:", "");
          const raw = await env.KV.get(k.name);
          if (raw) {
            const messages = JSON.parse(raw);
            const userRaw = await env.KV.get(`user:${userId}`);
            const u = userRaw ? JSON.parse(userRaw) : { email: "?", fullName: "?" };
            const lastMsg = messages[messages.length - 1];
            const unread = messages.filter(m => m.from === "student" && !m.read).length;
            threads.push({
              userId, email: u.email, fullName: u.fullName,
              lastMessage: lastMsg ? lastMsg.text : "",
              lastTime: lastMsg ? lastMsg.time : 0,
              unread, count: messages.length,
            });
          }
        }
        return wrap(json(threads.sort((a, b) => b.lastTime - a.lastTime)));
      }

      const adChat = path.match(/^\/api\/admin\/chats\/([^\/]+)$/);
      if (adChat && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const userId = adChat[1];
        const raw = await env.KV.get(`chat:${userId}`);
        const messages = raw ? JSON.parse(raw) : [];
        let modified = false;
        for (const m of messages) {
          if (m.from === "student" && !m.read) { m.read = true; modified = true; }
        }
        if (modified) await env.KV.put(`chat:${userId}`, JSON.stringify(messages));
        return wrap(json(messages));
      }
      if (adChat && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const userId = adChat[1];
        const { message } = await request.json().catch(() => ({}));
        if (!message || !message.trim()) return wrap(json({ error: "הודעה ריקה" }, 400));
        const raw = await env.KV.get(`chat:${userId}`);
        const messages = raw ? JSON.parse(raw) : [];
        messages.push({ id: rid("m_"), from: "admin", text: message.trim().slice(0, 5000), time: Date.now(), read: false });
        await env.KV.put(`chat:${userId}`, JSON.stringify(messages));
        return wrap(json({ ok: true }));
      }

      if (path === "/api/admin/config" && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const ic = await env.KV.get("icount_config");
        const rs = await env.KV.get("resend_config");
        const st = await env.KV.get("site_config");
        const icp = ic ? JSON.parse(ic) : null;
        const rsp = rs ? JSON.parse(rs) : null;
        return wrap(json({
          icount: icp ? { configured: true, companyId: icp.companyId, user: icp.user, password: "****" } : { configured: false },
          resend: rsp ? { configured: true, from: rsp.from, apiKey: "****" } : { configured: false },
          site: st ? JSON.parse(st) : { currency: "₪" },
        }));
      }
      if (path === "/api/admin/config" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const body = await request.json().catch(() => ({}));
        if (body.icount) {
          const exRaw = await env.KV.get("icount_config");
          const ex = exRaw ? JSON.parse(exRaw) : {};
          const m = { ...ex, ...body.icount };
          if (m.password === "****") m.password = ex.password;
          await env.KV.put("icount_config", JSON.stringify(m));
        }
        if (body.resend) {
          const exRaw = await env.KV.get("resend_config");
          const ex = exRaw ? JSON.parse(exRaw) : {};
          const m = { ...ex, ...body.resend };
          if (m.apiKey === "****") m.apiKey = ex.apiKey;
          await env.KV.put("resend_config", JSON.stringify(m));
        }
        if (body.site) await env.KV.put("site_config", JSON.stringify(body.site));
        return wrap(json({ ok: true }));
      }

      if (path === "/api/admin/test-email" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { to } = await request.json().catch(() => ({}));
        if (!to) return wrap(json({ error: "חסר נמען" }, 400));
        const r = await sendEmail(env, to, "מייל בדיקה - מערכת דורון",
          `<div style="font-family:Arial,sans-serif;padding:20px"><h2 style="color:#14213D">המייל פועל! 🎉</h2><p>אם הגעת למייל הזה, המערכת מוכנה לשליחת הודעות אוטומטיות ללקוחות.</p></div>`);
        return wrap(json(r));
      }

      if (path === "/api/admin/change-password" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { oldPassword, newPassword } = await request.json().catch(() => ({}));
        if (!oldPassword || !newPassword) return wrap(json({ error: "חסרים שדות" }, 400));
        if (newPassword.length < 6) return wrap(json({ error: "סיסמה קצרה" }, 400));
        const raw = await env.KV.get("auth:doron");
        const auth = JSON.parse(raw);
        if ((await sha256(oldPassword)) !== auth.hash) return wrap(json({ error: "סיסמה נוכחית שגויה" }, 400));
        auth.hash = await sha256(newPassword);
        await env.KV.put("auth:doron", JSON.stringify(auth));
        return wrap(json({ ok: true }));
      }

      // Stats overview
      if (path === "/api/admin/stats" && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const ulist = await env.KV.list({ prefix: "user:" });
        const olist = await env.KV.list({ prefix: "order:" });
        const clist = await env.KV.list({ prefix: "chat:" });
        const cRaw = await env.KV.get("courses:catalog");
        const courses = cRaw ? JSON.parse(cRaw) : [];
        let totalRevenue = 0;
        let paidOrders = 0;
        let unreadChats = 0;
        for (const k of olist.keys) {
          const raw = await env.KV.get(k.name);
          if (raw) {
            const o = JSON.parse(raw);
            if (o.status === "paid") { totalRevenue += (o.amount || 0); paidOrders++; }
          }
        }
        for (const k of clist.keys) {
          const raw = await env.KV.get(k.name);
          if (raw) {
            const t = JSON.parse(raw);
            if (t.some(m => m.from === "student" && !m.read)) unreadChats++;
          }
        }
        return wrap(json({
          totalUsers: ulist.keys.length,
          totalOrders: olist.keys.length,
          paidOrders,
          totalRevenue,
          totalCourses: courses.length,
          publishedCourses: courses.filter(c => c.published).length,
          unreadChats,
        }));
      }

      // Admin: read/save site content (textual + theme + visibility)
      if (path === "/api/admin/site-content" && method === "GET") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const raw = await env.KV.get("site_content");
        return wrap(json(raw ? JSON.parse(raw) : getDefaultSiteContent()));
      }
      if (path === "/api/admin/site-content" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const { content } = await request.json().catch(() => ({}));
        if (!content || typeof content !== "object") return wrap(json({ error: "תוכן לא תקין" }, 400));
        // Merge with defaults to ensure full structure
        const merged = { ...getDefaultSiteContent(), ...content };
        await env.KV.put("site_content", JSON.stringify(merged));
        return wrap(json({ ok: true, content: merged }));
      }
      if (path === "/api/admin/site-content/reset" && method === "POST") {
        if (!admin) return wrap(json({ error: "לא מחובר" }, 401));
        const def = getDefaultSiteContent();
        await env.KV.put("site_content", JSON.stringify(def));
        return wrap(json({ ok: true, content: def }));
      }

      return wrap(json({ error: "Not found", path }, 404));
    } catch (err) {
      console.error(err);
      return wrap(json({ error: err.message || "שגיאה פנימית" }, 500));
    }
  },
};

// ===== Default site content =====
function getDefaultSiteContent() {
  return {
    // Brand
    brandName: "דורון",
    brandTagline: "אימון חיים באמונה",
    logoUrl: "", // empty = use default "ד" letter

    // Theme colors
    colorNavy: "#14213D",
    colorCream: "#F5EFE6",
    colorCreamLight: "#FAF7F2",
    colorGold: "#C9A961",
    colorGoldDark: "#A68940",

    // Hero
    heroEyebrow: "מסע של אמונה · הקשבה · צמיחה",
    heroTitle: "להביט על החיים",
    heroTitleEm: "דרך מבט של אמונה",
    heroLead: "קורסי וידאו מקצועיים, מסגרות אימון אישיות וקבוצתיות, מאמרי יסוד שמתחדשים מדי יום.",
    heroBgImage: "", // optional background image URL
    heroBtnPrimary: "לכל הקורסים",
    heroBtnSecondary: "קרא מאמרים",

    // About
    aboutKicker: "על שיטת האימון",
    aboutTitle: "אימון חיים שמתחיל במקור",
    aboutP1: "שיטת אימון ייחודית שנשענת על יסודות באמונה, ומתרגמת אותם לכלים מעשיים לחיי היומיום. כל פגישה היא הזדמנות להעמיק את ההקשבה לעצמך, לזוגיות, ולסביבה – דרך מבט רחב יותר.",
    aboutP2: "הליווי שלי משלב בין שיחה אישית, מסגרות קבוצתיות, וחומרי לימוד יומיים שזמינים כאן באתר. המטרה אחת: שכל אחד יצליח לחיות את החיים שלו מתוך משמעות.",

    // Contact
    contactTitle: "פרטי התקשרות",
    contactSubtitle: "ליצירת קשר או קביעת פגישת היכרות ללא התחייבות",
    contactPhone: "058-7529107",
    contactEmail: "doron.avihzer@gmail.com",
    contactWhatsappNum: "972587529107",
    contactWhatsappMsg: "שלום דורון, אשמח לקבל פרטים נוספים",

    // Courses section
    coursesKicker: "קורסי וידאו דיגיטליים",
    coursesTitle: "הקורסים שלי",
    coursesLead: "כל קורס נבנה במיוחד לליווי של מסע פנימי. צפייה גמישה בקצב שלך, חומרי לימוד נלווים, ומענה אישי לשאלות.",

    // Offerings section (workshops/lectures/lessons)
    offeringsKicker: "לציבור ולמוסדות חינוך",
    offeringsTitle: "סדנאות, הרצאות ושיעורים",
    offeringsLead: "תוכן מותאם – לקהילה, לבית ספר, לארגון, או לכל מסגרת אחרת.",
    offering1Title: "סדנאות",
    offering1Text: "סדנאות חווייתיות של מספר שעות, מותאמות למטרת הקבוצה או המוסד.",
    offering2Title: "הרצאות",
    offering2Text: "הרצאות בנושאי יסודות באמונה, חינוך, זוגיות, ועבודה עצמית.",
    offering3Title: "שיעורים קבועים",
    offering3Text: "שיעורים שבועיים או חודשיים לקהילות ומוסדות חינוך.",

    // Articles section
    articlesKicker: "מאמרי יסוד · טור דעה · ספריית מאמרים",
    articlesTitle: "תוכן שמתחדש כל יום",

    // Footer
    footerAbout: "אימון חיים באמונה – קורסים דיגיטליים, מסגרות אישיות וקבוצתיות, ותוכן מותאם למוסדות.",
    footerCopyright: "נבנה בעברית ובאהבה",

    // Section visibility toggles
    showAbout: true,
    showCourses: true,
    showOfferings: true,
    showArticles: true,
    showContact: true,
  };
}
