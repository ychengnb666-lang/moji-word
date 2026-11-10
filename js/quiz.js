/* ============================================================
   墨记单词 · 测验中心
   看英选中 / 看中选英 / 听音选词 / 拼写挑战
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
  function speak(text) {
    if (window.App && window.App.speak) window.App.speak(text);
  }
  function toast(msg) {
    if (window.App && window.App.toast) window.App.toast(msg);
  }

  var MODES = {
    "en-zh": { label: "选出正确的中文释义" },
    "zh-en": { label: "选出对应的英文单词" },
    "listen": { label: "听发音，选出你听到的单词" },
    "spell": { label: "根据释义拼写这个单词" }
  };
  var SCOPE_SUB = {
    learned: "从学过的单词里出题",
    all: "从整个词库随机出题",
    star: "从生词本里出题",
    mistake: "从错题本里出题"
  };
  var SCOPE_EMPTY = {
    learned: "还没有学过的单词，先学几个再来测验吧",
    all: "这个词库还没有单词",
    star: "生词本是空的，先在词库或单词卡里收藏几个词",
    mistake: "错题本是空的，先做一组测验吧"
  };

  var cfg = { mode: "en-zh", size: 10, scope: "learned" };
  var run = null;

  /* ---------------- 设置面板 ---------------- */

  function render() {
    // 切到别的页面再回来时，不要丢掉正在进行的测验
    if (run && $("#quiz-run") && !$("#quiz-run").hidden) {
      renderSetup();
      return;
    }
    showSetup();
  }

  function setRunning(on) {
    var v = $("#view-quiz");
    if (v) {
      v.classList.toggle("is-running", !!on);
      if (on) v.classList.remove("is-result");
    }
  }

  function setResult(on) {
    var v = $("#view-quiz");
    if (v) {
      v.classList.toggle("is-result", !!on);
      if (on) v.classList.remove("is-running");
    }
  }

  function showSetup() {
    setRunning(false);
    setResult(false);
    $("#quiz-setup").hidden = false;
    $("#quiz-run").hidden = true;
    $("#quiz-result").hidden = true;
    run = null;
    renderSetup();
  }

  function renderSetup() {
    var q = Store.quizStats();
    $("#quiz-acc-pill").textContent = q.acc == null ? "正确率 --" : "正确率 " + q.acc + "%";
    var m = Store.mistakeCount((Store.currentBook() || {}).id);
    $("#quiz-mistake-count").textContent = m + " 个";
    $("#btn-quiz-mistakes").hidden = m === 0;
    $("#quiz-mistake-text").textContent = m
      ? "错题本里有 " + m + " 个词，答错的词会在复习队列里更早出现。"
      : "测验答错的词会自动收进这里，可以随时专项重练。";
    $("#quiz-scope-sub").textContent = SCOPE_SUB[cfg.scope] || "";
  }

  /* ---------------- 出题 ---------------- */

  function buildQuestions(pool) {
    var book = Store.currentBook();
    var all = (book && book.words) || [];
    return pool.map(function (w) {
      var q = { word: w, mode: cfg.mode };
      if (cfg.mode === "spell") return q;

      var field = cfg.mode === "en-zh" ? "m" : "w";
      var right = String(w[field]);
      q.answer = right;

      var opts = [right];
      var used = {};
      used[right.toLowerCase()] = 1;
      var guard = 0;
      while (opts.length < 4 && guard < 800) {
        guard++;
        var cand = all[Math.floor(Math.random() * all.length)];
        if (!cand) continue;
        var val = cand[field];
        if (!val) continue;
        var key = String(val).toLowerCase();
        if (used[key]) continue;
        used[key] = 1;
        opts.push(String(val));
      }
      for (var i = opts.length - 1; i > 0; i--) {
        var r = Math.floor(Math.random() * (i + 1));
        var t = opts[i]; opts[i] = opts[r]; opts[r] = t;
      }
      q.options = opts;
      return q;
    });
  }

  function startWith(pool) {
    if (!pool || !pool.length) return;
    var questions = buildQuestions(pool);
    run = {
      questions: questions,
      i: 0,
      total: questions.length,
      correct: 0,
      wrong: [],
      answered: false,
      start: Date.now()
    };
    $("#quiz-setup").hidden = true;
    $("#quiz-result").hidden = true;
    $("#quiz-run").hidden = false;
    setRunning(true);
    renderQuestion();
  }

  function start() {
    var book = Store.currentBook();
    if (!book) return;
    var pool = Store.quizPool(book.id, cfg.scope, cfg.size);
    if (!pool.length) { toast(SCOPE_EMPTY[cfg.scope] || "没有可出的题"); return; }
    // 已学词不够时，用整个词库补足
    if (pool.length < cfg.size && cfg.scope !== "all") {
      var extra = Store.quizPool(book.id, "all", cfg.size * 4);
      var have = {};
      pool.forEach(function (w) { have[String(w.w).toLowerCase()] = 1; });
      extra.forEach(function (w) {
        if (pool.length >= cfg.size) return;
        var k = String(w.w).toLowerCase();
        if (!have[k]) { have[k] = 1; pool.push(w); }
      });
    }
    startWith(pool.slice(0, cfg.size));
  }

  /* ---------------- 答题 ---------------- */

  function renderQuestion() {
    var q = run.questions[run.i];
    if (!q) { finish(); return; }
    run.answered = false;

    $("#quiz-counter").textContent = (run.i + 1) + " / " + run.total;
    $("#quiz-bar").style.width = (run.i / run.total * 100) + "%";
    $("#quiz-label").textContent = MODES[cfg.mode].label;
    $("#quiz-feedback").hidden = true;
    $("#quiz-feedback").className = "quiz-feedback";
    $("#quiz-next").hidden = true;
    $("#quiz-kbd-hint").hidden = false;

    var wordEl = $("#quiz-word");
    var phonEl = $("#quiz-phon");
    var speakBtn = $("#quiz-speak");
    var optionsEl = $("#quiz-options");
    var inputWrap = $("#quiz-input-wrap");
    var input = $("#quiz-input");

    wordEl.hidden = false;
    wordEl.className = "quiz-word";
    phonEl.textContent = "";
    speakBtn.hidden = false;
    speakBtn.classList.remove("big");
    optionsEl.hidden = true;
    inputWrap.hidden = true;
    optionsEl.innerHTML = "";

    if (cfg.mode === "en-zh") {
      wordEl.textContent = q.word.w;
      phonEl.textContent = q.word.p ? "/ " + q.word.p + " /" : "";
    } else if (cfg.mode === "zh-en") {
      wordEl.textContent = q.word.m || q.word.w;
      wordEl.classList.add("is-zh");
      phonEl.textContent = "想一想它对应的英文";
      speakBtn.hidden = true;
    } else if (cfg.mode === "listen") {
      wordEl.hidden = true;
      phonEl.textContent = "点击喇叭重听";
      speakBtn.classList.add("big");
      setTimeout(function () { speak(q.word.w); }, 120);
    } else {
      wordEl.textContent = q.word.m || q.word.w;
      wordEl.classList.add("is-zh");
      phonEl.textContent = q.word.p ? "/ " + q.word.p + " /" : "";
      speakBtn.hidden = true;
      input.value = "";
      inputWrap.hidden = false;
      if (window.matchMedia && window.matchMedia("(min-width:900px)").matches) {
        setTimeout(function () { input.focus(); }, 60);
      }
    }

    if (cfg.mode !== "spell") {
      optionsEl.hidden = false;
      optionsEl.innerHTML = q.options.map(function (o, i) {
        return '<button class="quiz-opt" data-opt="' + esc(o) + '">' +
          '<span class="quiz-opt-key">' + "ABCD".charAt(i) + "</span>" +
          '<span class="quiz-opt-text">' + esc(o) + "</span>" +
        "</button>";
      }).join("");
    }
  }

  function answer(choice) {
    if (!run || run.answered) return;
    var q = run.questions[run.i];
    if (!q) return;
    run.answered = true;

    var right = String(q.answer || q.word.w);
    var ok = String(choice).trim().toLowerCase() === right.trim().toLowerCase();

    $$("#quiz-options .quiz-opt").forEach(function (b) {
      var val = String(b.getAttribute("data-opt"));
      b.disabled = true;
      if (val.toLowerCase() === right.toLowerCase()) b.classList.add("is-right");
      else if (val.toLowerCase() === String(choice).toLowerCase()) b.classList.add("is-wrong");
    });

    if (cfg.mode === "spell") {
      var input = $("#quiz-input");
      input.disabled = true;
      input.classList.add(ok ? "is-right" : "is-wrong");
    }

    Store.quizAnswer(q.word.w, (Store.currentBook() || {}).id, ok);
    if (ok) run.correct++;
    else run.wrong.push(q.word);

    var fb = $("#quiz-feedback");
    fb.hidden = false;
    fb.className = "quiz-feedback " + (ok ? "ok" : "no");
    fb.innerHTML =
      '<p class="quiz-fb-title">' + (ok ? "回答正确" : "回答错误") + "</p>" +
      '<p class="quiz-fb-word"><b>' + esc(q.word.w) + "</b>" +
        (q.word.p ? ' <span>/ ' + esc(q.word.p) + " /</span>" : "") + "</p>" +
      '<p class="quiz-fb-mean">' + esc(q.word.m || "") + "</p>" +
      (ok ? "" : '<p class="quiz-fb-tip">这个词已加入错题本，稍后会在复习里再见。</p>');

    if (!ok && window.App && window.App.toast) { /* 反馈已在卡片中展示 */ }

    $("#quiz-next").hidden = false;
    $("#quiz-next").textContent = (run.i + 1 >= run.total) ? "查看结果" : "下一题";
    $("#quiz-kbd-hint").hidden = true;
  }

  function submitSpell() {
    if (!run || run.answered) return;
    var input = $("#quiz-input");
    var val = input.value.trim();
    if (!val) { toast("先输入你记得的拼写"); return; }
    answer(val);
  }

  function next() {
    if (!run || !run.answered) return;
    run.i++;
    if (run.i >= run.total) finish();
    else renderQuestion();
  }

  /* ---------------- 结果 ---------------- */

  function finish() {
    var total = run.total;
    var acc = total ? Math.round(run.correct / total * 100) : 0;
    var mins = Math.max(1, Math.round((Date.now() - run.start) / 60000));

    setRunning(false);
    $("#quiz-run").hidden = true;
    setResult(true);
    $("#quiz-result").hidden = false;
    $("#quiz-score").textContent = run.correct;
    $("#quiz-score-total").textContent = total;
    $("#quiz-result-sub").textContent = acc >= 90 ? "几乎全对，这些词已经很稳了。"
      : acc >= 70 ? "掌握得不错，把错题再过一遍就更牢了。"
      : acc >= 50 ? "有一半记住了，错题建议马上重练。"
      : "这些词还不够熟，先重练错题，再回去看一遍。";
    $("#quiz-result-stats").innerHTML =
      "<div><b>" + run.correct + "</b><span>答对</span></div>" +
      "<div><b>" + run.wrong.length + "</b><span>答错</span></div>" +
      "<div><b>" + acc + "%</b><span>正确率</span></div>" +
      "<div><b>" + mins + "</b><span>用时(分)</span></div>";

    var box = $("#quiz-wrong-box");
    if (run.wrong.length) {
      box.hidden = false;
      $("#quiz-wrong-list").innerHTML = run.wrong.map(function (w) {
        return '<div class="quiz-wrong-item"><b>' + esc(w.w) + "</b>" +
          (w.p ? '<span class="quiz-wrong-ph">/ ' + esc(w.p) + " /</span>" : "") +
          '<span class="quiz-wrong-mean">' + esc(w.m || "") + "</span></div>";
      }).join("");
      $("#quiz-retry-wrong").hidden = false;
    } else {
      box.hidden = true;
      $("#quiz-retry-wrong").hidden = true;
    }
    renderSetup();
  }

  /* ---------------- 事件 ---------------- */

  function init() {
    var setup = $("#quiz-setup");
    if (!setup) return;

    $("#quiz-modes").addEventListener("click", function (e) {
      var b = e.target.closest("[data-mode]");
      if (!b) return;
      cfg.mode = b.getAttribute("data-mode");
      $$("#quiz-modes .quiz-mode").forEach(function (x) {
        x.classList.toggle("is-active", x === b);
      });
    });

    $("#quiz-size").addEventListener("click", function (e) {
      var b = e.target.closest("[data-size]");
      if (!b) return;
      cfg.size = parseInt(b.getAttribute("data-size"), 10) || 10;
      $$("#quiz-size .seg-btn").forEach(function (x) {
        x.classList.toggle("is-active", x === b);
      });
    });

    $("#quiz-scope").addEventListener("change", function () {
      cfg.scope = this.value;
      $("#quiz-scope-sub").textContent = SCOPE_SUB[cfg.scope] || "";
    });

    $("#btn-quiz-start").addEventListener("click", start);

    $("#btn-quiz-mistakes").addEventListener("click", function () {
      var book = Store.currentBook();
      var pool = Store.quizPool(book.id, "mistake", cfg.size);
      if (!pool.length) { toast(SCOPE_EMPTY.mistake); return; }
      startWith(pool);
    });

    $("#quiz-exit").addEventListener("click", function () {
      if (run && !run.answered && run.i === 0) { showSetup(); return; }
      showSetup();
      renderSetup();
    });

    $("#quiz-options").addEventListener("click", function (e) {
      var b = e.target.closest("[data-opt]");
      if (b && run && !run.answered) answer(b.getAttribute("data-opt"));
    });

    $("#quiz-speak").addEventListener("click", function () {
      if (!run) return;
      var q = run.questions[run.i];
      if (q) speak(q.word.w);
    });

    $("#quiz-submit").addEventListener("click", submitSpell);
    $("#quiz-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submitSpell(); }
    });

    $("#quiz-next").addEventListener("click", next);
    $("#quiz-retry-wrong").addEventListener("click", function () {
      if (!run || !run.wrong.length) return;
      startWith(run.wrong.slice());
    });
    $("#quiz-again").addEventListener("click", function () { start(); });
    $("#quiz-back").addEventListener("click", function () { showSetup(); });

    document.addEventListener("keydown", function (e) {
      if (!$("#view-quiz").classList.contains("is-active")) return;
      if ($("#quiz-run").hidden) return;
      if (e.key === "Escape") { showSetup(); return; }
      if (e.target && e.target.id === "quiz-input") return;
      var q = run && run.questions[run.i];
      if (!q) return;

      if (!run.answered) {
        if (["1", "2", "3", "4"].indexOf(e.key) !== -1 && q.options) {
          var opt = q.options[parseInt(e.key, 10) - 1];
          if (opt != null) { e.preventDefault(); answer(opt); }
        }
        return;
      }
      if (e.key === "Enter" || e.code === "Space") {
        e.preventDefault();
        next();
      }
    });
  }

  window.Quiz = { init: init, render: render };
})();
