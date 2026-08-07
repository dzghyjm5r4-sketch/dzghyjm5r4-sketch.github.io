/* ===== Doreen's Personal OS — app.js ===== */

/* ===== Domain Config ===== */
const DOMAINS = {
  schedule: { name: '日程', color: '#E8A598', bg: '#FBF0ED', soft: '#F5DAD3', icon: '📅' },
  reading:  { name: '阅读', color: '#8BA5B8', bg: '#EDF1F5', soft: '#D4DFE8', icon: '📚' },
  learning: { name: '学习', color: '#D4B896', bg: '#F7F2E9', soft: '#EDE0CC', icon: '✏️' },
  personal: { name: '个人生活', color: '#A3B5A0', bg: '#EFF3EE', soft: '#D5DED3', icon: '🌿' },
  period:   { name: '生理期', color: '#C4A0A8', bg: '#F5EFF1', soft: '#E0D0D5', icon: '🌙' },
  exercise: { name: '运动', color: '#A8A09A', bg: '#F5F3F1', soft: '#E5E0DC', icon: '🏃' },
};

/* ===== Empty Data Template (user starts fresh) ===== */
const EMPTY_DATA = {
  profile: {
    name: 'Doreen',
    avatar: null,
    status: '把散落的生活，收进今天。',
    streak: 0,
    lastActiveDate: null,
  },
  tasks: [],
  books: [],
  learningTopics: [],
  exercises: [],
  schedules: [],
  inspirations: [],
  reminders: [],
  period: {
    lastStart: null,
    cycleLength: 28,
    periodLength: 5,
    currentDay: 0,
    nextPredict: null,
  },
  stats: {
    weeklyCompleted: 0,
    top3Rate: 0,
    weeklyFocus: 0,
    readingMinutes: 0,
    learningMinutes: 0,
    exerciseMinutes: 0,
    exerciseCount: 0,
    inboxClearCount: 0,
  },
  heatmap: new Array(28).fill(0),
};

/* ===== Robust Storage Layer =====
 * iOS 上以「添加到主屏幕」运行的独立 PWA，localStorage 比普通 Safari 更脆弱
 * （配额更激进、易被系统清理/隔离）。这里用 localStorage 同步读写做主路径，
 * 同时把数据异步镜像到 IndexedDB 作为更耐久的兜底；启动时探测可用性，
 * 若两者都不可用则标记 Storage.available=false 并提示用户。
 */
const Storage = {
  KEY: 'doreenPersonalOS_v1',
  IDB_KEY: 'doreenPersonalOS_data',
  DB_NAME: 'doreenOS',
  STORE: 'kv',
  available: true,
  localOk: true,
  idbAvailable: false,

  localGet() {
    try { return localStorage.getItem(this.KEY); }
    catch (e) { this.localOk = false; return null; }
  },
  localSet(str) {
    try { localStorage.setItem(this.KEY, str); this.localOk = true; return true; }
    catch (e) { this.localOk = false; return false; }
  },

  _openIDB() {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) { this.idbAvailable = false; resolve(null); return; }
      try {
        const req = indexedDB.open(this.DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE);
        };
        req.onsuccess = () => { this.idbAvailable = true; resolve(req.result); };
        req.onerror = () => { this.idbAvailable = false; resolve(null); };
      } catch (e) { this.idbAvailable = false; resolve(null); }
    });
  },
  idbGet() {
    return this._openIDB().then((db) => {
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.STORE, 'readonly');
          const req = tx.objectStore(this.STORE).get(this.IDB_KEY);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    });
  },
  idbSet(str) {
    return this._openIDB().then((db) => {
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.STORE, 'readwrite');
          tx.objectStore(this.STORE).put(str, this.IDB_KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      });
    });
  },

  // 启动探测：localStorage 是否可写 + IndexedDB 是否可用
  probe() {
    const testKey = '__doreen_probe__';
    try {
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      this.localOk = true;
    } catch (e) { this.localOk = false; }
    return this._openIDB().then(() => {
      this.available = this.localOk || this.idbAvailable;
      return this.available;
    });
  },

  // 双写：localStorage（同步主路径）+ IndexedDB（异步耐久兜底）
  save(str) {
    let ok = false;
    if (this.localOk) ok = this.localSet(str);
    if (this.idbAvailable) {
      this.idbSet(str); // best-effort，不阻塞
      ok = true;
    }
    if (!ok) this.available = false;
    return ok;
  },

  // localStorage 缺失时，尝试从 IndexedDB 恢复（应对被系统清理的场景）
  restoreFromIDB(db) {
    if (!this.idbAvailable) return Promise.resolve();
    return this.idbGet().then((raw) => {
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        const cur = db.data || {};
        const isEmpty = (!cur.tasks || cur.tasks.length === 0)
          && (!cur.schedules || cur.schedules.length === 0)
          && (!cur.inspirations || cur.inspirations.length === 0)
          && (!cur.books || cur.books.length === 0)
          && (!cur.learningTopics || cur.learningTopics.length === 0)
          && (!cur.exercises || cur.exercises.length === 0);
        if (isEmpty) {
          db.data = data;
          db.save();
          if (typeof UI !== 'undefined' && UI.renderAll) UI.renderAll();
          if (typeof UI !== 'undefined' && UI.renderTab) UI.renderTab(UI.currentTab);
        }
      } catch (e) { /* ignore */ }
    });
  }
};

/* ===== DB Module ===== */
const DB = {
  KEY: 'doreenPersonalOS_v1',
  data: null,

  init() {
    const saved = Storage.localGet();
    let hadLocal = saved !== null;
    if (saved) {
      try { this.data = JSON.parse(saved); }
      catch(e) { this.data = JSON.parse(JSON.stringify(EMPTY_DATA)); hadLocal = false; }
    } else {
      this.data = JSON.parse(JSON.stringify(EMPTY_DATA));
    }
    this.save();
    // localStorage 缺失（被系统清理）时，尝试从 IndexedDB 恢复
    if (!hadLocal) Storage.restoreFromIDB(this);
  },

  save() {
    const str = JSON.stringify(this.data);
    const ok = Storage.save(str);
    if (!ok && typeof UI !== 'undefined') {
      UI.flagStorageProblem();
      UI.toast('⚠️ 保存失败：当前环境不支持本地存储');
    }
    return ok;
  },

  resetDemo() {
    this.data = JSON.parse(JSON.stringify(EMPTY_DATA));
    this.save();
  },

  export() {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personal-os-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  import(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      this.data = data;
      this.save();
      return true;
    } catch(e) { return false; }
  },

  getTasks(domain) {
    if (!domain) return this.data.tasks;
    return this.data.tasks.filter(t => t.domain === domain);
  },

  getTodayTasks() { return this.data.tasks.filter(t => t.inToday && t.status !== 'completed' && t.status !== 'cancelled'); },
  getTop3() { return this.data.tasks.filter(t => t.inTop3).sort((a,b) => a.top3Order - b.top3Order); },
  getTodayTop3() {
    const today = new Date().toISOString().slice(0, 10);
    return this.data.tasks
      .filter(t => t.inTop3 && (t.inToday || (t.dueDate && t.dueDate === today)) && t.status !== 'completed' && t.status !== 'cancelled')
      .sort((a,b) => (a.top3Order||0) - (b.top3Order||0));
  },
  getInbox() { return this.data.inspirations.filter(i => !i.processed); },
  getReminders() { return this.data.reminders; },
  getTodaySchedules() {
    const today = new Date().toISOString().slice(0, 10);
    return this.data.schedules.filter(s => s.date === today).sort((a,b) => a.start.localeCompare(b.start));
  },

  getDomainProgress(domain) {
    const tasks = this.getTasks(domain);
    if (!tasks.length) return 0;
    const done = tasks.filter(t => t.status === 'completed').length;
    return Math.round((done / tasks.length) * 100);
  },

  getDomainPending(domain) {
    return this.getTasks(domain).filter(t => t.status !== 'completed' && t.status !== 'cancelled').length;
  },
};

