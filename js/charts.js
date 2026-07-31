/**
 * الرسوم البيانية — Charts
 * =========================
 * مكوّن رسم خطي خفيف على Canvas بلا أي مكتبات خارجية.
 * يدعم عدة سلاسل، شبكة ومحاور بتدرجات "لطيفة"، قصّ الرسم حتى لحظة
 * زمنية معينة (للتحديث الحي أثناء العرض)، وتلميحًا عند مرور المؤشر.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Charts = (function () {
  'use strict';

  // ألوان اللوحة المعتمدة (وضع فاتح)
  var PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#898781', GRID = '#e1e0d9', BASELINE = '#c3c2b7', SURFACE = '#fcfcfb';

  var sharedTooltip = null;
  function tooltipEl() {
    if (!sharedTooltip) {
      sharedTooltip = document.createElement('div');
      sharedTooltip.className = 'chart-tooltip';
      sharedTooltip.style.display = 'none';
      document.body.appendChild(sharedTooltip);
    }
    return sharedTooltip;
  }

  /** حساب خطوة تدرج "لطيفة" (1، 2، 5 × 10ⁿ) */
  function niceStep(span, maxTicks) {
    if (!(span > 0)) return 1;
    var raw = span / Math.max(1, maxTicks);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
    return step * mag;
  }

  function fmtTick(v, step) {
    var d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    if (d > 4) return v.toExponential(1);
    return v.toFixed(Math.min(d, 4));
  }

  /** تقليل عدد النقاط للأداء مع إبقاء أول وآخر نقطة */
  function decimate(pts, maxPts) {
    if (pts.length <= maxPts) return pts;
    var stride = Math.ceil(pts.length / maxPts);
    var out = [];
    for (var i = 0; i < pts.length; i += stride) out.push(pts[i]);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  /**
   * مخطط خطي.
   * opts: {
   *   xLabel, yLabel,
   *   series: [{key, label, color, dash, width}],
   *   clipBy: 'x' | 't'   (كيفية قص الرسم الحي)،
   *   includeZeroY: bool,  equalAspect: bool (لمخطط المسار)،
   *   fmt(seriesLabel, pt) → نص التلميح
   * }
   */
  function LineChart(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.series = (opts.series || []).map(function (s, i) {
      return Object.assign({ color: PALETTE[i % PALETTE.length], width: 2, dash: null }, s);
    });
    this.data = {};
    this.bounds = null;
    this._clip = undefined;
    this._bindHover();
  }

  LineChart.prototype.setData = function (dataBySeries) {
    var self = this;
    this.data = {};
    var xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    this.series.forEach(function (s) {
      var pts = decimate(dataBySeries[s.key] || [], 1400);
      self.data[s.key] = pts;
      pts.forEach(function (p) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      });
    });
    if (!isFinite(xMin)) { this.bounds = null; return; }
    if (this.opts.includeZeroY) { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
    if (yMax - yMin < 1e-12) { yMax += 1; yMin -= 1; }
    if (xMax - xMin < 1e-12) { xMax += 1; }
    var padY = (yMax - yMin) * 0.06;
    this.bounds = { xMin: xMin, xMax: xMax, yMin: yMin - padY, yMax: yMax + padY };
  };

  LineChart.prototype._prepare = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return null;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // أساس LTR كي لا تنقلب إشارات الأرقام السالبة في السياق العربي
    this.ctx.direction = 'ltr';
    return { w: w, h: h };
  };

  /** رسم المخطط، مع قصّ اختياري حتى قيمة معينة (زمن أو x) */
  LineChart.prototype.draw = function (clipVal) {
    this._clip = clipVal;
    var dims = this._prepare();
    if (!dims) return;
    var ctx = this.ctx, w = dims.w, h = dims.h;
    var m = { left: 48, right: 10, top: 10, bottom: 28 };
    var pw = w - m.left - m.right, ph = h - m.top - m.bottom;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, w, h);

    if (!this.bounds) {
      ctx.fillStyle = MUTED;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('لا بيانات بعد — شغّل تجربة', w / 2, h / 2);
      return;
    }

    var b = this.bounds;
    var xMin = b.xMin, xMax = b.xMax, yMin = b.yMin, yMax = b.yMax;

    // نسبة أبعاد متساوية لمخطط المسار (متر أفقي = متر رأسي)
    if (this.opts.equalAspect) {
      var sx = pw / (xMax - xMin), sy = ph / (yMax - yMin);
      if (sx < sy) {
        var cy = (yMin + yMax) / 2, half = (ph / sx) / 2;
        yMin = cy - half; yMax = cy + half;
        if (yMin > -1) { yMax -= (yMin + 1); yMin = -1; } // أبقِ الأرض ظاهرة
      } else {
        var cx = (xMin + xMax) / 2, halfx = (pw / sy) / 2;
        xMin = cx - halfx; xMax = cx + halfx;
      }
    }

    var X = function (v) { return m.left + (v - xMin) / (xMax - xMin) * pw; };
    var Y = function (v) { return m.top + ph - (v - yMin) / (yMax - yMin) * ph; };
    this._X = X; this._Y = Y; this._view = { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax, m: m, pw: pw, ph: ph };

    // الشبكة والتدرجات
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var stepX = niceStep(xMax - xMin, 6);
    var v;
    for (v = Math.ceil(xMin / stepX) * stepX; v <= xMax + 1e-9; v += stepX) {
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(v), m.top); ctx.lineTo(X(v), m.top + ph); ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(fmtTick(v, stepX), X(v), m.top + ph + 5);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var stepY = niceStep(yMax - yMin, 5);
    for (v = Math.ceil(yMin / stepY) * stepY; v <= yMax + 1e-9; v += stepY) {
      ctx.strokeStyle = Math.abs(v) < stepY * 1e-6 ? BASELINE : GRID;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.left, Y(v)); ctx.lineTo(m.left + pw, Y(v)); ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(fmtTick(v, stepY), m.left - 5, Y(v));
    }
    // إطار المحاور
    ctx.strokeStyle = BASELINE;
    ctx.strokeRect(m.left, m.top, pw, ph);

    // عناوين المحاور (وحدات)
    ctx.fillStyle = INK2;
    ctx.font = '10.5px system-ui, sans-serif';
    if (this.opts.xLabel) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(this.opts.xLabel, m.left + 2, h - 2);
    }
    if (this.opts.yLabel) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(this.opts.yLabel, m.left + 4, m.top + 2);
    }

    // السلاسل
    var clipBy = this.opts.clipBy || 'x';
    var self = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.left, m.top, pw, ph);
    ctx.clip();
    this.series.forEach(function (s) {
      var pts = self.data[s.key] || [];
      if (!pts.length) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.setLineDash(s.dash || []);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var cv = clipBy === 't' ? (p.t !== undefined ? p.t : p.x) : p.x;
        if (clipVal !== undefined && cv > clipVal) break;
        if (!started) { ctx.moveTo(X(p.x), Y(p.y)); started = true; }
        else ctx.lineTo(X(p.x), Y(p.y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  };

  /** تلميح عند مرور المؤشر: أقرب نقطة زمنيًا في كل سلسلة */
  LineChart.prototype._bindHover = function () {
    var self = this;
    this.canvas.addEventListener('mousemove', function (ev) {
      if (!self.bounds || !self._X) return;
      var rect = self.canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left;
      var view = self._view;
      var xVal = view.xMin + (mx - view.m.left) / view.pw * (view.xMax - view.xMin);
      if (xVal < view.xMin || xVal > view.xMax) { tooltipEl().style.display = 'none'; return; }

      var best = null;
      self.series.forEach(function (s) {
        var pts = self.data[s.key] || [];
        if (!pts.length) return;
        // بحث ثنائي عن أقرب x
        var lo = 0, hi = pts.length - 1;
        while (hi - lo > 1) {
          var mid = (lo + hi) >> 1;
          if (pts[mid].x < xVal) lo = mid; else hi = mid;
        }
        var p = Math.abs(pts[lo].x - xVal) < Math.abs(pts[hi].x - xVal) ? pts[lo] : pts[hi];
        var d = Math.abs(p.x - xVal);
        if (!best || d < best.d) best = { d: d, p: p, s: s };
      });
      if (!best) { tooltipEl().style.display = 'none'; return; }
      var tt = tooltipEl();
      tt.textContent = self.opts.fmt
        ? self.opts.fmt(best.s.label, best.p)
        : best.p.x.toFixed(2) + ' , ' + best.p.y.toFixed(2);
      tt.style.display = 'block';
      tt.style.left = ev.clientX + 'px';
      tt.style.top = ev.clientY + 'px';
    });
    this.canvas.addEventListener('mouseleave', function () {
      tooltipEl().style.display = 'none';
    });
  };

  /** بناء وسيلة إيضاح HTML لسلاسل المخطط */
  function buildLegend(container, series) {
    container.innerHTML = '';
    series.forEach(function (s) {
      var item = document.createElement('span');
      item.className = 'lg-item';
      var sw = document.createElement('span');
      sw.className = 'lg-swatch';
      sw.style.background = s.color;
      if (s.dash) sw.style.backgroundImage = 'linear-gradient(90deg,' + s.color + ' 60%, transparent 60%)';
      item.appendChild(sw);
      item.appendChild(document.createTextNode(s.label));
      container.appendChild(item);
    });
  }

  return { LineChart: LineChart, PALETTE: PALETTE, buildLegend: buildLegend };
})();
