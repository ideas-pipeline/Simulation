/**
 * رسّام المشهد — Animation Renderer
 * ==================================
 * يرسم المشهد الجانبي ثنائي الأبعاد على Canvas: الأرض، القاعدة، محور
 * الارتكاز، الذراع، الثقل الموازن، المقلاع، المقذوف، مسار الطيران
 * المتقطع، الهدف، ومتجهات القوى عند تفعيل «إظهار القوى».
 *
 * ملاحظة الاتجاه: الصفحة عربية RTL، لذا يُعرض المنجنيق يمين المشهد
 * ويطير المقذوف نحو اليسار (المحور الفيزيائي +x يُعكس على الشاشة).
 * أثناء طور الذراع يقرّب المنظر على الآلة، وبعد التحرير يتسع تدريجيًا
 * ليشمل المسار كاملًا والهدف.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Renderer = (function () {
  'use strict';

  var COLORS = {
    sky: '#eef4fa',
    ground: '#e5dcc7',
    groundLine: '#8a7d5a',
    wood: '#8b5e34',
    woodDark: '#6b4423',
    metal: '#52514e',
    cw: '#3f3e3b',
    projectile: '#0b0b0b',
    rope: '#a5814e',
    traj: '#2a78d6',
    target: '#d03b3b',
    landing: '#1c5cab',
    forceWeight: '#d03b3b',
    forceVel: '#008300',
    forceDrag: '#eb6834',
    torque: '#4a3aa7',
    ink: '#0b0b0b',
    ink2: '#52514e',
    muted: '#898781'
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.result = null;
    this.flightPath = [];
    this.overlays = [];
    this.showTrajectory = true;
    this.showForces = false;
  }

  /** تهيئة نتيجة جديدة وحساب إطاري المنظر (قريب/كامل) */
  Renderer.prototype.setResult = function (result) {
    this.result = result;
    this.flightPath = [];
    if (!result || !result.frames.length) return;

    var p = result.params;
    var Ls = p.slingEnabled ? p.slingLength : 0;
    var Lh = p.swingingCW ? p.hangerLength : 0;

    // مسار الطيران للمتقطع
    for (var i = 0; i < result.frames.length; i++) {
      var f = result.frames[i];
      if (f.phase === 'flight') this.flightPath.push({ x: f.proj.x, y: f.proj.y, t: f.t });
    }

    var yLow = -0.4;
    for (var j = 0; j < result.frames.length; j++) {
      var fr = result.frames[j];
      yLow = Math.min(yLow, fr.proj.y - 0.3, fr.tip.y - 0.3);
      if (fr.phase === 'flight') break; // يكفي طور الذراع
    }

    this.machineView = {
      xMin: -(p.longArm + Ls + 1.2),
      xMax: p.shortArm + Lh + 1.5,
      yMin: yLow,
      yMax: p.pivotHeight + p.longArm + Math.max(Ls * 0.4, 0) + 1
    };
    var maxH = (result.stats && result.stats.maxHeight) || this.machineView.yMax;
    var landX = result.landing ? result.landing.x : 10;
    this.fullView = {
      xMin: this.machineView.xMin,
      xMax: Math.max(p.targetDistance + 6, landX + 6, this.machineView.xMax + 4),
      yMin: yLow,
      yMax: Math.max(maxH + 2, this.machineView.yMax, p.wallEnabled ? p.wallHeight + 2 : 0)
    };
    if (!result.release) this.fullView = this.machineView;
  };

  Renderer.prototype.setOverlays = function (overlays) { this.overlays = overlays || []; };

  /** حالة جدار الحصار (الضرر التراكمي) من الواجهة الرئيسية */
  Renderer.prototype.setWallState = function (state) {
    this.wallState = state || { damagePct: 0, collapsed: false, hits: 0 };
  };

  function lerp(a, b, s) { return a + (b - a) * s; }
  function easeInOut(s) { return s * s * (3 - 2 * s); }

  Renderer.prototype._computeTransform = function (w, h, simTime) {
    var r = this.result;
    var blend = 0;
    if (r && r.release) {
      blend = easeInOut(Math.max(0, Math.min(1, (simTime - r.release.t) / 0.8 + 1e-9)));
    }
    var mv = this.machineView || { xMin: -6, xMax: 3, yMin: -0.5, yMax: 8 };
    var fv = this.fullView || mv;
    var view = {
      xMin: lerp(mv.xMin, fv.xMin, blend),
      xMax: lerp(mv.xMax, fv.xMax, blend),
      yMin: lerp(mv.yMin, fv.yMin, blend),
      yMax: lerp(mv.yMax, fv.yMax, blend)
    };
    var pad = 14;
    var dx = view.xMax - view.xMin, dy = view.yMax - view.yMin;
    var scale = Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy);
    var contentW = dx * scale;
    var left = (w - contentW) / 2;
    var self = this;
    // انعكاس أفقي: +x الفيزيائي يتجه يسار الشاشة (عرض RTL)
    this.W2S = function (x, y) {
      return {
        x: w - left - (x - view.xMin) * scale,
        y: h - pad - (y - view.yMin) * scale
      };
    };
    this.scale = scale;
    this.view = view;
    return view;
  };

  /** سهم بمقبض وخط ورأس، مع تسمية اختيارية */
  Renderer.prototype._arrow = function (x1, y1, x2, y2, color, label) {
    var ctx = this.ctx;
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.hypot(dx, dy);
    if (len < 3) return;
    var ux = dx / len, uy = dy / len;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - ux * 7, y2 - uy * 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * 9 - uy * 4, y2 - uy * 9 + ux * 4);
    ctx.lineTo(x2 - ux * 9 + uy * 4, y2 - uy * 9 - ux * 4);
    ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x2 + (Math.abs(uy) > 0.7 ? 0 : -ux * 20), y2 + uy * 16 + (uy >= 0 ? 10 : -6));
    }
  };

  /** الرسم الرئيسي عند إطار معين وزمن عرض معين */
  Renderer.prototype.render = function (frame, simTime) {
    var canvas = this.canvas, ctx = this.ctx;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // اتجاه أساس LTR كي تُعرض الأرقام والوحدات ("20 m") بترتيب صحيح
    ctx.direction = 'ltr';

    // الخلفية والسماء
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, w, h);

    this._computeTransform(w, h, simTime || 0);
    var W2S = this.W2S;
    var r = this.result;
    var p = r ? r.params : null;

    // ---- الأرض
    var g0 = W2S(this.view.xMin, 0), g1 = W2S(this.view.xMax, 0);
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, g0.y, w, h - g0.y);
    ctx.strokeStyle = COLORS.groundLine;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, g0.y); ctx.lineTo(w, g0.y); ctx.stroke();

    // مسطرة مسافات على الأرض
    if (r) {
      var span = this.view.xMax - this.view.xMin;
      var step = span > 200 ? 50 : span > 120 ? 25 : span > 60 ? 10 : span > 25 ? 5 : span > 12 ? 2 : 1;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      for (var xm = 0; xm <= this.view.xMax; xm += step) {
        var pt = W2S(xm, 0);
        ctx.strokeStyle = COLORS.groundLine;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x, pt.y + 5); ctx.stroke();
        if (xm > 0) ctx.fillText(xm + ' m', pt.x, pt.y + 16);
      }
    }

    if (!r || !frame) return;

    // ---- الهدف: جدار قابل للهدم أو علم بسيط
    var tg = W2S(p.targetDistance, 0);
    if (p.wallEnabled) {
      this._renderWall(p, simTime, tg);
    } else {
      ctx.strokeStyle = COLORS.target;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(tg.x, tg.y); ctx.lineTo(tg.x, tg.y - 34); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.target;
      ctx.beginPath();
      ctx.moveTo(tg.x, tg.y - 34);
      ctx.lineTo(tg.x + 16, tg.y - 28);
      ctx.lineTo(tg.x, tg.y - 22);
      ctx.closePath();
      ctx.fill();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('الهدف', tg.x, tg.y - 52);
      ctx.fillText(p.targetDistance + ' m', tg.x, tg.y - 40);
    }

    // ---- مسارات السيناريوهات المحفوظة (مقارنة)
    var self = this;
    this.overlays.forEach(function (ov) {
      if (!ov.points || ov.points.length < 2) return;
      ctx.strokeStyle = ov.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(ov.dash || [2, 5]);
      ctx.beginPath();
      ov.points.forEach(function (pt2, i) {
        var s = W2S(pt2.x, pt2.y);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // ---- مسار المقذوف الحالي (متقطع) حتى اللحظة الحالية
    if (this.showTrajectory && this.flightPath.length > 1) {
      ctx.strokeStyle = COLORS.traj;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < this.flightPath.length; i++) {
        var fp = this.flightPath[i];
        if (simTime !== undefined && fp.t > simTime) break;
        var s = W2S(fp.x, fp.y);
        if (!started) { ctx.moveTo(s.x, s.y); started = true; } else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- علامة السقوط وفرق الهدف
    if (r.landing && simTime >= r.landing.t - 1e-9) {
      var ld = W2S(r.landing.x, 0);
      ctx.strokeStyle = COLORS.landing;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ld.x - 6, ld.y - 6); ctx.lineTo(ld.x + 6, ld.y + 6);
      ctx.moveTo(ld.x + 6, ld.y - 6); ctx.lineTo(ld.x - 6, ld.y + 6);
      ctx.stroke();
      // خط الفرق عن الهدف
      var diff = r.landing.x - p.targetDistance;
      ctx.strokeStyle = COLORS.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(ld.x, ld.y - 12); ctx.lineTo(tg.x, tg.y - 12); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.ink2;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Δ = ' + Math.abs(diff).toFixed(1) + ' m ' + (diff < 0 ? '(قبل الهدف)' : '(بعد الهدف)'),
        (ld.x + tg.x) / 2, ld.y - 18);
    }

    // ---- قاعدة المنجنيق (هيكل A)
    var pv = W2S(0, p.pivotHeight);
    var baseHalf = Math.max(0.5, p.pivotHeight * 0.45);
    var bl = W2S(-baseHalf, 0), br = W2S(baseHalf, 0);
    ctx.strokeStyle = COLORS.woodDark;
    ctx.lineWidth = Math.max(3, 0.14 * this.scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bl.x, bl.y); ctx.lineTo(pv.x, pv.y); ctx.lineTo(br.x, br.y);
    ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y);
    ctx.stroke();

    // ---- الذراع
    var tip = W2S(frame.tip.x, frame.tip.y);
    var se = W2S(frame.shortEnd.x, frame.shortEnd.y);
    ctx.strokeStyle = COLORS.wood;
    ctx.lineWidth = Math.max(4, 0.16 * this.scale);
    ctx.beginPath(); ctx.moveTo(se.x, se.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();

    // ---- الثقل الموازن (+ التعليق إن كان متأرجحًا)
    var cw = W2S(frame.cw.x, frame.cw.y);
    if (p.swingingCW) {
      ctx.strokeStyle = COLORS.metal;
      ctx.lineWidth = Math.max(2, 0.06 * this.scale);
      ctx.beginPath(); ctx.moveTo(se.x, se.y); ctx.lineTo(cw.x, cw.y); ctx.stroke();
    }
    var cwSide = Math.max(0.35, Math.cbrt(p.counterweightMass / 2500)) * this.scale;
    cwSide = Math.max(10, cwSide);
    ctx.fillStyle = COLORS.cw;
    ctx.strokeStyle = '#1f1e1c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cw.x - cwSide / 2, cw.y - cwSide / 2, cwSide, cwSide, 3);
    else ctx.rect(cw.x - cwSide / 2, cw.y - cwSide / 2, cwSide, cwSide);
    ctx.fill(); ctx.stroke();

    // ---- المقلاع والمقذوف
    var isFlying = frame.phase === 'flight';
    var pr = W2S(frame.proj.x, frame.proj.y);
    if (p.slingEnabled && !isFlying) {
      ctx.strokeStyle = COLORS.rope;
      ctx.lineWidth = Math.max(1.5, 0.04 * this.scale);
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(pr.x, pr.y); ctx.stroke();
    }
    var landed = r.landing && simTime >= r.landing.t - 1e-9;
    var prPos = landed ? W2S(r.landing.x, 0) : pr;
    var projR = Math.max(3.5, p.projectileDiameter / 2 * this.scale);
    ctx.fillStyle = COLORS.projectile;
    ctx.beginPath();
    ctx.arc(prPos.x, prPos.y - (landed ? projR * 0.6 : 0), projR, 0, Math.PI * 2);
    ctx.fill();

    // ---- محور الارتكاز
    ctx.fillStyle = COLORS.metal;
    ctx.beginPath(); ctx.arc(pv.x, pv.y, Math.max(4, 0.1 * this.scale), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(pv.x, pv.y, Math.max(1.5, 0.035 * this.scale), 0, Math.PI * 2); ctx.fill();

    // ---- مظهر التحطم (التحليل الإنشائي)
    var sf = r.structFailure;
    if (sf && simTime >= sf.t - 1e-9) {
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (sf.type === 'arm') {
        // شرخ متعرج أحمر عبر الذراع عند المحور
        var dxA = tip.x - se.x, dyA = tip.y - se.y;
        var lenA = Math.hypot(dxA, dyA) || 1;
        var nx = -dyA / lenA, ny = dxA / lenA; // عمودي على الذراع
        var cs = Math.max(10, 0.22 * this.scale);
        ctx.strokeStyle = '#d03b3b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pv.x - nx * cs, pv.y - ny * cs);
        ctx.lineTo(pv.x - nx * cs * 0.3 + dxA / lenA * cs * 0.35, pv.y - ny * cs * 0.3 + dyA / lenA * cs * 0.35);
        ctx.lineTo(pv.x + nx * cs * 0.3 - dxA / lenA * cs * 0.35, pv.y + ny * cs * 0.3 - dyA / lenA * cs * 0.35);
        ctx.lineTo(pv.x + nx * cs, pv.y + ny * cs);
        ctx.stroke();
        ctx.fillStyle = '#d03b3b';
        ctx.fillText('⚡ تحطم الذراع! σ تجاوز حد كسر الخشب', pv.x, pv.y - Math.max(38, 0.5 * this.scale));
      } else if (sf.type === 'rope' && simTime < sf.t + 1.5) {
        // بقايا حبل متدلية من الطرف + تنبيه مؤقت
        ctx.strokeStyle = COLORS.rope;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x + 4, tip.y + Math.max(10, 0.25 * this.scale));
        ctx.stroke();
        ctx.fillStyle = '#d03b3b';
        ctx.fillText('⚡ انقطع حبل المقلاع!', tip.x, tip.y - 14);
      }
    }

    // ---- طبقة القوى
    if (this.showForces) this._renderForces(frame, simTime, pv, tip, cw, prPos);

    // ---- وسيلة إيضاح للمقارنة
    if (this.overlays.length) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      var ly = 18;
      this.overlays.forEach(function (ov) {
        ctx.strokeStyle = ov.color;
        ctx.lineWidth = 2.5;
        ctx.setLineDash(ov.dash || [2, 5]);
        ctx.beginPath(); ctx.moveTo(10, ly - 4); ctx.lineTo(40, ly - 4); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLORS.ink2;
        ctx.fillText(ov.label, 46, ly);
        ly += 17;
      });
    }
  };

  /** رسم جدار الهدف مع الضرر التراكمي وأثر الاصطدام */
  Renderer.prototype._renderWall = function (p, simTime, tg) {
    var ctx = this.ctx;
    var W2S = this.W2S;
    var r = this.result;
    var state = this.wallState || { damagePct: 0, collapsed: false, hits: 0 };
    var mat = TrebSim.Wall.material(p);

    var aBase = W2S(p.targetDistance, 0);
    var bTop = W2S(p.targetDistance + p.wallThickness, p.wallHeight);
    var rx = Math.min(aBase.x, bTop.x);
    var rw = Math.max(2, Math.abs(aBase.x - bTop.x));
    var ry = bTop.y;
    var rh = aBase.y - bTop.y;

    if (state.collapsed) {
      // 💥 ركام الجدار المنهار
      ctx.fillStyle = mat.dark;
      var n = 7;
      for (var i = 0; i < n; i++) {
        var frac = (i + 0.5) / n;
        var rr = Math.max(3, rh * 0.09 * (1 - 0.4 * ((i * 37) % 10) / 10));
        ctx.beginPath();
        ctx.arc(rx + rw * ((i * 53) % 100) / 100, aBase.y - rr * (0.6 + ((i * 29) % 10) / 14), rr + rw * 0.18 * frac * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = mat.dark;
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(rx, ry, rw, rh); // أثر الجدار السابق
      ctx.setLineDash([]);
      ctx.fillStyle = '#d03b3b';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💥 انهار الجدار بعد ' + state.hits + ' قذيفة', rx + rw / 2, ry - 8);
    } else {
      // جسم الجدار
      ctx.fillStyle = mat.color;
      ctx.strokeStyle = mat.dark;
      ctx.lineWidth = 1.5;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      // مداميك أفقية (أو ألواح خشب)
      ctx.strokeStyle = mat.dark;
      ctx.lineWidth = 0.8;
      var course = Math.max(6, 0.5 * this.scale);
      for (var yy = aBase.y - course; yy > ry; yy -= course) {
        ctx.beginPath(); ctx.moveTo(rx, yy); ctx.lineTo(rx + rw, yy); ctx.stroke();
      }
      // شقوق تتزايد مع الضرر
      var cracks = Math.min(8, Math.floor(state.damagePct / 12));
      ctx.strokeStyle = '#2b2a28';
      ctx.lineWidth = 1.5;
      for (var c = 0; c < cracks; c++) {
        var cy0 = ry + rh * (((c * 41) % 90) + 5) / 100;
        var cx0 = rx + rw * 0.5;
        ctx.beginPath();
        ctx.moveTo(cx0, cy0);
        var px = cx0, py = cy0;
        for (var s2 = 0; s2 < 4; s2++) {
          px += (((c + s2) * 31) % 7 - 3) * rw * 0.12;
          py += rh * 0.06;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      // التسمية وشريط الضرر
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.ink2;
      ctx.fillText(mat.name.split(' ')[0] + ' ' + p.wallThickness + ' m — ' + p.targetDistance + ' m', rx + rw / 2, ry - 22);
      var dmg = Math.min(100, state.damagePct);
      ctx.fillStyle = dmg >= 60 ? '#d03b3b' : dmg >= 25 ? '#c98500' : '#006300';
      ctx.fillText('الضرر ' + dmg.toFixed(0) + '% (' + state.hits + ' قذيفة)', rx + rw / 2, ry - 8);
    }

    // وميض الاصطدام عند لحظة الإصابة
    if (r && r.wallImpact && simTime >= r.wallImpact.t - 1e-9 && simTime < r.wallImpact.t + 1.5) {
      var hp = W2S(r.wallImpact.x, r.wallImpact.y);
      ctx.strokeStyle = '#eb6834';
      ctx.lineWidth = 2;
      for (var k = 0; k < 8; k++) {
        var ang = k * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(hp.x + 5 * Math.cos(ang), hp.y + 5 * Math.sin(ang));
        ctx.lineTo(hp.x + 14 * Math.cos(ang), hp.y + 14 * Math.sin(ang));
        ctx.stroke();
      }
      if (r.impact) {
        ctx.fillStyle = '#d03b3b';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(r.impact.belowThreshold ? 'ارتداد — بلا ضرر' : 'ضرر +' + r.impact.damagePct.toFixed(1) + '%',
          hp.x, hp.y - 16);
      }
    }
  };

  /** طبقة عرض القوى والمتجهات */
  Renderer.prototype._renderForces = function (frame, simTime, pv, tipS, cwS, prS) {
    var ctx = this.ctx;
    var r = this.result, p = r.params;
    var g = p.gravity;
    var W2S = this.W2S;

    // مقياس الأسهم: أكبر وزن ← 55 بكسل
    var maxF = Math.max(p.counterweightMass * g, p.projectileMass * g, 1);
    var fScale = 55 / maxF;
    var isFlying = frame.phase === 'flight';
    var landed = r.landing && simTime >= r.landing.t - 1e-9;

    // وزن الثقل الموازن W = Mc·g (نيوتن، للأسفل)
    this._arrow(cwS.x, cwS.y, cwS.x, cwS.y + p.counterweightMass * g * fScale,
      COLORS.forceWeight, 'Wc = ' + Math.round(p.counterweightMass * g) + ' N');

    // وزن المقذوف W = Mp·g
    if (!landed) {
      this._arrow(prS.x, prS.y, prS.x, prS.y + Math.max(14, p.projectileMass * g * fScale),
        COLORS.forceWeight, 'Wp = ' + Math.round(p.projectileMass * g) + ' N');
    }

    // مركز كتلة الذراع (علامة +)
    var com = W2S(frame.armCom.x, frame.armCom.y);
    ctx.strokeStyle = COLORS.torque;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(com.x - 6, com.y); ctx.lineTo(com.x + 6, com.y);
    ctx.moveTo(com.x, com.y - 6); ctx.lineTo(com.x, com.y + 6);
    ctx.stroke();

    // اتجاه عزم الدوران: قوس حول المحور بإشارة العزم الصافي
    var tq = TrebSim.Trebuchet.torqueBreakdown(p, { theta: frame.theta }, { theta: frame.omega });
    var ccwWorld = tq.net > 0; // موجب في إحداثيات الفيزياء
    // بسبب الانعكاس الأفقي على الشاشة ينقلب الاتجاه الظاهري
    var startA = -0.4, endA = -2.2;
    ctx.strokeStyle = COLORS.torque;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pv.x, pv.y, 22, startA, endA, !ccwWorld);
    ctx.stroke();
    var aEnd = endA;
    var hx = pv.x + 22 * Math.cos(aEnd), hy = pv.y + 22 * Math.sin(aEnd);
    ctx.fillStyle = COLORS.torque;
    ctx.beginPath();
    ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Στ = ' + Math.round(tq.net) + ' N·m', pv.x, pv.y - 30);

    if (!isFlying) {
      // السرعة المماسية لطرف الذراع v = ω·Lp
      if (frame.tipV) {
        var vt = Math.hypot(frame.tipV.x, frame.tipV.y);
        if (vt > 0.05) {
          // متجه عالمي (vx, vy) يقابل على الشاشة (−vx, −vy) بسبب الانعكاس الأفقي
          // وكون محور y الشاشي نحو الأسفل
          var vScale = 40 / Math.max(vt, 1);
          this._arrow(tipS.x, tipS.y,
            tipS.x - frame.tipV.x * vScale, tipS.y - frame.tipV.y * vScale,
            COLORS.forceVel, 'v = ' + vt.toFixed(1) + ' m/s');
        }
      }
    } else if (!landed && frame.projV) {
      // سرعة المقذوف أثناء الطيران (ولحظة التحرير)
      var vp = Math.hypot(frame.projV.x, frame.projV.y);
      var vScale2 = 40 / Math.max(vp, 1);
      this._arrow(prS.x, prS.y, prS.x - frame.projV.x * vScale2, prS.y - frame.projV.y * vScale2,
        COLORS.forceVel, 'v = ' + vp.toFixed(1) + ' m/s');

      // قوة مقاومة الهواء (عكس السرعة النسبية)
      if (p.dragEnabled) {
        var df = TrebSim.Projectile.dragForce(p, frame.projV.x, frame.projV.y);
        if (df.mag > 0.01) {
          var dScale = 35 / Math.max(df.mag, 1);
          this._arrow(prS.x, prS.y, prS.x - df.fx * dScale, prS.y - df.fy * dScale,
            COLORS.forceDrag, 'Fd = ' + df.mag.toFixed(1) + ' N');
        }
      }
    }
  };

  return { Renderer: Renderer, COLORS: COLORS };
})();
