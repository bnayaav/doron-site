/**
 * doron-api — Cloudflare Worker
 * ------------------------------
 * API לאתר של דורון: אימות, ניהול סרטונים וניהול מאמרים.
 * כל הנתונים נשמרים ב-KV (binding: KV).
 *
 * Endpoints:
 *   GET    /api/content/videos               — פומבי
 *   GET    /api/content/articles             — פומבי
 *   POST   /api/auth/login                   — { user, password } → { token }
 *   POST   /api/auth/change-password         — { oldPassword, newPassword } (אוטנטיקציה)
 *   POST   /api/content/videos               — { courseId, video } (אוטנטיקציה)
 *   DELETE /api/content/videos/:course/:id   — (אוטנטיקציה)
 *   POST   /api/content/articles             — { article } (אוטנטיקציה)
 *   DELETE /api/content/articles/:id         — (אוטנטיקציה)
 */

const DEFAULT_USER = "doron";
const DEFAULT_PASS = "12345678";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

// ——— Helpers ———
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "*";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
  const allow = allowed.includes("*") ? "*" : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, init = {}, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function ensureDefaultAuth(env) {
  const existing = await env.KV.get("auth:doron");
  if (!existing) {
    const hash = await sha256(DEFAULT_PASS);
    await env.KV.put("auth:doron", JSON.stringify({ user: DEFAULT_USER, hash }));
  }
}

async function requireAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const raw = await env.KV.get(`session:${token}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ——— Main handler ———
export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const wrap = (resp) => {
      const h = new Headers(resp.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(resp.body, { status: resp.status, headers: h });
    };

    try {
      await ensureDefaultAuth(env);
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // ——— Health check ———
      if (path === "/" || path === "/api" || path === "/api/health") {
        return wrap(json({ ok: true, service: "doron-api", time: Date.now() }));
      }

      // ——— Public: videos list ———
      if (path === "/api/content/videos" && method === "GET") {
        const raw = await env.KV.get("content:videos");
        return wrap(json(raw ? JSON.parse(raw) : {}));
      }

      // ——— Public: articles list ———
      if (path === "/api/content/articles" && method === "GET") {
        const raw = await env.KV.get("content:articles");
        return wrap(json(raw ? JSON.parse(raw) : []));
      }

      // ——— Login ———
      if (path === "/api/auth/login" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { user, password } = body;
        if (!user || !password) {
          return wrap(json({ error: "חסרים פרטי התחברות" }, { status: 400 }));
        }
        const authRaw = await env.KV.get("auth:doron");
        const auth = authRaw ? JSON.parse(authRaw) : null;
        if (!auth || auth.user !== user) {
          return wrap(json({ error: "שם משתמש או סיסמה שגויים" }, { status: 401 }));
        }
        const hash = await sha256(password);
        if (hash !== auth.hash) {
          return wrap(json({ error: "שם משתמש או סיסמה שגויים" }, { status: 401 }));
        }
        const token = randomToken();
        await env.KV.put(
          `session:${token}`,
          JSON.stringify({ user, created: Date.now() }),
          { expirationTtl: SESSION_TTL }
        );
        return wrap(json({ token, user }));
      }

      // ——— All endpoints below require auth ———
      const session = await requireAuth(request, env);
      if (!session) {
        return wrap(json({ error: "לא מחובר" }, { status: 401 }));
      }

      // ——— Logout ———
      if (path === "/api/auth/logout" && method === "POST") {
        const header = request.headers.get("Authorization") || "";
        const token = header.replace(/^Bearer\s+/i, "").trim();
        if (token) await env.KV.delete(`session:${token}`);
        return wrap(json({ ok: true }));
      }

      // ——— Change password ———
      if (path === "/api/auth/change-password" && method === "POST") {
        const { oldPassword, newPassword } = await request.json().catch(() => ({}));
        if (!oldPassword || !newPassword) {
          return wrap(json({ error: "חסרים שדות" }, { status: 400 }));
        }
        if (newPassword.length < 6) {
          return wrap(json({ error: "הסיסמה החדשה קצרה מדי (מינימום 6)" }, { status: 400 }));
        }
        const authRaw = await env.KV.get("auth:doron");
        const auth = JSON.parse(authRaw);
        const oldHash = await sha256(oldPassword);
        if (oldHash !== auth.hash) {
          return wrap(json({ error: "הסיסמה הנוכחית שגויה" }, { status: 400 }));
        }
        auth.hash = await sha256(newPassword);
        await env.KV.put("auth:doron", JSON.stringify(auth));
        return wrap(json({ ok: true }));
      }

      // ——— Add video ———
      if (path === "/api/content/videos" && method === "POST") {
        const { courseId, video } = await request.json().catch(() => ({}));
        if (!courseId || !video || !video.title || !video.url) {
          return wrap(json({ error: "חסרים שדות חובה" }, { status: 400 }));
        }
        const raw = await env.KV.get("content:videos");
        const data = raw ? JSON.parse(raw) : {};
        if (!data[courseId]) data[courseId] = [];
        const entry = {
          id: video.id || "v_" + Date.now().toString(36),
          title: String(video.title).slice(0, 200),
          url: String(video.url).slice(0, 500),
          description: String(video.description || "").slice(0, 2000),
          addedAt: Date.now(),
        };
        data[courseId].unshift(entry);
        await env.KV.put("content:videos", JSON.stringify(data));
        return wrap(json({ ok: true, videos: data }));
      }

      // ——— Delete video ———
      const vidMatch = path.match(/^\/api\/content\/videos\/([^\/]+)\/([^\/]+)$/);
      if (vidMatch && method === "DELETE") {
        const [, courseId, videoId] = vidMatch;
        const raw = await env.KV.get("content:videos");
        const data = raw ? JSON.parse(raw) : {};
        if (data[courseId]) {
          data[courseId] = data[courseId].filter(v => v.id !== videoId);
        }
        await env.KV.put("content:videos", JSON.stringify(data));
        return wrap(json({ ok: true }));
      }

      // ——— Add article ———
      if (path === "/api/content/articles" && method === "POST") {
        const { article } = await request.json().catch(() => ({}));
        if (!article || !article.title || !article.content) {
          return wrap(json({ error: "חסרים שדות חובה" }, { status: 400 }));
        }
        const raw = await env.KV.get("content:articles");
        const list = raw ? JSON.parse(raw) : [];
        const entry = {
          id: article.id || "a_" + Date.now().toString(36),
          title: String(article.title).slice(0, 200),
          content: String(article.content).slice(0, 20000),
          category: article.category === "opinion" ? "opinion" : "foundation",
          date: Date.now(),
        };
        list.push(entry);
        await env.KV.put("content:articles", JSON.stringify(list));
        return wrap(json({ ok: true }));
      }

      // ——— Delete article ———
      const artMatch = path.match(/^\/api\/content\/articles\/([^\/]+)$/);
      if (artMatch && method === "DELETE") {
        const [, articleId] = artMatch;
        const raw = await env.KV.get("content:articles");
        const list = raw ? JSON.parse(raw) : [];
        const filtered = list.filter(a => a.id !== articleId);
        await env.KV.put("content:articles", JSON.stringify(filtered));
        return wrap(json({ ok: true }));
      }

      return wrap(json({ error: "Not found", path }, { status: 404 }));
    } catch (err) {
      console.error(err);
      return wrap(json({ error: err.message || "שגיאה פנימית" }, { status: 500 }));
    }
  },
};
