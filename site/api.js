/* API client — used by all pages */
(function() {
  const API_BASE = window.API_BASE || "";
  const ADMIN_TOKEN_KEY = "doron:admin-token";
  const STUDENT_TOKEN_KEY = "doron:student-token";

  const Auth = {
    get adminToken() { try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; } },
    get studentToken() { try { return localStorage.getItem(STUDENT_TOKEN_KEY); } catch { return null; } },
    setAdminToken(t) { try { t ? localStorage.setItem(ADMIN_TOKEN_KEY, t) : localStorage.removeItem(ADMIN_TOKEN_KEY); } catch {} },
    setStudentToken(t) { try { t ? localStorage.setItem(STUDENT_TOKEN_KEY, t) : localStorage.removeItem(STUDENT_TOKEN_KEY); } catch {} },
    get bestToken() { return this.adminToken || this.studentToken; },
  };

  async function req(path, options = {}, useToken = "auto") {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    let tok = null;
    if (useToken === "admin") tok = Auth.adminToken;
    else if (useToken === "student") tok = Auth.studentToken;
    else tok = Auth.bestToken;
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const res = await fetch(API_BASE + path, { ...options, headers });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data.error || ('שגיאה (' + res.status + ')'));
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  window.Auth = Auth;
  window.API = {
    // Public
    health: () => req('/api/health'),
    catalog: () => req('/api/catalog'),
    courseDetail: (id) => req('/api/catalog/' + encodeURIComponent(id)),
    articles: () => req('/api/content/articles'),
    videos: (courseId) => req('/api/content/videos/' + encodeURIComponent(courseId)),
    checkout: (data) => req('/api/checkout', { method: 'POST', body: JSON.stringify(data) }),
    checkOrder: (orderId) => req('/api/checkout/check?o=' + encodeURIComponent(orderId)),

    // Auth
    adminLogin: (user, password) => req('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ user, password }) }),
    studentLogin: (email, password) => req('/api/auth/student-login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => req('/api/auth/logout', { method: 'POST' }).catch(() => {}),

    // Student
    me: () => req('/api/me'),
    changeMyPassword: (oldPassword, newPassword) => req('/api/me/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),
    setProgress: (courseId, videoId, completed) => req('/api/me/progress', { method: 'POST', body: JSON.stringify({ courseId, videoId, completed }) }),
    myMaterials: (courseId) => req('/api/me/materials/' + encodeURIComponent(courseId)),
    myCertificate: (courseId) => req('/api/me/certificate/' + encodeURIComponent(courseId)),
    myChat: () => req('/api/me/chat'),
    sendMessage: (message) => req('/api/me/chat', { method: 'POST', body: JSON.stringify({ message }) }),

    // Admin
    adminCatalog: () => req('/api/admin/catalog', {}, 'admin'),
    saveCourse: (course) => req('/api/admin/catalog', { method: 'POST', body: JSON.stringify({ course }) }, 'admin'),
    deleteCourse: (id) => req('/api/admin/catalog/' + encodeURIComponent(id), { method: 'DELETE' }, 'admin'),

    adminVideos: (courseId) => req('/api/admin/videos/' + encodeURIComponent(courseId), {}, 'admin'),
    addVideo: (courseId, video) => req('/api/admin/videos/' + encodeURIComponent(courseId), { method: 'POST', body: JSON.stringify({ video }) }, 'admin'),
    deleteVideo: (courseId, videoId) => req('/api/admin/videos/' + encodeURIComponent(courseId) + '/' + encodeURIComponent(videoId), { method: 'DELETE' }, 'admin'),

    adminMaterials: (courseId) => req('/api/admin/materials/' + encodeURIComponent(courseId), {}, 'admin'),
    addMaterial: (courseId, material) => req('/api/admin/materials/' + encodeURIComponent(courseId), { method: 'POST', body: JSON.stringify({ material }) }, 'admin'),
    deleteMaterial: (courseId, matId) => req('/api/admin/materials/' + encodeURIComponent(courseId) + '/' + encodeURIComponent(matId), { method: 'DELETE' }, 'admin'),

    addArticle: (article) => req('/api/admin/articles', { method: 'POST', body: JSON.stringify({ article }) }, 'admin'),
    deleteArticle: (id) => req('/api/admin/articles/' + encodeURIComponent(id), { method: 'DELETE' }, 'admin'),

    adminUsers: () => req('/api/admin/users', {}, 'admin'),
    addUser: (data) => req('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }, 'admin'),
    updateUser: (id, data) => req('/api/admin/users/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
    deleteUser: (id) => req('/api/admin/users/' + encodeURIComponent(id), { method: 'DELETE' }, 'admin'),

    adminOrders: () => req('/api/admin/orders', {}, 'admin'),
    activateOrder: (id, loginUrl) => req('/api/admin/orders/' + encodeURIComponent(id) + '/activate', { method: 'POST', body: JSON.stringify({ loginUrl }) }, 'admin'),

    adminChats: () => req('/api/admin/chats', {}, 'admin'),
    adminChat: (userId) => req('/api/admin/chats/' + encodeURIComponent(userId), {}, 'admin'),
    replyChat: (userId, message) => req('/api/admin/chats/' + encodeURIComponent(userId), { method: 'POST', body: JSON.stringify({ message }) }, 'admin'),

    adminConfig: () => req('/api/admin/config', {}, 'admin'),
    saveConfig: (data) => req('/api/admin/config', { method: 'POST', body: JSON.stringify(data) }, 'admin'),
    testEmail: (to) => req('/api/admin/test-email', { method: 'POST', body: JSON.stringify({ to }) }, 'admin'),
    changeAdminPassword: (oldPassword, newPassword) => req('/api/admin/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }, 'admin'),
    adminStats: () => req('/api/admin/stats', {}, 'admin'),
  };

  // Helpers
  window.escapeHtml = function(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  };
  window.parseVideoUrl = function(url) {
    if (!url) return null;
    url = url.trim();
    let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/);
    if (m) return { type:'youtube', id:m[1], embed:'https://www.youtube.com/embed/'+m[1], thumb:'https://img.youtube.com/vi/'+m[1]+'/hqdefault.jpg' };
    m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return { type:'vimeo', id:m[1], embed:'https://player.vimeo.com/video/'+m[1], thumb:null };
    if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) return { type:'direct', embed:url, thumb:null };
    return null;
  };
  window.formatPrice = function(amount, currency = '₪') {
    if (!amount || amount <= 0) return 'חינם';
    return currency + Number(amount).toLocaleString('he-IL');
  };
})();