/* ===== UI Module ===== */
const UI = {
  currentTab: 'today',
  currentProject: null,
  formState: { type: null, data: null, onSave: null },
  quickAddType: 'task',
  pendingAvatar: null,

  init() {
    DB.init();
    this.updateStreak();
    Storage.probe().then((ok) => { if (!ok) this.flagStorageProblem(); });
    this.bindEvents();
    this.renderAll();
    this.startClock();
    if (location.hash && ['today','projects','schedule','inbox','profile'].includes(location.hash.slice(1))) {
      this.switchTab(location.hash.slice(1));
    }
  },

  updateStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const p = DB.data.profile;
    if (p.lastActiveDate === today) {
      // 今天已记录过，无需重复累加
    } else if (!p.lastActiveDate) {
      p.streak = 1;
    } else {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (p.lastActiveDate === yesterday) p.streak = (p.streak || 0) + 1;
      else p.streak = 1;
    }
    p.lastActiveDate = today;
    DB.save();
  },

  bindEvents() {
    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    document.getElementById('fab').addEventListener('click', () => this.showQuickAdd());
    document.getElementById('quickAddClose').addEventListener('click', () => this.hideQuickAdd());
    document.getElementById('quickAddSubmit').addEventListener('click', () => this.handleQuickAdd());
    document.getElementById('quickAddText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleQuickAdd();
    });

    document.querySelectorAll('.qa-option').forEach(btn => {
      btn.addEventListener('click', () => {
        this.quickAddType = btn.dataset.type;
        document.querySelectorAll('.qa-option').forEach(b => b.style.opacity = '0.5');
        btn.style.opacity = '1';
        document.getElementById('quickAddText').focus();
      });
    });

    document.getElementById('quickAddModal').addEventListener('click', (e) => {
      if (e.target.id === 'quickAddModal') this.hideQuickAdd();
    });

    document.getElementById('formModalSave').addEventListener('click', () => this.handleFormSave());
    document.getElementById('formModalCancel').addEventListener('click', () => this.closeFormModal());
    document.getElementById('formModal').addEventListener('click', (e) => {
      if (e.target.id === 'formModal') this.closeFormModal();
    });

    // Avatar upload
    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput) avatarInput.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      this.handleAvatarFile(f);
    });
    document.getElementById('avatarSaveBtn').addEventListener('click', () => this.saveAvatar());
    document.getElementById('avatarCancelBtn').addEventListener('click', () => this.closeAvatarModal());
    document.getElementById('avatarRemoveBtn').addEventListener('click', () => this.removeAvatar());
    document.getElementById('avatarModal').addEventListener('click', (e) => {
      if (e.target.id === 'avatarModal') this.closeAvatarModal();
    });

    // AI Deep Analysis
    const analysisCloseBtn = document.getElementById('analysisCloseBtn');
    if (analysisCloseBtn) analysisCloseBtn.addEventListener('click', () => this.closeAIAnalysis());
    const analysisReBtn = document.getElementById('analysisReBtn');
    if (analysisReBtn) analysisReBtn.addEventListener('click', () => this.openAIAnalysis());
    document.getElementById('analysisModal').addEventListener('click', (e) => {
      if (e.target.id === 'analysisModal') this.closeAIAnalysis();
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    this.currentProject = null;
    document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${tab}`).classList.add('active');
    this.renderTab(tab);
    window.scrollTo(0, 0);
  },

  renderTab(tab) {
    switch(tab) {
      case 'today': this.renderToday(); break;
      case 'projects': this.renderProjects(); break;
      case 'schedule': this.renderSchedule(); break;
      case 'inbox': this.renderInbox(); break;
      case 'profile': this.renderProfile(); break;
    }
  },

  renderAll() {
    this.renderToday();
    this.updateInboxBadge();
  },

  startClock() {
    setInterval(() => {
      if (this.currentTab === 'today') {
        const now = new Date();
        const el = document.getElementById('timelineNow');
        if (el) {
          const minutes = now.getHours() * 60 + now.getMinutes();
          const top = Math.max(0, (minutes - 360) / (1380 - 360) * 100);
          el.style.top = top + '%';
        }
      }
    }, 60000);
  },

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  },

  flagStorageProblem() {
    const el = document.getElementById('storageWarning');
    if (el) el.style.display = 'block';
  },

  renderEmptyState(iconEmoji, title, desc, note) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">
          <img src="icons/doreen-empty.svg" alt="empty" style="width:80px;height:80px;opacity:0.75">
        </div>
        <div class="empty-state-title">${title}</div>
        <div class="empty-state-desc">${desc}</div>
        ${note ? `<div class="empty-state-note handwriting">${note}</div>` : ''}
      </div>
    `;
  },

  updateInboxBadge() {
    const count = DB.getInbox().length;
    const badge = document.getElementById('inboxBadge');
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  },

  /* ===== Generic Form Modal ===== */
  entityNames: { task:'任务', schedule:'日程', book:'书籍', topic:'学习主题', exercise:'运动记录', inspiration:'灵感', period:'周期' },

  openFormModal(type, data, onSave) {
    this.formState = { type, data: data || {}, onSave };
    const title = (data && data.id ? '编辑' : '新建') + (this.entityNames[type] || '项目');
    document.getElementById('formModalTitle').textContent = title;
    document.getElementById('formModalBody').innerHTML = this.buildFormFields(type, data);
    document.getElementById('formModal').classList.add('show');
  },

  closeFormModal() {
    document.getElementById('formModal').classList.remove('show');
    this.formState = { type: null, data: null, onSave: null };
  },

  /* ===== Avatar Upload ===== */
  openAvatarPicker() {
    const input = document.getElementById('avatarInput');
    if (input) input.click();
  },

  handleAvatarFile(file) {
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) {
      this.toast('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const size = 320;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        let dataUrl;
        try { dataUrl = canvas.toDataURL('image/jpeg', 0.85); }
        catch (err) { dataUrl = e.target.result; }
        this.pendingAvatar = dataUrl;
        const preview = document.getElementById('avatarPreview');
        preview.src = dataUrl;
        preview.style.display = 'block';
        document.getElementById('avatarModal').classList.add('show');
      };
      img.onerror = () => this.toast('图片读取失败');
      img.src = e.target.result;
    };
    reader.onerror = () => this.toast('文件读取失败');
    reader.readAsDataURL(file);
  },

  saveAvatar() {
    if (!this.pendingAvatar) { this.closeAvatarModal(); return; }
    DB.data.profile.avatar = this.pendingAvatar;
    const ok = DB.save();
    this.closeAvatarModal();
    if (ok) {
      this.renderTab(this.currentTab);
      this.toast('头像已更新 ✨');
    } else {
      this.toast('⚠️ 保存失败：当前环境不支持本地存储');
    }
  },

  removeAvatar() {
    DB.data.profile.avatar = null;
    const ok = DB.save();
    this.closeAvatarModal();
    if (ok) {
      this.renderTab(this.currentTab);
      this.toast('已恢复默认头像');
    } else {
      this.toast('⚠️ 保存失败：当前环境不支持本地存储');
    }
  },

  closeAvatarModal() {
    const m = document.getElementById('avatarModal');
    if (m) m.classList.remove('show');
    this.pendingAvatar = null;
    const preview = document.getElementById('avatarPreview');
    if (preview) preview.style.display = 'none';
    const input = document.getElementById('avatarInput');
    if (input) input.value = '';
  },

  handleFormSave() {
    const { type, data, onSave } = this.formState;
    if (!type) return;
    const result = this.collectFormData(type, data);
    if (onSave) onSave.call(this, result);
    this.closeFormModal();
  },

  buildFormFields(type, data) {
    data = data || {};
    const domainOptions = Object.keys(DOMAINS).map(k => `<option value="${k}" ${data.domain===k?'selected':''}>${DOMAINS[k].name}</option>`).join('');
    const priorityOptions = [['high','高'], ['medium','中'], ['low','低']].map(([v,l]) => `<option value="${v}" ${data.priority===v?'selected':''}>${l}</option>`).join('');
    const statusOptions = [['pending','待办'], ['inProgress','进行中'], ['completed','已完成'], ['cancelled','已取消']].map(([v,l]) => `<option value="${v}" ${data.status===v?'selected':''}>${l}</option>`).join('');
    const repeatOptions = [['none','不重复'], ['daily','每天'], ['weekly','每周'], ['workday','工作日']].map(([v,l]) => `<option value="${v}" ${data.repeat===v?'selected':''}>${l}</option>`).join('');
    const bookStatusOptions = [['pending','待读'], ['reading','在读'], ['completed','已读完']].map(([v,l]) => `<option value="${v}" ${data.status===v?'selected':''}>${l}</option>`).join('');
    const topicStatusOptions = [['pending','待学习'], ['inProgress','进行中'], ['completed','已完成']].map(([v,l]) => `<option value="${v}" ${data.status===v?'selected':''}>${l}</option>`).join('');
    const sourceOptions = [['manual','手动'], ['voice','语音'], ['web','网页'], ['image','图片']].map(([v,l]) => `<option value="${v}" ${data.source===v?'selected':''}>${l}</option>`).join('');

    switch(type) {
      case 'task':
        return `
          <div class="form-field"><label>标题</label><input type="text" id="fm-title" value="${this.escape(data.title||'')}" placeholder="任务标题"></div>
          <div class="form-row">
            <div class="form-field"><label>领域</label><select id="fm-domain">${domainOptions}</select></div>
            <div class="form-field"><label>优先级</label><select id="fm-priority">${priorityOptions}</select></div>
          </div>
          <div class="form-row">
            <div class="form-field"><label>截止日期</label><input type="date" id="fm-dueDate" value="${data.dueDate && data.dueDate !== 'today' ? data.dueDate : ''}"></div>
            <div class="form-field"><label>截止时间</label><input type="time" id="fm-dueTime" value="${data.dueTime||''}"></div>
          </div>
          <div class="form-row">
            <div class="form-field"><label>预计时长（分钟）</label><input type="number" id="fm-estimated" value="${data.estimated||30}"></div>
            <div class="form-field"><label>进度（%）</label><input type="number" id="fm-progress" min="0" max="100" value="${data.progress||0}"></div>
          </div>
          <div class="form-field"><label>下一步行动</label><input type="text" id="fm-nextAction" value="${this.escape(data.nextAction||'')}" placeholder="下一步具体做什么"></div>
          <div class="form-field"><label>状态</label><select id="fm-status">${statusOptions}</select></div>
          <div class="form-field"><label><input type="checkbox" id="fm-inTop3" ${data.inTop3?'checked':''}> 加入今日 Top 3</label></div>
          <div class="form-field"><label><input type="checkbox" id="fm-inToday" ${data.inToday!==false?'checked':''}> 放入今日</label></div>
        `;
      case 'schedule':
        return `
          <div class="form-field"><label>标题</label><input type="text" id="fm-title" value="${this.escape(data.title||'')}" placeholder="日程安排"></div>
          <div class="form-row">
            <div class="form-field"><label>领域</label><select id="fm-domain">${domainOptions}</select></div>
            <div class="form-field"><label>重复</label><select id="fm-repeat">${repeatOptions}</select></div>
          </div>
          <div class="form-field"><label>日期</label><input type="date" id="fm-date" value="${data.date && data.date !== 'today' ? data.date : new Date().toISOString().slice(0,10)}"></div>
          <div class="form-row">
            <div class="form-field"><label>开始时间</label><input type="time" id="fm-start" value="${data.start||'09:00'}"></div>
            <div class="form-field"><label>结束时间</label><input type="time" id="fm-end" value="${data.end||'10:00'}"></div>
          </div>
          <div class="form-field"><label>地点</label><input type="text" id="fm-location" value="${this.escape(data.location||'')}" placeholder="地点（可选）"></div>
        `;
      case 'book':
        return `
          <div class="form-field"><label>书名</label><input type="text" id="fm-title" value="${this.escape(data.title||'')}" placeholder="书名"></div>
          <div class="form-field"><label>作者</label><input type="text" id="fm-author" value="${this.escape(data.author||'')}" placeholder="作者"></div>
          <div class="form-row">
            <div class="form-field"><label>进度（%）</label><input type="number" id="fm-progress" min="0" max="100" value="${data.progress||0}"></div>
            <div class="form-field"><label>状态</label><select id="fm-status">${bookStatusOptions}</select></div>
          </div>
          <div class="form-field"><label>封面色</label><input type="color" id="fm-coverColor" value="${data.coverColor||'#8BA5B8'}"></div>
        `;
      case 'topic':
        return `
          <div class="form-field"><label>主题名称</label><input type="text" id="fm-title" value="${this.escape(data.title||'')}" placeholder="学习主题"></div>
          <div class="form-field"><label>来源</label><input type="text" id="fm-source" value="${this.escape(data.source||'')}" placeholder="课程 / 视频 / 文档"></div>
          <div class="form-row">
            <div class="form-field"><label>进度（%）</label><input type="number" id="fm-progress" min="0" max="100" value="${data.progress||0}"></div>
            <div class="form-field"><label>状态</label><select id="fm-status">${topicStatusOptions}</select></div>
          </div>
          <div class="form-field"><label>下一步行动</label><input type="text" id="fm-nextAction" value="${this.escape(data.nextAction||'')}" placeholder="下一步学什么"></div>
        `;
      case 'exercise':
        return `
          <div class="form-field"><label>运动项目</label><input type="text" id="fm-type" value="${this.escape(data.type||'')}" placeholder="如：跑步、瑜伽"></div>
          <div class="form-row">
            <div class="form-field"><label>时长（分钟）</label><input type="number" id="fm-duration" value="${data.duration||30}"></div>
            <div class="form-field"><label>日期</label><input type="date" id="fm-date" value="${data.date||new Date().toISOString().slice(0,10)}"></div>
          </div>
          <div class="form-field"><label>心情/图标</label><input type="text" id="fm-mood" value="${this.escape(data.mood||'🏃')}" placeholder="emoji"></div>
          <div class="form-field"><label>运动摘要</label><textarea id="fm-summary" placeholder="记录今天的运动感受">${this.escape(data.summary||'')}</textarea></div>
        `;
      case 'inspiration':
        return `
          <div class="form-field"><label>内容</label><textarea id="fm-content" placeholder="记录灵感">${this.escape(data.content||'')}</textarea></div>
          <div class="form-field"><label>来源</label><select id="fm-source">${sourceOptions}</select></div>
        `;
      case 'period':
        return `
          <div class="form-field"><label>上次开始日期</label><input type="date" id="fm-lastStart" value="${data.lastStart||''}"></div>
          <div class="form-row">
            <div class="form-field"><label>周期长度（天）</label><input type="number" id="fm-cycleLength" value="${data.cycleLength||28}"></div>
            <div class="form-field"><label>经期长度（天）</label><input type="number" id="fm-periodLength" value="${data.periodLength||5}"></div>
          </div>
        `;
      default:
        return '';
    }
  },

  collectFormData(type, data) {
    data = data || {};
    const getVal = id => {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };
    const getNum = id => {
      const v = getVal(id);
      return v === '' ? 0 : Number(v);
    };
    const getCheck = id => {
      const el = document.getElementById(id);
      return el ? el.checked : false;
    };

    let result = { ...data };
    switch(type) {
      case 'task':
        result.title = getVal('fm-title').trim();
        result.domain = getVal('fm-domain');
        result.priority = getVal('fm-priority');
        result.dueDate = getVal('fm-dueDate') || null;
        result.dueTime = getVal('fm-dueTime') || null;
        result.estimated = getNum('fm-estimated');
        result.progress = getNum('fm-progress');
        result.nextAction = getVal('fm-nextAction').trim();
        result.status = getVal('fm-status');
        result.inTop3 = getCheck('fm-inTop3');
        result.inToday = getCheck('fm-inToday');
        break;
      case 'schedule':
        result.title = getVal('fm-title').trim();
        result.domain = getVal('fm-domain');
        result.repeat = getVal('fm-repeat');
        result.date = getVal('fm-date');
        result.start = getVal('fm-start');
        result.end = getVal('fm-end');
        result.location = getVal('fm-location').trim();
        break;
      case 'book':
        result.title = getVal('fm-title').trim();
        result.author = getVal('fm-author').trim();
        result.progress = getNum('fm-progress');
        result.status = getVal('fm-status');
        result.coverColor = getVal('fm-coverColor');
        break;
      case 'topic':
        result.title = getVal('fm-title').trim();
        result.source = getVal('fm-source').trim();
        result.progress = getNum('fm-progress');
        result.status = getVal('fm-status');
        result.nextAction = getVal('fm-nextAction').trim();
        break;
      case 'exercise':
        result.type = getVal('fm-type').trim();
        result.duration = getNum('fm-duration');
        result.date = getVal('fm-date');
        result.mood = getVal('fm-mood').trim();
        result.summary = getVal('fm-summary').trim();
        break;
      case 'inspiration':
        result.content = getVal('fm-content').trim();
        result.source = getVal('fm-source');
        break;
      case 'period':
        result.lastStart = getVal('fm-lastStart');
        result.cycleLength = getNum('fm-cycleLength');
        result.periodLength = getNum('fm-periodLength');
        break;
    }
    return result;
  },

  escape(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  /* ===== Quick Add ===== */
  showQuickAdd() {
    this.quickAddType = 'task';
    document.querySelectorAll('.qa-option').forEach(b => b.style.opacity = b.dataset.type === 'task' ? '1' : '0.5');
    document.getElementById('quickAddModal').classList.add('show');
    setTimeout(() => document.getElementById('quickAddText').focus(), 300);
  },

  hideQuickAdd() {
    document.getElementById('quickAddModal').classList.remove('show');
    document.getElementById('quickAddText').value = '';
  },

  handleQuickAdd() {
    const text = document.getElementById('quickAddText').value.trim();
    const domain = document.getElementById('quickAddDomain').value;
    if (!text) { this.toast('请输入内容'); return; }

    const type = this.quickAddType;
    if (type === 'task') {
      this.saveTask({
        title: text,
        domain,
        priority: 'medium',
        dueDate: null,
        dueTime: null,
        estimated: 30,
        progress: 0,
        nextAction: '明确下一步行动',
        inToday: false,
        inTop3: false,
        top3Order: 0,
        status: 'pending'
      });
    } else if (type === 'schedule') {
      this.saveSchedule({
        title: text,
        domain,
        date: new Date().toISOString().slice(0, 10),
        start: '09:00',
        end: '10:00',
        repeat: 'none',
        location: ''
      });
    } else {
      DB.data.inspirations.unshift({
        id: 'i' + Date.now(),
        content: text,
        source: 'manual',
        createdAt: new Date().toISOString(),
        processed: false,
      });
      DB.save();
      this.toast('已添加到收集箱');
      this.updateInboxBadge();
      if (this.currentTab === 'inbox') this.renderInbox();
    }
    this.hideQuickAdd();
    if (this.currentTab === 'today') this.renderToday();
  },

  /* ===== Today Page ===== */
  renderToday() {
    const p = document.getElementById('page-today');
    const now = new Date();
    const hour = now.getHours();
    const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const days = ['日','一','二','三','四','五','六'];
    const dateStr = `${now.getMonth()+1}月${now.getDate()}日 星期${days[now.getDay()]}`;
    const todayStr = now.toISOString().slice(0, 10);
    const checkedIn = DB.data.profile.lastActiveDate === todayStr;

    const todayTasks = DB.getTodayTasks();
    const completed = todayTasks.filter(t => t.status === 'completed').length;
    const todayTotal = todayTasks.length;
    const todayProgress = todayTotal > 0 ? Math.round(completed / todayTotal * 100) : 0;
    const circ = 2 * Math.PI * 18;
    const dashOffset = circ * (1 - todayProgress / 100);

    p.innerHTML = `
      <!-- 1. Hero -->
      <div class="hero">
        <div class="hero-avatar" onclick="UI.openAvatarPicker()">
          ${DB.data.profile.avatar ? `<img src="${DB.data.profile.avatar}" alt="avatar">` : `<img src="icons/doreen-avatar.svg" alt="Doreen">`}
        </div>
        <div class="hero-info">
          <div class="hero-date">${dateStr}</div>
          <div class="hero-greeting">${greet}，Doreen。</div>
          <div class="hero-status">${DB.data.profile.status}</div>
        </div>
        <div class="hero-stats">
          <div class="hero-progress-ring">
            <svg width="44" height="44" viewBox="0 0 44 44">
              <circle class="ring-bg" cx="22" cy="22" r="18" fill="none" stroke-width="3.5"/>
              <circle class="ring-fg" cx="22" cy="22" r="18" fill="none" stroke-width="3.5"
                stroke-dasharray="${circ}" stroke-dashoffset="${dashOffset}"/>
            </svg>
            <div class="hero-progress-text">${todayProgress}%</div>
          </div>
          <div class="hero-streak ${checkedIn ? 'is-checked' : ''}">
            <span class="hero-streak-flame">🔥</span>
            <span class="hero-streak-num">连续 ${DB.data.profile.streak} 天</span>
            <span class="hero-streak-badge ${checkedIn ? 'checked' : 'pending'}">${checkedIn ? '今日已打卡' : '今日待打卡'}</span>
          </div>
        </div>
      </div>

      <!-- 2. AI Briefing -->
      <div id="aiBriefWrap">${this.renderAIBrief()}</div>

      <!-- 3. Top 3 -->
      <div class="section-title">今日聚焦 Top 3</div>
      ${this.renderTop3()}

      <!-- 4. Timeline -->
      <div class="section-title">今日时间轴</div>
      ${this.renderTimeline()}

      <!-- 5. Domains -->
      <div class="section-title">六大生活主线</div>
      ${this.renderDomainScroll()}

      <!-- 6. Reminders -->
      <div class="section-title">待处理提醒</div>
      ${this.renderReminders()}

      <!-- 7. Inspirations -->
      <div class="section-title">最近灵感</div>
      ${this.renderRecentInspirations()}

      <div class="spacer-20"></div>
    `;
  },

  renderAIBrief() {
    const top3 = DB.getTodayTop3();
    const overdue = DB.data.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate === 'today' && !t.inTop3);
    const inboxCount = DB.getInbox().length;
    const periodDay = DB.data.period.currentDay;
    const periodPredict = DB.data.period.nextPredict;

    const focus = top3.slice(0,3).map(t => t.title).join('、') || '今日暂无重点任务';
    const notes = [];
    if (overdue.length) notes.push(`${overdue.length} 项任务今日截止但未加入 Top3`);
    if (inboxCount > 3) notes.push(`收集箱有 ${inboxCount} 条灵感待整理`);
    if (periodDay >= 24) notes.push(`生理期预计 ${periodPredict} 到来，注意身体`);
    const stale = DB.data.tasks.filter(t => t.status === 'pending' && !t.inToday);
    if (stale.length > 3) notes.push(`${stale.length} 项任务长期未推进`);
    if (!notes.length) notes.push('一切在掌控中，保持节奏即可');

    const firstTask = top3[0];
    const suggestion = firstTask
      ? `建议先用 ${firstTask.estimated} 分钟完成「${firstTask.title}」的第一步：${firstTask.nextAction}`
      : '建议先整理收集箱，选出今天最重要的三件事';

    return `
      <div class="ai-brief">
        <div class="ai-brief-header">
          <div class="ai-brief-icon">
            <img src="icons/doreen-avatar.svg" alt="Doreen">
          </div>
          <div class="ai-brief-title">AI 今日简报</div>
          <div class="ai-brief-tag">规则引擎</div>
        </div>
        <div class="ai-brief-motto handwriting">focus, then flow ♡</div>
        <div class="ai-brief-section">
          <div class="ai-brief-label">今天的重点</div>
          <div class="ai-brief-text">${focus}</div>
        </div>
        <div class="ai-brief-section">
          <div class="ai-brief-label">需要注意</div>
          <div class="ai-brief-text">${notes.join('；')}。</div>
        </div>
        <div class="ai-brief-section">
          <div class="ai-brief-label">建议下一步</div>
          <div class="ai-brief-text">${suggestion}</div>
        </div>
        <div class="ai-brief-actions">
          <button class="ai-brief-btn primary" onclick="UI.openAIAnalysis()">AI 深度分析</button>
          <button class="ai-brief-btn secondary" onclick="UI.refreshBrief()">刷新简报</button>
        </div>
      </div>
    `;
  },

  refreshBrief() {
    const wrap = document.getElementById('aiBriefWrap');
    if (wrap) wrap.innerHTML = this.renderAIBrief();
    this.toast('简报已刷新');
  },

  openAIAnalysis() {
    const data = DB.data;
    const today = new Date().toISOString().slice(0, 10);
    const days = ['日','一','二','三','四','五','六'];
    const todayTasks = DB.getTodayTasks();
    const completedTasks = todayTasks.filter(t => t.status === 'completed');
    const top3 = DB.getTodayTop3();
    const schedules = DB.getTodaySchedules();
    const pendingTasks = data.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
    const overdue = data.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate && t.dueDate < today && t.dueDate !== 'today');
    const inboxCount = DB.getInbox().length;
    const exercises = data.exercises || [];
    const books = data.books.filter(b => b.status === 'reading');
    const learning = data.learningTopics.filter(l => l.status === 'inProgress');

    const sections = [];

    // 1. 今日概览
    sections.push({ title: '📌 今日概览', items: [
      `今日任务 ${todayTasks.length} 项，已完成 ${completedTasks.length} 项（${todayTasks.length ? Math.round(completedTasks.length/todayTasks.length*100) : 0}%）。`,
      `今日聚焦 Top 3：${top3.length ? top3.map(t => t.title).join('、') : '暂未设置，建议先选出今天最重要的三件事'}。`,
      `今日日程 ${schedules.length} 项${schedules.length ? '：' + schedules.map(s => `${s.start} ${s.title}`).join('；') : ''}。`,
    ]});

    // 2. 各主线进展
    const domainLines = Object.keys(DOMAINS).map(key => {
      const d = DOMAINS[key];
      const progress = DB.getDomainProgress(key);
      const pending = DB.getDomainPending(key);
      if (key === 'period') return `🌙 生理期：当前周期第 ${data.period.currentDay} 天，预测下次 ${data.period.nextPredict}。`;
      if (key === 'exercise') return `🏃 运动：累计 ${exercises.length} 次，本周 ${exercises.filter(e => e.date >= new Date(Date.now()-6*86400000).toISOString().slice(0,10)).length} 次。`;
      if (key === 'reading') return `📚 阅读：在读 ${books.length} 本，整体进度 ${progress}%。`;
      if (key === 'learning') return `✏️ 学习：进行中 ${learning.length} 个主题，整体进度 ${progress}%。`;
      return `${d.icon} ${d.name}：${progress}% 完成，${pending} 项待办。`;
    });
    sections.push({ title: '📊 各主线进展', items: domainLines });

    // 3. 需要关注
    const alerts = [];
    if (overdue.length) alerts.push(`⏰ ${overdue.length} 项任务已逾期（${overdue.map(t => t.title).slice(0,3).join('、')}），建议今天处理或顺延。`);
    if (inboxCount > 3) alerts.push(`📥 收集箱有 ${inboxCount} 条灵感待整理，避免堆积。`);
    if (pendingTasks.length > 8) alerts.push(`📋 待办共 ${pendingTasks.length} 项，建议聚焦 Top 3，其余排入后续。`);
    if (data.period.currentDay >= 24) alerts.push(`🌙 生理期预计 ${data.period.nextPredict} 到来，注意身体状态。`);
    if (!alerts.length) alerts.push('✅ 暂无紧急事项，保持当前节奏即可。');
    sections.push({ title: '⚠️ 需要关注', items: alerts });

    // 4. 建议下一步
    const tips = [];
    if (top3[0]) tips.push(`建议先用 ${top3[0].estimated} 分钟推进「${top3[0].title}」：${top3[0].nextAction}。`);
    if (schedules.length && !completedTasks.length) tips.push('今天已有日程安排，先从第一个时间块开始，进入状态。');
    if (inboxCount) tips.push('抽出 5 分钟清空收集箱，把灵感转化为任务或笔记。');
    if (!exercises.length) tips.push('今天还没记录运动，哪怕 10 分钟散步也有助于状态。');
    if (!tips.length) tips.push('今天的计划已经很清晰，按节奏执行即可。');
    sections.push({ title: '💡 建议下一步', items: tips });

    // 5. 坚持与趋势（连续天数里程碑 + 近 4 周热力图累计）
    const streakN = DB.data.profile.streak || 0;
    const heatSum = (DB.data.heatmap || []).reduce((a, b) => a + (b || 0), 0);
    let milestone = '';
    if (streakN >= 365) milestone = '🌟 一年如一日，了不起的坚持！';
    else if (streakN >= 100) milestone = '💎 连续 100 天，习惯已稳稳扎根。';
    else if (streakN >= 30) milestone = '🌿 连续一个月，节奏正在变成习惯。';
    else if (streakN >= 7) milestone = '🌱 连续一周，好的开始！';
    const trendItems = [
      `已连续使用 ${streakN} 天，近 4 周累计完成 ${heatSum} 个任务节点。`,
    ];
    if (milestone) trendItems.push(milestone);
    trendItems.push(streakN >= 2 ? '昨天也来了，保持这份节奏，明天继续 ♡' : '今天是新起点，先迈出轻松的第一步。');
    sections.push({ title: '📈 坚持与趋势', items: trendItems });

    const html = sections.map(s => `
      <div class="analysis-section">
        <div class="analysis-section-title">${s.title}</div>
        ${s.items.map(i => `<div class="analysis-item">${this.escape(i)}</div>`).join('')}
      </div>
    `).join('');

    document.getElementById('analysisBody').innerHTML = html;
    document.getElementById('analysisModal').classList.add('show');
  },

  closeAIAnalysis() {
    document.getElementById('analysisModal').classList.remove('show');
  },

  renderTop3() {
    const top3 = DB.getTodayTop3();
    if (!top3.length) {
      return this.renderEmptyState('🎯', '还没有设置 Top 3', '从任务中选出今天最重要的三件事', 'one by one');
    }
    return `<div class="top3-list">${top3.map(t => {
      const d = DOMAINS[t.domain];
      return `
        <div class="top3-item">
          <div class="top3-rank" style="background:${d.color}">${t.top3Order}</div>
          <div class="top3-content">
            <div class="top3-title">${t.title}</div>
            <div class="top3-meta">
              <span class="top3-meta-item"><span class="dot dot-${t.domain}"></span>${d.name}</span>
              <span class="top3-meta-item">⏱ ${t.estimated}分钟</span>
              ${t.dueTime ? `<span class="top3-meta-item">截止 ${t.dueTime}</span>` : ''}
            </div>
            <div class="top3-next">→ ${t.nextAction}</div>
            <div class="top3-progress">
              <div class="top3-progress-bar" style="width:${t.progress}%;background:${d.color}"></div>
            </div>
          </div>
          <div class="top3-actions">
            <div class="top3-check ${t.status==='completed'?'done':''}" onclick="UI.toggleTask('${t.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <button class="inbox-action" style="margin-top:6px;padding:4px 6px" onclick="UI.moveTop3('${t.id}', -1)">↑</button>
            <button class="inbox-action" style="padding:4px 6px" onclick="UI.moveTop3('${t.id}', 1)">↓</button>
            <button class="inbox-action" style="padding:4px 6px" onclick="UI.removeFromTop3('${t.id}')">移出</button>
            <button class="inbox-action" style="padding:4px 6px" onclick="UI.openFormModal('task', DB.data.tasks.find(t=>t.id==='${t.id}'), UI.saveTask)">编辑</button>
            <button class="inbox-action" style="padding:4px 6px" onclick="UI.deleteTask('${t.id}')">删除</button>
          </div>
        </div>
      `;
    }).join('')}</div>`;
  },

  renderTimeline() {
    const schedules = DB.getTodaySchedules();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (!schedules.length) {
      return this.renderEmptyState('🗓', '今天还没有安排日程', '点击空白时间段新增安排', '给计划留一点呼吸');
    }

    return `
      <div class="timeline">
        <div class="timeline-line"></div>
        ${nowMinutes >= 360 && nowMinutes <= 1380 ? `<div class="timeline-now" id="timelineNow" style="top:${((nowMinutes-360)/(1380-360)*100).toFixed(1)}%"></div>` : ''}
        ${schedules.map(s => {
          const d = DOMAINS[s.domain];
          const [h,m] = s.start.split(':').map(Number);
          const sMin = h*60+m;
          const isDone = s.completed;
          const isNow = !isDone && nowMinutes >= sMin && nowMinutes < sMin + 60;
          return `
            <div class="timeline-item ${isDone?'timeline-done':''}">
              <div class="timeline-dot" style="background:${isDone?'var(--text-tertiary)':d.color};cursor:pointer" onclick="UI.toggleSchedule('${s.id}')"></div>
              <div class="timeline-content" ${isNow?`style="border-color:${d.color};border-width:1.5px"`:''}>
                <div class="timeline-time">${s.start} - ${s.end} ${isNow?'· 进行中':''}</div>
                <div class="timeline-title">${s.title}</div>
                ${s.location?`<div class="text-xs text-tertiary" style="margin-top:2px">📍 ${s.location}</div>`:''}
                <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
                  <span class="timeline-tag" style="background:${d.bg};color:${d.color}">${d.name}</span>
                  <button class="inbox-action" style="padding:3px 8px" onclick="event.stopPropagation();UI.openFormModal('schedule', DB.data.schedules.find(s=>s.id==='${s.id}'), UI.saveSchedule)">编辑</button>
                  <button class="inbox-action" style="padding:3px 8px" onclick="event.stopPropagation();UI.deleteSchedule('${s.id}')">删除</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
        <div class="timeline-empty" onclick="UI.openFormModal('schedule', {date:new Date().toISOString().slice(0,10), start:'09:00', end:'10:00', repeat:'none', domain:'schedule'}, UI.saveSchedule)">+ 点击新增安排</div>
      </div>
    `;
  },

  renderDomainScroll() {
    const domains = Object.keys(DOMAINS);
    return `<div class="domain-scroll">${domains.map(key => {
      const d = DOMAINS[key];
      const progress = DB.getDomainProgress(key);
      const pending = DB.getDomainPending(key);
      let nextAction = '暂无待办';
      if (key === 'reading') {
        const reading = DB.data.books.filter(b => b.status === 'reading');
        nextAction = reading.length ? `继续阅读《${reading[0].title}》` : '选择一本新书开始';
      } else if (key === 'learning') {
        const inProg = DB.data.learningTopics.filter(l => l.status === 'inProgress');
        nextAction = inProg.length ? inProg[0].nextAction : '选择一个学习主题';
      } else if (key === 'period') {
        nextAction = `预测下次：${DB.data.period.nextPredict}`;
      } else if (key === 'exercise') {
        const exercises = DB.data.exercises || [];
        nextAction = exercises.length ? `最近：${exercises[0].type} · ${exercises[0].duration}分钟` : '记录今日运动';
      } else if (key === 'schedule') {
        nextAction = '查看今日时间轴';
      } else {
        const t = DB.getTasks(key).find(t => t.status !== 'completed');
        nextAction = t ? t.nextAction : '暂无待办';
      }

      let countdown = '';
      if (key === 'period') {
        countdown = `第${DB.data.period.currentDay}天`;
      }

      // 为移除进度条的卡片（生理期 / 运动）填充有意义的摘要行
      let summaryLine = '';
      if (key === 'period') {
        const cycleLen = DB.data.period.cycleLength || 28;
        const daysToNext = Math.max(0, cycleLen - DB.data.period.currentDay);
        summaryLine = `距下次约 ${daysToNext} 天 · 周期共 ${cycleLen} 天`;
      } else if (key === 'exercise') {
        const ex = DB.data.exercises || [];
        const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
        const weekCount = ex.filter(e => e.date >= weekStart).length;
        const weekMin = ex.filter(e => e.date >= weekStart).reduce((s, e) => s + (e.duration || 0), 0);
        summaryLine = ex.length ? `本周 ${weekCount} 次 · 共 ${weekMin} 分钟 · 累计 ${ex.length} 次` : '记录今日运动，开启本周节奏';
      }

      const metaPrimary = (key === 'exercise') ? `${(DB.data.exercises || []).length} 次累计` : `${pending} 项`;

      return `
        <div class="domain-card" onclick="UI.openProject('${key}')">
          <div class="domain-card-header">
            <div class="domain-card-icon" style="background:${d.bg}">${d.icon}</div>
            <div class="domain-card-name">${d.name}</div>
          </div>
          ${(key === 'period' || key === 'exercise') ? `
          <div class="domain-card-summary">${summaryLine}</div>` : `
          <div class="domain-card-progress">
            <div class="domain-card-progress-bar">
              <div class="domain-card-progress-fill" style="width:${progress}%;background:${d.color}"></div>
            </div>
            <div class="domain-card-progress-text">
              <span>${progress}% 完成</span>
              <span>${pending} 待办</span>
            </div>
          </div>`}
          <div class="domain-card-next-label">下一步</div>
          <div class="domain-card-next">${nextAction}</div>
          ${countdown ? `<div class="domain-card-meta"><span>${countdown}</span><span>更新于今日</span></div>` : `<div class="domain-card-meta"><span>${metaPrimary}</span><span>更新于今日</span></div>`}
        </div>
      `;
    }).join('')}</div>`;
  },

  renderReminders() {
    const reminders = DB.getReminders();
    if (!reminders.length) {
      return this.renderEmptyState('✓', '暂无待处理提醒', '一切都在掌控中', 'have a nice day!');
    }
    return `<div class="card">${reminders.map(r => {
      const d = DOMAINS[r.domain];
      return `
        <div class="reminder-item">
          <div class="reminder-dot" style="background:${d.color}"></div>
          <div class="reminder-content">
            <div class="reminder-title">${r.title}</div>
            <div class="reminder-sub">${r.sub}</div>
          </div>
          <div class="reminder-actions">
            <button class="reminder-btn" onclick="UI.toast('已加入今日')">加入今日</button>
            <button class="reminder-btn" onclick="UI.toast('已延期')">延期</button>
          </div>
        </div>
      `;
    }).join('')}</div>`;
  },

  renderRecentInspirations() {
    const items = DB.getInbox().slice(0, 5);
    if (!items.length) {
      return this.renderEmptyState('💡', '收集箱是空的', '点击右下角 + 按钮记录灵感', 'keep growing');
    }
    const sourceMap = { manual: '📝 手动', voice: '🎤 语音', image: '📷 图片', web: '🔗 网页' };
    return `<div class="card">${items.map(i => `
      <div class="inspiration-item">
        <div class="inspiration-icon" style="background:var(--c-learning-bg)">
          <span style="font-size:14px">${(sourceMap[i.source]||'📝').split(' ')[0]}</span>
        </div>
        <div class="inspiration-content">
          <div class="inspiration-text">${i.content}</div>
          <div class="inspiration-meta">
            <span class="inspiration-source">${sourceMap[i.source] || '手动'}</span>
            <span class="inspiration-time">· ${this.timeAgo(i.createdAt)}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          <button class="inspiration-convert" onclick="UI.convertInspiration('${i.id}')">整理 →</button>
          <button class="inspiration-convert" onclick="UI.openFormModal('inspiration', DB.data.inspirations.find(i=>i.id==='${i.id}'), UI.saveInspiration)">编辑</button>
          <button class="inspiration-convert" onclick="UI.deleteInspiration('${i.id}')">删除</button>
        </div>
      </div>
    `).join('')}</div>`;
  },

  /* ===== Projects Page ===== */
  renderProjects() {
    const p = document.getElementById('page-projects');
    if (this.currentProject) {
      this.renderProjectDetail(this.currentProject);
      return;
    }

    const domains = Object.keys(DOMAINS);
    p.innerHTML = `
      <div class="page-header-block">
        <h1 class="page-title">项目</h1>
        <p class="page-subtitle">六个领域，一目了然。</p>
        <span class="page-handwriting">keep growing <span style="color:var(--c-learning);font-size:13px">✦</span></span>
      </div>
      <div class="projects-grid">
        ${domains.map(key => {
          const d = DOMAINS[key];
          const progress = DB.getDomainProgress(key);
          const pending = DB.getDomainPending(key);
          let extraInfo = '';
          if (key === 'reading') {
            const reading = DB.data.books.filter(b => b.status === 'reading').length;
            const done = DB.data.books.filter(b => b.status === 'completed').length;
            extraInfo = `在读 ${reading} 本 · 已读 ${done} 本`;
          } else if (key === 'learning') {
            const inProg = DB.data.learningTopics.filter(l => l.status === 'inProgress').length;
            const done = DB.data.learningTopics.filter(l => l.status === 'completed').length;
            extraInfo = `在学 ${inProg} · 已完成 ${done}`;
          } else if (key === 'period') {
            extraInfo = `周期第 ${DB.data.period.currentDay} 天`;
          } else if (key === 'exercise') {
            const exercises = DB.data.exercises || [];
            const totalMin = exercises.reduce((s, e) => s + e.duration, 0);
            extraInfo = `本周 ${exercises.length} 次 · ${totalMin} 分钟`;
          } else {
            extraInfo = `${pending} 项待办`;
          }
          return `
            <div class="project-tile" onclick="UI.openProject('${key}')" style="background:${d.bg}">
              <div class="project-tile-icon" style="background:rgba(255,255,255,0.85);box-shadow:0 1px 3px rgba(44,42,40,0.05)">${d.icon}</div>
              <div class="project-tile-name">${d.name}</div>
              <div class="project-tile-progress">${progress}% 完成</div>
              <div class="project-tile-count">${extraInfo}</div>
              <div class="project-tile-bar" style="background:rgba(255,255,255,0.6)"><div style="height:100%;width:${progress}%;background:${d.color};border-radius:2px"></div></div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="spacer-20"></div>
    `;
  },

  openProject(key) {
    this.currentProject = key;
    this.renderProjectDetail(key);
  },

  renderProjectDetail(key) {
    const d = DOMAINS[key];
    const p = document.getElementById('page-projects');

    let content = '';
    if (key === 'reading') content = this.renderReadingDetail();
    else if (key === 'learning') content = this.renderLearningDetail();
    else if (key === 'period') content = this.renderPeriodDetail();
    else if (key === 'exercise') content = this.renderExerciseDetail();
    else content = this.renderGenericDomainDetail(key);

    p.innerHTML = `
      <div class="project-detail-header">
        <div class="project-detail-back" onclick="UI.currentProject=null;UI.renderProjects()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </div>
        <div>
          <div class="project-detail-title">${d.name}</div>
          <div class="project-detail-sub">${d.name}领域详情</div>
        </div>
      </div>
      ${content}
      <div class="spacer-20"></div>
    `;
  },

  renderReadingDetail() {
    const reading = DB.data.books.filter(b => b.status === 'reading');
    const pending = DB.data.books.filter(b => b.status === 'pending');
    const completed = DB.data.books.filter(b => b.status === 'completed');

    const bookActions = (b) => `
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;margin-left:8px">
        <button class="inbox-action" style="padding:4px 8px" onclick="UI.openFormModal('book', DB.data.books.find(b=>b.id==='${b.id}'), UI.saveBook)">编辑</button>
        <button class="inbox-action" style="padding:4px 8px" onclick="UI.deleteBook('${b.id}')">删除</button>
      </div>
    `;

    return `
      <button class="btn-primary" style="margin-bottom:12px" onclick="UI.openFormModal('book', {status:'pending', progress:0, coverColor:'#8BA5B8'}, UI.saveBook)">+ 添加书籍</button>
      <div class="card">
        <div class="card-header"><span class="card-title">📖 在读 (${reading.length})</span></div>
        ${reading.map(b => `
          <div class="book-item">
            <div class="book-cover" style="background:${b.coverColor}">${b.title.slice(0,4)}</div>
            <div class="book-info">
              <div class="book-title">${b.title}</div>
              <div class="book-author">${b.author}</div>
              <div class="book-progress">
                <div class="top3-progress"><div class="top3-progress-bar" style="width:${b.progress}%;background:var(--c-reading)"></div></div>
                <div class="text-xs text-tertiary" style="margin-top:4px">${b.progress}%</div>
              </div>
            </div>
            ${bookActions(b)}
          </div>
        `).join('') || '<div class="text-secondary text-sm">暂无在读</div>'}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">📋 待读 (${pending.length})</span></div>
        ${pending.map(b => `
          <div class="book-item">
            <div class="book-cover" style="background:${b.coverColor}">${b.title.slice(0,4)}</div>
            <div class="book-info">
              <div class="book-title">${b.title}</div>
              <div class="book-author">${b.author}</div>
            </div>
            ${bookActions(b)}
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">✅ 已读完 (${completed.length})</span></div>
        ${completed.map(b => `
          <div class="book-item">
            <div class="book-cover" style="background:${b.coverColor}">${b.title.slice(0,4)}</div>
            <div class="book-info">
              <div class="book-title" style="text-decoration:line-through;color:var(--text-tertiary)">${b.title}</div>
              <div class="book-author">${b.author}</div>
            </div>
            ${bookActions(b)}
          </div>
        `).join('')}
      </div>
    `;
  },

  renderLearningDetail() {
    const inProg = DB.data.learningTopics.filter(l => l.status === 'inProgress');
    const pending = DB.data.learningTopics.filter(l => l.status === 'pending');
    const done = DB.data.learningTopics.filter(l => l.status === 'completed');

    const topicActions = (l) => `
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="inbox-action" style="padding:4px 8px" onclick="UI.openFormModal('topic', DB.data.learningTopics.find(l=>l.id==='${l.id}'), UI.saveTopic)">编辑</button>
        <button class="inbox-action" style="padding:4px 8px" onclick="UI.deleteTopic('${l.id}')">删除</button>
      </div>
    `;

    return `
      <button class="btn-primary" style="margin-bottom:12px" onclick="UI.openFormModal('topic', {status:'pending', progress:0}, UI.saveTopic)">+ 添加学习主题</button>
      <div class="card">
        <div class="card-header"><span class="card-title">✏️ 正在学习 (${inProg.length})</span></div>
        ${inProg.map(l => `
          <div style="padding:10px 0;border-bottom:0.5px solid var(--border-subtle)">
            <div style="font-weight:600;font-size:14px">${l.title}</div>
            <div class="text-xs text-tertiary" style="margin-top:2px">来源：${l.source}</div>
            <div class="top3-progress" style="margin-top:8px"><div class="top3-progress-bar" style="width:${l.progress}%;background:var(--c-learning)"></div></div>
            <div class="text-xs" style="color:var(--c-learning);margin-top:4px;font-weight:500">→ ${l.nextAction}</div>
            ${topicActions(l)}
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">📋 待学习 (${pending.length})</span></div>
        ${pending.map(l => `
          <div style="padding:8px 0;border-bottom:0.5px solid var(--border-subtle)">
            <div style="font-weight:500;font-size:14px">${l.title}</div>
            <div class="text-xs text-tertiary" style="margin-top:2px">来源：${l.source}</div>
            ${topicActions(l)}
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">✅ 已完成 (${done.length})</span></div>
        ${done.map(l => `
          <div style="padding:8px 0">
            <div style="font-weight:500;font-size:14px;text-decoration:line-through;color:var(--text-tertiary)">${l.title}</div>
            <div class="text-xs text-tertiary" style="margin-top:2px">${l.nextAction}</div>
            ${topicActions(l)}
          </div>
        `).join('')}
      </div>
    `;
  },

  renderPeriodDetail() {
    const p = DB.data.period;
    const day = p.currentDay;
    const phase = day <= 5 ? '经期' : day <= 14 ? '卵泡期' : day <= 21 ? '排卵期' : '黄体期';
    return `
      <button class="btn-primary" style="margin-bottom:12px" onclick="UI.openFormModal('period', DB.data.period, UI.savePeriod)">编辑周期信息</button>
      <div class="period-card">
        <div class="period-day">${day}</div>
        <div class="period-label">周期第 ${day} 天 · ${phase}</div>
        <div class="period-predict">预测下次经期：${p.nextPredict}（约 ${p.cycleLength - day} 天后）</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">📊 周期信息</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="text-secondary">上次开始</span><span>${p.lastStart}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="text-secondary">周期长度</span><span>${p.cycleLength} 天</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="text-secondary">经期长度</span><span>${p.periodLength} 天</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span class="text-secondary">预测下次</span><span>${p.nextPredict}</span></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">📝 提示</span></div>
        <p class="text-secondary text-sm">此数据基于历史周期均值计算，仅供参考。</p>
      </div>
    `;
  },

  renderExerciseDetail() {
    const exercises = DB.data.exercises || [];
    const totalMin = exercises.reduce((s, e) => s + e.duration, 0);
    const avgMin = exercises.length ? Math.round(totalMin / exercises.length) : 0;
    const types = [...new Set(exercises.map(e => e.type))];

    // Build weekly bar chart (last 7 days)
    const now = new Date();
    const days = ['日','一','二','三','四','五','六'];
    const weekBars = [];
    let maxMin = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayEx = exercises.filter(e => e.date === dateStr);
      const dayMin = dayEx.reduce((s, e) => s + e.duration, 0);
      if (dayMin > maxMin) maxMin = dayMin;
      weekBars.push({ day: days[d.getDay()], min: dayMin, isToday: i === 0 });
    }

    return `
      <div class="exercise-stats">
        <div class="exercise-stat">
          <div class="exercise-stat-val">${totalMin}</div>
          <div class="exercise-stat-label">本周总时长 (分钟)</div>
        </div>
        <div class="exercise-stat">
          <div class="exercise-stat-val">${exercises.length}</div>
          <div class="exercise-stat-label">运动次数</div>
        </div>
        <div class="exercise-stat">
          <div class="exercise-stat-val">${avgMin}</div>
          <div class="exercise-stat-label">平均时长 (分钟)</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">📊 本周运动概览</span></div>
        <div class="exercise-week-chart">
          ${weekBars.map(b => `
            <div class="exercise-week-bar">
              <div class="exercise-week-bar-fill ${b.isToday ? 'active' : ''}" style="height:${maxMin > 0 ? (b.min / maxMin * 100) : 0}%; min-height:${b.min > 0 ? '8' : '2'}px"></div>
              <div class="exercise-week-bar-label" style="${b.isToday ? 'color:var(--c-exercise)' : ''}">${b.day}</div>
            </div>
          `).join('')}
        </div>
        <div class="text-xs text-tertiary" style="text-align:center">最近 7 天运动时长分布</div>
      </div>

      <button class="btn-primary" style="margin-bottom:12px" onclick="UI.openFormModal('exercise', {date:'${new Date().toISOString().slice(0,10)}', mood:'🏃'}, UI.saveExercise)">+ 记录运动</button>
      <div class="card">
        <div class="card-header"><span class="card-title">🏃 运动记录 (${exercises.length})</span></div>
        ${exercises.length === 0
          ? this.renderEmptyState('', '还没有运动记录', '记录今天的运动项目、时长和感受', 'keep moving')
          : exercises.map(e => `
            <div class="exercise-record">
              <div class="exercise-record-icon" style="background:var(--c-exercise-bg)">${e.mood || '🏃'}</div>
              <div class="exercise-record-info">
                <div class="exercise-record-header">
                  <div class="exercise-record-type">${e.type}</div>
                  <div class="exercise-record-duration">${e.duration} 分钟</div>
                </div>
                <div class="exercise-record-summary">${e.summary}</div>
                <div class="exercise-record-date">${e.date}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
                <button class="inbox-action" style="padding:4px 8px" onclick="UI.openFormModal('exercise', DB.data.exercises.find(e=>e.id==='${e.id}'), UI.saveExercise)">编辑</button>
                <button class="inbox-action" style="padding:4px 8px" onclick="UI.deleteExercise('${e.id}')">删除</button>
              </div>
            </div>
          `).join('')
        }
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">📋 运动项目类型 (${types.length})</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">
          ${types.map(t => `<span class="badge badge-exercise">${t}</span>`).join('') || '<div class="text-secondary text-sm">暂无</div>'}
        </div>
      </div>
    `;
  },

  renderGenericDomainDetail(key) {
    const d = DOMAINS[key];
    const tasks = DB.getTasks(key);
    return `
      <button class="btn-primary" style="margin-bottom:12px" onclick="UI.openFormModal('task', {domain:'${key}', status:'pending', priority:'medium', estimated:30, progress:0, inToday:true, inTop3:false, top3Order:0}, UI.saveTask)">+ 新建任务</button>
      <div class="card">
        <div class="card-header"><span class="card-title">📋 任务 (${tasks.length})</span></div>
        ${tasks.map(t => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:0.5px solid var(--border-subtle)">
            <div class="top3-check ${t.status==='completed'?'done':''}" onclick="UI.toggleTask('${t.id}')" style="margin-top:2px;flex-shrink:0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;font-size:14px;${t.status==='completed'?'text-decoration:line-through;color:var(--text-tertiary)':''}">${t.title}</div>
              <div class="text-xs text-tertiary" style="margin-top:3px">→ ${t.nextAction}</div>
              ${t.progress > 0 ? `<div class="top3-progress" style="margin-top:6px"><div class="top3-progress-bar" style="width:${t.progress}%;background:${d.color}"></div></div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
              <button class="inbox-action" style="padding:4px 8px" onclick="UI.openFormModal('task', DB.data.tasks.find(t=>t.id==='${t.id}'), UI.saveTask)">编辑</button>
              <button class="inbox-action" style="padding:4px 8px" onclick="UI.deleteTask('${t.id}')">删除</button>
            </div>
          </div>
        `).join('') || '<div class="text-secondary text-sm">暂无任务</div>'}
      </div>
    `;
  },

  /* ===== Schedule Page ===== */
  renderSchedule() {
    const p = document.getElementById('page-schedule');
    const now = new Date();
    const days = ['日','一','二','三','四','五','六'];
    const today = now.getDay() === 0 ? 7 : now.getDay();

    const weekDays = [];
    for (let i = -1; i <= 5; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      weekDays.push({ date: d.getDate(), day: d.getDay(), isToday: i === 0, offset: i });
    }

    const hours = [];
    for (let h = 8; h <= 22; h++) hours.push(h);

    p.innerHTML = `
      <div class="page-header-block">
        <h1 class="page-title">日程</h1>
        <span class="page-handwriting">给计划留一点呼吸 <span style="color:var(--c-schedule)">♡</span></span>
      </div>
      <div class="schedule-toggle">
        <button class="schedule-toggle-btn active" onclick="UI.switchScheduleView('day')">日视图</button>
        <button class="schedule-toggle-btn" onclick="UI.switchScheduleView('week')">周视图</button>
        <button class="schedule-toggle-btn" onclick="UI.switchScheduleView('list')">全部</button>
      </div>
      <div id="scheduleContent"></div>
    `;
    this.renderScheduleDay();
  },

  scheduleView: 'day',

  switchScheduleView(view) {
    this.scheduleView = view;
    const labels = { day: '日', week: '周', list: '全部' };
    document.querySelectorAll('.schedule-toggle-btn').forEach(b => b.classList.toggle('active', b.textContent.includes(labels[view])));
    if (view === 'day') this.renderScheduleDay();
    else if (view === 'week') this.renderScheduleWeek();
    else this.renderScheduleList();
  },

  renderScheduleDay() {
    const el = document.getElementById('scheduleContent');
    if (!el) return;
    const now = new Date();
    const days = ['日','一','二','三','四','五','六'];
    const todayStr = now.toISOString().slice(0, 10);
    const schedules = DB.getTodaySchedules();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    el.innerHTML = `
      <button class="btn-primary" style="margin-bottom:12px" onclick="UI.openFormModal('schedule', {date:'${todayStr}', start:'09:00', end:'10:00', repeat:'none', domain:'schedule'}, UI.saveSchedule)">+ 新建日程</button>
      <div class="day-header">
        <div class="day-header-date">${now.getMonth()+1}月${now.getDate()}日</div>
        <div class="day-header-day">星期${days[now.getDay()]}</div>
      </div>
      ${schedules.length === 0 ? this.renderEmptyState('', '今天还没有安排日程', '点击空白时间段新增安排', 'one by one') : `
      <div class="timeline">
        <div class="timeline-line"></div>
        ${nowMinutes >= 480 && nowMinutes <= 1320 ? `<div class="timeline-now" style="top:${((nowMinutes-480)/(1320-480)*100).toFixed(1)}%"></div>` : ''}
        ${schedules.map(s => {
          const d = DOMAINS[s.domain];
          const [h,m] = s.start.split(':').map(Number);
          const sMin = h*60+m;
          const isDone = s.completed;
          const isNow = !isDone && nowMinutes >= sMin && nowMinutes < sMin + 60;
          return `
            <div class="timeline-item ${isDone?'timeline-done':''}">
              <div class="timeline-dot" style="background:${isDone?'var(--text-tertiary)':d.color};cursor:pointer" onclick="UI.toggleSchedule('${s.id}')"></div>
              <div class="timeline-content" ${isNow?`style="border-color:${d.color};border-width:1.5px"`:''}>
                <div class="timeline-time">${s.start} - ${s.end}</div>
                <div class="timeline-title">${s.title}</div>
                ${s.location?`<div class="text-xs text-tertiary" style="margin-top:2px">📍 ${s.location}</div>`:''}
                <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
                  <span class="timeline-tag" style="background:${d.bg};color:${d.color}">${d.name}</span>
                  <button class="inbox-action" style="padding:3px 8px" onclick="event.stopPropagation();UI.openFormModal('schedule', DB.data.schedules.find(s=>s.id==='${s.id}'), UI.saveSchedule)">编辑</button>
                  <button class="inbox-action" style="padding:3px 8px" onclick="event.stopPropagation();UI.deleteSchedule('${s.id}')">删除</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      `}
    `;
  },

  renderScheduleWeek() {
    const el = document.getElementById('scheduleContent');
    if (!el) return;
    const now = new Date();
    const days = ['日','一','二','三','四','五','六'];
    const todayIdx = now.getDay();

    const weekDays = [];
    const dayNames = ['日','一','二','三','四','五','六'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - todayIdx + i);
      weekDays.push({ date: d.getDate(), day: i, dayName: dayNames[d.getDay()], isToday: i === todayIdx });
    }

    const hours = [8, 10, 12, 14, 16, 18, 20, 22];
    const allSchedules = DB.data.schedules;

    el.innerHTML = `
      <div class="week-grid">
        <div></div>
        ${weekDays.map(d => `<div class="week-header ${d.isToday?'today':''}">${d.dayName}<br>${d.date}</div>`).join('')}
        ${hours.map(h => `
          <div class="week-time">${h}:00</div>
          ${weekDays.map(d => {
            const dateStr = new Date(new Date().setDate(new Date().getDate() - todayIdx + d.day)).toISOString().slice(0,10);
            const events = allSchedules.filter(s => {
              const sDate = s.date === 'today' ? new Date().toISOString().slice(0,10) : s.date;
              const [sh] = s.start.split(':').map(Number);
              return sh === h && sDate === dateStr;
            });
            if (events.length) {
              const e = events[0];
              const dom = DOMAINS[e.domain];
              return `<div class="week-cell week-event" style="background:${dom.color}" onclick="UI.openFormModal('schedule', DB.data.schedules.find(s=>s.id==='${e.id}'), UI.saveSchedule)" title="${e.title}"></div>`;
            }
            return `<div class="week-cell" onclick="UI.openFormModal('schedule', {date:'${dateStr}', start:'${String(h).padStart(2,'0')}:00', end:'${String(h).padStart(2,'0')}:00', repeat:'none', domain:'schedule'}, UI.saveSchedule)"></div>`;
          }).join('')}
        `).join('')}
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-header"><span class="card-title">领域色块</span></div>
        ${Object.entries(DOMAINS).map(([k,d]) => `
          <div style="display:flex;align-items:center;gap:10px;padding:5px 0">
            <div style="width:14px;height:14px;border-radius:4px;background:${d.color};flex-shrink:0"></div>
            <span class="text-sm">${d.name}</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderScheduleList() {
    const el = document.getElementById('scheduleContent');
    if (!el) return;
    const all = DB.data.schedules.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const repeatMap = { none: '不重复', daily: '每天', weekly: '每周', workday: '工作日' };
    const dateLabel = s => s.date === 'today' ? '今天' : (s.date || '—');
    const rowHtml = s => {
      const d = DOMAINS[s.domain];
      const isDone = s.completed;
      const repeatBadge = (s.repeat && s.repeat !== 'none') ? `<span class="text-xs text-tertiary">↻ ${repeatMap[s.repeat]}</span>` : '';
      return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:0.5px solid var(--border-subtle)">
          <div class="top3-check ${isDone?'done':''}" onclick="UI.toggleSchedule('${s.id}')" style="margin-top:2px;flex-shrink:0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;font-size:14px;${isDone?'text-decoration:line-through;color:var(--text-tertiary)':''}">${this.escape(s.title)}</div>
            <div class="text-xs text-tertiary" style="margin-top:3px">${dateLabel(s)} · ${s.start} - ${s.end}${s.location?` · 📍 ${this.escape(s.location)}`:''}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
              <span class="timeline-tag" style="background:${d.bg};color:${d.color}">${d.name}</span>
              ${repeatBadge}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
            <button class="inbox-action" style="padding:4px 8px" onclick="event.stopPropagation();UI.openFormModal('schedule', DB.data.schedules.find(s=>s.id==='${s.id}'), UI.saveSchedule)">编辑</button>
            <button class="inbox-action" style="padding:4px 8px" onclick="event.stopPropagation();UI.deleteSchedule('${s.id}')">删除</button>
          </div>
        </div>
      `;
    };

    const pending = all.filter(s => !s.completed);
    const done = all.filter(s => s.completed);

    el.innerHTML = `
      <div class="card" style="padding:6px 16px">
        <div class="card-header" style="padding:10px 0 4px"><span class="card-title">未完成 (${pending.length})</span></div>
        ${pending.length ? pending.map(rowHtml).join('') : `<div class="text-secondary text-sm" style="padding:12px 0">暂无未完成的日程</div>`}
        <div class="card-header" style="padding:14px 0 4px"><span class="card-title">已完成 (${done.length})</span></div>
        ${done.length ? done.map(rowHtml).join('') : `<div class="text-secondary text-sm" style="padding:12px 0">暂无已完成的日程</div>`}
      </div>
    `;
  },

  /* ===== Inbox Page ===== */
  renderInbox() {
    const p = document.getElementById('page-inbox');
    const items = DB.getInbox();
    const todayCount = items.filter(i => {
      const d = new Date(i.createdAt);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;
    const oldest = items.length ? this.timeAgo(items[items.length-1].createdAt) : '—';

    const sourceMap = { manual: '📝 手动', voice: '🎤 语音', image: '📷 图片', web: '🔗 网页' };

    p.innerHTML = `
      <div class="page-header-block">
        <h1 class="page-title">收集箱</h1>
        <p class="page-subtitle">先接住，再整理。</p>
        <span class="page-handwriting">you've got this <span style="color:var(--c-schedule)">♡</span></span>
      </div>
      <div class="inbox-stats">
        <div class="inbox-stat">
          <div class="inbox-stat-num">${items.length}</div>
          <div class="inbox-stat-label">未整理</div>
        </div>
        <div class="inbox-stat">
          <div class="inbox-stat-num">${todayCount}</div>
          <div class="inbox-stat-label">今日新增</div>
        </div>
        <div class="inbox-stat">
          <div class="inbox-stat-num" style="font-size:14px;padding-top:8px">${oldest}</div>
          <div class="inbox-stat-label">最早记录</div>
        </div>
      </div>
      ${items.length === 0 ? this.renderEmptyState('', '收集箱是空的', '点击右下角 + 按钮，快速记录任何想法', 'have a nice day!') : items.map(i => `
        <div class="inbox-item">
          <div class="inbox-item-content">${i.content}</div>
          <div class="inbox-item-meta">
            <span class="badge badge-${i.source==='web'?'reading':i.source==='voice'?'learning':'personal'}">${sourceMap[i.source] || '手动'}</span>
            <span class="text-xs text-tertiary">${this.timeAgo(i.createdAt)}</span>
          </div>
          <div class="inbox-item-actions">
            <button class="inbox-action" onclick="UI.openFormModal('inspiration', DB.data.inspirations.find(i=>i.id==='${i.id}'), UI.saveInspiration)">编辑</button>
            <button class="inbox-action" onclick="UI.convertInspiration('${i.id}','task')">转任务</button>
            <button class="inbox-action" onclick="UI.convertInspiration('${i.id}','note')">转笔记</button>
            <button class="inbox-action" onclick="UI.deleteInspiration('${i.id}')">删除</button>
          </div>
        </div>
      `).join('')}
      <div class="spacer-20"></div>
    `;
  },

  convertInspiration(id, type) {
    const item = DB.data.inspirations.find(i => i.id === id);
    if (!item) return;
    item.processed = true;
    if (type === 'task') {
      DB.data.tasks.unshift({
        id: 't' + Date.now(),
        title: item.content.slice(0, 50),
        domain: 'personal',
        priority: 'medium',
        dueDate: null, dueTime: null,
        estimated: 30, progress: 0,
        nextAction: '明确下一步行动',
        inToday: false, inTop3: false, top3Order: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      this.toast('已转化为任务');
    } else {
      this.toast('已转化为笔记');
    }
    DB.save();
    this.updateInboxBadge();
    if (this.currentTab === 'inbox') this.renderInbox();
    if (this.currentTab === 'today') this.renderToday();
  },

  saveInspiration(data) {
    if (!data.content) { this.toast('请输入内容'); return; }
    const isNew = !data.id;
    if (isNew) {
      data.id = 'i' + Date.now();
      data.createdAt = new Date().toISOString();
      data.processed = false;
      DB.data.inspirations.unshift(data);
    } else {
      const idx = DB.data.inspirations.findIndex(i => i.id === data.id);
      if (idx >= 0) DB.data.inspirations[idx] = { ...DB.data.inspirations[idx], ...data };
    }
    DB.save();
    this.toast(isNew ? '灵感已添加' : '灵感已更新');
    this.updateInboxBadge();
    if (this.currentTab === 'inbox') this.renderInbox();
    if (this.currentTab === 'today') this.renderToday();
  },

  deleteInspiration(id) {
    if (!confirm('确定删除这条灵感吗？')) return;
    DB.data.inspirations = DB.data.inspirations.filter(i => i.id !== id);
    DB.save();
    this.toast('已删除');
    this.updateInboxBadge();
    if (this.currentTab === 'inbox') this.renderInbox();
    if (this.currentTab === 'today') this.renderToday();
  },

  /* ===== Profile Page ===== */
  renderProfileRing(value, color, label, sub) {
    const r = 30;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - value / 100);
    return `
      <div class="profile-ring-card">
        <div class="profile-ring">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle class="ring-bg" cx="36" cy="36" r="${r}" fill="none" stroke-width="5"/>
            <circle class="ring-fg" cx="36" cy="36" r="${r}" fill="none" stroke-width="5"
              stroke="${color}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
          </svg>
          <div class="hero-progress-text" style="font-size:13px;font-weight:700;color:${color}">${value}%</div>
        </div>
        <div class="profile-ring-label">${label}</div>
        <div class="profile-ring-value">${sub}</div>
      </div>
    `;
  },

  renderProfile() {
    const p = document.getElementById('page-profile');
    const s = DB.data.stats;

    // Compute ring values
    const totalTasks = DB.data.tasks.length;
    const completedTasks = DB.data.tasks.filter(t => t.status === 'completed').length;
    const contentValue = totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0;

    const learningTopics = DB.data.learningTopics;
    const learningValue = learningTopics.length ? Math.round(learningTopics.reduce((sum, t) => sum + (t.progress || 0), 0) / learningTopics.length) : 0;

    const exerciseGoal = 180;
    const exerciseValue = Math.min(100, Math.round(s.exerciseMinutes / exerciseGoal * 100));

    const travelValue = 0;

    // Compute weekly time distribution from actual data
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const domainMinutes = {};
    Object.keys(DOMAINS).forEach(k => domainMinutes[k] = 0);

    DB.data.schedules.forEach(sc => {
      const d = new Date(sc.date);
      if (d >= weekStart) {
        const [sh, sm] = sc.start.split(':').map(Number);
        const [eh, em] = sc.end.split(':').map(Number);
        const minutes = (eh * 60 + em) - (sh * 60 + sm);
        if (domainMinutes[sc.domain] !== undefined) domainMinutes[sc.domain] += minutes;
      }
    });

    (DB.data.exercises || []).forEach(e => {
      const d = new Date(e.date);
      if (d >= weekStart) domainMinutes.exercise += e.duration;
    });

    const maxMin = Math.max(1, ...Object.values(domainMinutes));
    const fmtH = (m) => m === 0 ? '0h' : (m / 60 < 1 ? m + 'm' : (m / 60).toFixed(1).replace('.0','') + 'h');

    p.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar" onclick="UI.openAvatarPicker()">
          ${DB.data.profile.avatar ? `<img src="${DB.data.profile.avatar}" alt="avatar">` : `<img src="icons/doreen-full.svg" alt="Doreen">`}
        </div>
        <div class="profile-name">Doreen</div>
        <div class="profile-sub">连续使用 ${DB.data.profile.streak} 天</div>
        <div class="profile-brand handwriting">把散落的生活，收进今天。</div>
      </div>

      <div class="profile-rings">
        ${this.renderProfileRing(contentValue, 'var(--c-personal)', '内容', `${completedTasks}/${totalTasks} 完成`)}
        ${this.renderProfileRing(learningValue, 'var(--c-learning)', '学习', `${learningValue}% 进度`)}
        ${this.renderProfileRing(exerciseValue, 'var(--c-exercise)', '运动', `${s.exerciseMinutes}/${exerciseGoal} min`)}
        ${this.renderProfileRing(travelValue, 'var(--c-reading)', '旅行', '待记录')}
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-value" style="color:var(--c-personal)">${s.weeklyCompleted}</div>
          <div class="stat-card-label">本周完成任务</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style="color:var(--c-schedule)">${s.top3Rate}%</div>
          <div class="stat-card-label">Top 3 完成率</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style="color:var(--c-reading)">${s.readingMinutes}<span style="font-size:14px">min</span></div>
          <div class="stat-card-label">本周阅读时长</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value" style="color:var(--c-exercise)">${s.exerciseCount}</div>
          <div class="stat-card-label">本周运动次数</div>
        </div>
      </div>

      <div class="section-title">连续完成热力图</div>
      <div class="card">
        <div class="heatmap">
          ${DB.data.heatmap.map(v => {
            const level = v === 0 ? '' : `l${Math.min(4, Math.ceil(v))}`;
            return `<div class="heatmap-cell ${level}"></div>`;
          }).join('')}
        </div>
        <div class="flex-between text-xs text-tertiary" style="margin-top:8px">
          <span>4 周前</span>
          <span>少 ▢ ▣ ▦ ▩ 多</span>
          <span>本周</span>
        </div>
      </div>

      <div class="section-title">每周时间分布</div>
      <div class="card">
        <div class="time-dist">
          ${Object.entries(DOMAINS).map(([k, d]) => {
            const mins = domainMinutes[k] || 0;
            const pct = Math.round(mins / maxMin * 100);
            return `<div class="time-dist-row"><div class="time-dist-label">${d.name}</div><div class="time-dist-bar"><div class="time-dist-fill" style="width:${pct}%;background:${d.color}"></div></div><div class="time-dist-val">${fmtH(mins)}</div></div>`;
          }).join('')}
        </div>
      </div>

      <div class="section-title">数据管理</div>
      <div class="settings-list">
        <div class="settings-item" onclick="UI.exportData()">
          <div class="settings-item-icon" style="background:var(--c-reading-bg)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-reading)" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          </div>
          <div class="settings-item-label">导出数据</div>
          <div class="settings-item-arrow">›</div>
        </div>
        <div class="settings-item" onclick="UI.importData()">
          <div class="settings-item-icon" style="background:var(--c-learning-bg)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-learning)" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          </div>
          <div class="settings-item-label">导入数据</div>
          <div class="settings-item-arrow">›</div>
        </div>
        <div class="settings-item" onclick="UI.resetData()">
          <div class="settings-item-icon" style="background:var(--c-schedule-bg)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-schedule)" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1015-6.7L21 8M21 3v5h-5"/></svg>
          </div>
          <div class="settings-item-label">清空所有数据</div>
          <div class="settings-item-arrow">›</div>
        </div>
      </div>

      <div class="section-title">关于</div>
      <div class="card">
        <div style="font-weight:600;font-size:15px">Doreen's Personal OS</div>
        <div class="text-secondary text-sm" style="margin-top:4px">把散落的生活，收进今天。</div>
        <div class="text-xs text-tertiary" style="margin-top:8px">版本 2.0</div>
      </div>

      <div class="spacer-20"></div>
    `;
  },

  /* ===== Actions ===== */
  toggleTask(id) {
    const t = DB.data.tasks.find(t => t.id === id);
    if (!t) return;
    if (t.status === 'completed') {
      t.status = t.progress > 0 ? 'inProgress' : 'pending';
      this.toast('已恢复');
    } else {
      t.status = 'completed';
      t.completedAt = new Date().toISOString();
      this.toast('完成！🎉');
    }
    DB.save();
    this.refreshAfterTaskChange();
  },

  saveTask(data) {
    if (!data.title) { this.toast('请输入标题'); return; }
    const isNew = !data.id;
    if (data.inTop3 && (!data.top3Order || data.top3Order === 0)) {
      const maxOrder = DB.data.tasks.reduce((m, t) => Math.max(m, t.top3Order || 0), 0);
      data.top3Order = maxOrder + 1;
    }
    if (!data.inTop3) data.top3Order = 0;
    if (isNew) {
      data.id = 't' + Date.now();
      data.createdAt = new Date().toISOString().slice(0, 10);
      DB.data.tasks.unshift(data);
    } else {
      const idx = DB.data.tasks.findIndex(t => t.id === data.id);
      if (idx >= 0) {
        const existing = DB.data.tasks[idx];
        DB.data.tasks[idx] = { ...existing, ...data };
      }
    }
    DB.save();
    this.toast(isNew ? '任务已创建' : '任务已更新');
    this.refreshAfterTaskChange();
  },

  deleteTask(id) {
    if (!confirm('确定删除这个任务吗？')) return;
    DB.data.tasks = DB.data.tasks.filter(t => t.id !== id);
    DB.save();
    this.toast('已删除');
    this.refreshAfterTaskChange();
  },

  removeFromTop3(id) {
    const t = DB.data.tasks.find(t => t.id === id);
    if (!t) return;
    t.inTop3 = false;
    t.top3Order = 0;
    DB.save();
    this.toast('已移出 Top 3');
    this.refreshAfterTaskChange();
  },

  moveTop3(id, direction) {
    const top3 = DB.getTodayTop3();
    const idx = top3.findIndex(t => t.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= top3.length) return;
    const temp = top3[idx].top3Order;
    top3[idx].top3Order = top3[newIdx].top3Order;
    top3[newIdx].top3Order = temp;
    DB.save();
    this.refreshAfterTaskChange();
  },

  refreshAfterTaskChange() {
    this.updateInboxBadge();
    if (this.currentTab === 'today') this.renderToday();
    if (this.currentTab === 'projects') this.renderProjects();
  },

  saveBook(data) {
    if (!data.title) { this.toast('请输入书名'); return; }
    const isNew = !data.id;
    if (isNew) {
      data.id = 'b' + Date.now();
      DB.data.books.unshift(data);
    } else {
      const idx = DB.data.books.findIndex(b => b.id === data.id);
      if (idx >= 0) DB.data.books[idx] = { ...DB.data.books[idx], ...data };
    }
    DB.save();
    this.toast(isNew ? '书籍已添加' : '书籍已更新');
    this.renderProjects();
  },

  deleteBook(id) {
    if (!confirm('确定删除这本书吗？')) return;
    DB.data.books = DB.data.books.filter(b => b.id !== id);
    DB.save();
    this.toast('已删除');
    this.renderProjects();
  },

  saveTopic(data) {
    if (!data.title) { this.toast('请输入主题名称'); return; }
    const isNew = !data.id;
    if (isNew) {
      data.id = 'l' + Date.now();
      DB.data.learningTopics.unshift(data);
    } else {
      const idx = DB.data.learningTopics.findIndex(l => l.id === data.id);
      if (idx >= 0) DB.data.learningTopics[idx] = { ...DB.data.learningTopics[idx], ...data };
    }
    DB.save();
    this.toast(isNew ? '学习主题已添加' : '学习主题已更新');
    this.renderProjects();
  },

  deleteTopic(id) {
    if (!confirm('确定删除这个学习主题吗？')) return;
    DB.data.learningTopics = DB.data.learningTopics.filter(l => l.id !== id);
    DB.save();
    this.toast('已删除');
    this.renderProjects();
  },

  saveExercise(data) {
    if (!data.type) { this.toast('请输入运动项目'); return; }
    const isNew = !data.id;
    if (isNew) {
      data.id = 'ex' + Date.now();
      DB.data.exercises.unshift(data);
    } else {
      const idx = DB.data.exercises.findIndex(e => e.id === data.id);
      if (idx >= 0) DB.data.exercises[idx] = { ...DB.data.exercises[idx], ...data };
    }
    DB.save();
    this.toast(isNew ? '运动记录已添加' : '运动记录已更新');
    this.renderProjects();
    if (this.currentTab === 'today') this.renderToday();
  },

  deleteExercise(id) {
    if (!confirm('确定删除这条运动记录吗？')) return;
    DB.data.exercises = DB.data.exercises.filter(e => e.id !== id);
    DB.save();
    this.toast('已删除');
    this.renderProjects();
    if (this.currentTab === 'today') this.renderToday();
  },

  savePeriod(data) {
    DB.data.period = { ...DB.data.period, ...data };
    const last = new Date(DB.data.period.lastStart);
    const next = new Date(last);
    next.setDate(next.getDate() + DB.data.period.cycleLength);
    DB.data.period.nextPredict = next.toISOString().slice(0, 10);
    const today = new Date();
    const diff = Math.floor((today - last) / (1000 * 60 * 60 * 24)) + 1;
    DB.data.period.currentDay = Math.max(1, diff);
    DB.save();
    this.toast('周期信息已更新');
    this.renderProjects();
    if (this.currentTab === 'today') this.renderToday();
  },

  saveSchedule(data) {
    if (!data.title) { this.toast('请输入日程标题'); return; }
    if (!data.date || !data.start || !data.end) { this.toast('请填写完整时间'); return; }
    const isNew = !data.id;
    if (isNew) {
      data.id = 's' + Date.now();
      data.completed = false;
      DB.data.schedules.push(data);
    } else {
      const idx = DB.data.schedules.findIndex(s => s.id === data.id);
      if (idx >= 0) DB.data.schedules[idx] = { ...DB.data.schedules[idx], ...data };
    }
    DB.data.schedules.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    DB.save();
    this.toast(isNew ? '日程已创建' : '日程已更新');
    if (this.currentTab === 'schedule') this.renderSchedule();
    if (this.currentTab === 'today') this.renderToday();
  },

  deleteSchedule(id) {
    if (!confirm('确定删除这个日程吗？')) return;
    DB.data.schedules = DB.data.schedules.filter(s => s.id !== id);
    DB.save();
    this.toast('已删除');
    if (this.currentTab === 'schedule') this.renderSchedule();
    if (this.currentTab === 'today') this.renderToday();
  },

  toggleSchedule(id) {
    const s = DB.data.schedules.find(s => s.id === id);
    if (!s) return;
    s.completed = !s.completed;
    DB.save();
    this.toast(s.completed ? '日程已完成' : '已恢复');
    if (this.currentTab === 'schedule') this.renderSchedule();
    if (this.currentTab === 'today') this.renderToday();
  },

  exportData() {
    DB.export();
    this.toast('数据已导出');
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (DB.import(ev.target.result)) {
          this.toast('数据导入成功');
          this.renderAll();
          this.renderTab(this.currentTab);
        } else {
          this.toast('导入失败：文件格式错误');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  resetData() {
    if (confirm('确定清空所有数据吗？这将删除当前全部任务、日程、灵感等记录，恢复为空白状态。')) {
      DB.resetDemo();
      this.toast('数据已清空');
      this.renderAll();
      this.renderTab(this.currentTab);
    }
  },

  /* ===== Utils ===== */
  timeAgo(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    return Math.floor(diff / 86400) + '天前';
  },
};

/* ===== Boot ===== */
document.addEventListener('DOMContentLoaded', () => UI.init());
