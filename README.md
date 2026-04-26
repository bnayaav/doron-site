# 🌿 אתר דורון — אימון חיים באמונה

אתר מלא עם פאנל ניהול לדורון, בנוי לפריסה אוטומטית מהטלפון על Cloudflare Pages + Workers + KV.

## 🏗 ארכיטקטורה

```
doron-site/
├── site/                           ← Frontend (Cloudflare Pages)
│   └── index.html                  — עמוד יחיד HTML/CSS/JS
├── worker/                         ← Backend API (Cloudflare Worker)
│   ├── src/index.js                — קוד ה-Worker
│   ├── wrangler.toml               — קונפיגורציה
│   └── package.json
└── .github/workflows/
    ├── deploy-worker.yml           — פריסת Worker בכל push
    └── deploy-pages.yml            — פריסת Pages בכל push
```

## 📱 התקנה מהטלפון (שלב-אחר-שלב)

### 1. יצירת Repo ב-GitHub
- פתח את אפליקציית GitHub בטלפון → **New repository** → שם: `doron-site`
- העלה את כל הקבצים של הפרויקט (כולל התיקיות `.github`, `site`, `worker`)

### 2. יצירת KV namespace ב-Cloudflare
- היכנס ל-**dash.cloudflare.com** (מהדפדפן בטלפון)
- **Workers & Pages** → **KV** → **Create a namespace**
- שם: `doron-kv` → Create
- העתק את ה-**Namespace ID** שמופיע ברשימה

### 3. עדכון `worker/wrangler.toml`
ערוך את הקובץ (דרך GitHub בדפדפן) והחלף את `REPLACE_WITH_YOUR_KV_ID` ב-ID שהעתקת:

```toml
[[kv_namespaces]]
binding = "KV"
id = "abc123def456..."   ← ה-ID שלך כאן
```

### 4. יצירת API Token ל-Cloudflare
- בדשבורד: **My Profile** (פינה ימנית עליונה) → **API Tokens** → **Create Token**
- בחר בתבנית **"Edit Cloudflare Workers"**
- Continue → Continue → Create Token
- העתק את הטוקן (מוצג פעם אחת בלבד!)
- העתק גם את ה-**Account ID** (זמין בדף הראשי של Workers & Pages)

### 5. הוספת Secrets ל-GitHub
ב-GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | הטוקן שיצרת בשלב 4 |
| `CLOUDFLARE_ACCOUNT_ID` | ה-Account ID מהדשבורד |

### 6. הפעלת Workflows
ב-GitHub → **Actions** → אם מופיעה הודעה, לחץ **"I understand my workflows, enable them"**.

### 7. פריסת ה-Worker
- **Actions** → **Deploy Worker** → **Run workflow** → **Run workflow** (כפתור ירוק)
- המתן ~30 שניות לסיום
- הכתובת תהיה: `https://doron-api.<subdomain>.workers.dev`
- ודא שזה עובד: פתח `<url>/api/health` בדפדפן — צריך לראות `{"ok":true,...}`

### 8. עדכון כתובת ה-API בפרונטאנד
ערוך את `site/index.html`, מצא את השורה:
```js
const API_BASE = "REPLACE_WITH_YOUR_WORKER_URL";
```
והחלף ב-URL שקיבלת, למשל:
```js
const API_BASE = "https://doron-api.bnaya-av.workers.dev";
```

### 9. פריסת Pages (בחר דרך אחת)

**אופציה א': ידנית דרך GitHub Actions (מומלץ — הכל מהטלפון)**
- **Actions** → **Deploy Pages** → **Run workflow**
- Cloudflare יצר פרויקט בשם `doron-site` באופן אוטומטי
- הכתובת: `https://doron-site.pages.dev`

**אופציה ב': חיבור ישיר ב-Cloudflare dashboard (חד-פעמי, אוטומטי לנצח)**
- Cloudflare → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
- בחר את ה-repo `doron-site`
- Build output directory: `site`
- Deploy → כל push ייצר deploy אוטומטי

### 10. הגבלת CORS (אופציונלי לאחר פריסה)
לאחר שהאתר חי, ערוך את `worker/wrangler.toml`:
```toml
[vars]
ALLOWED_ORIGINS = "https://doron-site.pages.dev"
```
Push → ה-Worker יתעדכן אוטומטית.

---

## 🔐 כניסה ראשונה

- האתר: `https://doron-site.pages.dev`
- לחץ על סמל המנעול בפינה העליונה
- שם משתמש: `doron`
- סיסמה: `12345678`
- **שנה מיד את הסיסמה** בכרטיסיית "הגדרות" בפאנל

---

## 🎥 העלאת סרטונים

בפאנל הניהול → **סרטונים**:
1. בחר מסגרת (אימון אישי / זוגי / קבוצתי / קורס משפיעים / סדנאות / הרצאות / שיעורים / מסע למידה)
2. הדבק כתובת של:
   - **YouTube** — כל פורמט (`youtu.be/...`, `youtube.com/watch?v=...`, shorts, embed)
   - **Vimeo** — `vimeo.com/123456`
   - **קובץ וידאו ישיר** — `https://.../video.mp4`
3. כותרת + תיאור → הוסף
4. הסרטון מופיע מיד בעמוד הציבורי

---

## 📝 ניהול מאמרים

בפאנל → **מאמרים** → הוסף מאמר:
- **יסוד באמונה** (מאמרים יומיים)
- **טור דעה על המצב**

כל המאמרים מופיעים בעמוד הציבורי עם חיפוש לפי תוכן.

---

## 🔧 פיתוח מקומי (למי שיש מחשב)

```bash
# Worker
cd worker
npm install
npx wrangler kv namespace create doron-kv   # פעם אחת בלבד
# עדכן את ה-ID ב-wrangler.toml
npx wrangler dev

# Frontend
cd site
npx serve .
```

---

## 💡 טיפים

- **סקלבליות:** Worker חינמי מכסה 100,000 בקשות/יום
- **KV:** חינמי עד 1,000 כתיבות/יום — יותר מדי לאתר תוכן
- **גיבוי:** `wrangler kv key list --binding=KV` להצגת כל המפתחות
- **לוגים:** Dashboard → Workers → doron-api → Logs

---

## 🆘 בעיות נפוצות

| שגיאה | פתרון |
|-------|-------|
| `API_BASE` אדום למעלה | לא עדכנת את הכתובת ב-`site/index.html` |
| "לא מחובר" אחרי login | CORS חסום — בדוק שה-Origin מותר ב-wrangler.toml |
| Worker deploy נכשל | Secrets של GitHub לא הוגדרו נכון |
| 404 על API | שכחת לפרוס את ה-Worker אחרי השינוי |

בהצלחה 🌿
