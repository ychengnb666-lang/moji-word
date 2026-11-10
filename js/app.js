/* ============================================================
   墨记单词 · 交互层
   ============================================================ */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var Store = window.Store;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function todayLabel() {
    var d = new Date();
    var w = "日一二三四五六".charAt(d.getDay());
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 · 周" + w;
  }
  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return "夜深了";
    if (h < 9) return "早上好";
    if (h < 12) return "上午好";
    if (h < 14) return "中午好";
    if (h < 18) return "下午好";
    return "晚上好";
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  window.App = {
    toast: toast,
    speak: speak,
    go: go,
    openSheet: openSheet,
    refreshAll: refreshAll
  };

  /* ---------------- 主题 ---------------- */
  function prefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function applyTheme() {
    var mode = Store.getSettings().theme;
    var dark = mode === "dark" || (mode === "auto" && prefersDark());
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var use = $("#btn-theme use");
    if (use) use.setAttribute("href", dark ? "#i-moon" : "#i-sun");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0F1311" : "#F4F1E8");
  }

  /* ---------------- 语音 ---------------- */
  var voices = [];
  function loadVoices() {
    if (!window.speechSynthesis) return;
    voices = window.speechSynthesis.getVoices() || [];
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  function speak(text) {
    if (!window.speechSynthesis) { toast("当前浏览器不支持语音朗读"); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text));
    var accent = Store.getSettings().accent;
    u.lang = accent;
    u.rate = 0.88;
    var v = voices.filter(function (x) { return x.lang === accent; })[0] ||
            voices.filter(function (x) { return /^en/i.test(x.lang); })[0];
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }

  /* ---------------- 视图切换 ---------------- */
  var currentView = "home";
  function go(view) {
    currentView = view;
    $$(".view").forEach(function (v) {
      v.classList.toggle("is-active", v.id === "view-" + view);
    });
    $$(".tab").forEach(function (t) {
      t.classList.toggle("is-active", t.getAttribute("data-view") === view);
    });
    window.scrollTo({ top: 0, behavior: "auto" });
    var mainEl = $(".main");
    if (mainEl) mainEl.scrollTop = 0;
    if (view === "home") renderHome();
    if (view === "books") renderBooks();
    if (view === "quiz" && window.Quiz) window.Quiz.render();
    if (view === "video" && window.Video) window.Video.render();
    if (view === "sentences") renderSentences();
    if (view === "me") renderMe();
  }

  /* ---------------- 今日 ---------------- */
  function renderHome() {
    var book = Store.currentBook();
    if (!book) return;
    var info = Store.todayInfo(book.id);
    var done = info.done;
    var plan = done + info.due + info.newLeft;
    var pct = plan ? Math.min(1, done / plan) : (done ? 1 : 0);

    $("#hello-date").textContent = todayLabel();
    $("#hello-title").textContent = greeting();
    var learnedToday = info.day.words ? info.day.words.length : 0;
    $("#hello-sub").textContent = learnedToday
      ? "今天已经记了 " + learnedToday + " 个词，保持这个节奏。"
      : "今天也来记几个词吧。";

    $("#home-done").textContent = done;
    $("#home-plan").textContent = plan;
    $("#home-book").textContent = book.name + " · 共 " + book.words.length + " 词";
    $("#home-new").textContent = info.newLeft;
    $("#home-due").textContent = info.due;
    $("#home-streak").textContent = Store.checkinStreak();
    $("#home-ring-pct").textContent = Math.round(pct * 100) + "%";

    var ring = $("#ring-fg");
    var C = 2 * Math.PI * 50;
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C * (1 - pct);

    var startBtn = $("#btn-start");
    var remaining = info.due + info.newLeft;
    if (remaining === 0) {
      startBtn.textContent = "今日已完成";
      startBtn.disabled = true;
    } else {
      startBtn.textContent = info.due > 0 ? "开始复习" : "开始学习";
      startBtn.disabled = false;
    }

    var sStats = Store.sentenceStats();
    $("#quick-review-sub").textContent = info.due ? info.due + " 个待复习" : "今天没有待复习";
    $("#quick-sentence-sub").textContent = sStats.done + " / " + sStats.total + " 已掌握";

    renderCheckin();
    var heatDays = (window.matchMedia && window.matchMedia("(min-width:900px) and (min-height:520px) and (orientation:landscape)").matches) ? 364 : 84;
    renderHeatmap($("#heatmap"), heatDays);
    $("#heat-total").textContent = "共 " + Store.activeDays() + " 天";

    var todayCard = $("#today-card");
    var ws = info.day.words || [];
    if (ws.length) {
      todayCard.hidden = false;
      $("#today-count").textContent = ws.length + " 个";
      $("#today-chips").innerHTML = ws.slice(0, 40).map(function (w) {
        return '<button class="chip" data-word="' + esc(w) + '"><b>' + esc(w) + "</b></button>";
      }).join("");
    } else {
      todayCard.hidden = true;
    }
  }

  function renderHeatmap(container, days) {
    if (!container) return;
    var data = Store.heatmap(days);
    var html = "";
    data.forEach(function (d) {
      var lv = d.n === 0 ? 0 : d.n < 8 ? 1 : d.n < 20 ? 2 : d.n < 45 ? 3 : 4;
      html += '<i class="lv' + lv + (d.today ? " today" : "") + '" title="' + d.key + " · " + d.n + ' 词"></i>';
    });
    container.innerHTML = html;
  }

  /* ---------------- 打卡 ---------------- */

  function renderCheckin() {
    var card = $("#checkin-card");
    if (!card) return;
    var checked = Store.checkedIn();
    var streak = Store.checkinStreak();
    var total = Store.checkinTotal();
    var words = Store.todayWords();

    $("#checkin-streak").textContent = streak;

    if (checked) {
      $("#checkin-hint").textContent = "今天已打卡 · 累计 " + total + " 天";
    } else if (words > 0) {
      $("#checkin-hint").textContent = "今天学了 " + words + " 个词，打个卡吧";
    } else {
      $("#checkin-hint").textContent = "先学几个词，就能打卡了";
    }

    card.classList.toggle("is-done", checked);
    var btn = $("#btn-checkin");
    btn.classList.toggle("is-done", checked);
    btn.classList.toggle("is-locked", !checked && words === 0);
    btn.disabled = checked;
    btn.textContent = checked ? "已打卡" : "今日打卡";

    $("#checkin-week").innerHTML = Store.checkinWeek().map(function (d) {
      return '<span class="cw' + (d.checked ? " is-on" : "") + (d.today ? " is-today" : "") +
          '" title="' + d.key + (d.words ? " · " + d.words + " 词" : "") + '">' +
        "<i>" + d.label + "</i>" +
        "<b>" + (d.checked ? '<svg class="ic"><use href="#i-check"></use></svg>' : "") + "</b>" +
      "</span>";
    }).join("");
  }

  function doCheckIn() {
    var r = Store.checkIn();
    if (!r.ok) {
      toast(r.reason === "done" ? "今天已经打过卡了" : "先学几个词再来打卡吧");
      return;
    }
    toast("打卡成功 · 连续 " + r.streak + " 天");
    var card = $("#checkin-card");
    if (card) {
      card.classList.add("just-checked");
      setTimeout(function () { card.classList.remove("just-checked"); }, 700);
    }
    renderHome();
    renderMe();
    renderDoneCheckin();
  }

  function renderDoneCheckin() {
    var btn = $("#btn-done-checkin");
    if (!btn) return;
    var checked = Store.checkedIn();
    var words = Store.todayWords();
    if (checked) {
      btn.hidden = true;
      $("#done-checkin-sub").textContent = "今天已打卡 · 连续 " + Store.checkinStreak() + " 天";
    } else if (words > 0) {
      btn.hidden = false;
      btn.textContent = "打卡 · 记录今天";
      $("#done-checkin-sub").textContent = "今天已学 " + words + " 个词";
    } else {
      btn.hidden = true;
      $("#done-checkin-sub").textContent = "";
    }
  }

  /* ---------------- 打卡日历 ---------------- */

  var calCursor = new Date();

  function renderCalendar() {
    var grid = $("#cal-grid");
    if (!grid) return;
    var y = calCursor.getFullYear();
    var m = calCursor.getMonth();
    $("#cal-title").textContent = y + "年" + (m + 1) + "月";
    $("#cal-total").textContent = "累计 " + Store.checkinTotal() + " 天";

    grid.innerHTML = Store.checkinMonth(y, m).map(function (c) {
      if (!c) return '<span class="cal-cell is-blank"></span>';
      var cls = "cal-cell" + (c.checked ? " is-on" : "") +
        (c.today ? " is-today" : "") + (c.words > 0 ? " has-study" : "");
      return '<span class="' + cls + '" title="' + c.key +
        (c.words ? " · " + c.words + " 词" : "") + '">' +
        "<b>" + c.day + "</b>" +
        (c.checked ? '<svg class="ic"><use href="#i-check"></use></svg>' : "") +
      "</span>";
    }).join("");

    var now = new Date();
    $("#cal-next").disabled =
      y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());
  }

  /* ---------------- 词库 ---------------- */
  var wordLimit = 60;
  var wordFilter = "all";
  var searchTimer = null;

  function renderBooks() {
    var books = Store.allBooks();
    var current = Store.currentBook();
    $("#book-list").innerHTML = books.map(function (b) {
      var p = Store.bookProgress(b.id);
      var pct = Math.round(p.pct * 100);
      var mark = esc((b.short || b.name).slice(0, 2));
      return '<div class="book' + (b.id === current.id ? " is-current" : "") + '" role="button" tabindex="0" data-book="' + esc(b.id) + '">' +
        '<span class="book-mark">' + mark + "</span>" +
        '<span class="book-info">' +
          '<span class="book-name">' + esc(b.name) +
            '<span class="book-badge">' + esc(b.short || "") + "</span>" +
          "</span>" +
          '<span class="book-desc">' + esc(b.desc || "") + "</span>" +
          '<span class="book-bar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="book-count">' + p.learned + " / " + p.total + " 词 · 已学 " + pct + "%</span>" +
        "</span>" +
        (b.custom ? '<button class="book-del" data-del="' + esc(b.id) + '" aria-label="删除词库" title="删除词库"><svg class="ic"><use href="#i-trash"></use></svg></button>' : "") +
        '<span class="book-radio"><svg class="ic"><use href="#i-check"></use></svg></span>' +
      "</div>";
    }).join("");
    renderWordList();
  }

  function matchesFilter(w) {
    if (wordFilter === "star") return Store.isStarred(w.w);
    if (wordFilter === "mastered") return Store.statusOf(w.w) === "mastered";
    if (wordFilter === "learning") return ["learning", "review"].indexOf(Store.statusOf(w.w)) !== -1;
    if (wordFilter === "new") return !Store.cardOf(w.w);
    return true;
  }

  function renderWordList() {
    var book = Store.currentBook();
    if (!book) return;
    var q = ($("#word-search").value || "").trim().toLowerCase();
    var words;
    if (q) {
      words = book.words.filter(function (w) {
        return w.w.toLowerCase().indexOf(q) !== -1 || (w.m && w.m.indexOf(q) !== -1);
      });
      $("#word-list-title").textContent = "搜索结果";
    } else {
      words = book.words.slice();
      $("#word-list-title").textContent = book.name;
    }

    words = words.filter(matchesFilter);

    var slice;
    if (q) {
      slice = words.slice(0, 200);
      $("#word-list-count").textContent = words.length + " 个匹配";
      $("#btn-more-words").hidden = words.length <= 200;
    } else {
      slice = words.slice(0, wordLimit);
      $("#word-list-count").textContent = wordFilter === "all"
        ? "共 " + book.words.length + " 词"
        : "筛选出 " + words.length + " 词";
      $("#btn-more-words").hidden = words.length <= wordLimit;
    }

    if (!slice.length) {
      var empty = {
        star: "生词本还是空的，点开任意单词就能收藏",
        mastered: "还没有已掌握的单词，继续积累吧",
        learning: "还没有正在学习的单词",
        new: "这个词库的单词都已经学过了"
      }[wordFilter] || "没有找到匹配的单词";
      $("#word-list").innerHTML = '<div class="word-empty">' + esc(empty) + "</div>";
      return;
    }

    $("#word-list").innerHTML = slice.map(function (w) {
      var st = Store.statusOf(w.w);
      return '<div class="word-row" role="button" tabindex="0" data-word="' + esc(w.w) + '" data-book="' + esc(book.id) + '">' +
        '<span class="w-dot ' + st + '"></span>' +
        '<span class="w-main"><span class="w-word">' + esc(w.w) +
          (Store.isStarred(w.w) ? '<svg class="ic w-star"><use href="#i-star"></use></svg>' : "") +
        "</span>" +
        '<span class="w-meaning">' + esc(w.m || "暂无释义") + "</span></span>" +
        '<svg class="ic" style="width:14px;height:14px;color:var(--muted)"><use href="#i-chevron"></use></svg>' +
      "</div>";
    }).join("");
  }

  /* ---------------- 单词详情 ---------------- */
  function openSheet(word, bookId, opts) {
    opts = opts || {};
    bookId = bookId || (Store.currentBook() ? Store.currentBook().id : "cet4");
    var found = Store.findWordAnywhere(word);
    var data = (found && found.word) || Store.wordData(bookId, word) || { w: word, p: "", m: "" };
    var cardBook = Store.cardOf(word) ? Store.cardOf(word).book : bookId;
    var st = Store.statusOf(word);
    var stLabel = { new: "未学习", learning: "学习中", review: "复习中", mastered: "已掌握" }[st];
    var extra = (window.EXTRAS || {})[String(word).toLowerCase()];
    var html =
      '<div class="sheet-word">' + esc(data.w) + "</div>" +
      (data.p ? '<div class="sheet-phon">/ ' + esc(data.p) + " /</div>" : "") +
      '<div class="sheet-mean">' + esc(data.m || "暂无释义") + "</div>" +
      '<div class="sheet-meta"><span class="tag green">' + stLabel + "</span>" +
        (Store.cardOf(word) ? '<span class="tag">已复习 ' + Store.cardOf(word).seen + " 次</span>" : "") +
        (Store.cardOf(word) && Store.cardOf(word).interval ? '<span class="tag">间隔 ' + Store.cardOf(word).interval + " 天</span>" : "") +
      "</div>";
    if (extra) {
      html += '<div class="example" style="margin-top:16px"><div class="example-en">' + esc(extra.e) + "</div>" +
              '<div class="example-zh">' + esc(extra.ez) + "</div></div>" +
              '<div class="note" style="margin-top:12px">' + esc(extra.n) + "</div>";
    }
    var starred = Store.isStarred(data.w);
    html += '<label class="note-editor">' +
        '<span class="note-editor-label"><svg class="ic"><use href="#i-edit"></use></svg>我的笔记</span>' +
        '<textarea id="sheet-note" rows="2" maxlength="240" placeholder="记一下词根、易混词，或自己造个句子…"></textarea>' +
      "</label>";
    html += '<div class="sheet-actions">' +
      '<button class="btn-ghost' + (starred ? " is-starred" : "") + '" data-act="star">' +
        '<svg class="ic"><use href="#i-star"></use></svg>' + (starred ? "已收藏" : "收藏") + "</button>" +
      '<button class="btn-ghost" data-act="speak">朗读</button>' +
      (opts.videoMode
        ? '<button class="btn-ghost" data-act="add">加入视频生词本</button>'
        : '<button class="btn-ghost" data-act="master">标为已掌握</button>' +
          '<button class="btn-ghost" data-act="reset">重置该词</button>') +
      "</div>";
    $("#sheet-content").innerHTML = html;
    $("#sheet-backdrop").hidden = false;
    $("#sheet").hidden = false;
    $("#sheet").setAttribute("data-word", data.w);
    $("#sheet").setAttribute("data-book", cardBook || bookId);

    var noteEl = $("#sheet-note");
    if (noteEl) {
      noteEl.value = Store.getNote(data.w);
      var noteTimer = null;
      noteEl.addEventListener("input", function () {
        clearTimeout(noteTimer);
        var v = noteEl.value;
        noteTimer = setTimeout(function () { Store.setNote(data.w, v); }, 250);
      });
      noteEl.addEventListener("blur", function () { Store.setNote(data.w, noteEl.value); });
    }

    $$("#sheet-content [data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-act");
        if (act === "speak") speak(data.w);
        if (act === "star") {
          var on = Store.toggleStar(data.w);
          btn.classList.toggle("is-starred", on);
          btn.innerHTML = '<svg class="ic"><use href="#i-star"></use></svg>' + (on ? "已收藏" : "收藏");
          toast(on ? "已加入生词本" : "已从生词本移除");
          if (currentView === "books") renderWordList();
        }
        if (act === "add") {
          var r = Store.addWordToVideoBook(data.w, data.p, data.m);
          toast(r.added ? "已加入视频生词本（共 " + r.total + " 词）" : "这个词已经在生词本里了");
          closeSheet();
          if (opts.onAdd) opts.onAdd(data.w, r);
        }
        if (act === "master") { Store.setMastered(data.w, cardBook || bookId); toast("已标记为掌握"); closeSheet(); refreshAll(); }
        if (act === "reset") { Store.resetWord(data.w); toast("已重置，将重新学习"); closeSheet(); refreshAll(); }
      });
    });
  }

  function closeSheet() {
    $("#sheet-backdrop").hidden = true;
    $("#sheet").hidden = true;
  }

  /* ---------------- 长难句列表 ---------------- */
  var sentFilter = "全部";

  function renderSentences() {
    var list = window.SENTENCES || [];
    var tags = ["全部"];
    list.forEach(function (s) { if (tags.indexOf(s.tag) === -1) tags.push(s.tag); });
    $("#sent-filters").innerHTML = tags.map(function (t) {
      return '<button class="filter' + (t === sentFilter ? " is-active" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
    }).join("");

    var ss = Store.sentenceStats();
    $("#sent-progress").textContent = ss.done + " / " + ss.total;

    var shown = list.filter(function (s) { return sentFilter === "全部" || s.tag === sentFilter; });
    $("#sentence-list").innerHTML = shown.map(function (s) {
      var done = Store.sentenceDone(s.id);
      var dots = "";
      for (var i = 1; i <= 5; i++) dots += '<i class="' + (i <= s.diff ? "on" : "") + '"></i>';
      return '<button class="sent-item' + (done ? " done" : "") + '" data-sent="' + esc(s.id) + '">' +
        '<span class="sent-item-top"><span class="tag gold">' + esc(s.tag) + "</span>" +
          '<span class="diff">' + dots + "</span>" +
          (done ? '<span class="done-mark" style="margin-left:auto"><svg class="ic"><use href="#i-check"></use></svg>已掌握</span>' : "") +
        "</span>" +
        '<span class="sent-item-en">' + esc(s.en) + "</span>" +
      "</button>";
    }).join("");
  }

  /* ---------------- 长难句学习 ---------------- */
  var sentSession = null;

  function openSentenceStudy(id) {
    var list = (window.SENTENCES || []).filter(function (s) {
      return sentFilter === "全部" || s.tag === sentFilter;
    });
    var idx = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { idx = i; break; }
    sentSession = { list: list, i: idx, revealed: false };
    $("#sent-study").classList.add("is-open");
    $("#sent-study").setAttribute("aria-hidden", "false");
    renderSentenceCard();
  }

  var ROLE = { main: ["c-main", "主干"], clause: ["c-clause", "从句"], mod: ["c-mod", "修饰"], adv: ["c-adv", "状语"] };

  function renderSentenceCard() {
    var s = sentSession.list[sentSession.i];
    if (!s) return;
    sentSession.revealed = false;
    $("#sent-card-tags").innerHTML = '<span class="tag gold">' + esc(s.tag) + "</span>" +
      '<span class="tag">难度 ' + s.diff + " / 5</span>";
    $("#sent-en").innerHTML = chunksHtml(s, false);
    $("#sent-hint").hidden = false;
    $("#sent-reveal").hidden = true;
    $("#sent-actions-reveal").hidden = false;
    $("#sent-actions-rate").hidden = true;

    var total = sentSession.list.length;
    $("#sent-counter").textContent = (sentSession.i + 1) + " / " + total;
    $("#sent-bar").style.width = ((sentSession.i + 1) / total * 100) + "%";
  }

  function chunksHtml(s, colored) {
    return s.chunks.map(function (c) {
      var cls = "chunk";
      if (colored && ROLE[c.r]) cls += " " + ROLE[c.r][0];
      return '<span class="' + cls + '">' + esc(c.t) + "</span>";
    }).join(" ");
  }

  function revealSentence() {
    var s = sentSession.list[sentSession.i];
    if (!s || sentSession.revealed) return;
    sentSession.revealed = true;
    $("#sent-en").innerHTML = chunksHtml(s, true);
    $("#sent-hint").hidden = true;
    $("#sent-reveal").hidden = false;
    $("#sent-zh").textContent = s.zh;
    var roles = [];
    s.chunks.forEach(function (c) { if (roles.indexOf(c.r) === -1) roles.push(c.r); });
    $("#chunk-legend").innerHTML = roles.map(function (r) {
      return '<span class="' + ROLE[r][0] + '">' + ROLE[r][1] + "</span>";
    }).join("");
    $("#sent-notes").innerHTML = (s.notes || []).map(function (n) {
      return '<div class="note-item">' + esc(n) + "</div>";
    }).join("");
    $("#sent-kw").innerHTML = (s.kw || []).map(function (k) {
      return '<span class="chip"><b>' + esc(k.w) + "</b> " + esc(k.m) + "</span>";
    }).join("");
    $("#sent-actions-reveal").hidden = true;
    $("#sent-actions-rate").hidden = false;
  }

  function nextSentence(known) {
    var s = sentSession.list[sentSession.i];
    if (s) Store.setSentence(s.id, !!known);
    sentSession.i++;
    if (sentSession.i >= sentSession.list.length) {
      closeSentenceStudy();
      toast("这一组已经读完了");
      renderSentences();
      renderHome();
    } else {
      renderSentenceCard();
      $("#sent-body-scroll") && ($("#sent-body-scroll").scrollTop = 0);
      var body = $(".sent-body");
      if (body) body.scrollTop = 0;
    }
  }

  function closeSentenceStudy() {
    $("#sent-study").classList.remove("is-open");
    $("#sent-study").setAttribute("aria-hidden", "true");
    sentSession = null;
  }

  /* ---------------- 单词学习 ---------------- */
  var session = null;
  var studyCard = $("#study-card");

  function startSession(opts) {
    var book = Store.currentBook();
    var queue = Store.buildQueue(book.id, opts || {});
    if (!queue.length) {
      toast(Store.todayInfo(book.id).due ? "今天的复习量已达上限" : "今日任务已完成，明天再来吧");
      return;
    }
    session = {
      queue: queue,
      i: 0,
      total: queue.length,
      passed: 0,
      answers: 0,
      correct: 0,
      start: Date.now(),
      timeRecorded: false,
      finished: false,
      bookId: book.id
    };
    $("#study").classList.add("is-open");
    $("#study").setAttribute("aria-hidden", "false");
    $("#study-done").hidden = true;
    $("#study-body").hidden = false;
    renderCard();
  }

  function renderCard() {
    var item = session.queue[session.i];
    if (!item) { finishSession(); return; }
    var w = item.word;
    var s = Store.getSettings();
    session.revealed = false;

    studyCard.classList.remove("revealed");
    $("#study-actions-reveal").hidden = false;
    $("#study-actions-rate").hidden = true;

    $("#card-tag").textContent = item.kind === "new" ? "新词" : "复习";
    $("#card-tag").className = "card-tag" + (item.kind === "new" ? "" : " review");

    if (s.direction === "zh-en") {
      $("#card-word").textContent = w.m || w.w;
      $("#card-word").classList.add("word-zh");
      $("#card-phonetic").textContent = "想一想它的英文";
      $("#btn-speak").style.visibility = "hidden";
      $("#card-meaning").innerHTML =
        '<span class="reveal-word">' + esc(w.w) + "</span>" +
        (w.p ? '<span class="reveal-phon">/ ' + esc(w.p) + " /</span>" : "");
    } else {
      $("#card-word").textContent = w.w;
      $("#card-word").classList.remove("word-zh");
      $("#card-phonetic").textContent = w.p ? "/ " + w.p + " /" : "";
      $("#btn-speak").style.visibility = "visible";
      $("#card-meaning").textContent = w.m || "暂无释义";
    }

    var extra = (window.EXTRAS || {})[String(w.w).toLowerCase()];
    var ex = $("#card-example");
    var note = $("#card-note");
    if (extra) {
      ex.hidden = false;
      ex.innerHTML = '<div class="example-en">' + esc(extra.e) + "</div>" +
                     '<div class="example-zh">' + esc(extra.ez) + "</div>";
      note.hidden = false;
      note.textContent = extra.n;
    } else {
      ex.hidden = true;
      note.hidden = true;
    }

    var mine = Store.getNote(w.w);
    var mynote = $("#card-mynote");
    if (mynote) {
      if (mine) { mynote.hidden = false; mynote.textContent = mine; }
      else mynote.hidden = true;
    }

    $("#study-counter").textContent = session.passed + " / " + session.total;
    $("#study-bar").style.width = (session.passed / session.total * 100) + "%";

    if (s.autoSpeak && s.direction !== "zh-en") speak(w.w);
  }

  function revealCard() {
    if (!session || session.revealed) return;
    session.revealed = true;
    studyCard.classList.add("revealed");
    $("#study-actions-reveal").hidden = true;
    $("#study-actions-rate").hidden = false;
  }

  function rateCurrent(q) {
    if (!session || !session.revealed) return;
    var item = session.queue[session.i];
    Store.rate(item.word.w, session.bookId, q);
    session.answers++;
    if (q >= 3) {
      session.correct++;
      session.passed++;
    } else {
      item.fails = (item.fails || 0) + 1;
      if (item.fails < 3) {
        var pos = Math.min(session.i + 3, session.queue.length);
        session.queue.splice(pos, 0, item);
      }
    }
    session.i++;
    if (session.i >= session.queue.length) finishSession();
    else renderCard();
  }

  function recordTime() {
    if (!session || session.timeRecorded) return;
    session.timeRecorded = true;
    Store.setTodaySeconds(Math.max(1, Math.round((Date.now() - session.start) / 1000)));
  }

  function finishSession() {
    recordTime();
    session.finished = true;
    $("#study-body").hidden = true;
    $("#study-actions-reveal").hidden = true;
    $("#study-actions-rate").hidden = true;
    $("#study-done").hidden = false;
    var acc = session.answers ? Math.round(session.correct / session.answers * 100) : 0;
    var mins = Math.max(1, Math.round((Date.now() - session.start) / 60000));
    $("#done-sub").textContent = "这一组共 " + session.passed + " 个词，约 " + mins + " 分钟。";
    $("#done-stats").innerHTML =
      "<div><b>" + session.passed + "</b><span>学习词数</span></div>" +
      "<div><b>" + acc + "%</b><span>正确率</span></div>" +
      "<div><b>" + session.answers + "</b><span>作答次数</span></div>";
    $("#study-counter").textContent = session.total + " / " + session.total;
    $("#study-bar").style.width = "100%";
    renderDoneCheckin();
    renderHome();
  }

  function closeStudy() {
    if (session && !session.finished) recordTime();
    $("#study").classList.remove("is-open");
    $("#study").setAttribute("aria-hidden", "true");
    session = null;
    renderHome();
  }

  function refreshAll() {
    renderHome();
    if (currentView === "books") renderBooks();
    if (currentView === "sentences") renderSentences();
    if (currentView === "me") renderMe();
  }

  /* ---------------- 我的 ---------------- */
  function renderMe() {
    $("#stat-learned").textContent = Store.totalLearned();
    $("#stat-mastered").textContent = Store.totalMastered();
    $("#stat-streak").textContent = Store.checkinStreak();
    var acc = Store.accuracy();
    $("#stat-acc").textContent = acc == null ? "--" : acc + "%";
    renderHeatmap($("#me-heatmap"), 140);
    $("#me-heat-total").textContent = "共 " + Store.activeDays() + " 天";
    renderWeek();
    renderBadges();
    renderCalendar();
  }

  function renderWeek() {
    var w = Store.weekStats();
    var cw = Store.checkinWeek();
    $("#week-range").textContent = "近 7 天";
    $("#week-grid").innerHTML =
      "<div><b>" + w.days + "</b><span>学习天数</span></div>" +
      "<div><b>" + w.answers + "</b><span>学习次数</span></div>" +
      "<div><b>" + (w.answers ? Math.round(w.correct / w.answers * 100) + "%" : "--") + "</b><span>正确率</span></div>" +
      "<div><b>" + w.quiz + "</b><span>测验题数</span></div>";

    var max = 1;
    cw.forEach(function (d) { if (d.words > max) max = d.words; });
    $("#week-bars").innerHTML = cw.map(function (d) {
      var pct = d.words ? Math.max(10, Math.round(d.words / max * 100)) : 0;
      return '<div class="week-bar' + (d.today ? " is-today" : "") + (d.words ? " has" : "") + '" title="' + d.key + " · " + d.words + ' 词">' +
        "<b>" + (d.words || "") + "</b>" +
        '<div class="week-bar-trail"><i style="height:' + pct + '%"></i></div>' +
        "<span>" + d.label + "</span>" +
      "</div>";
    }).join("");
  }

  function renderBadges() {
    var list = Store.badges();
    var got = list.filter(function (b) { return b.got; }).length;
    $("#badge-count").textContent = got + " / " + list.length;
    $("#badge-grid").innerHTML = list.map(function (b) {
      return '<div class="badge' + (b.got ? " is-got" : "") + '" title="' + esc(b.desc) + '">' +
        '<span class="badge-ic"><svg class="ic"><use href="#i-' + b.icon + '"></use></svg></span>' +
        "<b>" + esc(b.name) + "</b>" +
        "<span>" + esc(b.desc) + "</span>" +
      "</div>";
    }).join("");
  }

  function syncSettingsUI() {
    var s = Store.getSettings();
    $("#set-dailyNew").value = s.dailyNew;
    $("#val-dailyNew").textContent = s.dailyNew;
    $("#set-dailyReview").value = s.dailyReview;
    $("#val-dailyReview").textContent = s.dailyReview;
    $("#set-accent").value = s.accent;
    $("#set-autoSpeak").setAttribute("aria-checked", s.autoSpeak ? "true" : "false");
    $("#set-direction").value = s.direction;
    $("#set-theme").value = s.theme;
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    applyTheme();
    syncSettingsUI();
    renderHome();

    var mqLayout = window.matchMedia ? window.matchMedia("(min-width:900px) and (min-height:520px) and (orientation:landscape)") : null;
    if (mqLayout && mqLayout.addEventListener) {
      mqLayout.addEventListener("change", function () { renderHome(); });
    }

    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", function () {
        if (Store.getSettings().theme === "auto") applyTheme();
      });
    }

    // 导航
    $$(".tab").forEach(function (t) {
      t.addEventListener("click", function () { go(t.getAttribute("data-view")); });
    });
    $$("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-goto")); });
    });

    // 主题
    $("#btn-theme").addEventListener("click", function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      Store.setSetting("theme", dark ? "light" : "dark");
      $("#set-theme").value = Store.getSettings().theme;
      applyTheme();
    });

    // 今日
    $("#btn-start").addEventListener("click", function () { startSession(); });
    $("#btn-quick-review").addEventListener("click", function () { startSession({ onlyReview: true }); });
    $("#btn-quick-sentence").addEventListener("click", function () { go("sentences"); });

    // 今日学过的词
    $("#today-chips").addEventListener("click", function (e) {
      var b = e.target.closest("[data-word]");
      if (b) openSheet(b.getAttribute("data-word"), Store.currentBook().id);
    });

    // 词库
    $("#book-list").addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        var id = del.getAttribute("data-del");
        if (confirm("删除这个词库？已学记录会保留，但词库内容将移除。")) {
          Store.deleteBook(id);
          renderBooks();
          renderHome();
          toast("词库已删除");
        }
        return;
      }
      var row = e.target.closest("[data-book]");
      if (!row) return;
      Store.setBook(row.getAttribute("data-book"));
      wordLimit = 60;
      renderBooks();
      renderHome();
    });

    $("#word-search").addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderWordList, 120);
    });

    $("#word-list").addEventListener("click", function (e) {
      var row = e.target.closest("[data-word]");
      if (row) openSheet(row.getAttribute("data-word"), row.getAttribute("data-book"));
    });

    $("#word-filters").addEventListener("click", function (e) {
      var b = e.target.closest("[data-filter]");
      if (!b) return;
      wordFilter = b.getAttribute("data-filter");
      $$("#word-filters .filter").forEach(function (x) {
        x.classList.toggle("is-active", x === b);
      });
      wordLimit = 60;
      renderWordList();
    });

    $("#btn-more-words").addEventListener("click", function () {
      wordLimit += 100;
      renderWordList();
    });

    $("#btn-import").addEventListener("click", function () { $("#file-import").click(); });
    $("#file-import").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var name = file.name.replace(/\.[^.]+$/, "");
          var book = Store.parseImport(reader.result, name || "我的词库");
          toast("已导入 " + book.words.length + " 个词");
          go("books");
          renderBooks();
          renderHome();
        } catch (err) {
          toast("导入失败：" + err.message);
        }
      };
      reader.readAsText(file, "utf-8");
      e.target.value = "";
    });

    // 长难句
    $("#sent-filters").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tag]");
      if (!b) return;
      sentFilter = b.getAttribute("data-tag");
      renderSentences();
    });
    $("#sentence-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-sent]");
      if (b) openSentenceStudy(b.getAttribute("data-sent"));
    });

    $("#sent-close").addEventListener("click", function () {
      closeSentenceStudy();
      renderSentences();
      renderHome();
    });
    $("#sent-reveal-btn").addEventListener("click", revealSentence);
    $("#sent-unclear").addEventListener("click", function () { nextSentence(false); });
    $("#sent-clear").addEventListener("click", function () { nextSentence(true); });

    // 单词学习
    $("#study-close").addEventListener("click", closeStudy);
    $("#btn-reveal").addEventListener("click", revealCard);
    $("#study-card").addEventListener("click", function (e) {
      if (e.target.closest("#btn-speak")) return;
      if (!session || session.finished) return;
      if (!session.revealed) revealCard();
    });
    $("#btn-speak").addEventListener("click", function (e) {
      e.stopPropagation();
      var item = session && session.queue[session.i];
      if (item) speak(item.word.w);
    });
    $$("#study-actions-rate .rate").forEach(function (b) {
      b.addEventListener("click", function () { rateCurrent(parseInt(b.getAttribute("data-q"), 10)); });
    });
    $("#btn-done-home").addEventListener("click", function () { closeStudy(); go("home"); });
    $("#btn-done-again").addEventListener("click", function () {
      closeStudy();
      startSession();
    });

    // 打卡
    $("#btn-checkin").addEventListener("click", doCheckIn);
    $("#btn-done-checkin").addEventListener("click", doCheckIn);
    $("#cal-prev").addEventListener("click", function () {
      calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
      renderCalendar();
    });
    $("#cal-next").addEventListener("click", function () {
      var now = new Date();
      var next = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
      if (next.getFullYear() > now.getFullYear() ||
          (next.getFullYear() === now.getFullYear() && next.getMonth() > now.getMonth())) return;
      calCursor = next;
      renderCalendar();
    });

    // 设置
    $("#set-dailyNew").addEventListener("input", function () {
      Store.setSetting("dailyNew", parseInt(this.value, 10));
      $("#val-dailyNew").textContent = this.value;
      renderHome();
    });
    $("#set-dailyReview").addEventListener("input", function () {
      Store.setSetting("dailyReview", parseInt(this.value, 10));
      $("#val-dailyReview").textContent = this.value;
      renderHome();
    });
    $("#set-accent").addEventListener("change", function () { Store.setSetting("accent", this.value); });
    $("#set-autoSpeak").addEventListener("click", function () {
      var on = this.getAttribute("aria-checked") !== "true";
      this.setAttribute("aria-checked", on ? "true" : "false");
      Store.setSetting("autoSpeak", on);
    });
    $("#set-direction").addEventListener("change", function () { Store.setSetting("direction", this.value); });
    $("#set-theme").addEventListener("change", function () {
      Store.setSetting("theme", this.value);
      applyTheme();
    });

    // 数据
    $("#btn-export").addEventListener("click", function () {
      var blob = new Blob([Store.exportData()], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "墨记单词备份-" + Store.dayKey() + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast("备份已导出");
    });
    $("#btn-import-data").addEventListener("click", function () { $("#file-restore").click(); });
    $("#file-restore").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          Store.importData(reader.result);
          applyTheme();
          syncSettingsUI();
          renderHome();
          renderMe();
          toast("备份已恢复");
        } catch (err) {
          toast("恢复失败：" + err.message);
        }
      };
      reader.readAsText(file, "utf-8");
      e.target.value = "";
    });
    $("#btn-reset").addEventListener("click", function () {
      if (!confirm("确定清空所有学习数据吗？此操作不可撤销，建议先导出备份。")) return;
      if (!confirm("再次确认：所有卡片、统计和打卡记录都会被删除。")) return;
      Store.reset();
      applyTheme();
      syncSettingsUI();
      renderHome();
      renderMe();
      toast("数据已清空");
    });

    // 弹层
    $("#sheet-backdrop").addEventListener("click", closeSheet);

    // 键盘
    document.addEventListener("keydown", function (e) {
      if ($("#study").classList.contains("is-open")) {
        if (e.key === "Escape") { closeStudy(); return; }
        if (!session || session.finished) return;
        if (e.code === "Space") { e.preventDefault(); revealCard(); return; }
        if (session.revealed && ["1", "2", "3"].indexOf(e.key) !== -1) {
          var q = { "1": 1, "2": 3, "3": 4 }[e.key];
          rateCurrent(q);
        }
      } else if ($("#sent-study").classList.contains("is-open")) {
        if (e.key === "Escape") { closeSentenceStudy(); renderSentences(); }
        else if (e.code === "Space") { e.preventDefault(); revealSentence(); }
      } else if (e.key === "Escape") {
        closeSheet();
      }
    });

    // 服务工作者
    if (window.Quiz) window.Quiz.init();
    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  init();
})();
