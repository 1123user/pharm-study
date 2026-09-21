/* ============================================================
   三科通关 · 应用逻辑
   逐页确认（我已清楚）→ 解锁下一页 → 自动进入下一知识点
   ============================================================ */
(function () {
  "use strict";

  var SUBJECTS = [
    { id: "organic", name: "有机化学", short: "有机", badge: "有机", color: "var(--c-organic)",
      file: "js/data/organic.js", total: 25, desc: "大纲内 25 个人名反应" },
    { id: "pharm", name: "药理学", short: "药理", badge: "药理", color: "var(--c-pharm)",
      file: "js/data/pharm.js", total: 42, desc: "大纲内 42 个临床首选药与选药依据" },
    { id: "anal", name: "分析化学", short: "分析", badge: "分析", color: "var(--c-anal)",
      file: "js/data/anal.js", total: 529, desc: "大纲内 529 个名词解释与要点（13 章）" },
    { id: "instrument", name: "仪器分析", short: "仪器", badge: "仪器", color: "var(--c-inst)",
      file: "js/data/instrument.js", total: 354, desc: "大纲内 354 个考点问答 · 205 道选择题" }
  ];

  var STORE_KEY = "study3.progress.v1";
  var THEME_KEY = "study3.theme";
  var SCOPE_KEY = "study3.scope";
  var WEAK_KEY = "study3.weak.v1";
  var SYNC_KEY = "study3.sync.code";
  var PLAN_KEY = "study3.plan.v1";
  var AUTH_KEY = "study3.auth.token";
  var SB = window.SUPABASE_CONFIG || {};
  var SB_URL = (SB.url || "").replace(/\/+$/, "");
  var SB_KEY = SB.anonKey || "";
  var SB_SUFFIX = SB.emailSuffix || "@pharm.app";
  // 选项字母表：题库含 5 选项题（A–E），统一字母表避免越界渲染成空白
  var OPT_LETTERS = "ABCDEFGH";
  function fnUrl(name) { return SB_URL + "/functions/v1/" + name; }
  var THEMES = [
    { v: "auto", label: "跟随系统" },
    { v: "light", label: "浅色" },
    { v: "dark", label: "深色" }
  ];

  var state = {
    subjectId: null,
    index: 0,
    page: 0,
    confirmed: false,
    unlocked: false,
    finished: false,
    // 数据里已不含大纲外条目（构建时剔除），这里恒为 true
    onlyOutline: true,
    syncCode: localStorage.getItem(SYNC_KEY) || "",
    plan: (function () {
      try { return JSON.parse(localStorage.getItem("study3.plan.v1") || "null") || {}; }
      catch (e) { return {}; }
    })()
  };

  var progress = loadProgress();
  var searchQuery = "";

  /* ---------------- DOM 快捷方式 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var dom = {
    html: document.documentElement,
    sidebar: $("sidebar"),
    scrim: $("scrim"),
    subjectNav: $("subjectNav"),
    moduleBlock: $("moduleBlock"),
    moduleLabel: $("moduleLabel"),
    moduleList: $("moduleList"),
    topTitle: $("topTitle"),
    topSub: $("topSub"),
    progressStrip: $("progressStrip"),
    progressBar: $("progressBar"),
    progressText: $("progressText"),
    viewHome: $("viewHome"),
    viewStudy: $("viewStudy"),
    actionbar: $("actionbar"),
    searchOverlay: $("searchOverlay"),
    searchInput: $("searchInput"),
    searchResults: $("searchResults"),
    viewQuiz: $("viewQuiz"),
    quizBtn: $("quizBtn"),
    quizTotal: $("quizTotal"),
    bankNav: $("bankNav"),
    syncBody: $("syncBody"),
    themeBtn: $("themeBtn"),
    scopeBtn: $("scopeBtn"),
    toast: $("toast")
  };

  /* ---------------- 进度存取 ---------------- */
  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveProgressRaw() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  function saveProgress() {
    saveProgressRaw();
    scheduleSync();
  }
  function subProgress(id) {
    if (!progress[id]) progress[id] = { done: {}, current: null, at: 0 };
    return progress[id];
  }

  /* ---------------- 登录门控（Supabase Auth） ---------------- */
  function getToken() { return localStorage.getItem(AUTH_KEY) || ""; }
  function setToken(t) { if (t) localStorage.setItem(AUTH_KEY, t); else localStorage.removeItem(AUTH_KEY); }
  function authHeaders() {
    return { "apikey": SB_KEY, "Authorization": "Bearer " + getToken() };
  }
  function showAuthGate() { var g = $("authGate"); if (g) g.hidden = false; }
  function hideAuthGate() { var g = $("authGate"); if (g) g.hidden = true; }
  function authGuard() {
    var t = getToken();
    if (!t) { showAuthGate(); return Promise.resolve(false); }
    return fetch(SB_URL + "/auth/v1/user", {
      headers: { "apikey": SB_KEY, "Authorization": "Bearer " + t }
    }).then(function (r) { return r.ok; })
      .catch(function () { return false; })
      .then(function (ok) {
        if (ok) { hideAuthGate(); return true; }
        setToken("");
        showAuthGate();
        return false;
      });
  }
  function bindAuthLogin() {
    var btn = $("authGo");
    if (!btn) return;
    function attempt() {
      var u = ($("authUser").value || "").trim();
      var p = $("authPass").value;
      var err = $("authErr");
      if (!u || !p) { if (err) err.textContent = "请输入账号和密码"; return; }
      btn.disabled = true;
      btn.textContent = "登录中…";
      if (err) err.textContent = "";
      fetch(SB_URL + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { "apikey": SB_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: u + SB_SUFFIX, password: p })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.access_token) {
          setToken(j.access_token);
          hideAuthGate();
          boot();
        } else {
          if (err) err.textContent = (j && (j.error_description || j.msg)) || "登录失败，请重试";
        }
      }).catch(function () {
        if (err) err.textContent = "网络错误，请重试";
      }).then(function () {
        btn.disabled = false;
        btn.textContent = "登录";
      });
    }
    btn.addEventListener("click", attempt);
    var passEl = $("authPass");
    if (passEl) passEl.addEventListener("keydown", function (e) { if (e.key === "Enter") attempt(); });
  }

  /* ---------------- 数据加载 ---------------- */
  function getSubject(id) {
    return (window.STUDY_SUBJECTS || {})[id] || null;
  }
  function loadSubject(id) {
    return new Promise(function (resolve) {
      var cached = getSubject(id);
      if (cached) return resolve(cached);
      fetch(fnUrl("get-data") + "?name=" + id, { headers: authHeaders() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j) {
            window.STUDY_SUBJECTS = window.STUDY_SUBJECTS || {};
            window.STUDY_SUBJECTS[id] = j;
          }
          resolve(j);
        })
        .catch(function () { resolve(null); });
    });
  }
  function loadAll() {
    return Promise.all(SUBJECTS.map(function (s) { return loadSubject(s.id); }));
  }

  /* ---------------- 主题 ---------------- */
  /* fixed + transform 的侧边栏会被提升为合成层，切换主题时需强制其重绘，
     否则部分浏览器（含 Safari）可能残留旧主题底色。 */
  function repaintLayer(el) {
    if (!el) return;
    var prev = el.style.transform;
    el.style.transform = "translateZ(0)";
    void el.offsetHeight;
    el.style.transform = prev;
  }
  function syncLayers() {
    var bgElev = getComputedStyle(dom.html).getPropertyValue("--bg-elevated").trim();
    if (dom.sidebar) dom.sidebar.style.backgroundColor = bgElev || "";
    repaintLayer(dom.sidebar);
    repaintLayer(dom.actionbar);
    repaintLayer(dom.progressStrip);
  }
  function applyTheme() {
    var t = localStorage.getItem(THEME_KEY) || "auto";
    dom.html.setAttribute("data-theme", t);
    var cur = THEMES.filter(function (x) { return x.v === t; })[0] || THEMES[0];
    dom.themeBtn.textContent = "外观：" + cur.label;
    syncLayers();
  }
  function cycleTheme() {
    var t = localStorage.getItem(THEME_KEY) || "auto";
    var i = THEMES.map(function (x) { return x.v; }).indexOf(t);
    var next = THEMES[(i + 1) % THEMES.length].v;
    localStorage.setItem(THEME_KEY, next);
    applyTheme();
  }

  /* ---------------- 通用 UI ---------------- */
  var toastTimer = null;
  function toast(msg) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    requestAnimationFrame(function () { dom.toast.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      dom.toast.classList.remove("show");
      setTimeout(function () { dom.toast.hidden = true; }, 260);
    }, 1600);
  }

  function openSidebar() {
    dom.sidebar.classList.add("open");
    dom.scrim.hidden = false;
    requestAnimationFrame(function () { dom.scrim.classList.add("show"); });
  }
  function closeSidebar() {
    dom.sidebar.classList.remove("open");
    dom.scrim.classList.remove("show");
    setTimeout(function () { dom.scrim.hidden = true; }, 260);
  }

  /* ---------------- 侧边栏渲染 ---------------- */
  function renderSidebar() {
    dom.subjectNav.innerHTML = SUBJECTS.map(function (s) {
      var p = progress[s.id] || { done: {} };
      var n = Object.keys(p.done || {}).length;
      var sub = getSubject(s.id);
      var total = sub ? sub.items.length : s.total;
      return '<button type="button" class="subject-item' + (state.subjectId === s.id ? " active" : "") +
        '" data-subject="' + s.id + '" style="--dot:' + s.color + '">' +
        '<span class="dot"></span><span class="name">' + esc(s.name) + "</span>" +
        '<span class="count">' + n + "/" + total + "</span></button>";
    }).join("");

    var subj = state.subjectId ? getSubject(state.subjectId) : null;
    if (subj && subj.modules && subj.modules.length) {
      dom.moduleBlock.hidden = false;
      dom.moduleLabel.textContent = subj.name + " · 模块";
      var cur = currentItem();
      var curMod = cur ? cur.module : "";
      var mods = [];
      subj.items.forEach(function (it, i) {
        if (mods.length === 0 || mods[mods.length - 1].m !== it.module) {
          mods.push({ m: it.module, i: i });
        }
      });
      dom.moduleList.innerHTML = mods.map(function (x) {
        return '<button type="button" class="module-item' + (x.m === curMod ? " active" : "") +
          '" data-module="' + esc(x.m) + '"><span class="idx">' + (x.i + 1) + "</span>" +
          esc(x.m) + "</button>";
      }).join("");
    } else {
      dom.moduleBlock.hidden = true;
    }
    renderBankNav();
  }

  /* 题库导航：随机出题下方，点科目直接进入该科做题 */
  function renderBankNav() {
    if (!dom.bankNav) return;
    var cnt = {};
    if (quiz.pool.length) {
      quiz.pool.forEach(function (q) { cnt[q.s] = (cnt[q.s] || 0) + 1; });
    }
    var items = [{ id: "all", name: "全部混合", color: "var(--accent)", n: quiz.pool.length }]
      .concat(SUBJECTS.map(function (s) {
        return { id: s.id, name: s.name, color: s.color, n: cnt[s.id] || 0 };
      }));
    dom.bankNav.innerHTML = items.map(function (b) {
      return '<button type="button" class="subject-item" data-quizfilter="' + b.id +
        '" style="--dot:' + b.color + '">' +
        '<span class="dot"></span><span class="name">' + esc(b.name) + "</span>" +
        '<span class="count">' + (b.n ? b.n + " 题" : "›") + "</span></button>";
    }).join("");
  }

  /* ---------------- 首页 ---------------- */
  function pillCount(id) {
    var s = getSubject(id);
    if (s) return s.items.length;
    var meta = SUBJECTS.filter(function (x) { return x.id === id; })[0];
    return meta ? meta.total : 0;
  }

  function itemDesc(s, total) {
    var tail = state.onlyOutline ? " · 已按考试大纲筛选" : "";
    if (s.id === "organic") return total + " 个人名反应" + tail;
    if (s.id === "pharm") return total + " 个临床首选药" + tail;
    if (s.id === "instrument") return total + " 个考点问答" + tail;
    return total + " 个名词解释与要点" + tail;
  }

  function renderHome() {
    var last = null;
    SUBJECTS.forEach(function (s) {
      var p = progress[s.id];
      if (p && p.current != null && (!last || (p.ts || 0) > (last.ts || 0))) {
        last = { id: s.id, current: p.current, at: p.at || 0, ts: p.ts || 0, name: s.name };
      }
    });

    var continueHtml = "";
    if (last) {
      continueHtml =
        '<button type="button" class="continue-card" data-subject="' + last.id + '">' +
        '<div class="txt"><strong>继续学习 · ' + esc(last.name) + "</strong>" +
        "<span>上次进行到第 " + (last.at + 1) + " 个知识点，点击继续</span></div>" +
        '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>' +
        "</button>";
    }

    var cards = SUBJECTS.map(function (s) {
      var p = progress[s.id] || { done: {} };
      var n = Object.keys(p.done || {}).length;
      var sub = getSubject(s.id);
      var total = sub ? sub.items.length : s.total;
      var pct = Math.round((n / total) * 100);
      return '<button type="button" class="subject-card" data-subject="' + s.id +
        '" style="--card-color:' + s.color + '">' +
        '<div class="head">' +
        '<div class="badge">' + esc(s.badge) + "</div>" +
        '<div class="meta"><h2>' + esc(s.name) + "</h2><p>" + esc(itemDesc(s, total)) + "</p></div>" +
        '<span class="arrow"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg></span>' +
        "</div>" +
        '<div class="stats"><div class="bar"><i style="width:' + pct + '%"></i></div><em>' +
        n + " / " + total + "</em></div></button>";
    }).join("");

    // 今日任务摘要：把「新学 + 回顾 + 补位」的完整清单放到首页最前
    var planHtml = "";
    if (planIsToday()) {
      var pp = state.plan;
      var pIds = pp.ids || [], pRev = pp.rev || [], pCov = pp.cover || [];
      var pTotal = pIds.length + pRev.length + pCov.length;
      var rows = SUBJECTS.map(function (m) {
        var n = 0;
        pIds.forEach(function (u) { if (subjOfUnit(u) === m.id) n++; });
        pRev.forEach(function (r) { if (subjOfUnit(r.id) === m.id) n++; });
        pCov.forEach(function (c) { if (subjOfUnit(c.id) === m.id) n++; });
        if (!n) return "";
        return '<button type="button" class="plan-row" data-subject="' + m.id + '">' +
          '<span class="pg-dot ' + m.id + '"></span><span class="nm">' + esc(m.name) +
          "</span><em>" + n + " 项</em></button>";
      }).join("");
      var firstUnit = pIds[0] || (pRev[0] && pRev[0].id) || (pCov[0] && pCov[0].id) || "";
      planHtml =
        '<div class="home-plan"><div class="hp-head"><strong>今日任务</strong>' +
        "<span>" + pTotal + " 项</span></div>" +
        '<div class="hp-meta">新学 ' + pIds.length + " · 回顾 " + pRev.length +
        (pCov.length ? " · 补位 " + pCov.length : "") + "</div>" +
        '<div class="hp-rows">' + rows + "</div>" +
        (firstUnit ? '<button type="button" class="btn btn-primary hp-go" data-unit-go="' +
          firstUnit + '">开始今日任务</button>' : "") +
        "</div>";
    }

    dom.viewHome.innerHTML =
      '<div class="inner">' +
      '<div class="hero"><h1>药学知识</h1>' +
      "<p>三科通关 · 逐页浏览 · 卡片记忆 · 进度自动保存</p>" +
      '<div class="pills"><span class="pill">' + (pillCount("organic")) + " 人名反应</span>" +
      '<span class="pill">' + (pillCount("pharm")) + " 首选药</span>" +
      '<span class="pill">' + (pillCount("anal")) + " 名词</span></div></div>" +
      planHtml +
      continueHtml +
      '<div class="home-grid">' + cards + "</div>" +
      '<div class="tip-note"><b>使用方式：</b>底部「上一页 / 下一页」逐页浏览，' +
      "翻过某条内容的最后一页即记为已掌握；左侧菜单可开关「仅显示大纲内容」，" +
      "三科均默认按你的考试大纲筛选。进度保存在本机。</div>" +
      "</div>";

    dom.topTitle.textContent = "药学知识";
    dom.topSub.textContent = "选择科目开始学习";
    dom.progressStrip.hidden = true;
    dom.viewHome.hidden = false;
    dom.viewStudy.hidden = true;
    if (dom.viewQuiz) dom.viewQuiz.hidden = true;
    dom.actionbar.hidden = true;
    dom.viewHome.scrollTop = 0;
  }

  /* ---------------- 学习视图 ---------------- */
  /* 大纲范围：默认只显示考试大纲覆盖的知识点，关闭后显示全部 */
  function applyScope(subj) {
    subj = subj || currentSubject();
    if (!subj) return;
    if (!subj._all) subj._all = subj.items.slice();
    var list = state.onlyOutline
      ? subj._all.filter(function (x) { return x.scope !== "extra"; })
      : subj._all.slice();
    // 今日计划里的章节（含今日回顾）排到最前，保证「选择科目后先看到今天要复习的」
    var ids = planFocusIds(subj.id);
    if (ids.length) {
      var head = [], tail = [];
      list.forEach(function (x) {
        (ids.indexOf(x.unit) >= 0 ? head : tail).push(x);
      });
      list = head.concat(tail);
    }
    subj.items = list;
  }

  function toggleScope() {
    state.onlyOutline = !state.onlyOutline;
    localStorage.setItem(SCOPE_KEY, state.onlyOutline ? "outline" : "all");
    var subj = currentSubject();
    if (!subj) return;
    applyScope(subj);
    state.index = Math.min(state.index, subj.items.length - 1);
    state.page = 0;
    state.confirmed = false;
    state.unlocked = false;
    state.finished = false;
    renderStudy();
    dom.viewStudy.scrollTop = 0;
    renderScopeBtn();
    toast(state.onlyOutline ? "只显示大纲内容" : "显示全部内容");
  }

  function renderScopeBtn() {
    if (!dom.scopeBtn) return;
    dom.scopeBtn.classList.toggle("on", state.onlyOutline);
    dom.scopeBtn.setAttribute("aria-checked", state.onlyOutline ? "true" : "false");
  }

  function currentSubject() { return getSubject(state.subjectId); }
  function currentItem() {
    var s = currentSubject();
    return s ? s.items[state.index] : null;
  }

  function renderFig(b) {
    var list = (b.v || []).filter(Boolean);
    if (!list.length) return "";
    var imgs = list.map(function (src) {
      return '<img src="' + esc(src) + '" alt="教材反应式" loading="lazy" decoding="async">';
    }).join("");
    var cap = b.cap ? "<figcaption>" + esc(b.cap) + "</figcaption>" : "";
    return '<figure class="b-fig">' + imgs + cap + "</figure>";
  }

  function renderBlock(b) {
    switch (b.t) {
      case "p":
        return '<p class="b-p">' + esc(b.v) + "</p>";
      case "en":
        return '<p class="b-en">' + esc(b.v) + "</p>";
      case "core":
        return '<div class="b-core">' + esc(b.v) + "</div>";
      case "answer":
        return '<div class="b-answer">' + esc(b.v) + "</div>";
      case "kv": {
        var rows = (b.v || []).filter(function (r) { return r && r[1]; });
        if (!rows.length) return "";
        return '<div class="b-kv">' + rows.map(function (r) {
          return '<div class="kv-row"><div class="k">' + esc(r[0]) + "</div>" +
            '<div class="v">' + esc(r[1]) + "</div></div>";
        }).join("") + "</div>";
      }
      case "ul": {
        var items = (b.v || []).filter(Boolean);
        if (!items.length) return "";
        return '<ul class="b-ul">' + items.map(function (x) {
          return "<li>" + esc(x) + "</li>";
        }).join("") + "</ul>";
      }
      case "tip":
        return b.v ? '<div class="b-tip"><span class="ico">💡</span><div>' +
          '<span class="k">记忆提示</span>' + esc(b.v) + "</div></div>" : "";
      case "quote":
        return '<blockquote class="b-quote">' + esc(b.v) + "</blockquote>";
      case "fig":
        return renderFig(b);
      default:
        return "";
    }
  }

  function renderStudy() {
    var subj = currentSubject();
    if (!subj) return;
    applyScope(subj);
    if (state.index >= subj.items.length) state.index = subj.items.length - 1;
    var item = subj.items[state.index];
    var pages = item.pages;
    var pageIdx = Math.min(state.page, pages.length - 1);
    var p = subProgress(subj.id);
    var isDone = !!p.done[item.id];

    var crumbs = '<span class="tag" style="color:' + SUBJECTS.filter(function (s) {
      return s.id === subj.id;
    })[0].color + '">' + esc(subj.name) + "</span>" +
      "<span>第 " + (state.index + 1) + " / " + subj.items.length + " 个</span>" +
      '<button type="button" class="crumb-quiz" data-quiz-subj="' + subj.id +
      '">本科出题</button>' +
      '<span class="spacer"></span>' +
      (function (u) {
        if (!planIsToday()) return "";
        var p = state.plan;
        if ((p.ids || []).indexOf(u) >= 0) return '<span class="today-badge">今日新学</span>';
        if ((p.rev || []).some(function (r) { return r.id === u; })) {
          return '<span class="today-badge">今日回顾</span>';
        }
        if ((p.cover || []).some(function (c) { return c.id === u; })) {
          return '<span class="today-badge soft">今日补位</span>';
        }
        return "";
      })(item.unit) +
      (isDone ? '<span style="color:var(--success)">✓ 已掌握</span>' : '<span>未掌握</span>');

    var tagsHtml = (item.tags || []).filter(Boolean).length
      ? '<div class="card-tags">' + item.tags.filter(Boolean).map(function (t) {
          return "<span>" + esc(t) + "</span>";
        }).join("") + "</div>"
      : "";

    var titleHtml = esc(item.title);
    if (subj.id === "pharm") titleHtml += '<span class="q"> 首选何药？</span>';

    var dots = pages.map(function (_, i) {
      var cls = i === pageIdx ? "on" : (i < pageIdx ? "done" : "");
      return '<i class="' + cls + '"></i>';
    }).join("");

    var body = (pages[pageIdx].blocks || []).map(function (b) {
      return '<div class="block">' + renderBlock(b) + "</div>";
    }).join("");

    var footNote = "";
    if (pageIdx === pages.length - 1 && state.confirmed) {
      footNote = '<div class="card-foot-note">本知识点已确认，点击下方按钮继续</div>';
    }

    dom.viewStudy.innerHTML =
      '<div class="inner"><div class="card">' +
      '<div class="card-head">' +
      '<div class="card-crumb">' + crumbs + "</div>" +
      '<h1 class="card-title">' + titleHtml + "</h1>" +
      (subj.id === "organic" && item.subtitle ? '<p class="card-sub">' + esc(item.subtitle) + "</p>" : "") +
      (subj.id === "pharm" ? '<p class="card-sub">' + esc(item.module || "") + " · 临床首选药</p>" : "") +
      tagsHtml +
      "</div>" +
      '<div class="pager"><div class="dots">' + dots + "</div>" +
      '<span class="label">' + esc(pages[pageIdx].label) + "</span>" +
      '<span class="count">' + (pageIdx + 1) + " / " + pages.length + " 页</span></div>" +
      '<div class="page-body">' + body + footNote + "</div>" +
      "</div></div>";

    dom.viewHome.hidden = true;
    dom.viewStudy.hidden = false;
    if (dom.viewQuiz) dom.viewQuiz.hidden = true;
    dom.actionbar.hidden = false;

    var meta = SUBJECTS.filter(function (s) { return s.id === subj.id; })[0];
    dom.topTitle.textContent = subj.name;
    dom.topSub.textContent = item.title;

    var doneCount = Object.keys(p.done || {}).length;
    dom.progressStrip.hidden = false;
    dom.progressBar.style.width = Math.round((doneCount / subj.items.length) * 100) + "%";
    dom.progressText.textContent = doneCount + " / " + subj.items.length + " 已掌握";

    renderSidebar();
    renderActionbar();
    requestAnimationFrame(checkScroll);
  }

  function renderActionbar() {
    if (!state.subjectId || state.finished) return;
    var subj = currentSubject();
    var item = currentItem();
    if (!subj || !item) return;
    var last = state.page >= item.pages.length - 1;
    var lastItem = state.index >= subj.items.length - 1;

    var first = state.index === 0 && state.page === 0;
    var p = subProgress(subj.id);
    var mark = p.done[item.id] ? " ✓" : "";
    var hint = "第 " + (state.index + 1) + " / " + subj.items.length + " 个 · 第 " +
      (state.page + 1) + " / " + item.pages.length + " 页 · " + item.pages[state.page].label + mark;
    dom.actionbar.innerHTML = '<div class="action-hint">' + esc(hint) + "</div>" +
      '<div class="inner"><button type="button" class="btn btn-ghost" id="navPrev"' +
      (first ? " disabled" : "") + ">‹ 上一页</button>" +
      '<button type="button" class="btn btn-primary" id="navNext"' +
      (last && lastItem ? " disabled" : "") + ">下一页 ›</button></div>";
  }

  function checkScroll() {
    if (!state.subjectId || state.finished || state.unlocked) return;
    var v = dom.viewStudy;
    var reachable = v.scrollHeight <= v.clientHeight + 8;
    var atBottom = v.scrollTop + v.clientHeight >= v.scrollHeight - 16;
    if (reachable || atBottom) {
      state.unlocked = true;
      renderActionbar();
    }
  }

  /* ---------------- 前进流程 ---------------- */
  function confirmPage() {
    state.confirmed = true;
    renderActionbar();
  }

  function goNext() {
    var subj = currentSubject();
    var item = currentItem();
    if (!subj || !item) return;

    if (state.page < item.pages.length - 1) {
      state.page += 1;
      state.confirmed = false;
      state.unlocked = false;
      renderStudy();
      dom.viewStudy.scrollTop = 0;
      return;
    }

    // 本知识点最后一页 → 标记已掌握
    var p = subProgress(subj.id);
    var wasDone = !!p.done[item.id];
    p.done[item.id] = 1;
    if (!wasDone) {
      var n = Object.keys(p.done).length;
      if (n % 10 === 0 || n === subj.items.length) toast("已掌握 " + n + " / " + subj.items.length);
    }

    if (state.index < subj.items.length - 1) {
      state.index += 1;
      state.page = 0;
      state.confirmed = false;
      state.unlocked = false;
      p.current = subj.items[state.index].id;
      p.at = state.index;
      p.ts = Date.now();
      saveProgress();
      renderStudy();
      dom.viewStudy.scrollTop = 0;
    } else {
      state.finished = true;
      p.current = null;
      p.at = 0;
      p.ts = Date.now();
      saveProgress();
      renderFinished();
    }
  }

  function markDone() {
    var subj = currentSubject();
    var it = currentItem();
    if (!subj || !it) return;
    var p = subProgress(subj.id);
    if (p.done[it.id]) return;
    p.done[it.id] = 1;
    p.current = it.id;
    p.at = state.index;
    p.ts = Date.now();
    var n = Object.keys(p.done).length;
    saveProgress();
    if (n % 10 === 0 || n === subj.items.length) {
      toast("已掌握 " + n + " / " + subj.items.length);
    }
  }

  function navStep(dir) {
    var s = currentSubject();
    if (!s) return;
    var i = state.index;
    var pg = state.page + dir;
    if (pg < 0) { i -= 1; if (i < 0) return; pg = s.items[i].pages.length - 1; }
    else if (pg >= s.items[i].pages.length) {
      markDone();
      i += 1;
      if (i >= s.items.length) return;
      pg = 0;
    }
    jumpTo(i, pg);
  }

  function jumpTo(i, pg) {
    state.index = i;
    state.page = pg;
    state.confirmed = false;
    state.unlocked = false;
    renderStudy();
    dom.viewStudy.scrollTop = 0;
  }

  function renderFinished() {
    var subj = currentSubject();
    var p = subProgress(subj.id);
    var n = Object.keys(p.done || {}).length;
    dom.viewStudy.innerHTML =
      '<div class="inner"><div class="card done-card">' +
      '<div class="emoji">🎉</div>' +
      "<h2>" + esc(subj.name) + " 已全部学完</h2>" +
      "<p>共 " + n + " / " + subj.items.length + " 个知识点已确认掌握</p>" +
      '<div class="row">' +
      '<button type="button" class="btn btn-ghost" id="restartBtn">再复习一遍</button>' +
      '<button type="button" class="btn btn-primary" id="backHomeBtn">返回科目</button>' +
      "</div></div></div>";
    dom.actionbar.hidden = true;
    dom.viewStudy.scrollTop = 0;
    dom.progressBar.style.width = "100%";
    dom.progressText.textContent = n + " / " + subj.items.length + " 已掌握";
  }

  /* ---------------- 进入科目 ---------------- */
  function openSubject(id, opts) {
    opts = opts || {};
    closeSidebar();
    state.subjectId = id;
    state.finished = false;
    state.confirmed = false;
    state.unlocked = false;
    state.page = 0;

    loadSubject(id).then(function (subj) {
      if (!subj) { toast("数据加载失败，请刷新重试"); return; }
      applyScope(subj);
      renderScopeBtn();
      var p = subProgress(id);

      if (typeof opts.index === "number") {
        state.index = Math.max(0, Math.min(opts.index, subj.items.length - 1));
      } else {
        var idx = 0;
        if (p.current) {
          var i = subj.items.map(function (x) { return x.id; }).indexOf(p.current);
          if (i >= 0) idx = i;
        } else if (Object.keys(p.done || {}).length) {
          idx = Math.min(Object.keys(p.done).length, subj.items.length - 1);
        }
        // 今日有计划时，直接落到今天第一个要复习的知识点（含今日回顾章节）
        var tu = planFocusIds(id);
        if (tu.length) {
          var ti = -1;
          for (var k = 0; k < subj.items.length; k++) {
            if (tu.indexOf(subj.items[k].unit) >= 0) { ti = k; break; }
          }
          if (ti >= 0) idx = ti;
        }
        state.index = idx;
      }
      if (!p.current) { p.current = subj.items[state.index].id; }
      p.at = state.index;
      p.ts = Date.now();
      saveProgress();
      renderStudy();
      dom.viewStudy.scrollTop = 0;
      try {
        history.replaceState(null, "", "#/" + id + "/" + (state.index + 1));
      } catch (e) {}
    });
  }

  function goHome() {
    state.subjectId = null;
    state.finished = false;
    renderHome();
    renderSidebar();
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }

  /* ---------------- 搜索 ---------------- */
  function indexSubject(subj, meta) {
    if (subj._index) return subj._index;
    subj._index = subj.items.map(function (it, i) {
      var parts = [it.title, it.subtitle || "", it.en || "", (it.tags || []).join(" ")];
      (it.pages || []).forEach(function (pg) {
        (pg.blocks || []).forEach(function (b) {
          if (typeof b.v === "string") parts.push(b.v);
          else if (Array.isArray(b.v)) {
            b.v.forEach(function (x) {
              if (Array.isArray(x)) parts.push(x.join(" "));
              else if (x) parts.push(x);
            });
          }
        });
      });
      return { i: i, it: it, text: parts.join(" ").toLowerCase() };
    });
    return subj._index;
  }

  function openSearch() {
    dom.searchOverlay.hidden = false;
    dom.searchInput.value = searchQuery;
    setTimeout(function () { dom.searchInput.focus(); }, 60);
    loadAll().then(function () { renderSearch(); });
  }
  function closeSearch() {
    dom.searchOverlay.hidden = true;
    dom.searchInput.blur();
  }

  function renderSearch() {
    var q = searchQuery.trim().toLowerCase();
    if (!q) {
      dom.searchResults.innerHTML = '<div class="result-empty">输入关键词，搜索人名反应、首选药或专业名词</div>';
      return;
    }
    var groups = [];
    SUBJECTS.forEach(function (meta) {
      var subj = getSubject(meta.id);
      if (!subj) return;
      var idx = indexSubject(subj, meta);
      var hits = idx.filter(function (x) {
        return x.text.indexOf(q) >= 0 ||
          (x.it.title || "").toLowerCase().indexOf(q) >= 0;
      }).slice(0, 40);
      if (hits.length) groups.push({ meta: meta, hits: hits, subj: subj });
    });

    if (!groups.length) {
      dom.searchResults.innerHTML = '<div class="result-empty">没有找到「' + esc(searchQuery) + "」相关内容</div>";
      return;
    }
    dom.searchResults.innerHTML = groups.map(function (g) {
      var p = progress[g.meta.id] || { done: {} };
      return '<div class="search-group"><div class="t">' + esc(g.meta.name) +
        "（" + g.hits.length + " 条）</div>" +
        g.hits.map(function (h) {
          var done = p.done && p.done[h.it.id];
          return '<button type="button" class="result-item" data-go="' + g.meta.id +
            '" data-index="' + h.i + '">' +
            '<span class="no">' + h.it.no + "</span>" +
            '<span class="txt"><strong>' + esc(h.it.title) + "</strong>" +
            "<span>" + esc(h.it.subtitle || h.it.module || g.meta.desc) + "</span></span>" +
            (done ? '<span class="mark">✓</span>' : "") +
            "</button>";
        }).join("") + "</div>";
    }).join("");
  }

  /* ---------------- 随机出题 ---------------- */
  var quiz = { pool: [], list: [], idx: 0, picked: -1, right: 0, filter: "all", size: 20,
    revealed: false, sel: [] };

  function loadQuiz() {
    if (window.STUDY_QUIZ) return Promise.resolve(window.STUDY_QUIZ);
    return fetch(fnUrl("get-data") + "?name=quiz", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (j) { if (j) window.STUDY_QUIZ = j; return window.STUDY_QUIZ || []; })
      .catch(function () { return []; });
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- 题库首页：按科目分库，先选科目再练习 ---------------- */
  function bankBackChip() {
    return '<button type="button" class="chip back" id="bankHome">‹ 题库</button>';
  }

  function openQuizHome() {
    closeSidebar();
    Promise.all([loadQuiz(), loadAll()]).then(function (r) {
      var all = r[0];
      if (!all.length) { toast("题库加载失败"); return; }
      quiz.pool = all;
      quiz.filter = "";
      quiz.list = [];
      quiz.idx = 0;
      if (dom.quizTotal) dom.quizTotal.textContent = all.length + " 题";
      renderBankNav();
      renderQuizHome();
    });
  }

  function renderQuizHome() {
    dom.viewHome.hidden = true;
    dom.viewStudy.hidden = true;
    dom.viewQuiz.hidden = false;
    dom.actionbar.hidden = true;
    dom.progressStrip.hidden = true;
    dom.topTitle.textContent = "随机出题";
    dom.topSub.textContent = "题库 " + quiz.pool.length + " 题 · 每组 " + quiz.size + " 题";

    var cnt = {};
    quiz.pool.forEach(function (q) { cnt[q.s] = (cnt[q.s] || 0) + 1; });
    var set = todayRefSet();
    var todayN = quiz.pool.filter(function (q) { return set[q.r]; }).length;

    var todayCard = todayN
      ? '<button type="button" class="bank-card today" data-quizfilter="todayplan">' +
        '<span class="bk-name">今日计划</span><span class="bk-n">' + todayN + ' 题</span>' +
        '<span class="bk-desc">只做今天要新学 / 复习的章节</span></button>'
      : "";
    var subjCards = SUBJECTS.map(function (m) {
      var n = cnt[m.id] || 0;
      if (!n) return "";
      return '<button type="button" class="bank-card" data-quizfilter="' + m.id +
        '" style="--dot:' + m.color + '">' +
        '<span class="bk-dot"></span><span class="bk-name">' + esc(m.name) + "</span>" +
        '<span class="bk-n">' + n + " 题</span>" +
        '<span class="bk-desc">' + esc(itemDesc(m, n)) + "</span></button>";
    }).join("");
    var allCard = '<button type="button" class="bank-card all" data-quizfilter="all">' +
      '<span class="bk-name">全部科目混合</span><span class="bk-n">' + quiz.pool.length +
      ' 题</span><span class="bk-desc">五科随机混合，不区分科目</span></button>';

    dom.viewQuiz.innerHTML = '<div class="inner">' +
      '<div class="bank-head">选择题库</div>' +
      '<div class="bank-list">' + todayCard + allCard + "</div>" +
      '<div class="bank-head">单科题库</div>' +
      '<div class="bank-list">' + subjCards + "</div>" +
      "</div>";
    dom.viewQuiz.scrollTop = 0;
  }

  function startQuiz(filter) {
    if (filter) quiz.filter = filter;
    closeSidebar();
    Promise.all([loadQuiz(), loadAll()]).then(function (r) {
      var all = r[0];
      if (!all.length) { toast("题库加载失败"); return; }
      quiz.pool = all;
      if (dom.quizTotal) dom.quizTotal.textContent = all.length + " 题";
      renderBankNav();
      var src;
      if (quiz.filter === "todayplan") {
        var set = todayRefSet();
        src = all.filter(function (q) { return set[q.r]; });
        if (!src.length) toast("今日计划范围内暂无题目");
      } else if (quiz.filter === "all") {
        src = all.slice();
      } else {
        src = all.filter(function (q) { return q.s === quiz.filter; });
      }
      if (!src.length) { toast("该范围内暂无题目"); return; }
      quiz.list = shuffle(src.slice()).slice(0, quiz.size);
      quiz.idx = 0;
      quiz.right = 0;
      quiz.results = [];
      quiz.wrong = [];
      quiz.revealed = false;
      quiz.sel = [];
      state.subjectId = null;
      renderQuiz();
    });
  }

  function renderQuiz() {
    dom.viewHome.hidden = true;
    dom.viewStudy.hidden = true;
    dom.viewQuiz.hidden = false;
    dom.actionbar.hidden = true;
    dom.progressStrip.hidden = true;
    dom.topTitle.textContent = "随机出题";
    dom.topSub.textContent = "题库 " + (quiz.pool.length || 0) + " 题 · 每组 " + quiz.size + " 题";

    if (quiz.idx >= quiz.list.length) return renderQuizDone();

    var q = quiz.list[quiz.idx];
    if (q.self) return renderSelfQuiz(q);      // 简答自评题：看答案后自评
    if (q.multi) return renderMultiQuiz(q);    // 多选题：勾选后提交
    var fig = q.fig ? '<div class="q-fig"><img src="' + esc(q.fig) + '" alt="反应式"></div>' : "";
    var opts = q.opts.map(function (o, i) {
      var cls = "";
      if (quiz.picked >= 0) {
        if (o === q.opts[q.a]) cls = " right";
        else if (i === quiz.picked) cls = " wrong";
      }
      // 题干与选项都在图里时，选项只显示字母，避免「A A」重复
      var letterOnly = o === OPT_LETTERS.charAt(i);
      return '<button type="button" class="opt' + cls + (letterOnly ? " letter" : "") +
        '" data-opt="' + i + '"' + (quiz.picked >= 0 ? " disabled" : "") +
        '><span class="k">' + OPT_LETTERS.charAt(i) + "</span>" +
        (letterOnly ? "" : "<span>" + esc(o) + "</span>") + "</button>";
    }).join("");
    var ans = q.t.indexOf("判断") === 0 ? q.opts[q.a] : OPT_LETTERS.charAt(q.a);
    var explain = quiz.picked >= 0
      ? '<div class="q-explain"><b>' + (quiz.picked === q.a ? "回答正确" : "正确答案：" + ans) +
        "</b>" + esc(q.ex) + "</div>"
      : "";
    var filters = bankBackChip() + [["todayplan", "今日计划"], ["all", "全部"], ["organic", "有机化学"],
                   ["pharm", "药理学"], ["anal", "分析化学"], ["instrument", "仪器分析"]]
      .map(function (f) {
        return '<button type="button" class="chip' + (quiz.filter === f[0] ? " on" : "") +
          '" data-quizfilter="' + f[0] + '">' + f[1] + "</button>";
      }).join("");

    dom.viewQuiz.innerHTML = '<div class="inner">' +
      '<div class="quiz-head"><span class="q">第 ' + (quiz.idx + 1) + " / " + quiz.list.length +
      " 题　·　" + esc(q.t) + '</span><span class="s">答对 ' + quiz.right + "</span></div>" +
      '<div class="chip-row">' + filters + "</div>" +
      '<div class="card"><div class="page-body"><p class="q-stem">' + esc(q.stem) + "</p>" +
      fig + '<div class="opts">' + opts + "</div>" + explain + "</div></div>" +
      (quiz.picked >= 0 ? '<div class="opts" style="margin-top:16px"><button type="button" class="btn btn-primary" id="quizNext">' +
        (quiz.idx + 1 >= quiz.list.length ? "查看成绩" : "下一题 ›") + "</button></div>" : "") +
      "</div>";
    dom.viewQuiz.scrollTop = 0;
  }

  /* 简答自评题：先自己想，再点开参考答案，然后自评「记住了 / 没记住」 */
  function renderSelfQuiz(q) {
    var filters = bankBackChip() + [["todayplan", "今日计划"], ["all", "全部"], ["organic", "有机化学"],
                   ["pharm", "药理学"], ["anal", "分析化学"], ["instrument", "仪器分析"]]
      .map(function (f) {
        return '<button type="button" class="chip' + (quiz.filter === f[0] ? " on" : "") +
          '" data-quizfilter="' + f[0] + '">' + f[1] + "</button>";
      }).join("");
    var revealed = !!quiz.revealed;
    var graded = quiz.picked >= 0;
    var ansHtml = revealed
      ? '<div class="self-ans">' + (q.ans || []).map(function (x) {
          return "<p>" + esc(x) + "</p>";
        }).join("") + "</div>"
      : '<button type="button" class="btn btn-soft self-reveal" id="selfReveal">查看参考答案</button>';
    var tail = "";
    if (graded) {
      tail = '<div class="q-explain"><b>' +
        (quiz.picked === 0 ? "已掌握" : "已记入薄弱点") +
        "</b>参考答案见上，可在复习时回看本学科对应条目。</div>";
    } else if (revealed) {
      tail = '<div class="self-grade">' +
        '<button type="button" class="btn btn-soft" id="selfNo">没记住</button>' +
        '<button type="button" class="btn btn-primary" id="selfYes">记住了</button></div>';
    }
    dom.viewQuiz.innerHTML = '<div class="inner">' +
      '<div class="quiz-head"><span class="q">第 ' + (quiz.idx + 1) + " / " + quiz.list.length +
      " 题　·　" + esc(q.t) + '</span><span class="s">答对 ' + quiz.right + "</span></div>" +
      '<div class="chip-row">' + filters + "</div>" +
      '<div class="card"><div class="page-body">' +
      '<div class="self-tip">简答题：先自己复述一遍，再看参考答案自评</div>' +
      '<p class="q-stem">' + esc(q.stem) + "</p>" + ansHtml + tail +
      "</div></div>" +
      (graded ? '<div class="opts" style="margin-top:16px"><button type="button" class="btn btn-primary" id="quizNext">' +
        (quiz.idx + 1 >= quiz.list.length ? "查看成绩" : "下一题 ›") + "</button></div>" : "") +
      "</div>";
    dom.viewQuiz.scrollTop = 0;
  }

  function quizSelf(ok) {
    if (quiz.picked >= 0) return;
    var q = quiz.list[quiz.idx];
    quiz.picked = ok ? 0 : 1;
    quiz.results[quiz.idx] = !!ok;
    if (ok) {
      quiz.right += 1;
    } else {
      quiz.wrong.push(q);
      recordWeak(q);
    }
    renderQuiz();
  }

  /* 多选题：勾选任意几个选项后提交；少选、多选、错选都算错 */
  function renderMultiQuiz(q) {
    var ans = q.ans || [];
    var picked = quiz.picked >= 0;
    var filters = bankBackChip() + [["todayplan", "今日计划"], ["all", "全部"], ["organic", "有机化学"],
                   ["pharm", "药理学"], ["anal", "分析化学"], ["instrument", "仪器分析"]]
      .map(function (f) {
        return '<button type="button" class="chip' + (quiz.filter === f[0] ? " on" : "") +
          '" data-quizfilter="' + f[0] + '">' + f[1] + "</button>";
      }).join("");
    var opts = q.opts.map(function (o, i) {
      var on = quiz.sel.indexOf(i) >= 0;
      var cls = "opt multi" + (on ? " on" : "");
      if (picked) {
        if (ans.indexOf(i) >= 0) cls = "opt multi right";
        else if (on) cls = "opt multi wrong";
      }
      return '<button type="button" class="' + cls + '" data-mopt="' + i + '"' +
        (picked ? " disabled" : "") + '><span class="k">' + OPT_LETTERS.charAt(i) + "</span>" +
        "<span>" + esc(o) + "</span></button>";
    }).join("");
    var tail = picked
      ? '<div class="q-explain"><b>' + (quiz.results[quiz.idx] ? "回答正确" : "正确答案：" +
          ans.map(function (i) { return OPT_LETTERS.charAt(i); }).join("")) +
        "</b>" + esc(q.ex) + "</div>"
      : '<button type="button" class="btn btn-primary multi-submit" id="multiSubmit"' +
        (quiz.sel.length ? "" : " disabled") + ">提交答案（已选 " + quiz.sel.length +
        " 项）</button>";
    dom.viewQuiz.innerHTML = '<div class="inner">' +
      '<div class="quiz-head"><span class="q">第 ' + (quiz.idx + 1) + " / " + quiz.list.length +
      " 题　·　" + esc(q.t) + '</span><span class="s">答对 ' + quiz.right + "</span></div>" +
      '<div class="chip-row">' + filters + "</div>" +
      '<div class="card"><div class="page-body">' +
      '<div class="self-tip">多选题：选出所有正确选项后提交</div>' +
      '<p class="q-stem">' + esc(q.stem) + "</p>" +
      '<div class="opts">' + opts + "</div>" + tail + "</div></div>" +
      (picked ? '<div class="opts" style="margin-top:16px"><button type="button" class="btn btn-primary" id="quizNext">' +
        (quiz.idx + 1 >= quiz.list.length ? "查看成绩" : "下一题 ›") + "</button></div>" : "") +
      "</div>";
    dom.viewQuiz.scrollTop = 0;
  }

  function quizMultiToggle(i) {
    if (quiz.picked >= 0) return;
    var k = quiz.sel.indexOf(i);
    if (k >= 0) quiz.sel.splice(k, 1);
    else quiz.sel.push(i);
    renderQuiz();
  }

  function quizMultiSubmit() {
    if (quiz.picked >= 0 || !quiz.sel.length) return;
    var q = quiz.list[quiz.idx];
    var ans = (q.ans || []).slice().sort();
    var sel = quiz.sel.slice().sort();
    var ok = ans.length === sel.length && ans.every(function (v, i) { return v === sel[i]; });
    quiz.picked = 1;
    quiz.results[quiz.idx] = ok;
    if (ok) {
      quiz.right += 1;
    } else {
      quiz.wrong.push(q);
      recordWeak(q);
    }
    renderQuiz();
  }

  function subjMeta(id) {
    return SUBJECTS.filter(function (x) { return x.id === id; })[0] || { name: id, color: "var(--accent)" };
  }

  function reviewBtn(ref) {
    return '<button type="button" class="mini-btn" data-review="' + esc(ref) + '">去复习</button>';
  }

  function renderQuizDone() {
    var n = quiz.list.length;
    var right = quiz.right;
    var pct = n ? Math.round((right / n) * 100) : 0;

    // 分科正确率
    var bySub = {};
    quiz.list.forEach(function (q, i) {
      var b = bySub[q.s] || (bySub[q.s] = { c: 0, t: 0 });
      b.t++;
      if (quiz.results[i]) b.c++;
    });
    var subRows = Object.keys(bySub).map(function (k) {
      var b = bySub[k];
      var p = Math.round((b.c / b.t) * 100);
      return '<div class="stat-row"><span class="nm">' + esc(subjMeta(k).name) +
        '</span><span class="bar"><i style="width:' + p + "%;background:" +
        subjMeta(k).color + '"></i></span><em>' + b.c + "/" + b.t + "　" + p + "%</em></div>";
    }).join("");

    // 本组薄弱知识点（按错题数排序）
    var thisWeak = {};
    quiz.wrong.forEach(function (q) {
      if (!q.r) return;
      var e = thisWeak[q.r] || (thisWeak[q.r] = { n: 0, rn: q.rn, s: q.s });
      e.n++;
    });
    var weakList = Object.keys(thisWeak).map(function (k) {
      var e = thisWeak[k];
      e.ref = k;
      return e;
    }).sort(function (a, b) { return b.n - a.n; });

    var weakHtml = weakList.length
      ? weakList.map(function (e) {
          return '<div class="weak-item"><span class="dot" style="background:' +
            subjMeta(e.s).color + '"></span><span class="txt"><strong>' + esc(e.rn || e.ref) +
            "</strong><span>" + esc(subjMeta(e.s).name) + "　本组错 " + e.n + " 次</span></span>" +
            reviewBtn(e.ref) + "</div>";
        }).join("")
      : '<div class="weak-none">本组没有做错的知识点，掌握得很扎实。</div>';

    // 跨组累计反复出错（>=2 次）
    var all = loadWeak();
    var repeat = Object.keys(all).map(function (k) {
      return { ref: k, n: all[k].n, rn: all[k].rn, s: all[k].s };
    }).filter(function (e) { return e.n >= 2; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    var repeatHtml = repeat.length
      ? repeat.map(function (e) {
          return '<div class="weak-item"><span class="dot" style="background:' +
            subjMeta(e.s).color + '"></span><span class="txt"><strong>' + esc(e.rn || e.ref) +
            '</strong><span>' + esc(subjMeta(e.s).name) + "　累计错 " + e.n + " 次</span></span>" +
            reviewBtn(e.ref) + "</div>";
        }).join("")
      : '<div class="weak-none">暂无反复出错的知识点。</div>';

    // 错题清单
    var wrongHtml = quiz.wrong.length
      ? quiz.wrong.map(function (q) {
          return '<div class="wrong-item"><div class="q">' + esc(q.stem.replace(/\n/g, "　")) +
            '</div><div class="a">正确答案：' + esc(q.opts[q.a]) + "</div></div>";
        }).join("")
      : "";

    dom.viewQuiz.innerHTML = '<div class="inner">' +
      '<div class="card quiz-done"><div class="score">' + right + " / " + n +
      '</div><h2>正确率 ' + pct + "%</h2><p>" +
      (pct >= 90 ? "非常稳，可以换科目或加大题量了" :
        pct >= 70 ? "基本掌握，把下面的薄弱点再看一遍" : "薄弱点较多，建议先回卡片复习") +
      "</p></div>" +

      '<div class="card" style="margin-top:14px"><div class="page-body">' +
      '<div class="sec-title">分科正确率</div>' + subRows + "</div></div>" +

      '<div class="card" style="margin-top:14px"><div class="page-body">' +
      '<div class="sec-title">本组薄弱知识点' + (weakList.length ? "（按错题数排序）" : "") +
      "</div>" + weakHtml + "</div></div>" +

      '<div class="card" style="margin-top:14px"><div class="page-body">' +
      '<div class="sec-title">反复出错的知识点' +
      '<button type="button" class="mini-btn plain" id="quizClearWeak">清空记录</button>' +
      "</div>" + repeatHtml + "</div></div>" +

      (wrongHtml ? '<div class="card" style="margin-top:14px"><div class="page-body">' +
        '<div class="sec-title">本组错题回顾</div>' + wrongHtml + "</div></div>" : "") +

      '<div class="opts" style="margin-top:16px">' +
      (quiz.wrong.length ? '<button type="button" class="btn btn-primary" id="quizRetryWrong">' +
        "重练这 " + quiz.wrong.length + " 道错题</button>" : "") +
      '<button type="button" class="btn ' + (quiz.wrong.length ? "btn-ghost" : "btn-primary") +
      '" id="quizAgain">再出一组新题</button>' +
      '<button type="button" class="btn btn-ghost" id="quizHome">返回首页</button>' +
      "</div></div>";
  }

  function retryWrong() {
    if (!quiz.wrong.length) return;
    quiz.list = quiz.wrong.slice();
    quiz.idx = 0;
    quiz.right = 0;
    quiz.picked = -1;
    quiz.revealed = false;
    quiz.sel = [];
    quiz.results = [];
    quiz.wrong = [];
    renderQuiz();
  }

  function goReview(ref) {
    var sid = (ref || "").split("-")[0];
    var subj = getSubject(sid);
    if (subj) {
      applyScope(subj);
      var i = subj.items.map(function (x) { return x.id; }).indexOf(ref);
      openSubject(sid, { index: i >= 0 ? i : 0 });
    } else {
      openSubject(sid, { index: 0 });
    }
  }

  function quizPick(i) {
    if (quiz.picked >= 0) return;
    var q = quiz.list[quiz.idx];
    quiz.picked = i;
    var ok = i === q.a;
    quiz.results[quiz.idx] = ok;
    if (ok) {
      quiz.right += 1;
    } else {
      quiz.wrong.push(q);
      recordWeak(q);
    }
    renderQuiz();
  }

  function loadWeak() {
    try { return JSON.parse(localStorage.getItem(WEAK_KEY) || "{}"); } catch (e) { return {}; }
  }
  function recordWeak(q) {
    if (!q.r) return;
    var w = loadWeak();
    var e = w[q.r] || { n: 0 };
    e.n += 1;
    e.rn = q.rn;
    e.s = q.s;
    e.ts = Date.now();
    w[q.r] = e;
    try { localStorage.setItem(WEAK_KEY, JSON.stringify(w)); } catch (err) {}
  }

  function quizNext() {
    quiz.idx += 1;
    quiz.picked = -1;
    quiz.revealed = false;
    quiz.sel = [];
    renderQuiz();
  }

  /* ---------------- 云端同步 ---------------- */
  var syncTimer = null;
  var syncing = false;

  function saveWeak(w) {
    try { localStorage.setItem(WEAK_KEY, JSON.stringify(w)); } catch (e) {}
  }
  function setSyncStatus(t) {
    var el = $("syncStatus");
    if (el) el.textContent = t;
  }
  function apiGet(code) {
    return fetch(fnUrl("sync") + "?code=" + encodeURIComponent(code), {
      cache: "no-store",
      headers: authHeaders()
    }).then(function (r) { return r.json(); });
  }
  function apiPost(code, data) {
    return fetch(fnUrl("sync"), {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ code: code, data: data })
    }).then(function (r) { return r.json(); });
  }

  function mergeProgress(local, remote) {
    var out = {};
    [local || {}, remote || {}].forEach(function (src) {
      Object.keys(src).forEach(function (k) {
        var a = out[k], b = src[k] || {};
        if (!a) {
          out[k] = {
            done: Object.assign({}, b.done || {}),
            current: b.current || null, at: b.at || 0, ts: b.ts || 0
          };
          return;
        }
        var done = {};
        Object.keys(a.done || {}).forEach(function (d) { done[d] = 1; });
        Object.keys(b.done || {}).forEach(function (d) { done[d] = 1; });
        var newer = (b.ts || 0) > (a.ts || 0) ? b : a;
        out[k] = {
          done: done, current: newer.current || null,
          at: newer.at || 0, ts: Math.max(a.ts || 0, b.ts || 0)
        };
      });
    });
    return out;
  }

  function mergeWeak(local, remote) {
    var out = {};
    Object.keys(local || {}).forEach(function (k) { out[k] = Object.assign({}, local[k]); });
    Object.keys(remote || {}).forEach(function (k) {
      var a = out[k], b = remote[k] || {};
      if (!a) { out[k] = Object.assign({}, b); return; }
      out[k] = {
        n: Math.max(a.n || 0, b.n || 0),
        rn: b.rn || a.rn, s: b.s || a.s,
        ts: Math.max(a.ts || 0, b.ts || 0)
      };
    });
    return out;
  }

  function scheduleSync() {
    if (!state.syncCode || syncing) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow(true); }, 2500);
  }

  function syncNow(silent) {
    var code = state.syncCode;
    if (!code || syncing) return Promise.resolve();
    syncing = true;
    if (!silent) setSyncStatus("同步中…");
    return apiGet(code).then(function (res) {
      if (res && res.ok && res.data) {
        progress = mergeProgress(progress, res.data.progress || {});
        saveWeak(mergeWeak(loadWeak(), res.data.weak || {}));
        var rp = res.data.plan;
        if (rp && rp.ids && (rp.ts || 0) > (state.plan.ts || 0)) {
          state.plan = rp;
          try { localStorage.setItem(PLAN_KEY, JSON.stringify(rp)); } catch (e) {}
          renderPlanPanel();
        }
        saveProgressRaw();
      }
      return apiPost(code, { progress: progress, weak: loadWeak(), plan: state.plan });
    }).then(function () {
      syncing = false;
      setSyncStatus("上次同步：" + new Date().toLocaleTimeString().slice(0, 5) +
        "　进度 " + Object.keys(progress).length + " 科");
      renderSidebar();
      if (dom.viewHome.hidden === false) renderHome();
      if (!silent) toast("已同步");
    }).catch(function () {
      syncing = false;
      setSyncStatus("同步失败，请检查网络后重试");
      if (!silent) toast("同步失败");
    });
  }

  function newSyncCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "";
    for (var i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }

  function enableSync(code) {
    state.syncCode = code;
    try { localStorage.setItem(SYNC_KEY, code); } catch (e) {}
    renderSync();
    syncNow(false);
  }

  function renderSync() {
    if (!dom.syncBody) return;
    if (!state.syncCode) {
      dom.syncBody.innerHTML =
        '<input id="syncInput" class="sync-input" placeholder="输入同步码" maxlength="16" ' +
        'autocapitalize="characters" autocomplete="off" spellcheck="false">' +
        '<div class="sync-actions">' +
        '<button type="button" class="ghost-btn" id="syncJoin">用此同步码开启同步</button>' +
        '<button type="button" class="ghost-btn" id="syncNew">生成一个新同步码</button>' +
        "</div>" +
        '<div class="sync-status">在手机和 Mac 上填同一个同步码，两边的学习进度与错题记录就会互通。</div>';
    } else {
      dom.syncBody.innerHTML =
        '<div class="sync-code"><span>' + esc(state.syncCode) + "</span><em>同步码</em></div>" +
        '<div class="sync-actions">' +
        '<button type="button" class="ghost-btn" id="syncCopy">复制同步码</button>' +
        '<button type="button" class="ghost-btn" id="syncNow">立即同步</button>' +
        '<button type="button" class="ghost-btn" id="syncOff">关闭同步</button>' +
        "</div>" +
        '<div class="sync-status" id="syncStatus">正在同步…</div>';
    }
  }

  /* ---------------- 今日计划（对接「考试复习计划生成器」） ---------------- */
  var PLAN_URL = "https://kctrnmiupuwuxqtqxqni.supabase.co";
  var PLAN_ANON = "sb_publishable_zSCDdhBA1kw2IRksxGZXaw_XAtsZFbb";
  var PLAN_AUTH_KEY = "study3.plan.auth";
  var PLAN_PREFIX = { organic: "org", pharm: "pha", anal: "an" };

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function planIsToday() {
    var p = state.plan || {};
    return !!(p.date === todayISO() &&
      ((p.ids && p.ids.length) || (p.rev && p.rev.length) ||
        (p.cover && p.cover.length)));
  }

  function planIdsFor(subjId) {
    if (!planIsToday()) return [];
    var pre = PLAN_PREFIX[subjId];
    return state.plan.ids.filter(function (u) { return u.indexOf(pre) === 0; });
  }

  /* 今日计划全部涉及章节 = 新学 + 到期回顾 + 三科补位 */
  function planUnits() {
    var p = state.plan || {};
    return (p.ids || [])
      .concat((p.rev || []).map(function (r) { return r.id; }))
      .concat((p.cover || []).map(function (c) { return c.id; }));
  }

  function planFocusIds(subjId) {
    if (!planIsToday()) return [];
    var pre = PLAN_PREFIX[subjId];
    return planUnits().filter(function (u) { return u.indexOf(pre) === 0; });
  }

  function subjOfUnit(uid) {
    return uid.indexOf("org") === 0 ? "organic" :
      uid.indexOf("pha") === 0 ? "pharm" : "anal";
  }

  function isoAdd(iso, n) {
    var p = iso.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function isoDiff(a, b) {
    var pa = a.split("-"), pb = b.split("-");
    var da = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    var db = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    return Math.round((db - da) / 86400000);
  }

  /* 遗忘曲线：首轮精学当天起 1/2/4/7/15/30/45/60/75/90 天各回顾一次，
     已在计划应用里勾掉（reviewDone 的 id#轮次）的不再重复出现。
     算法与「349 复习计划」保持一致，保证两个应用的今日任务对得上。 */
  var REVIEW_OFFS = [1, 2, 4, 7, 15, 30, 45, 60, 75, 90];

  function computeReview(st, iso) {
    var out = [], r1 = (st && st.r1) || {}, done = (st && st.reviewDone) || {};
    Object.keys(r1).forEach(function (id) {
      REVIEW_OFFS.forEach(function (off, i) {
        var k = id + "#" + (i + 1);
        if (done[k]) return;
        var due = isoAdd(r1[id], off);
        if (isoDiff(due, iso) >= 0) {
          out.push({ id: id, cycle: i + 1, overdue: Math.max(0, isoDiff(due, iso)) });
        }
      });
    });
    out.sort(function (a, b) {
      if (a.overdue !== b.overdue) return b.overdue - a.overdue;
      return a.cycle - b.cycle;
    });
    return out;
  }

  /* 三科全勤：当天某科既没有新学也没有到期回顾时，补一条轻量任务 —
     学过的回看最近一章，完全没学过的预习该科下一章。 */
  function computeCover(st, ids, rev) {
    var has = {};
    ids.concat(rev.map(function (r) { return r.id; })).forEach(function (u) {
      has[subjOfUnit(u)] = 1;
    });
    var out = [], r1 = (st && st.r1) || {};
    SUBJECTS.forEach(function (m) {
      if (has[m.id]) return;
      var subj = getSubject(m.id);
      if (!subj || !subj.units) return;
      var last = "", lastDate = "";
      subj.units.forEach(function (u) {
        var d = r1[u[0]];
        if (d && d > lastDate) { lastDate = d; last = u[0]; }
      });
      if (last) { out.push({ id: last, kind: "back" }); return; }
      var next = subj.units.filter(function (u) { return !r1[u[0]]; })[0];
      if (next) out.push({ id: next[0], kind: "preview" });
    });
    return out;
  }

  /* 由云端计划应用的状态对象组装出「今天的完整清单」 */
  function buildDayPlan(st, iso) {
    var ids = (st.daySnap && st.daySnap.date === iso && st.daySnap.ids) || [];
    ids = ids.filter(function (id) { return !(st.skip && st.skip[id]); });
    var rev = computeReview(st, iso);
    return { ids: ids.slice(), rev: rev, cover: computeCover(st, ids, rev) };
  }

  function todayRefSet() {
    var set = {};
    if (!planIsToday()) return set;
    SUBJECTS.forEach(function (m) {
      var subj = getSubject(m.id);
      if (!subj || !subj.items) return;
      var ids = planFocusIds(m.id);
      if (!ids.length) return;
      subj.items.forEach(function (x) {
        if (ids.indexOf(x.unit) >= 0) set[x.id] = 1;
      });
    });
    return set;
  }

  function savePlan() {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(state.plan)); } catch (e) {}
    scheduleSync();
  }

  function setPlanStatus(t) {
    var el = $("planStatus");
    if (el) el.textContent = t;
  }

  function unitName(subjId, uid) {
    var subj = getSubject(subjId);
    if (!subj) return uid;
    var u = (subj.units || []).filter(function (x) { return x[0] === uid; })[0];
    return u ? u[1] + " " + u[2] : uid;
  }

  function unitNameAny(uid) {
    var id = uid.indexOf("org") === 0 ? "organic" : uid.indexOf("pha") === 0 ? "pharm" : "anal";
    return unitName(id, uid);
  }

  /* --- Supabase 登录与读取（只读计划，不动计划项目的数据） --- */
  function planAuth(body, path) {
    return fetch(PLAN_URL + "/auth/v1" + path, {
      method: "POST",
      headers: { "apikey": PLAN_ANON, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.msg || j.error_description || j.message || ("HTTP " + r.status));
        return j;
      });
    });
  }

  function planSession() {
    try { return JSON.parse(localStorage.getItem(PLAN_AUTH_KEY) || "null"); } catch (e) { return null; }
  }

  function planToken() {
    var s = planSession();
    if (!s) return Promise.reject(new Error("请先连接复习计划"));
    if (s.token && s.exp && Date.now() < s.exp - 60000) return Promise.resolve(s.token);
    return planAuth({ refresh_token: s.refresh }, "/token?grant_type=refresh_token")
      .then(function (j) {
        savePlanSession(j, s.email);
        return j.access_token;
      });
  }

  function savePlanSession(j, email) {
    var s = {
      email: email || (planSession() || {}).email || "",
      token: j.access_token, refresh: j.refresh_token || (planSession() || {}).refresh || "",
      exp: Date.now() + (j.expires_in || 3600) * 1000
    };
    try { localStorage.setItem(PLAN_AUTH_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function planConnect(email, pwd) {
    setPlanStatus("正在连接复习计划…");
    return planAuth({ email: email, password: pwd }, "/token?grant_type=password")
      .then(function (j) {
        savePlanSession(j, email);
        return pullPlan();
      })
      .catch(function (e) {
        setPlanStatus("连接失败：" + (e && e.message ? e.message : "请检查账号密码"));
        toast("连接复习计划失败");
        return false;
      });
  }

  function pullPlan() {
    return planToken().then(function (token) {
      return fetch(PLAN_URL + "/rest/v1/progress?select=id,st,updated_at&limit=1", {
        headers: { "apikey": PLAN_ANON, "Authorization": "Bearer " + token }
      }).then(function (r) { return r.json(); });
    }).then(function (rows) {
      var row = Array.isArray(rows) && rows[0];
      if (!row || !row.st) throw new Error("云端暂无计划数据");
      var snap = row.st.daySnap || null;
      var iso = todayISO();
      if (!snap || !snap.ids || !snap.ids.length) {
        setPlanStatus("计划里还没有生成清单，去计划应用打开一次即可");
        return false;
      }
      // 新学清单可能生成于更早的日期；回顾按「今天」实时推算，不依赖快照日期
      var built = buildDayPlan(row.st, iso);
      if (!built.ids.length && !built.rev.length && !built.cover.length) {
        setPlanStatus("今日没有待办章节，可手动勾选想学的章节");
        return false;
      }
      if (snap.date !== iso) {
        setPlanStatus("新学清单生成于 " + snap.date + "，回顾已按今天重新推算");
      } else {
        setPlanStatus("已同步今日计划（与计划应用一致）");
      }
      state.plan = {
        date: iso, ids: built.ids, rev: built.rev, cover: built.cover,
        src: "cloud", snapDate: snap.date, ts: Date.now()
      };
      savePlan();
      renderPlanPanel();
      renderSidebar();
      if (state.subjectId) renderStudy();
      toast("今日计划：" + built.ids.length + " 新学 · " + built.rev.length + " 回顾");
      return true;
    });
  }

  /* --- 章节多选（手动指定，无需登录） --- */
  function openUnitPicker() {
    var rows = "";
    SUBJECTS.forEach(function (m) {
      var subj = getSubject(m.id);
      if (!subj || !subj.units) return;
      var cur = planIdsFor(m.id);
      rows += '<div class="sch-group">' + esc(m.name) + "</div>";
      rows += subj.units.map(function (u) {
        var cnt = subj.items.filter(function (x) { return x.unit === u[0]; }).length;
        var on = cur.indexOf(u[0]) >= 0;
        return '<button type="button" class="sch-item' + (on ? " on" : "") +
          '" data-unit="' + u[0] + '"><span class="u">' + esc(u[1]) + "</span>" +
          "<span>" + esc(u[2]) + "</span><em>" + cnt + " 条</em></button>";
      }).join("");
    });
    $("schList").innerHTML = rows;
    $("schOverlay").hidden = false;
  }

  function closeUnitPicker() { $("schOverlay").hidden = true; }

  function toggleUnit(uid) {
    var p = state.plan || { date: todayISO(), ids: [], src: "manual", ts: 0 };
    if (p.date !== todayISO()) { p = { date: todayISO(), ids: [], src: "manual", ts: 0 }; }
    var i = p.ids.indexOf(uid);
    if (i >= 0) p.ids.splice(i, 1); else p.ids.push(uid);
    p.src = "manual";
    p.ts = Date.now();
    state.plan = p;
    savePlan();
    renderPlanPanel();
    renderSidebar();
    var btn = $("schList").querySelector('[data-unit="' + uid + '"]');
    if (btn) btn.classList.toggle("on");
    if (state.subjectId) renderStudy();
  }

  function clearPlan() {
    state.plan = { date: todayISO(), ids: [], src: "manual", ts: Date.now() };
    savePlan();
    renderPlanPanel();
    renderSidebar();
    if (state.subjectId) renderStudy();
    toast("已清空今日计划");
  }

  function planChip(uid, tag, extraCls) {
    var sid = subjOfUnit(uid);
    return '<button type="button" class="plan-chip' + (extraCls || "") +
      '" data-unit-go="' + uid + '">' + (tag ? '<i class="plan-tag">' + esc(tag) + "</i>" : "") +
      esc(unitName(sid, uid)) + "</button>";
  }

  function renderPlanPanel() {
    var box = $("planBody");
    if (!box) return;
    var on = planIsToday();
    var body = "";
    if (on) {
      var p = state.plan;
      var rev = p.rev || [], cover = p.cover || [];
      var total = (p.ids || []).length + rev.length + cover.length;
      // 按科目分组，和计划应用的「今日任务」一一对应
      var groups = "";
      SUBJECTS.forEach(function (m) {
        var ids = (p.ids || []).filter(function (u) { return subjOfUnit(u) === m.id; });
        var rv = rev.filter(function (r) { return subjOfUnit(r.id) === m.id; });
        var cv = cover.filter(function (c) { return subjOfUnit(c.id) === m.id; });
        if (!ids.length && !rv.length && !cv.length) return;
        var items = ids.map(function (u) { return planChip(u, "新学"); });
        rv.forEach(function (r) {
          var tag = "回顾" + r.cycle + (r.overdue ? "·欠" + r.overdue + "天" : "");
          items.push(planChip(r.id, tag, r.overdue ? " late" : ""));
        });
        cv.forEach(function (c) {
          items.push(planChip(c.id, c.kind === "back" ? "回看" : "预习", " soft"));
        });
        groups += '<div class="plan-group"><div class="plan-group-head">' +
          '<span class="pg-dot ' + m.id + '"></span>' + esc(m.name) +
          '<em>' + items.length + "</em></div>" +
          '<div class="plan-chips">' + items.join("") + "</div></div>";
      });
      body =
        '<div class="plan-today"><span class="d">今日 ' + esc(p.date.slice(5)) +
        '</span><span class="n">' + total + " 项</span></div>" +
        '<div class="plan-groups">' + groups + "</div>" +
        '<div class="plan-legend">新学 ' + (p.ids || []).length + " · 回顾 " + rev.length +
        (cover.length ? " · 补位 " + cover.length : "") + "</div>";
    } else {
      body = '<div class="sync-status">今日还没有计划，可从计划应用同步，或手动勾选章节。</div>';
    }
    var s = planSession();
    box.innerHTML = body +
      '<div class="sync-actions">' +
      (s ? '<button type="button" class="ghost-btn" id="planRefresh">同步计划（' +
        esc(s.email || "已连接") + "）</button>"
        : '<button type="button" class="ghost-btn" id="planLoginBtn">连接复习计划生成器</button>') +
      '<button type="button" class="ghost-btn" id="planPick">手动选择今日章节</button>' +
      (on ? '<button type="button" class="ghost-btn" id="planClear">清空今日计划</button>' : "") +
      "</div>" +
      '<div class="sync-status" id="planStatus">' +
      (on ? "进入科目时，今日章节的题目会排在最前。" : "连接后自动读取每日计划，无需手动维护。") +
      "</div>";
  }

  function goUnit(uid) {
    var sid = uid.indexOf("org") === 0 ? "organic" : uid.indexOf("pha") === 0 ? "pharm" : "anal";
    var subj = getSubject(sid);
    if (!subj) { openSubject(sid, { index: 0 }); return; }
    applyScope(subj);
    var i = subj.items.map(function (x) { return x.unit; }).indexOf(uid);
    closeSidebar();
    openSubject(sid, { index: i >= 0 ? i : 0 });
  }

  /* ---------------- 全局事件 ---------------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;

    if (t && t.dataset.subject) { openSubject(t.dataset.subject); return; }
    if (t && t.dataset.go) {
      var idx = parseInt(t.dataset.index, 10);
      closeSearch();
      openSubject(t.dataset.go, { index: idx });
      return;
    }
    if (t && t.dataset.unitGo) { closeUnitPicker(); goUnit(t.dataset.unitGo); return; }
    if (t && t.dataset.unit) { toggleUnit(t.dataset.unit); return; }
    if (t && t.dataset.review) { goReview(t.dataset.review); return; }
    if (t && t.dataset.mopt !== undefined) { quizMultiToggle(parseInt(t.dataset.mopt, 10)); return; }
    if (t && t.dataset.opt !== undefined) { quizPick(parseInt(t.dataset.opt, 10)); return; }
    if (t && t.dataset.quizfilter) { startQuiz(t.dataset.quizfilter); return; }
    if (t && t.dataset.quizSubj) { quiz.filter = t.dataset.quizSubj; startQuiz(); return; }
    if (t && t.dataset.module) {
      var subj = currentSubject();
      if (subj) {
        var i = subj.items.map(function (x) { return x.module; }).indexOf(t.dataset.module);
        if (i >= 0) {
          closeSidebar();
          state.index = i; state.page = 0; state.confirmed = false;
          state.unlocked = false; state.finished = false;
          renderStudy();
          dom.viewStudy.scrollTop = 0;
        }
      }
      return;
    }
    if (!t) return;
    switch (t.id) {
      case "navPrev": navStep(-1); break;
      case "navNext": navStep(1); break;
      case "bankHome": openQuizHome(); break;
      case "multiSubmit": quizMultiSubmit(); break;
      case "selfReveal": quiz.revealed = true; renderQuiz(); break;
      case "selfYes": quizSelf(true); break;
      case "selfNo": quizSelf(false); break;
      case "quizNext": quizNext(); break;
      case "quizAgain": startQuiz(); break;
      case "quizHome": goHome(); break;
      case "planLoginBtn":
        $("planLogin").hidden = false;
        setTimeout(function () { var e = $("planEmail"); if (e) e.focus(); }, 80);
        break;
      case "planLoginClose": $("planLogin").hidden = true; break;
      case "planLoginGo": {
        var em = ($("planEmail") || {}).value || "";
        var pw = ($("planPwd") || {}).value || "";
        if (!em || !pw) { toast("请填写邮箱和密码"); break; }
        planConnect(em.trim(), pw).then(function () { $("planLogin").hidden = true; });
        break;
      }
      case "planRefresh": pullPlan(); break;
      case "planPick": closeSidebar(); openUnitPicker(); break;
      case "planClear": clearPlan(); break;
      case "schClose": closeUnitPicker(); break;
      case "syncJoin": {
        var el = $("syncInput");
        var c = (el && el.value || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{6,16}$/.test(c)) { toast("请输入 6–16 位同步码"); break; }
        enableSync(c);
        break;
      }
      case "syncNew": enableSync(newSyncCode()); break;
      case "syncCopy":
        if (state.syncCode) {
          var okCopy = function () { toast("同步码已复制：" + state.syncCode); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(state.syncCode).then(okCopy, okCopy);
          } else { okCopy(); }
        }
        break;
      case "syncNow": syncNow(false); break;
      case "syncOff":
        state.syncCode = "";
        try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
        renderSync();
        toast("已关闭同步，本机数据保留");
        break;
      case "quizRetryWrong": retryWrong(); break;
      case "quizClearWeak":
        try { localStorage.removeItem(WEAK_KEY); } catch (e) {}
        toast("已清空薄弱知识点记录");
        renderQuizDone();
        break;
      case "restartBtn":
        state.index = 0; state.page = 0; state.confirmed = false;
        state.unlocked = false; state.finished = false;
        renderStudy(); dom.viewStudy.scrollTop = 0;
        break;
      case "backHomeBtn": goHome(); break;
    }
  });

  $("menuBtn").addEventListener("click", openSidebar);
  dom.scrim.addEventListener("click", closeSidebar);
  dom.themeBtn.addEventListener("click", cycleTheme);
  if (dom.scopeBtn) dom.scopeBtn.addEventListener("click", toggleScope);
  if (dom.quizBtn) dom.quizBtn.addEventListener("click", function () { openQuizHome(); });

  /* ---------------- 安装到桌面 / 主屏幕 ---------------- */
  var installEvent = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installEvent = e;
    var b = $("installBtn");
    if (b) b.hidden = false;
  });
  var ib = $("installBtn");
  if (ib) {
    ib.addEventListener("click", function () {
      if (installEvent) {
        installEvent.prompt();
        installEvent = null;
        ib.hidden = true;
      } else {
        toast("iPhone：Safari 分享按钮 → 添加到主屏幕");
      }
    });
  }

  /* ---------------- Service Worker（离线可用，需 https 或 localhost） ---------------- */
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || location.hostname === "localhost" ||
       location.hostname === "127.0.0.1")) {
    window.addEventListener("load", function () {
      // 带版本号注册 + updateViaCache:"none"：
      // 1) URL 变化可绕过 CDN / 浏览器的旧缓存；
      // 2) 浏览器定期更新检查时也强制回源，避免长期停留在旧版 Service Worker。
      navigator.serviceWorker.register("sw.js?v=26", { updateViaCache: "none" })
        .then(function (reg) { if (reg && reg.update) reg.update(); })
        .catch(function () {});
    });
  }
  $("resetBtn").addEventListener("click", function () {
    if (!confirm("确定清空三科全部学习进度？该操作不可恢复。")) return;
    progress = {};
    saveProgress();
    toast("已清空进度");
    if (state.subjectId) openSubject(state.subjectId, { index: 0 }); else renderHome();
    renderSidebar();
  });
  $("searchBtn").addEventListener("click", openSearch);
  $("searchClose").addEventListener("click", closeSearch);
  dom.searchInput.addEventListener("input", function () {
    searchQuery = dom.searchInput.value;
    renderSearch();
  });
  dom.searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSearch();
  });

  dom.viewStudy.addEventListener("scroll", checkScroll, { passive: true });
  window.addEventListener("resize", checkScroll);

  document.addEventListener("keydown", function (e) {
    if (!dom.searchOverlay.hidden) return;
    if (!state.subjectId || state.finished) return;
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navStep(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      navStep(-1);
    }
  });

  /* ---------------- 启动（支持 #/科目/序号 深链） ---------------- */
  applyTheme();

  function applyHash() {
    var m = /^#\/([a-z]+)(?:\/(\d+))?$/.exec(location.hash || "");
    if (m && SUBJECTS.some(function (s) { return s.id === m[1]; })) {
      openSubject(m[1], m[2] ? { index: parseInt(m[2], 10) - 1 } : undefined);
    } else {
      goHome();
    }
  }

  window.addEventListener("hashchange", applyHash);

  // 登录通过后执行主体初始化（数据文件需携带 token 才能加载）
  function boot() {
    applyHash();
    // 后台预加载三科，完成后刷新条目数 / 筛选 / 首页（首屏已在骨架阶段渲染，无需等待）
    loadAll().then(function () {
      SUBJECTS.forEach(function (s) { applyScope(getSubject(s.id)); });
      renderSidebar();
      if (!state.subjectId) renderHome();
    });
    loadQuiz().then(function (all) {
      if (dom.quizTotal && all && all.length) dom.quizTotal.textContent = all.length + " 题";
    });
    if (state.syncCode) setTimeout(function () { syncNow(true); }, 800);
    if (planSession() && !planIsToday()) {
      setTimeout(function () { pullPlan().catch(function () {}); }, 1500);
    }
  }

  // 立即渲染首屏骨架：首页/侧边栏用静态条目数即可渲染，不依赖数据文件，
  // 消除「等待登录校验 + 下载大体积数据」造成的白屏。
  function renderSkeleton() {
    renderScopeBtn();
    var m = /^#\/([a-z]+)(?:\/(\d+))?$/.exec(location.hash || "");
    if (!m) {
      renderSidebar();
      renderHome();
      renderPlanPanel();
      renderSync();
    }
  }

  bindAuthLogin();
  renderSkeleton();
  authGuard().then(function (ok) { if (ok) boot(); });
})();
