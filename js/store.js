/* ============================================================
   墨记单词 · 数据层
   localStorage + SM-2 间隔重复
   ============================================================ */
(function () {
  "use strict";

  var KEY = "moji-word-state-v1";
  var DAY = 86400000;

  var defaultSettings = {
    dailyNew: 20,
    dailyReview: 200,
    accent: "en-US",
    autoSpeak: true,
    direction: "en-zh",
    theme: "auto"
  };

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function defaultState() {
    return {
      version: 1,
      settings: Object.assign({}, defaultSettings),
      bookId: "cet4",
      cards: {},
      days: {},
      sentences: {},
      customBooks: [],
      videos: [],
      checkins: {},
      checkinsMigrated: true,
      stats: { answers: 0, correct: 0, startedAt: Date.now() }
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      var d = defaultState();
      s.settings = Object.assign({}, d.settings, s.settings || {});
      s.cards = s.cards || {};
      s.days = s.days || {};
      s.sentences = s.sentences || {};
      s.customBooks = s.customBooks || [];
      s.videos = s.videos || [];
      s.checkins = s.checkins || {};
      if (!s.checkinsMigrated) {
        // 老数据：把以前学过的日子补记为打卡，避免升级后连续天数清零
        for (var dk in s.days) {
          var rec = s.days[dk];
          if (rec && rec.total > 0 && !s.checkins[dk]) {
            s.checkins[dk] = { ts: 0, words: rec.total, migrated: true };
          }
        }
        s.checkinsMigrated = true;
      }
      s.stats = Object.assign({}, d.stats, s.stats || {});
      s.version = 1;
      return s;
    } catch (e) {
      console.warn("读取本地数据失败，已重置", e);
      return defaultState();
    }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        console.warn("保存失败", e);
        toastSafe("存储空间不足，请导出备份后清理数据");
      }
    }, 60);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
  }

  function toastSafe(msg) {
    if (window.App && window.App.toast) window.App.toast(msg);
  }

  /* ---------------- 词库 ---------------- */

  var books = null;
  function allBooks() {
    if (!books) {
      books = (window.WORDBOOKS || []).slice();
      (state.customBooks || []).forEach(function (b) {
        books.push(Object.assign({ custom: true }, b));
      });
      books.forEach(function (b) {
        if (!b.index) {
          b.index = Object.create(null);
          (b.words || []).forEach(function (w) {
            var k = String(w.w).toLowerCase();
            if (!(k in b.index)) b.index[k] = w;
          });
        }
      });
    }
    return books;
  }

  function refreshBooks() { books = null; }

  function getBook(id) {
    var list = allBooks();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  function currentBook() { return getBook(state.bookId); }

  function setBook(id) {
    if (getBook(id)) { state.bookId = id; save(); }
  }

  function wordData(bookId, word) {
    var b = getBook(bookId);
    if (!b || !b.index) return null;
    return b.index[String(word).toLowerCase()] || null;
  }

  function findWordAnywhere(word) {
    var k = String(word).toLowerCase();
    var list = allBooks();
    for (var i = 0; i < list.length; i++) {
      var w = list[i].index[k];
      if (w) return { word: w, book: list[i] };
    }
    return null;
  }

  /* ---------------- 卡片 ---------------- */

  function cardKey(word) { return String(word).toLowerCase(); }

  function cardOf(word) { return state.cards[cardKey(word)] || null; }

  function ensureCard(word, bookId) {
    var k = cardKey(word);
    var c = state.cards[k];
    if (!c) {
      c = state.cards[k] = {
        w: String(word),
        book: bookId,
        ease: 2.5,
        interval: 0,
        reps: 0,
        lapses: 0,
        due: 0,
        last: 0,
        seen: 0,
        correct: 0,
        state: "learning"
      };
    }
    if (!c.book) c.book = bookId;
    return c;
  }

  function statusOf(word) {
    var c = cardOf(word);
    if (!c || !c.seen) return "new";
    if (c.state === "review" && c.interval >= 21) return "mastered";
    if (c.state === "review") return "review";
    return "learning";
  }

  function isMastered(word) {
    return statusOf(word) === "mastered";
  }

  function setMastered(word, bookId) {
    var c = ensureCard(word, bookId);
    c.seen = Math.max(1, c.seen);
    c.state = "review";
    c.interval = 30;
    c.reps = Math.max(3, c.reps);
    c.ease = Math.max(2.5, c.ease);
    c.due = Date.now() + 30 * DAY;
    c.last = Date.now();
    save();
  }

  function resetWord(word) {
    delete state.cards[cardKey(word)];
    save();
  }

  /* SM-2 */
  function rate(word, bookId, q) {
    var c = ensureCard(word, bookId);
    var first = !c.seen;

    c.seen += 1;
    c.last = Date.now();

    if (q < 3) {
      c.lapses += 1;
      c.reps = 0;
      c.interval = 0;
      c.ease = Math.max(1.3, c.ease - 0.2);
      c.due = Date.now() + 10 * 60 * 1000;
      c.state = "learning";
    } else {
      c.reps += 1;
      if (c.reps === 1) c.interval = 1;
      else if (c.reps === 2) c.interval = 3;
      else c.interval = Math.max(1, Math.round((c.interval || 1) * c.ease));

      var delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
      c.ease = Math.min(3.0, Math.max(1.3, c.ease + delta));
      c.due = Date.now() + c.interval * DAY;
      c.state = "review";
      c.correct += 1;
    }

    var k = dayKey();
    var d = state.days[k] || (state.days[k] = { new: 0, review: 0, total: 0, correct: 0, seconds: 0, words: [] });
    d.total += 1;
    if (q >= 3) d.correct += 1;
    if (first) d.new += 1; else d.review += 1;
    if (d.words.indexOf(c.w) === -1 && d.words.length < 200) d.words.push(c.w);

    state.stats.answers += 1;
    if (q >= 3) state.stats.correct += 1;

    save();
    return c;
  }

  /* ---------------- 队列 ---------------- */

  function dueWords(bookId, limit) {
    var b = getBook(bookId);
    if (!b) return [];
    var now = Date.now();
    var out = [];
    var words = b.words;
    for (var i = 0; i < words.length; i++) {
      var c = state.cards[cardKey(words[i].w)];
      if (c && c.seen && c.state !== "new" && c.due <= now) {
        out.push(words[i]);
        if (limit && out.length >= limit) break;
      }
    }
    return out;
  }

  function newWords(bookId, limit) {
    var b = getBook(bookId);
    if (!b || limit <= 0) return [];
    var words = b.words;
    var pool = [];
    for (var i = 0; i < words.length; i++) {
      if (String(words[i].w).length < 2) continue;
      if (!state.cards[cardKey(words[i].w)]) pool.push(words[i]);
    }

    // 从整个词库中随机抽取，保证每日新词覆盖 A–Z，而不是总从 A 开头
    var n = Math.min(limit, pool.length);
    for (var j = 0; j < n; j++) {
      var r = j + Math.floor(Math.random() * (pool.length - j));
      var t = pool[j]; pool[j] = pool[r]; pool[r] = t;
    }
    return pool.slice(0, n);
  }

  function todayInfo(bookId) {
    var d = state.days[dayKey()] || { new: 0, review: 0, total: 0, correct: 0, seconds: 0, words: [] };
    var due = dueWords(bookId, state.settings.dailyReview);
    var remainingNew = Math.max(0, state.settings.dailyNew - (d.new || 0));
    var newLeft = newWords(bookId, remainingNew);
    return {
      day: d,
      due: due.length,
      newLeft: newLeft.length,
      done: d.total,
      plan: due.length + newLeft.length
    };
  }

  function buildQueue(bookId, opts) {
    opts = opts || {};
    var d = state.days[dayKey()] || { new: 0, review: 0 };
    var reviewLimit = opts.onlyReview ? state.settings.dailyReview : Math.max(0, state.settings.dailyReview - (d.review || 0));
    var due = dueWords(bookId, reviewLimit);
    var newLimit = opts.onlyReview ? 0 : Math.max(0, state.settings.dailyNew - (d.new || 0));
    var news = newWords(bookId, newLimit);

    var q = [];
    var ni = 0;
    for (var i = 0; i < due.length; i++) {
      q.push({ word: due[i], kind: "review" });
      if ((i + 1) % 3 === 0 && ni < news.length) {
        q.push({ word: news[ni++], kind: "new" });
      }
    }
    while (ni < news.length) q.push({ word: news[ni++], kind: "new" });
    return q;
  }

  /* ---------------- 统计 ---------------- */

  function streak() {
    var count = 0;
    var d = new Date();
    if (!state.days[dayKey(d)] || state.days[dayKey(d)].total === 0) {
      d = new Date(Date.now() - DAY);
      if (!state.days[dayKey(d)] || state.days[dayKey(d)].total === 0) return 0;
    }
    while (true) {
      var rec = state.days[dayKey(d)];
      if (rec && rec.total > 0) { count++; d = new Date(d.getTime() - DAY); }
      else break;
    }
    return count;
  }

  function totalLearned() {
    return Object.keys(state.cards).length;
  }

  function totalMastered() {
    var n = 0;
    for (var k in state.cards) {
      var c = state.cards[k];
      if (c.state === "review" && c.interval >= 21) n++;
    }
    return n;
  }

  function accuracy() {
    if (!state.stats.answers) return null;
    return Math.round((state.stats.correct / state.stats.answers) * 100);
  }

  function bookProgress(bookId) {
    var b = getBook(bookId);
    if (!b) return { learned: 0, total: 0, pct: 0 };
    var learned = 0;
    for (var i = 0; i < b.words.length; i++) {
      if (state.cards[cardKey(b.words[i].w)]) learned++;
    }
    return { learned: learned, total: b.words.length, pct: b.words.length ? learned / b.words.length : 0 };
  }

  function heatmap(days) {
    days = days || 84;
    var out = [];
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var start = new Date(today.getTime() - (days - 1) * DAY);
    // 对齐到周一，保证 7 行整齐
    var offset = (start.getDay() + 6) % 7;
    start = new Date(start.getTime() - offset * DAY);
    for (var t = start.getTime(); t <= today.getTime(); t += DAY) {
      var k = dayKey(new Date(t));
      var rec = state.days[k];
      out.push({ key: k, n: rec ? rec.total : 0, today: k === dayKey() });
    }
    return out;
  }

  function activeDays() {
    var n = 0;
    for (var k in state.days) if (state.days[k].total > 0) n++;
    return n;
  }

  /* ---------------- 打卡 ---------------- */

  function checkedIn(key) {
    key = key || dayKey();
    return !!(state.checkins && state.checkins[key]);
  }

  function todayWords() {
    var d = state.days[dayKey()];
    return d ? (d.total || 0) : 0;
  }

  function wordsOn(key) {
    var d = state.days[key];
    return d ? (d.total || 0) : 0;
  }

  function checkIn() {
    var k = dayKey();
    if (checkedIn(k)) {
      return { ok: false, reason: "done", streak: checkinStreak(), total: checkinTotal() };
    }
    var n = todayWords();
    if (!n) {
      return { ok: false, reason: "empty", streak: checkinStreak(), total: checkinTotal() };
    }
    state.checkins[k] = { ts: Date.now(), words: n };
    saveNow();
    return { ok: true, streak: checkinStreak(), total: checkinTotal() };
  }

  function checkinStreak() {
    var d = new Date();
    if (!checkedIn(dayKey(d))) {
      d = new Date(d.getTime() - DAY);
      if (!checkedIn(dayKey(d))) return 0;
    }
    var n = 0;
    while (checkedIn(dayKey(d))) {
      n++;
      d = new Date(d.getTime() - DAY);
    }
    return n;
  }

  function checkinTotal() {
    var n = 0;
    var c = state.checkins || {};
    for (var k in c) if (c[k]) n++;
    return n;
  }

  function checkinWeek() {
    var out = [];
    var wd = "日一二三四五六";
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    for (var i = 6; i >= 0; i--) {
      var d = new Date(today.getTime() - i * DAY);
      var k = dayKey(d);
      out.push({
        key: k,
        label: wd.charAt(d.getDay()),
        checked: checkedIn(k),
        today: i === 0,
        words: wordsOn(k)
      });
    }
    return out;
  }

  // 返回周日起始的日历格子，前导空格为 null
  function checkinMonth(year, month) {
    var first = new Date(year, month, 1);
    var total = new Date(year, month + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < first.getDay(); i++) cells.push(null);
    for (var day = 1; day <= total; day++) {
      var k = year + "-" + pad(month + 1) + "-" + pad(day);
      cells.push({
        day: day,
        key: k,
        checked: checkedIn(k),
        today: k === dayKey(),
        words: wordsOn(k)
      });
    }
    return cells;
  }

  /* ---------------- 长难句 ---------------- */

  function sentenceDone(id) { return !!(state.sentences[id] && state.sentences[id].done); }

  function setSentence(id, done) {
    state.sentences[id] = { done: done, ts: Date.now() };
    save();
  }

  function sentenceStats() {
    var list = window.SENTENCES || [];
    var done = 0;
    for (var i = 0; i < list.length; i++) if (sentenceDone(list[i].id)) done++;
    return { done: done, total: list.length };
  }

  /* ---------------- 词库导入 ---------------- */

  function parseImport(text, name) {
    text = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!text) throw new Error("文件是空的");

    var words = [];
    if (text.charAt(0) === "[" || text.charAt(0) === "{") {
      var data = JSON.parse(text);
      var arr = Array.isArray(data) ? data : (data.words || []);
      arr.forEach(function (it) {
        if (typeof it === "string") { words.push({ w: it, p: "", m: "" }); return; }
        var w = it.w || it.word || it.term;
        if (!w) return;
        words.push({
          w: String(w).trim(),
          p: String(it.p || it.phonetic || it.ipa || "").trim(),
          m: String(it.m || it.meaning || it.translation || it.def || "").trim()
        });
      });
    } else {
      text.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line || line.charAt(0) === "#") return;
        var parts = line.split(/[,;\t]/).map(function (s) { return s.trim(); });
        if (!parts[0]) return;
        if (parts.length >= 3 && /[\u4e00-\u9fa5]/.test(parts[2])) {
          words.push({ w: parts[0], p: parts[1], m: parts.slice(2).join(" ") });
        } else if (parts.length >= 2) {
          words.push({ w: parts[0], p: "", m: parts.slice(1).join("，") });
        } else {
          words.push({ w: parts[0], p: "", m: "" });
        }
      });
    }

    // 去重
    var seen = Object.create(null);
    words = words.filter(function (w) {
      var k = w.w.toLowerCase();
      if (!w.w || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
    if (!words.length) throw new Error("没有解析到单词，请检查格式");

    var id = "custom-" + Date.now().toString(36);
    var book = {
      id: id,
      name: name || "我的词库",
      short: "自建",
      desc: "导入的词库 · " + words.length + " 词",
      custom: true,
      words: words
    };
    state.customBooks.push(book);
    state.bookId = id;
    refreshBooks();
    save();
    return book;
  }

  function deleteBook(id) {
    state.customBooks = state.customBooks.filter(function (b) { return b.id !== id; });
    if (state.bookId === id) state.bookId = (window.WORDBOOKS && window.WORDBOOKS[0]) ? window.WORDBOOKS[0].id : "cet4";
    refreshBooks();
    save();
  }

  /* ---------------- 视频 ---------------- */

  function videos() {
    if (!state.videos) state.videos = [];
    return state.videos;
  }

  function getVideo(id) {
    var list = videos();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function addVideo(v) {
    var id = "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    var item = Object.assign({
      id: id,
      title: "未命名视频",
      type: "youtube",
      url: "",
      videoId: "",
      cues: [],
      learned: {},
      pos: 0,
      addedAt: Date.now()
    }, v || {});
    item.id = id;
    videos().push(item);
    saveNow();
    return item;
  }

  function updateVideo(id, patch) {
    var v = getVideo(id);
    if (!v) return null;
    Object.assign(v, patch || {});
    saveNow();
    return v;
  }

  function deleteVideo(id) {
    state.videos = videos().filter(function (v) { return v.id !== id; });
    saveNow();
  }

  function markCue(id, idx, learned) {
    var v = getVideo(id);
    if (!v) return;
    if (!v.learned) v.learned = {};
    if (learned) v.learned[idx] = 1;
    else delete v.learned[idx];
    saveNow();
  }

  function videoProgress(id) {
    var v = getVideo(id);
    if (!v) return { learned: 0, total: 0, pct: 0 };
    var total = (v.cues || []).length;
    var learned = Object.keys(v.learned || {}).length;
    return { learned: learned, total: total, pct: total ? learned / total : 0 };
  }

  function setVideoPos(id, sec) {
    var v = getVideo(id);
    if (!v) return;
    v.pos = Math.max(0, sec || 0);
    save();
  }

  var VIDEO_BOOK_ID = "video-book";

  function videoBook() {
    var list = state.customBooks.filter(function (b) { return b.id === VIDEO_BOOK_ID; });
    if (list.length) return list[0];
    var book = {
      id: VIDEO_BOOK_ID,
      name: "视频生词本",
      short: "视频",
      desc: "从视频字幕里加入的单词",
      custom: true,
      words: []
    };
    state.customBooks.push(book);
    refreshBooks();
    return book;
  }

  function addWordToVideoBook(word, phonetic, meaning) {
    var w = String(word || "").trim();
    if (!w) return { added: false, total: 0 };
    var book = videoBook();
    var key = w.toLowerCase();
    for (var i = 0; i < book.words.length; i++) {
      if (String(book.words[i].w).toLowerCase() === key) {
        return { added: false, total: book.words.length };
      }
    }
    book.words.push({ w: w, p: phonetic || "", m: meaning || "" });
    book.desc = "从视频字幕里加入的单词 · " + book.words.length + " 词";
    refreshBooks();
    saveNow();
    return { added: true, total: book.words.length };
  }

  /* ---------------- 备份 ---------------- */

  function exportData() {
    return JSON.stringify({
      app: "moji-word",
      version: 1,
      exportedAt: new Date().toISOString(),
      state: state
    }, null, 2);
  }

  function importData(text) {
    var obj = JSON.parse(text);
    var s = obj.state || obj;
    if (!s || typeof s !== "object" || !s.cards) throw new Error("不是有效的备份文件");
    state = Object.assign(defaultState(), s);
    state.settings = Object.assign({}, defaultSettings, s.settings || {});
    state.cards = s.cards || {};
    state.days = s.days || {};
    state.sentences = s.sentences || {};
    state.customBooks = s.customBooks || [];
    state.videos = s.videos || [];
    state.checkins = s.checkins || {};
    if (!s.checkinsMigrated && !s.checkins) {
      for (var dk in state.days) {
        var rec = state.days[dk];
        if (rec && rec.total > 0 && !state.checkins[dk]) {
          state.checkins[dk] = { ts: 0, words: rec.total, migrated: true };
        }
      }
    }
    state.checkinsMigrated = true;
    state.stats = Object.assign({ answers: 0, correct: 0, startedAt: Date.now() }, s.stats || {});
    refreshBooks();
    saveNow();
  }

  function reset() {
    state = defaultState();
    refreshBooks();
    saveNow();
  }

  function getSettings() { return state.settings; }

  function setSetting(k, v) {
    state.settings[k] = v;
    save();
  }

  function setTodaySeconds(sec) {
    var k = dayKey();
    var d = state.days[k] || (state.days[k] = { new: 0, review: 0, total: 0, correct: 0, seconds: 0, words: [] });
    d.seconds = (d.seconds || 0) + sec;
    save();
  }

  window.Store = {
    get state() { return state; },
    dayKey: dayKey,
    allBooks: allBooks,
    getBook: getBook,
    currentBook: currentBook,
    setBook: setBook,
    wordData: wordData,
    findWordAnywhere: findWordAnywhere,
    cardOf: cardOf,
    statusOf: statusOf,
    isMastered: isMastered,
    setMastered: setMastered,
    resetWord: resetWord,
    rate: rate,
    dueWords: dueWords,
    newWords: newWords,
    todayInfo: todayInfo,
    buildQueue: buildQueue,
    streak: streak,
    totalLearned: totalLearned,
    totalMastered: totalMastered,
    accuracy: accuracy,
    bookProgress: bookProgress,
    heatmap: heatmap,
    activeDays: activeDays,
    checkedIn: checkedIn,
    todayWords: todayWords,
    checkIn: checkIn,
    checkinStreak: checkinStreak,
    checkinTotal: checkinTotal,
    checkinWeek: checkinWeek,
    checkinMonth: checkinMonth,
    sentenceDone: sentenceDone,
    setSentence: setSentence,
    sentenceStats: sentenceStats,
    videos: videos,
    getVideo: getVideo,
    addVideo: addVideo,
    updateVideo: updateVideo,
    deleteVideo: deleteVideo,
    markCue: markCue,
    videoProgress: videoProgress,
    setVideoPos: setVideoPos,
    addWordToVideoBook: addWordToVideoBook,
    parseImport: parseImport,
    deleteBook: deleteBook,
    exportData: exportData,
    importData: importData,
    reset: reset,
    getSettings: getSettings,
    setSetting: setSetting,
    setTodaySeconds: setTodaySeconds,
    saveNow: saveNow
  };
})();
