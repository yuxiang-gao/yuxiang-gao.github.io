/* Yuxiang Gao — about.yuxiang.io
   1. Language switch (中 / EN) driven by html[data-lang].
   2. The intro robot's pupils follow the cursor.
   3. Teach-by-demonstration mini-game: draw a route around the boxes
      to the charging pad; the robot replays your demonstration.
   4. Sections fade in on scroll.
   All of it degrades gracefully without JS. */

(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- language switch (中 / EN) ---- */
  var root = document.documentElement;
  var langToggle = document.querySelector(".lang-toggle");
  var storedLang = null;
  try {
    storedLang = localStorage.getItem("lang");
  } catch (e) { /* private mode etc. — fall back to browser language */ }

  var lang = storedLang === "zh" || storedLang === "en"
    ? storedLang
    : ((navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en");

  function applyLang(next) {
    lang = next;
    root.setAttribute("data-lang", next);
    root.lang = next === "zh" ? "zh-Hans" : "en";
    document.title = next === "zh"
      ? "高宇翔 Yuxiang Gao · 机器人研究者，COCO Matrix 创始人"
      : "Yuxiang Gao 高宇翔 · roboticist, founder of COCO Matrix";
    if (langToggle) {
      langToggle.textContent = next === "zh" ? "EN" : "中文";
      langToggle.setAttribute("aria-label", next === "zh" ? "Switch to English" : "切换到中文");
      langToggle.setAttribute("lang", next === "zh" ? "en" : "zh-Hans");
    }
    var nav = document.querySelector(".top-links");
    if (nav) {
      nav.setAttribute("aria-label", next === "zh" ? "联系方式与语言" : "Contact and language");
    }
    var portrait = document.querySelector(".intro-photo .portrait");
    if (portrait) {
      portrait.alt = next === "zh"
        ? "高宇翔，站在山间紫色暮色的天空下"
        : "Yuxiang Gao in front of a violet dusk sky over the mountains";
    }
    var teachPanel = document.querySelector(".teach");
    if (teachPanel) {
      teachPanel.setAttribute("aria-label", next === "zh"
        ? "互动小游戏，用鼠标或手指画一条路线"
        : "Interactive demo. Draw a route with mouse or touch.");
    }
  }

  applyLang(lang);

  if (langToggle) {
    langToggle.addEventListener("click", function () {
      applyLang(lang === "zh" ? "en" : "zh");
      try {
        localStorage.setItem("lang", lang);
      } catch (e) { /* non-persistent contexts are fine */ }
    });
  }

  /* ---- pupil tracking on the intro robot ---- */
  var mark = document.querySelector(".hero-mark .coco-mark");
  var pupils = mark ? mark.querySelector(".pupils") : null;
  var hasFinePointer = window.matchMedia("(pointer: fine)").matches;

  if (pupils && hasFinePointer && !reducedMotion) {
    var MAX_SHIFT = 20; // svg user units; pupils stay inside the face
    var frame = null;

    document.addEventListener("mousemove", function (event) {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = null;
        var rect = mark.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = event.clientX - cx;
        var dy = event.clientY - cy;
        var distance = Math.hypot(dx, dy) || 1;
        var reach = Math.min(1, distance / 420);
        var x = (dx / distance) * MAX_SHIFT * reach;
        var y = (dy / distance) * MAX_SHIFT * reach * 0.6;
        pupils.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
      });
    });
  }

  /* ---- teach-by-demonstration mini-game ----
     A round has a charging pad (goal) and a few boxes (obstacles).
     Draw a route; the robot replays it. Hit a box and it stops;
     reach the pad and a fresh round is laid out. */
  var teach = document.querySelector(".teach");
  if (teach) {
    var SVG_NS = "http://www.w3.org/2000/svg";
    var trace = teach.querySelector(".teach-trace");
    var bot = teach.querySelector(".teach-bot");
    var goalGroup = teach.querySelector(".teach-goal");
    var obstacleGroup = teach.querySelector(".teach-obstacles");
    var statusEn = document.querySelector("[data-status-en]");
    var statusZh = document.querySelector("[data-status-zh]");

    var STATUS = {
      idle: {
        en: "// draw a route around the boxes, end at the charger.",
        zh: "// 绕开箱子，一笔画到充电桩。"
      },
      watch: {
        en: "// watching your demonstration…",
        zh: "// 正在观察你的示范……"
      },
      run: {
        en: "// learned. executing.",
        zh: "// 学会了，执行中。"
      },
      charged: {
        en: "// charged. one demonstration was enough.",
        zh: "// 充上电了，示范一遍就够。"
      },
      bump: {
        en: "// bumped into a box. teach it a better route?",
        zh: "// 撞上箱子了，再教一条更好的路线？"
      },
      miss: {
        en: "// it followed your demo. the charger is over there, though.",
        zh: "// 它照你教的走完了，可充电桩还在那边。"
      }
    };

    var setStatus = function (key) {
      if (statusEn) statusEn.textContent = STATUS[key].en;
      if (statusZh) statusZh.textContent = STATUS[key].zh;
    };

    var BOT_R = 20;        // collision radius around the robot's center
    var GOAL_R = 40;       // how close counts as reaching the pad
    var pts = [];
    var drawing = false;
    var activePointerId = null;
    var animId = null;
    var roundTimer = null;
    var resizeTimer = null;
    var lastWidth = 0;
    var botPos = { x: 56, y: 120 };
    var goal = { x: 0, y: 0 };
    var obstacles = [];

    var stopEverything = function () {
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
      if (roundTimer) {
        clearTimeout(roundTimer);
        roundTimer = null;
      }
      goalGroup.classList.remove("lit");
      drawing = false;
      activePointerId = null;
    };

    var placeBot = function (x, y) {
      botPos = { x: x, y: y };
      bot.style.transform = "translate(" + x + "px," + y + "px)";
    };

    var renderTrace = function () {
      trace.setAttribute(
        "points",
        pts.map(function (p) { return p.x + "," + p.y; }).join(" ")
      );
    };

    var inObstacle = function (p) {
      for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i];
        if (
          p.x > o.x - BOT_R && p.x < o.x + o.w + BOT_R &&
          p.y > o.y - BOT_R && p.y < o.y + o.h + BOT_R
        ) {
          return true;
        }
      }
      return false;
    };

    var layoutRound = function () {
      var w = teach.clientWidth;
      var h = teach.clientHeight;

      /* the charger spawns far from wherever the robot stands, so no
         round starts almost-solved */
      var minDist = Math.min(Math.max(w * 0.5, 240), w - 120);
      var candidate = null;
      var goalTries = 0;
      while (goalTries < 60) {
        goalTries++;
        var cand = {
          x: 45 + Math.random() * (w - 90),
          y: 45 + Math.random() * (h - 90)
        };
        if (Math.hypot(cand.x - botPos.x, cand.y - botPos.y) >= minDist) {
          candidate = cand;
          break;
        }
      }
      goal = candidate || {
        x: botPos.x < w / 2 ? w - 55 : 55,
        y: 45 + Math.random() * (h - 90)
      };
      goalGroup.setAttribute(
        "transform",
        "translate(" + (goal.x - 22) + " " + (goal.y - 22) + ")"
      );
      goalGroup.classList.remove("lit");

      obstacles = [];
      while (obstacleGroup.firstChild) {
        obstacleGroup.removeChild(obstacleGroup.firstChild);
      }
      var wanted = w < 480 ? 2 : 3;
      var attempts = 0;
      while (obstacles.length < wanted && attempts < 40) {
        attempts++;
        var ow = 28 + Math.random() * 18;
        var oh = 55 + Math.random() * (h * 0.35);
        var ox = w * 0.22 + Math.random() * (w * 0.5);
        var oy = 14 + Math.random() * (h - oh - 28);
        var clearOfBot = botPos.x < ox - 34 || botPos.x > ox + ow + 34 ||
          botPos.y < oy - 34 || botPos.y > oy + oh + 34;
        var clearOfGoal = goal.x < ox - 40 || goal.x > ox + ow + 40 ||
          goal.y < oy - 40 || goal.y > oy + oh + 40;
        /* keep boxes apart so a corridor always exists between them */
        var clearOfOthers = obstacles.every(function (o) {
          return ox + ow < o.x - 60 || ox > o.x + o.w + 60 ||
            oy + oh < o.y - 40 || oy > o.y + o.h + 40;
        });
        if (!clearOfBot || !clearOfGoal || !clearOfOthers) continue;
        obstacles.push({ x: ox, y: oy, w: ow, h: oh });
        var rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", ox);
        rect.setAttribute("y", oy);
        rect.setAttribute("width", ow);
        rect.setAttribute("height", oh);
        rect.setAttribute("rx", 8);
        obstacleGroup.appendChild(rect);
      }
    };

    var finishRound = function (reachedGoal) {
      if (reachedGoal) {
        goalGroup.classList.add("lit");
        setStatus("charged");
        roundTimer = setTimeout(function () {
          pts = [];
          renderTrace();
          layoutRound();
          setStatus("idle");
        }, 1600);
      } else {
        setStatus("miss");
      }
    };

    var bumpBot = function () {
      bot.classList.add("bump");
      setTimeout(function () {
        bot.classList.remove("bump");
      }, 500);
      setStatus("bump");
    };

    var replay = function () {
      if (!pts.length) {
        setStatus("idle");
        return;
      }
      /* the robot walks from where it stands to your stroke, then along it */
      var path = [{ x: botPos.x, y: botPos.y }].concat(pts);
      var seg = [0];
      var total = 0;
      for (var i = 1; i < path.length; i++) {
        total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        seg.push(total);
      }
      var end = path[path.length - 1];

      /* the robot always stops just OUTSIDE a box it hits, so the next
         demonstration can start from a safe spot and the game continues */
      var lastSafe = { x: path[0].x, y: path[0].y };
      var escaped = !inObstacle(path[0]);

      if (reducedMotion || total < 2) {
        /* no animation: still respect the course */
        for (var k = 1; k < path.length; k++) {
          var hitK = inObstacle(path[k]);
          if (!escaped) {
            if (!hitK) escaped = true;
          } else if (hitK) {
            placeBot(lastSafe.x, lastSafe.y);
            bumpBot();
            return;
          }
          if (!hitK) lastSafe = path[k];
        }
        placeBot(end.x, end.y);
        finishRound(Math.hypot(end.x - goal.x, end.y - goal.y) < GOAL_R);
        return;
      }

      setStatus("run");
      var duration = Math.max(650, (total / 260) * 1000);
      var t0 = performance.now();
      var step = function (now) {
        var t = Math.min(1, (now - t0) / duration);
        var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        var dist = eased * total;
        var j = 1;
        while (j < seg.length - 1 && seg[j] < dist) j++;
        var span = seg[j] - seg[j - 1] || 1;
        var f = (dist - seg[j - 1]) / span;
        var x = path[j - 1].x + (path[j].x - path[j - 1].x) * f;
        var y = path[j - 1].y + (path[j].y - path[j - 1].y) * f;
        placeBot(x, y);
        var hit = inObstacle({ x: x, y: y });
        if (!escaped) {
          if (!hit) escaped = true;
        } else if (hit) {
          animId = null;
          placeBot(lastSafe.x, lastSafe.y);
          bumpBot();
          return;
        }
        if (!hit) lastSafe = { x: x, y: y };
        if (t < 1) {
          animId = requestAnimationFrame(step);
        } else {
          animId = null;
          finishRound(Math.hypot(x - goal.x, y - goal.y) < GOAL_R);
        }
      };
      animId = requestAnimationFrame(step);
    };

    var localPoint = function (event) {
      var r = teach.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    };

    teach.addEventListener("pointerdown", function (event) {
      if (drawing) return; // one demonstration at a time; ignore extra fingers
      stopEverything();
      drawing = true;
      activePointerId = event.pointerId;
      pts = [localPoint(event)];
      renderTrace();
      setStatus("watch");
      try {
        if (teach.setPointerCapture) teach.setPointerCapture(event.pointerId);
      } catch (e) { /* pointer already released — capture is best-effort */ }
      event.preventDefault();
    });

    teach.addEventListener("pointermove", function (event) {
      if (!drawing || event.pointerId !== activePointerId) return;
      var p = localPoint(event);
      var last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 4 && pts.length < 800) {
        pts.push(p);
        renderTrace();
      }
    });

    teach.addEventListener("pointerup", function (event) {
      if (!drawing || event.pointerId !== activePointerId) return;
      drawing = false;
      activePointerId = null;
      replay();
    });

    teach.addEventListener("pointercancel", function (event) {
      if (event.pointerId !== activePointerId) return;
      drawing = false;
      activePointerId = null;
      setStatus("idle");
    });

    window.addEventListener("resize", function () {
      /* debounced, width-change only: mobile URL-bar show/hide fires
         height-only resizes that must not reset a round mid-play */
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var w = teach.clientWidth;
        if (w === lastWidth) return;
        lastWidth = w;
        stopEverything();
        var h = teach.clientHeight;
        placeBot(Math.min(botPos.x, w - 30), Math.min(botPos.y, h - 30));
        pts = [];
        renderTrace();
        layoutRound();
        setStatus("idle");
      }, 150);
    });

    lastWidth = teach.clientWidth;
    placeBot(56, (teach.clientHeight || 240) / 2);
    layoutRound();
    setStatus("idle");
  }

  /* ---- scroll reveal ---- */
  var revealed = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window) || reducedMotion) {
    revealed.forEach(function (el) {
      el.classList.add("is-visible");
    });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      /* Low threshold: tall blocks (the COCO card, the timeline) must reveal
         as soon as they enter, not once 10%+ of their height is on screen. */
      { threshold: 0.05, rootMargin: "0px 0px -4% 0px" }
    );

    revealed.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ---- a note for fellow tinkerers ---- */
  if (window.console && console.log) {
    console.log(
      "%cCOCO-01 online. It learns from people — so do I. → gaoyuxiang@cocomatrix.cn",
      "color:#12d2f2;font-family:monospace"
    );
  }
})();
