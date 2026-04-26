/* main.js — homepage logic */
(function(){
  let catalog = [];
  let articles = [];
  
  document.getElementById('year').textContent = new Date().getFullYear();
  
  // Show config banner if API_BASE is empty
  if (!window.API_BASE) {
    document.getElementById('configBanner').classList.add('show');
  }
  
  // Show "my dashboard" link if logged in as student
  if (Auth.studentToken) {
    const dl = document.getElementById('dashboardLink');
    const ll = document.getElementById('loginLink');
    if (dl) dl.style.display = '';
    if (ll) ll.style.display = 'none';
  }
  
  // Load catalog & articles
  loadCatalog();
  loadArticles();
  
  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({behavior:'smooth',block:'start'});
      }
    });
  });
  
  // Modal close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
  
  async function loadCatalog() {
    const grid = document.getElementById('catalogGrid');
    try {
      catalog = await API.catalog();
      if (!catalog.length) {
        grid.innerHTML = `
          <div class="empty-marketplace">
            <h3>קורסים בקרוב</h3>
            <p>אנחנו עובדים על תוכן מיוחד עבורך. שווה לחזור לבקר.</p>
          </div>`;
        return;
      }
      grid.innerHTML = catalog.map(c => courseCardHtml(c)).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-marketplace"><p style="color:var(--danger)">שגיאה בטעינת הקורסים: ${escapeHtml(err.message)}</p></div>`;
    }
  }
  
  function courseCardHtml(c) {
    const isFree = c.free || c.price === 0;
    const initial = (c.title || 'ק').charAt(0);
    const cover = c.coverImage 
      ? `<img src="${escapeHtml(c.coverImage)}" alt="${escapeHtml(c.title)}">`
      : `<div class="course-cover-icon">${escapeHtml(initial)}</div>`;
    const badge = isFree ? '<div class="course-badge free">חינם</div>' : (c.featured ? '<div class="course-badge">מומלץ</div>' : '');
    return `
      <div class="course-card" onclick="openCourse('${c.id}')">
        <div class="course-cover">${cover}${badge}</div>
        <div class="course-body">
          ${c.tag ? `<div class="course-tag">${escapeHtml(c.tag)}</div>` : ''}
          <h3>${escapeHtml(c.title)}</h3>
          <p class="desc">${escapeHtml(c.shortDescription || c.description || '')}</p>
          <div class="course-meta">
            ${c.duration ? `<div class="course-meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${escapeHtml(c.duration)}</div>` : ''}
            ${c.lessons ? `<div class="course-meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>${c.lessons} שיעורים</div>` : ''}
          </div>
          <div class="course-foot">
            <div class="course-price ${isFree?'free':''}">${formatPrice(c.price)}</div>
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openCourse('${c.id}')">פרטים נוספים</button>
          </div>
        </div>
      </div>`;
  }
  
  window.openCourse = function(id) {
    const c = catalog.find(x => x.id === id);
    if (!c) return;
    const isFree = c.free || c.price === 0;
    const initial = (c.title || 'ק').charAt(0);
    const cover = c.coverImage 
      ? `<img src="${escapeHtml(c.coverImage)}">`
      : `<div class="course-detail-cover-icon">${escapeHtml(initial)}</div>`;
    const features = c.features && c.features.length ? `
      <h4 style="font-size:18px;color:var(--navy);margin:18px 0 8px">מה תקבל בקורס</h4>
      <div class="course-features">
        ${c.features.map(f => `
          <div class="course-feature">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            ${escapeHtml(f)}
          </div>`).join('')}
      </div>` : '';
    
    document.getElementById('modalBox').className = 'modal wide';
    document.getElementById('modalBox').innerHTML = `
      <div class="modal-head">
        <h3>${escapeHtml(c.title)}</h3>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="course-detail-cover">${cover}</div>
        ${c.tag ? `<div class="course-tag">${escapeHtml(c.tag)}</div>` : ''}
        <p style="font-size:16px;line-height:1.7;color:var(--text-soft);margin-bottom:8px">${escapeHtml(c.description || c.shortDescription || '')}</p>
        ${features}
        <div class="course-detail-price">
          <div>
            <small style="color:var(--text-muted);font-size:13px">מחיר הקורס</small>
            <div class="price ${isFree?'free':''}">${formatPrice(c.price)}</div>
          </div>
          <button class="btn btn-primary" onclick="openCheckout('${c.id}')">
            ${isFree ? 'התחל ללמוד' : 'רכוש עכשיו'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        </div>
      </div>`;
    document.getElementById('modalBackdrop').classList.add('open');
  };
  
  window.openCheckout = function(courseId) {
    const c = catalog.find(x => x.id === courseId);
    if (!c) return;
    const isFree = c.free || c.price === 0;
    document.getElementById('modalBox').className = 'modal';
    document.getElementById('modalBox').innerHTML = `
      <div class="modal-head">
        <h3>${isFree ? 'התחלת לימוד' : 'השלמת רכישה'}</h3>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--cream);border-radius:10px;padding:14px 16px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:13px;color:var(--text-muted)">${isFree ? 'קורס חינם' : 'הקורס שלך'}</div>
            <strong style="color:var(--navy);font-size:16px">${escapeHtml(c.title)}</strong>
          </div>
          <div class="course-price ${isFree?'free':''}" style="font-size:22px">${formatPrice(c.price)}</div>
        </div>
        <div id="checkoutMsg"></div>
        <div class="field">
          <label>שם מלא</label>
          <input type="text" id="coFullName" placeholder="ישראל ישראלי">
        </div>
        <div class="field">
          <label>אימייל</label>
          <input type="email" id="coEmail" placeholder="your@email.com">
        </div>
        <div class="field">
          <label>טלפון <small style="color:var(--text-muted);font-weight:400">(אופציונלי)</small></label>
          <input type="tel" id="coPhone" placeholder="050-0000000">
        </div>
        <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
          ${isFree 
            ? 'נשלח לך מייל עם פרטי הגישה לאזור האישי.'
            : 'לאחר התשלום יישלח אליך מייל עם פרטי גישה לאזור האישי. ניתן לשלם בכרטיס אשראי באתר מאובטח של iCount.'
          }
        </p>
        <button class="btn btn-primary btn-block" id="coBtn" onclick="submitCheckout('${c.id}', ${isFree})">
          ${isFree ? 'התחל ללמוד' : 'המשך לתשלום'}
        </button>
      </div>`;
    document.getElementById('modalBackdrop').classList.add('open');
  };
  
  window.submitCheckout = async function(courseId, isFree) {
    const fullName = document.getElementById('coFullName').value.trim();
    const email = document.getElementById('coEmail').value.trim();
    const phone = document.getElementById('coPhone').value.trim();
    const msg = document.getElementById('checkoutMsg');
    const btn = document.getElementById('coBtn');
    msg.innerHTML = '';
    if (!fullName || fullName.length < 2) {
      msg.innerHTML = '<div class="form-error">אנא הזן שם מלא</div>';
      return;
    }
    if (!email || !/.+@.+\..+/.test(email)) {
      msg.innerHTML = '<div class="form-error">אנא הזן כתובת אימייל תקינה</div>';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> שולח...';
    try {
      const returnUrl = window.location.origin + '/?paid=' + encodeURIComponent(courseId);
      const data = await API.checkout({ courseId, fullName, email, phone, returnUrl });
      if (data.free) {
        msg.innerHTML = `
          <div class="form-success">
            <strong>✓ נרשמת בהצלחה!</strong><br>
            בדוק את האימייל שלך לקבלת פרטי הגישה.
          </div>`;
        setTimeout(() => { window.location = '/login.html'; }, 2500);
      } else if (data.payUrl) {
        msg.innerHTML = `<div class="form-info">מעבירים אותך לעמוד התשלום המאובטח...</div>`;
        setTimeout(() => { window.location = data.payUrl; }, 800);
      } else if (data.manual || data.ok) {
        // Manual flow — order saved, admin will contact the customer
        document.getElementById('modalBox').innerHTML = `
          <div class="modal-head">
            <h3>קיבלנו את הבקשה שלך! ✓</h3>
            <button class="modal-close" onclick="closeModal()">×</button>
          </div>
          <div class="modal-body" style="text-align:center;padding:30px 26px">
            <div style="width:80px;height:80px;border-radius:50%;background:rgba(76,157,95,.15);color:#2c6b3c;display:grid;place-items:center;margin:0 auto 20px">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 style="font-family:'Frank Ruhl Libre',serif;font-size:24px;color:var(--navy);margin-bottom:14px">תודה ${escapeHtml(fullName.split(' ')[0])}!</h3>
            <p style="font-size:16px;line-height:1.7;color:var(--text-soft);margin-bottom:20px">
              קיבלנו את הבקשה שלך לקורס<br>
              <strong style="color:var(--navy)">${escapeHtml(data.order ? data.order.courseTitle : '')}</strong>
            </p>
            <div style="background:var(--cream);border-radius:12px;padding:18px 22px;margin:20px 0;text-align:right">
              <p style="font-size:15px;line-height:1.7;color:var(--text-soft);margin:0">
                <strong>מה הלאה?</strong><br>
                נחזור אליך תוך מספר שעות עם לינק תשלום מאובטח. לאחר התשלום תקבל גישה מיידית לאזור האישי שלך.
              </p>
            </div>
            <p class="text-muted" style="font-size:13px">בדוק את תיבת הדואר שלך — נשלח לך גם אימייל אישור</p>
            <button class="btn btn-primary mt-16" onclick="closeModal()">סגור</button>
          </div>`;
      } else {
        msg.innerHTML = '<div class="form-error">משהו השתבש. אנא נסה שוב או צור קשר.</div>';
        btn.disabled = false;
        btn.innerHTML = 'המשך לתשלום';
      }
    } catch (err) {
      msg.innerHTML = `<div class="form-error">${escapeHtml(err.message || 'שגיאה')}</div>`;
      btn.disabled = false;
      btn.innerHTML = isFree ? 'התחל ללמוד' : 'המשך לתשלום';
    }
  };
  
  window.closeModal = function() {
    document.getElementById('modalBackdrop').classList.remove('open');
  };
  
  async function loadArticles() {
    try {
      articles = await API.articles();
      window.renderArticles();
    } catch {}
  }
  
  window.renderArticles = function() {
    const grid = document.getElementById('articlesGrid');
    const q = (document.getElementById('articleSearch').value || '').toLowerCase().trim();
    let list = [...articles].sort((a, b) => (b.date || 0) - (a.date || 0));
    if (q) list = list.filter(a => (a.title + ' ' + (a.content || '')).toLowerCase().includes(q));
    if (!list.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="ico">✦</div>
          <h4 style="color:var(--navy);font-family:'Frank Ruhl Libre',serif;font-size:20px;margin-bottom:6px">${q ? 'לא נמצאו תוצאות' : 'מאמרים בקרוב'}</h4>
          <p>${q ? 'נסה חיפוש אחר.' : 'תוכן חדש בדרך.'}</p>
        </div>`;
      return;
    }
    grid.innerHTML = list.map(a => {
      const date = new Date(a.date).toLocaleDateString('he-IL', {day:'numeric',month:'short',year:'numeric'});
      const tag = a.category === 'opinion' ? 'דעה' : 'יסוד';
      const tagClass = a.category === 'opinion' ? 'opinion' : '';
      const preview = (a.content || '').slice(0, 220);
      return `
        <article class="article-card" onclick="openArticle('${a.id}')">
          <div class="article-meta">
            <span class="article-tag ${tagClass}">${tag}</span>
            <span class="article-date">${date}</span>
          </div>
          <h4>${escapeHtml(a.title)}</h4>
          <p>${escapeHtml(preview)}${(a.content||'').length > 220 ? '...' : ''}</p>
        </article>`;
    }).join('');
  };
  
  window.openArticle = function(id) {
    const a = articles.find(x => x.id === id);
    if (!a) return;
    const date = new Date(a.date).toLocaleDateString('he-IL', {day:'numeric',month:'long',year:'numeric'});
    const tag = a.category === 'opinion' ? 'טור דעה' : 'מאמר יסוד';
    const tagClass = a.category === 'opinion' ? 'opinion' : '';
    document.getElementById('modalBox').className = 'modal full';
    document.getElementById('modalBox').innerHTML = `
      <div class="modal-head">
        <div style="flex:1">
          <div class="article-meta" style="margin-bottom:10px"><span class="article-tag ${tagClass}">${tag}</span><span class="article-date">${date}</span></div>
          <h3 style="font-size:28px">${escapeHtml(a.title)}</h3>
        </div>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">
        <div style="font-size:16.5px;line-height:1.85;color:var(--text-soft);white-space:pre-wrap">${escapeHtml(a.content)}</div>
      </div>`;
    document.getElementById('modalBackdrop').classList.add('open');
  };
})();
