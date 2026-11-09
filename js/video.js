/* ============================================================
   墨记单词 · 视频学习
   - YouTube 嵌入 + 字幕自动抓取（失败可手动导入）
   - 本地视频 + 字幕同步
   - 仅字幕模式（Netflix 等受 DRM 保护的内容）
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
  function toast(msg) {
    if (window.App && window.App.toast) window.App.toast(msg);
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
  }

  /* ============================================================
     字幕解析
     ============================================================ */

  function decodeEntities(s) {
    return String(s)
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'");
  }

  function parseTimestamp(t) {
    t = String(t || "").trim().replace(",", ".");
    var parts = t.split(":");
    var sec = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parseFloat(parts[i]);
      if (!isFinite(n)) return NaN;
      sec = sec * 60 + n;
    }
    return sec;
  }

  function cleanSubText(s) {
    s = String(s || "")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/<[^>]*>/g, " ");
    s = decodeEntities(s);
    return s.split("\n").map(function (l) {
      return l.replace(/\s+/g, " ").trim();
    }).filter(Boolean).join("\n");
  }

  function hasCJK(s) {
    return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(String(s || ""));
  }

  function splitBilingual(body) {
    var lines = String(body || "").split("\n").filter(Boolean);
    if (lines.length >= 2) {
      var cjk = [], other = [];
      lines.forEach(function (l) { (hasCJK(l) ? cjk : other).push(l); });
      if (cjk.length && other.length) {
        return { en: other.join(" ").trim(), zh: cjk.join(" ").trim() };
      }
    }
    var all = lines.join(" ").trim();
    if (hasCJK(all) && !/[A-Za-z]{2}/.test(all)) return { en: "", zh: all };
    return { en: all, zh: "" };
  }

  function parseSubtitle(text) {
    text = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    var blocks = text.split(/\n{2,}/);
    var out = [];
    var seen = Object.create(null);

    blocks.forEach(function (block) {
      var lines = block.split("\n").map(function (l) { return l.trim(); });
      var ti = -1;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("-->") !== -1) { ti = i; break; }
      }
      if (ti === -1) return;
      var m = lines[ti].match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/);
      if (!m) return;
      var s = parseTimestamp(m[1]);
      var e = parseTimestamp(m[2]);
      if (!isFinite(s) || !isFinite(e) || e <= s) return;

      var body = lines.slice(ti + 1).filter(function (l) {
        return l && !/^(NOTE|STYLE|REGION)\b/.test(l) && !/^(WEBVTT|Kind:|Language:)/.test(l);
      }).join("\n");
      body = cleanSubText(body);
      if (!body) return;

      var bi = splitBilingual(body);
      var key = Math.round(s * 10) + "|" + Math.round(e * 10) + "|" + bi.en + "|" + bi.zh;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ s: s, e: e, en: bi.en, zh: bi.zh });
    });

    out.sort(function (a, b) { return a.s - b.s; });
    return out;
  }

  // YouTube 自动字幕会把一句话切成很多碎片，合并成适合学习的句子
  function mergeShortCues(cues) {
    if (cues.length < 30) return cues;
    var bilingual = cues.filter(function (c) { return !!c.zh; }).length > cues.length * 0.3;
    if (bilingual) return cues;
    var sum = 0, noEnd = 0;
    cues.forEach(function (c) {
      sum += (c.en || "").length;
      if (!/[.?!。？！]$/.test((c.en || "").trim())) noEnd++;
    });
    if (sum / cues.length > 26 || noEnd / cues.length < 0.55) return cues;

    var out = [];
    cues.forEach(function (c) {
      var last = out[out.length - 1];
      var en = (c.en || "").trim();
      if (!en) return;
      if (last && c.s - last.e < 0.8 && last.en.length + en.length < 150 &&
          !/[.?!。？！]$/.test(last.en)) {
        last.en = (last.en + " " + en).trim();
        last.e = c.e;
        if (!last.zh && c.zh) last.zh = c.zh;
      } else {
        out.push({ s: c.s, e: c.e, en: c.en, zh: c.zh });
      }
    });
    return out;
  }

  function joinUnique(arr) {
    var out = [], seen = Object.create(null);
    arr.forEach(function (s) {
      s = String(s || "").trim();
      if (s && !seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out.join(" ").trim();
  }

  // 把中文字幕按时间轴贴到英文字幕上
  function attachZh(cues, zhCues) {
    var zhOnly = zhCues.map(function (z) {
      return { s: z.s, e: z.e, text: z.zh || z.en || "" };
    }).filter(function (z) { return z.text; });

    cues.forEach(function (c) {
      var parts = [];
      zhOnly.forEach(function (z) {
        if (z.s < c.e - 0.05 && z.e > c.s + 0.05) parts.push(z.text);
      });
      if (!parts.length) {
        var best = null, bd = 1e9;
        zhOnly.forEach(function (z) {
          var d = Math.min(Math.abs(z.s - c.s), Math.abs(z.e - c.e));
          if (d < bd) { bd = d; best = z; }
        });
        if (best && bd < 2) parts.push(best.text);
      }
      var zh = joinUnique(parts);
      if (zh) c.zh = zh;
    });
    return cues;
  }

  function readTextFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || "");
      if (text.indexOf("\uFFFD") !== -1) {
        var r2 = new FileReader();
        r2.onload = function () { cb(String(r2.result || "")); };
        r2.onerror = function () { cb(text); };
        try { r2.readAsText(file, "gbk"); } catch (e) { cb(text); }
      } else {
        cb(text);
      }
    };
    reader.onerror = function () { toast("读取文件失败"); };
    reader.readAsText(file, "utf-8");
  }

  /* ============================================================
     YouTube 字幕抓取
     ============================================================ */

  var PROXIES = [
    "https://api.allorigins.win/raw?url=",
    "https://api.codetabs.com/v1/proxy?quest=",
    "https://corsproxy.io/?url="
  ];

  function proxiedFetch(url) {
    var i = 0;
    function attempt() {
      if (i >= PROXIES.length) return Promise.reject(new Error("字幕代理不可用"));
      var prefix = PROXIES[i++];
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, 12000) : null;
      var opts = controller ? { signal: controller.signal } : {};
      return fetch(prefix + encodeURIComponent(url), opts).then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      }).catch(function () {
        if (timer) clearTimeout(timer);
        return attempt();
      });
    }
    return attempt();
  }

  function extractJsonArray(text, key) {
    var k = text.indexOf('"' + key + '":');
    if (k === -1) return null;
    var start = text.indexOf("[", k);
    if (start === -1) return null;
    var depth = 0, inStr = false, escFlag = false;
    for (var i = start; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inStr) {
        if (escFlag) escFlag = false;
        else if (ch === "\\") escFlag = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "[") depth++;
        else if (ch === "]") { depth--; if (depth === 0) return text.slice(start, i + 1); }
      }
    }
    return null;
  }

  function cuesFromJson3(text) {
    var data = JSON.parse(text);
    var events = data.events || [];
    var out = [];
    events.forEach(function (ev) {
      var body = (ev.segs || []).map(function (s) { return s.utf8 || ""; }).join("");
      body = body.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
      if (!body || ev.tStartMs == null) return;
      var s = ev.tStartMs / 1000;
      var e = s + (ev.dDurationMs || 0) / 1000;
      if (e <= s) e = s + 1;
      out.push({ s: s, e: e, en: body, zh: "" });
    });
    return out;
  }

  function cuesFromXml(text) {
    var re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    var out = [], m;
    while ((m = re.exec(text))) {
      var attrs = m[1] || "";
      var sm = /start="([\d.]+)"/.exec(attrs);
      var dm = /dur="([\d.]+)"/.exec(attrs);
      if (!sm) continue;
      var s = parseFloat(sm[1]);
      var e = s + (dm ? parseFloat(dm[1]) : 2);
      var body = decodeEntities(m[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      if (!body) continue;
      out.push({ s: s, e: e, en: body, zh: "" });
    }
    return out;
  }

  function extractYouTubeTitle(html) {
    var m = String(html || "").match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) return "";
    var t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    return t.replace(/\s*-\s*YouTube\s*$/i, "").trim();
  }

  function cuesFromYouTubeUrl(base) {
    var jsonUrl = base + (base.indexOf("?") === -1 ? "?" : "&") + "fmt=json3";
    return proxiedFetch(jsonUrl).then(function (txt) {
      try {
        var c = cuesFromJson3(txt);
        if (c.length) return c;
      } catch (e) {}
      var x = cuesFromXml(txt);
      if (x.length) return x;
      var v = parseSubtitle(txt);
      return v;
    });
  }

  function fetchYouTubeCaptions(videoId) {
    var htmlText = "";
    var watch = "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId) + "&hl=en";
    return proxiedFetch(watch).then(function (html) {
      htmlText = html;
      var arrText = extractJsonArray(html, "captionTracks");
      if (!arrText) throw new Error("no captionTracks");
      var tracks = JSON.parse(arrText);
      if (!tracks || !tracks.length) throw new Error("no tracks");

      var track = null;
      for (var i = 0; i < tracks.length; i++) {
        if (/^en(\.|-|$)/i.test(tracks[i].languageCode || "")) { track = tracks[i]; break; }
      }
      if (!track) track = tracks[0];

      var base = String(track.baseUrl || "")
        .replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
      if (!base) throw new Error("no baseUrl");
      return cuesFromYouTubeUrl(base);
    }).then(function (cues) {
      if (!cues || !cues.length) throw new Error("empty captions");
      return {
        cues: mergeShortCues(cues),
        title: extractYouTubeTitle(htmlText)
      };
    }).catch(function () {
      // 直接尝试 timedtext 接口作为兜底
      var langs = ["en", "en-US", "en-GB"];
      var chain = Promise.reject(new Error("start"));
      langs.forEach(function (lang) {
        chain = chain.catch(function () {
          var u = "https://www.youtube.com/api/timedtext?lang=" + lang + "&v=" + encodeURIComponent(videoId);
          return proxiedFetch(u).then(function (txt) {
            var c = cuesFromXml(txt);
            if (!c.length) throw new Error("empty");
            return { cues: mergeShortCues(c), title: "" };
          });
        });
      });
      return chain;
    });
  }

  /* ============================================================
     YouTube IFrame API
     ============================================================ */

  function loadYouTubeApi(cb) {
    if (window.YT && window.YT.Player) { cb(); return; }
    if (!window.__ytQueue) {
      window.__ytQueue = [];
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") { try { prev(); } catch (e) {} }
        var q = window.__ytQueue || [];
        window.__ytQueue = [];
        q.forEach(function (fn) { try { fn(); } catch (e) {} });
      };
      var tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      document.head.appendChild(tag);
    }
    window.__ytQueue.push(cb);
  }

  /* ============================================================
     状态
     ============================================================ */

  var addMode = "youtube";
  var pending = { videoFile: null, localSubText: "", subOnlyText: "" };
  var subtitleCallback = null;
  var localFiles = {};   // videoId -> { url, file }
  var current = null;    // 当前播放会话
  var tickTimer = null;

  /* ============================================================
     视频列表
     ============================================================ */

  var TYPE_LABEL = { youtube: "YouTube", local: "本地视频", subtitle: "仅字幕" };

  function renderList() {
    var list = Store.videos();
    var empty = $("#video-empty");
    if (empty) empty.hidden = list.length > 0;

    var el = $("#video-list");
    if (!el) return;

    el.innerHTML = list.map(function (v) {
      var p = Store.videoProgress(v.id);
      var pct = Math.round(p.pct * 100);
      var meta = (TYPE_LABEL[v.type] || "视频") + " · " + p.total + " 句 · 已学 " + p.learned;
      return '<button class="video-card" data-open="' + esc(v.id) + '">' +
        '<span class="video-thumb ' + esc(v.type) + '"><svg class="ic"><use href="#i-play"></use></svg></span>' +
        '<span class="video-info">' +
          '<span class="video-name">' + esc(v.title || "未命名视频") + '</span>' +
          '<span class="video-meta">' + esc(meta) + '</span>' +
          '<span class="video-bar"><i style="width:' + pct + '%"></i></span>' +
        '</span>' +
        '<span class="video-go"><svg class="ic"><use href="#i-chevron"></use></svg></span>' +
      '</button>';
    }).join("");
  }

  /* ============================================================
     添加视频弹层
     ============================================================ */

  function setMode(mode) {
    addMode = mode;
    $$("#add-mode .seg-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-mode") === mode);
    });
    $$("#add-video .add-pane").forEach(function (p) {
      p.hidden = p.getAttribute("data-pane") !== mode;
    });
  }

  function openAdd() {
    pending = { videoFile: null, localSubText: "", subOnlyText: "" };
    $("#yt-url").value = "";
    $("#yt-title").value = "";
    $("#sub-title").value = "";
    $("#sub-paste").value = "";
    $("#picked-video-name").textContent = "未选择视频";
    $("#picked-sub-name").textContent = "未选择字幕";
    $("#picked-sub-only-name").textContent = "未选择字幕";
    setMode("youtube");
    $("#add-video").hidden = false;
    $("#add-video-backdrop").hidden = false;
  }

  function closeAdd() {
    $("#add-video").hidden = true;
    $("#add-video-backdrop").hidden = true;
  }

  function pickSubtitle(cb) {
    subtitleCallback = cb;
    $("#file-subtitle").click();
  }

  function youtubeId(input) {
    input = String(input || "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
    var m = input.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/|\/v\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
  }

  function submitAdd() {
    if (addMode === "youtube") {
      var vid = youtubeId($("#yt-url").value);
      if (!vid) { toast("请填写有效的 YouTube 链接"); return; }
      var customTitle = $("#yt-title").value.trim();
      var v = Store.addVideo({
        type: "youtube",
        title: customTitle || "YouTube 视频",
        url: $("#yt-url").value.trim(),
        videoId: vid
      });
      closeAdd();
      openVideo(v.id);
      toast("正在抓取字幕…");
      fetchYouTubeCaptions(vid).then(function (res) {
        var patch = { cues: res.cues };
        if (!customTitle && res.title) patch.title = res.title;
        Store.updateVideo(v.id, patch);
        if (current && current.v.id === v.id) {
          current.cues = res.cues;
          current.v = Store.getVideo(v.id);
          $("#player-title").textContent = current.v.title;
          renderCues();
          highlightActive(true);
        }
        toast("已抓取 " + res.cues.length + " 句字幕");
        renderList();
      }).catch(function () {
        toast("字幕抓取失败，请点「字幕」手动导入 SRT / VTT");
      });
      return;
    }

    if (addMode === "local") {
      if (!pending.videoFile) { toast("请选择视频文件"); return; }
      var file = pending.videoFile;
      var lv = Store.addVideo({
        type: "local",
        title: file.name.replace(/\.[^.]+$/, ""),
        cues: []
      });
      localFiles[lv.id] = { url: URL.createObjectURL(file), file: file };
      if (pending.localSubText) {
        var lcues = parseSubtitle(pending.localSubText);
        if (lcues.length) Store.updateVideo(lv.id, { cues: mergeShortCues(lcues) });
      }
      closeAdd();
      openVideo(lv.id);
      if (!pending.localSubText) toast("已添加本地视频，可点「字幕」导入字幕");
      return;
    }

    var text = pending.subOnlyText || $("#sub-paste").value || "";
    if (!String(text).trim()) { toast("请导入或粘贴字幕"); return; }
    var cues = parseSubtitle(text);
    if (!cues.length) { toast("没有解析到字幕，请确认是 SRT / VTT 格式"); return; }
    var title = $("#sub-title").value.trim() || "仅字幕项目";
    var sv = Store.addVideo({
      type: "subtitle",
      title: title,
      cues: mergeShortCues(cues)
    });
    closeAdd();
    openVideo(sv.id);
    toast("已导入 " + sv.cues.length + " 句");
  }

  /* ============================================================
     播放器
     ============================================================ */

  function openVideo(id) {
    var v = Store.getVideo(id);
    if (!v) return;
    current = {
      v: v,
      cues: (v.cues || []).slice(),
      index: -1,
      yt: null,
      ytReady: false,
      localUrl: localFiles[id] ? localFiles[id].url : "",
      lastSave: v.pos || 0,
      pausedAtCue: -1
    };
    $("#player").hidden = false;
    $("#player-title").textContent = v.title || "视频学习";
    $("#player-only-unlearned").checked = false;
    $("#player-autopause").checked = false;
    $("#player-overlay").checked = true;
    setupStage();
    renderCues();
    highlightActive(true);
    startTick();
  }

  function closePlayer() {
    stopTick();
    if (current) {
      savePos();
      try {
        if (current.yt && current.yt.pauseVideo) current.yt.pauseVideo();
      } catch (e) {}
      var el = $("#local-video");
      if (el && !el.hidden) { try { el.pause(); } catch (e) {} }
    }
    $("#player").hidden = true;
    $("#sub-overlay").hidden = true;
    current = null;
    renderList();
  }

  function deleteCurrent() {
    if (!current) return;
    if (!confirm("删除这个视频及其字幕进度？")) return;
    var id = current.v.id;
    Store.deleteVideo(id);
    if (localFiles[id]) { try { URL.revokeObjectURL(localFiles[id].url); } catch (e) {} delete localFiles[id]; }
    closePlayer();
    toast("已删除");
  }

  function setupStage() {
    var v = current.v;
    $("#yt-wrap").hidden = true;
    $("#local-video").hidden = true;
    $("#stage-empty").hidden = true;
    $("#btn-reconnect").hidden = true;
    $("#stage-empty-text").textContent = "";

    if (v.type === "youtube") {
      $("#yt-wrap").hidden = false;
      ensureYouTube(v);
    } else if (v.type === "local") {
      if (current.localUrl) {
        var el = $("#local-video");
        el.hidden = false;
        if (el.getAttribute("data-src") !== current.localUrl) {
          el.setAttribute("data-src", current.localUrl);
          el.src = current.localUrl;
          el.load();
        }
        el.onloadedmetadata = function () {
          if (!current) return;
          var pos = current.v.pos || 0;
          if (pos > 0 && pos < (el.duration || 1e9)) {
            try { el.currentTime = pos; } catch (e) {}
          }
        };
      } else {
        $("#stage-empty").hidden = false;
        $("#stage-empty-text").textContent = "刷新页面后，本地视频需要重新选择同一个文件。";
        $("#btn-reconnect").hidden = false;
      }
    } else {
      $("#stage-empty").hidden = false;
      $("#stage-empty-text").textContent = "仅字幕模式 · 请在 Netflix 或其他播放器里播放，这里逐句学习。";
      $("#btn-reconnect").hidden = true;
    }
    updateOverlay();
  }

  function ensureYouTube(v) {
    $("#yt-player").innerHTML = '<div id="yt-frame-inner"></div>';
    loadYouTubeApi(function () {
      if (!current || current.v.id !== v.id) return;
      try {
        current.yt = new window.YT.Player("yt-frame-inner", {
          videoId: v.videoId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            cc_load_policy: 0,
            origin: location.origin
          },
          events: {
            onReady: function () {
              current.ytReady = true;
              $("#stage-empty").hidden = true;
              var pos = current.v.pos || 0;
              if (pos > 1) {
                try { current.yt.seekTo(pos, true); } catch (e) {}
              }
            },
            onStateChange: function (e) {
              if (!current) return;
              if (e.data === 1) current.pausedAtCue = -1;
              if (e.data === 2) savePos();
            },
            onError: function () {
              $("#stage-empty").hidden = false;
              $("#stage-empty-text").textContent = "YouTube 播放器加载失败，可能是网络或嵌入限制。仍可导入字幕后逐句学习。";
            }
          }
        });
      } catch (e) {
        $("#stage-empty").hidden = false;
        $("#stage-empty-text").textContent = "YouTube 播放器初始化失败。";
      }
    });

    // 脚本被网络拦截时给出提示
    setTimeout(function () {
      if (!current || current.v.id !== v.id) return;
      if (!current.ytReady) {
        $("#stage-empty").hidden = false;
        $("#stage-empty-text").textContent = "YouTube 播放器加载较慢或已被网络拦截。仍可导入字幕后逐句学习。";
      }
    }, 8000);
  }

  function getTime() {
    if (!current) return null;
    if (current.v.type === "youtube") {
      if (!current.ytReady || !current.yt) return null;
      try {
        var t = current.yt.getCurrentTime();
        return isFinite(t) ? t : null;
      } catch (e) { return null; }
    }
    if (current.v.type === "local") {
      var el = $("#local-video");
      if (!el || el.hidden || !isFinite(el.currentTime)) return null;
      return el.currentTime;
    }
    return null;
  }

  function isPlaying() {
    if (!current) return false;
    if (current.v.type === "youtube") {
      try { return current.ytReady && current.yt.getPlayerState() === 1; } catch (e) { return false; }
    }
    if (current.v.type === "local") {
      var el = $("#local-video");
      return !!el && !el.hidden && !el.paused;
    }
    return false;
  }

  function pausePlayback() {
    if (!current) return;
    if (current.v.type === "youtube") {
      try { current.yt.pauseVideo(); } catch (e) {}
    } else if (current.v.type === "local") {
      try { $("#local-video").pause(); } catch (e) {}
    }
  }

  function savePos() {
    if (!current) return;
    var t = getTime();
    if (t != null) Store.setVideoPos(current.v.id, t);
  }

  function startTick() {
    stopTick();
    tickTimer = setInterval(tick, 250);
  }
  function stopTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function findCueAt(t) {
    if (!current) return -1;
    var cues = current.cues;
    for (var i = 0; i < cues.length; i++) {
      if (t >= cues[i].s - 0.12 && t < cues[i].e + 0.3) return i;
    }
    return -1;
  }

  function tick() {
    if (!current) return;
    var t = getTime();
    if (t == null) return;

    var idx = findCueAt(t);
    if (idx !== current.index) {
      current.index = idx;
      highlightActive();
    }

    if ($("#player-autopause").checked && idx >= 0 && isPlaying() &&
        current.pausedAtCue !== idx && t >= current.cues[idx].e - 0.06) {
      current.pausedAtCue = idx;
      pausePlayback();
    }

    if (Math.abs(t - current.lastSave) > 4) {
      current.lastSave = t;
      Store.setVideoPos(current.v.id, t);
    }
  }

  /* ---------- 显示 ---------- */

  function learnedOf(i) {
    return !!(current && current.v.learned && current.v.learned[i]);
  }

  function cueHtml(c, i, learned) {
    return '<div class="cue' + (learned ? " learned" : "") + '" data-idx="' + i + '">' +
      '<button class="cue-check" data-learn="' + i + '" aria-label="标记已学">' +
        '<svg class="ic"><use href="#i-check"></use></svg>' +
      '</button>' +
      '<div class="cue-main">' +
        '<div class="cue-top"><span class="cue-time">' + fmtTime(c.s) + '</span>' +
          (learned ? '<span class="cue-tag">已学</span>' : '') +
        '</div>' +
        '<p class="cue-en">' + tokens(c.en || "") + '</p>' +
        (c.zh ? '<p class="cue-zh">' + esc(c.zh) + '</p>' : '') +
      '</div>' +
    '</div>';
  }

  function renderCues() {
    if (!current) return;
    var filter = $("#player-only-unlearned").checked;
    var v = current.v;
    var rows = "";
    current.cues.forEach(function (c, i) {
      var learned = !!(v.learned && v.learned[i]);
      if (filter && learned) return;
      rows += cueHtml(c, i, learned);
    });
    $("#cue-list").innerHTML = rows;
    $("#cue-empty").hidden = current.cues.length > 0;
    $("#btn-retry-captions").hidden = !(current.v.type === "youtube" && !current.cues.length);
    $("#btn-import-zh").hidden = !(current.cues.length && !current.cues.some(function (c) { return !!c.zh; }));
    updateProgress();
  }

  function updateProgress() {
    if (!current) return;
    var learned = Object.keys(current.v.learned || {}).length;
    $("#player-progress").textContent = "已学 " + learned + " / " + current.cues.length;
  }

  function highlightActive(forceScroll) {
    if (!current) return;
    var idx = current.index;
    $$("#cue-list .cue").forEach(function (row) {
      var on = parseInt(row.getAttribute("data-idx"), 10) === idx;
      row.classList.toggle("is-active", on);
    });
    if (idx >= 0 && forceScroll) {
      var active = $('#cue-list .cue[data-idx="' + idx + '"]');
      if (active && active.scrollIntoView) {
        try { active.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { active.scrollIntoView(); }
      }
    }
    updateOverlay();
  }

  function updateOverlay() {
    var el = $("#sub-overlay");
    if (!el) return;
    if (!current || !$("#player-overlay").checked || current.index < 0 ||
        current.v.type === "subtitle") {
      el.hidden = true;
      return;
    }
    var c = current.cues[current.index];
    if (!c) { el.hidden = true; return; }
    el.innerHTML = '<span class="ov-en">' + esc(c.en) + '</span>' +
      (c.zh ? '<span class="ov-zh">' + esc(c.zh) + '</span>' : '');
    el.hidden = false;
  }

  /* ---------- 单词 / 句子交互 ---------- */

  function lookupWord(raw) {
    var w = String(raw || "").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (!w) return null;
    var lw = w.toLowerCase();
    var tries = [w, lw];
    if (/ies$/.test(lw)) tries.push(lw.slice(0, -3) + "y");
    if (/ied$/.test(lw)) tries.push(lw.slice(0, -3) + "y");
    if (/ing$/.test(lw)) { tries.push(lw.slice(0, -3)); tries.push(lw.slice(0, -3) + "e"); }
    if (/ed$/.test(lw)) { tries.push(lw.slice(0, -2)); tries.push(lw.slice(0, -1)); }
    if (/es$/.test(lw)) tries.push(lw.slice(0, -2));
    if (/s$/.test(lw) && !/ss$/.test(lw)) tries.push(lw.slice(0, -1));
    if (/ly$/.test(lw)) tries.push(lw.slice(0, -2));
    if (/er$/.test(lw)) { tries.push(lw.slice(0, -2)); tries.push(lw.slice(0, -1)); }
    if (/est$/.test(lw)) tries.push(lw.slice(0, -3));
    for (var i = 0; i < tries.length; i++) {
      var f = Store.findWordAnywhere(tries[i]);
      if (f) return f.word;
    }
    return null;
  }

  function tokens(text) {
    if (!text) return "";
    var parts = String(text).match(/[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-]*|[^A-Za-zÀ-ÖØ-öø-ÿ]+/g) || [];
    return parts.map(function (p) {
      if (!/^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(p)) return esc(p);
      var base = p.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+|[^A-Za-zÀ-ÖØ-öø-ÿ]+$/g, "");
      var info = lookupWord(base);
      return '<button class="cue-word' + (info ? " known" : "") + '" data-word="' +
        esc(info ? info.w : base) + '">' + esc(p) + '</button>';
    }).join("");
  }

  function openWord(word) {
    if (!window.App || !App.openSheet) return;
    var book = Store.currentBook();
    App.openSheet(word, book ? book.id : undefined, {
      videoMode: true,
      onAdd: function () { renderList(); }
    });
  }

  function seekCue(i, play) {
    if (!current) return;
    i = Math.max(0, Math.min(current.cues.length - 1, i));
    var c = current.cues[i];
    if (!c) return;
    current.index = i;
    current.pausedAtCue = -1;

    if (current.v.type === "youtube" && current.ytReady && current.yt) {
      try {
        current.yt.seekTo(c.s, true);
        if (play !== false) current.yt.playVideo();
      } catch (e) {}
    } else if (current.v.type === "local") {
      var el = $("#local-video");
      if (el && !el.hidden) {
        try {
          el.currentTime = c.s;
          if (play !== false) {
            var pr = el.play();
            if (pr && pr.catch) pr.catch(function () {});
          }
        } catch (e) {}
      }
    } else if (current.v.type === "subtitle") {
      if (play !== false) App.speak(c.en || c.zh);
    }

    highlightActive(true);
    updateProgress();
  }

  function nextCue(dir) {
    if (!current || !current.cues.length) return;
    var i = current.index;
    var filter = $("#player-only-unlearned").checked;
    if (i < 0) i = dir > 0 ? -1 : current.cues.length;
    do {
      i += dir;
    } while (i >= 0 && i < current.cues.length && filter && learnedOf(i));
    seekCue(i);
  }

  function toggleLearn(i) {
    if (!current) return;
    var v = current.v;
    if (!v.learned) v.learned = {};
    var learned = !v.learned[i];
    Store.markCue(v.id, i, learned);
    if (learned) v.learned[i] = 1; else delete v.learned[i];

    if ($("#player-only-unlearned").checked) {
      renderCues();
      highlightActive();
    } else {
      var row = $('#cue-list .cue[data-idx="' + i + '"]');
      if (row) {
        row.classList.toggle("learned", learned);
        var tag = row.querySelector(".cue-tag");
        if (learned && !tag) {
          var top = row.querySelector(".cue-top");
          var span = document.createElement("span");
          span.className = "cue-tag";
          span.textContent = "已学";
          if (top) top.appendChild(span);
        } else if (!learned && tag) {
          tag.parentNode.removeChild(tag);
        }
      }
      updateProgress();
    }
    renderList();
    if (learned) toast("已标记为已学");
  }

  /* ---------- 字幕导入 ---------- */

  function applySubtitleText(text) {
    if (!current) return;
    var cues = parseSubtitle(text);
    if (!cues.length) { toast("没有解析到字幕，请确认是 SRT / VTT 格式"); return; }

    var newHasEnglish = cues.some(function (c) { return /[A-Za-z]{3}/.test(c.en); });

    if (current.cues.length && !newHasEnglish) {
      attachZh(current.cues, cues);
      Store.updateVideo(current.v.id, { cues: current.cues, hasZh: true });
      toast("已把中文字幕对齐到 " + current.cues.length + " 句");
    } else {
      current.cues = mergeShortCues(cues);
      current.v.cues = current.cues;
      current.v.learned = {};
      current.index = -1;
      Store.updateVideo(current.v.id, { cues: current.cues, learned: {} });
      toast("已更新字幕，共 " + current.cues.length + " 句");
    }
    renderCues();
    highlightActive();
    renderList();
  }

  function reconnectLocal(file) {
    if (!current || current.v.type !== "local") return;
    var url = URL.createObjectURL(file);
    if (localFiles[current.v.id]) {
      try { URL.revokeObjectURL(localFiles[current.v.id].url); } catch (e) {}
    }
    localFiles[current.v.id] = { url: url, file: file };
    current.localUrl = url;
    setupStage();
    toast("视频已重新加载");
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  function init() {
    $("#btn-add-video").addEventListener("click", openAdd);
    $("#btn-add-video-empty").addEventListener("click", openAdd);
    $("#add-video-close").addEventListener("click", closeAdd);
    $("#add-video-backdrop").addEventListener("click", closeAdd);

    $$("#add-mode .seg-btn").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
    });

    $("#add-video-submit").addEventListener("click", submitAdd);

    $("#pick-video").addEventListener("click", function () { $("#file-video").click(); });
    $("#pick-local-sub").addEventListener("click", function () {
      pickSubtitle(function (text) {
        pending.localSubText = text;
        var n = parseSubtitle(text).length;
        $("#picked-sub-name").textContent = n ? "已选择 · " + n + " 句" : "字幕解析失败";
      });
    });
    $("#pick-sub").addEventListener("click", function () {
      pickSubtitle(function (text) {
        pending.subOnlyText = text;
        var n = parseSubtitle(text).length;
        $("#picked-sub-only-name").textContent = n ? "已选择 · " + n + " 句" : "字幕解析失败";
      });
    });

    $("#file-video").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      pending.videoFile = f;
      $("#picked-video-name").textContent = f.name + " · " + (f.size / 1048576).toFixed(1) + " MB";
    });

    $("#file-subtitle").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      readTextFile(f, function (text) {
        var cb = subtitleCallback;
        subtitleCallback = null;
        if (cb) cb(text);
        else applySubtitleText(text);
      });
    });

    $("#file-reconnect").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) reconnectLocal(f);
    });

    $("#player-back").addEventListener("click", closePlayer);
    $("#player-delete").addEventListener("click", deleteCurrent);

    $("#video-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-open]");
      if (b) openVideo(b.getAttribute("data-open"));
    });

    $("#cue-list").addEventListener("click", function (e) {
      var wb = e.target.closest("[data-word]");
      if (wb) { e.stopPropagation(); openWord(wb.getAttribute("data-word")); return; }

      var cb = e.target.closest("[data-learn]");
      if (cb) { e.stopPropagation(); toggleLearn(parseInt(cb.getAttribute("data-learn"), 10)); return; }

      var row = e.target.closest("[data-idx]");
      if (row) seekCue(parseInt(row.getAttribute("data-idx"), 10));
    });

    $$(".player-tools .tool-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act");
        if (act === "prev") nextCue(-1);
        if (act === "next") nextCue(1);
        if (act === "replay") seekCue(current && current.index >= 0 ? current.index : 0);
        if (act === "sub") {
          if (!current) return;
          pickSubtitle(applySubtitleText);
        }
      });
    });

    $("#player-only-unlearned").addEventListener("change", function () {
      renderCues();
      highlightActive();
    });
    $("#player-overlay").addEventListener("change", updateOverlay);

    $("#btn-import-cue").addEventListener("click", function () {
      if (current) pickSubtitle(applySubtitleText);
    });
    $("#btn-retry-captions").addEventListener("click", function () {
      if (!current || current.v.type !== "youtube") return;
      var ytId = current.v.videoId;
      toast("正在重新抓取字幕…");
      fetchYouTubeCaptions(ytId).then(function (res) {
        if (!current || current.v.videoId !== ytId) return;
        current.cues = res.cues;
        var patch = { cues: res.cues };
        if (res.title && (!current.v.title || current.v.title === "YouTube 视频")) {
          patch.title = res.title;
          $("#player-title").textContent = res.title;
        }
        Store.updateVideo(current.v.id, patch);
        renderCues();
        highlightActive();
        renderList();
        toast("已抓取 " + res.cues.length + " 句字幕");
      }).catch(function () {
        toast("仍然抓不到字幕，请手动导入 SRT / VTT");
      });
    });
    $("#btn-import-zh").addEventListener("click", function () {
      if (!current) return;
      pickSubtitle(function (text) {
        var cues = parseSubtitle(text);
        if (!cues.length) { toast("没有解析到字幕"); return; }
        attachZh(current.cues, cues);
        Store.updateVideo(current.v.id, { cues: current.cues, hasZh: true });
        renderCues();
        highlightActive();
        toast("中文字幕已对齐");
      });
    });
    $("#btn-reconnect").addEventListener("click", function () { $("#file-reconnect").click(); });

    document.addEventListener("keydown", function (e) {
      if ($("#player").hidden) return;
      if (!$("#sheet").hidden || !$("#add-video").hidden) return;
      if (e.key === "Escape") { closePlayer(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); nextCue(1); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); nextCue(-1); return; }
      if (e.code === "Space") {
        e.preventDefault();
        if (!current) return;
        if (isPlaying()) pausePlayback();
        else if (current.v.type === "youtube" && current.ytReady) {
          try { current.yt.playVideo(); } catch (err) {}
        } else if (current.v.type === "local") {
          try { $("#local-video").play(); } catch (err) {}
        } else {
          var c = current.cues[current.index >= 0 ? current.index : 0];
          if (c) App.speak(c.en || c.zh);
        }
      }
    });

    renderList();
  }

  init();

  window.Video = {
    render: renderList,
    open: openVideo
  };
})();
