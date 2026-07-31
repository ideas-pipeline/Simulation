/**
 * الربط الرئيسي — Main Wiring
 * ============================
 * يربط لوحة التحكم بمحرك المحاكاة والرسّام والرسوم البيانية:
 * أي تعديل على القيم يعيد حساب التجربة كاملة فورًا (التكامل العددي
 * سريع)، ثم يُعرض التسجيل الناتج كرسوم متحركة بسرعات مختلفة.
 */
(function () {
  'use strict';

  var Sim = TrebSim.Simulation;
  var UI = TrebSim.UI;
  var Charts = TrebSim.Charts;

  // ---------------- الحالة العامة ----------------
  var result = null;        // نتيجة آخر تجربة
  var simTime = 0;          // زمن العرض الحالي (ثوانٍ محاكاة)
  var playing = false;
  var speed = 1;
  var lastTs = null;
  var rafId = null;
  var lastChartDraw = 0;
  var frameIdx = 0;

  var renderer = new TrebSim.Renderer.Renderer(document.getElementById('scene'));

  // ---------------- الرسوم البيانية ----------------
  var P = Charts.PALETTE;
  var charts = {
    theta: new Charts.LineChart(document.getElementById('chart-theta'), {
      xLabel: 't (s)', yLabel: 'θ (°)', includeZeroY: true,
      series: [{ key: 'theta', label: 'زاوية الذراع', color: P[0] }],
      fmt: function (l, pt) { return 't=' + pt.x.toFixed(2) + 's , θ=' + pt.y.toFixed(1) + '°'; }
    }),
    omega: new Charts.LineChart(document.getElementById('chart-omega'), {
      xLabel: 't (s)', yLabel: 'ω (rad/s)', includeZeroY: true,
      series: [{ key: 'omega', label: 'السرعة الزاوية', color: P[0] }],
      fmt: function (l, pt) { return 't=' + pt.x.toFixed(2) + 's , ω=' + pt.y.toFixed(2) + ' rad/s'; }
    }),
    alpha: new Charts.LineChart(document.getElementById('chart-alpha'), {
      xLabel: 't (s)', yLabel: 'α (rad/s²)', includeZeroY: true,
      series: [{ key: 'alpha', label: 'التسارع الزاوي', color: P[0] }],
      fmt: function (l, pt) { return 't=' + pt.x.toFixed(2) + 's , α=' + pt.y.toFixed(2) + ' rad/s²'; }
    }),
    height: new Charts.LineChart(document.getElementById('chart-height'), {
      xLabel: 't (s)', yLabel: 'y (m)', includeZeroY: true,
      series: [{ key: 'height', label: 'ارتفاع المقذوف', color: P[0] }],
      fmt: function (l, pt) { return 't=' + pt.x.toFixed(2) + 's , y=' + pt.y.toFixed(2) + ' m'; }
    }),
    speed: new Charts.LineChart(document.getElementById('chart-speed'), {
      xLabel: 't (s)', yLabel: '|v| (m/s)', includeZeroY: true,
      series: [{ key: 'speed', label: 'سرعة المقذوف', color: P[0] }],
      fmt: function (l, pt) { return 't=' + pt.x.toFixed(2) + 's , v=' + pt.y.toFixed(2) + ' m/s'; }
    }),
    energy: new Charts.LineChart(document.getElementById('chart-energy'), {
      xLabel: 't (s)', yLabel: 'E (J)', includeZeroY: true,
      series: [
        { key: 'peCW', label: 'وضع الثقل', color: P[0] },
        { key: 'keCW', label: 'حركة الثقل', color: P[1] },
        { key: 'keArm', label: 'دوران الذراع', color: P[2] },
        { key: 'keProj', label: 'حركة المقذوف', color: P[3] },
        { key: 'lost', label: 'المفقودة', color: P[4] },
        { key: 'total', label: 'الميكانيكية الكلية', color: P[5], dash: [6, 4] }
      ],
      fmt: function (l, pt) { return l + ' : ' + Math.round(pt.y) + ' J @ ' + pt.x.toFixed(2) + 's'; }
    }),
    traj: new Charts.LineChart(document.getElementById('chart-traj'), {
      xLabel: 'x (m)', yLabel: 'y (m)', includeZeroY: true, clipBy: 't', equalAspect: true,
      series: [
        { key: 'current', label: 'التجربة الحالية', color: P[0], width: 2.5 },
        { key: 'ov0', label: '', color: '#eb6834', dash: [10, 5] },
        { key: 'ov1', label: '', color: '#1baf7a', dash: [3, 5] }
      ],
      fmt: function (l, pt) { return (l || '') + ' x=' + pt.x.toFixed(1) + 'm , y=' + pt.y.toFixed(1) + 'm'; }
    })
  };
  Charts.buildLegend(document.getElementById('legend-energy'), charts.energy.series);

  function rebuildTrajLegend(overlays) {
    var series = [{ label: 'التجربة الحالية', color: P[0] }];
    overlays.forEach(function (ov) { series.push({ label: ov.label, color: ov.color, dash: ov.dash }); });
    Charts.buildLegend(document.getElementById('legend-traj'), series);
  }
  rebuildTrajLegend([]);

  /** بناء بيانات كل الرسوم من إطارات المحاكاة */
  function buildChartData() {
    var d = { theta: [], omega: [], alpha: [], height: [], speed: [], peCW: [], keCW: [], keArm: [], keProj: [], lost: [], total: [], current: [] };
    if (result && result.ok) {
      result.frames.forEach(function (f) {
        d.theta.push({ x: f.t, y: f.theta * 180 / Math.PI });
        d.omega.push({ x: f.t, y: f.omega });
        if (f.phase === 'arm') d.alpha.push({ x: f.t, y: f.alpha });
        d.height.push({ x: f.t, y: f.proj.y });
        d.speed.push({ x: f.t, y: f.projV ? Math.hypot(f.projV.x, f.projV.y) : 0 });
        d.peCW.push({ x: f.t, y: f.en.peCW });
        d.keCW.push({ x: f.t, y: f.en.keCW });
        d.keArm.push({ x: f.t, y: f.en.keArm });
        d.keProj.push({ x: f.t, y: f.en.keProj });
        d.lost.push({ x: f.t, y: f.en.lost });
        d.total.push({ x: f.t, y: f.en.total });
        if (f.phase === 'flight') d.current.push({ x: f.proj.x, y: f.proj.y, t: f.t });
      });
    }
    charts.theta.setData({ theta: d.theta });
    charts.omega.setData({ omega: d.omega });
    charts.alpha.setData({ alpha: d.alpha });
    charts.height.setData({ height: d.height });
    charts.speed.setData({ speed: d.speed });
    charts.energy.setData({ peCW: d.peCW, keCW: d.keCW, keArm: d.keArm, keProj: d.keProj, lost: d.lost, total: d.total });

    var ovs = TrebSim.Scenarios.getOverlays();
    charts.traj.setData({
      current: d.current,
      ov0: ovs[0] ? ovs[0].points : [],
      ov1: ovs[1] ? ovs[1].points : []
    });
  }

  function drawCharts(clip) {
    Object.keys(charts).forEach(function (k) { charts[k].draw(clip); });
  }

  // ---------------- البحث عن الإطار عند زمن معين ----------------
  function frameAt(t) {
    var frames = result.frames;
    if (!frames.length) return null;
    // تقدم مؤشر تسلسلي مع دعم الرجوع (إعادة التشغيل)
    if (frameIdx >= frames.length) frameIdx = frames.length - 1;
    while (frameIdx > 0 && frames[frameIdx].t > t) frameIdx--;
    while (frameIdx < frames.length - 1 && frames[frameIdx + 1].t <= t) frameIdx++;
    return frames[frameIdx];
  }

  function phaseName(f) {
    if (!f) return '';
    if (result.landing && simTime >= result.landing.t - 1e-9) return 'انتهت التجربة';
    return f.phase === 'arm' ? 'تأرجح الذراع' : 'طيران المقذوف';
  }

  /** عرض المشهد والحالة عند زمن معين */
  function renderAt(t, forceCharts) {
    if (!result || !result.ok || !result.frames.length) {
      renderer.result = null;
      renderer.render(null, 0);
      document.getElementById('status-line').textContent = '—';
      return;
    }
    var f = frameAt(t);
    renderer.render(f, t);
    var now = performance.now();
    if (forceCharts || now - lastChartDraw > 80) {
      lastChartDraw = now;
      drawCharts(playing ? t : undefined);
    }
    document.getElementById('status-line').textContent =
      't = ' + t.toFixed(3) + ' s | ' + phaseName(f);
  }

  // ---------------- حلقة العرض ----------------
  function loop(ts) {
    if (!playing) return;
    if (lastTs !== null) simTime += (ts - lastTs) / 1000 * speed;
    lastTs = ts;
    if (simTime >= result.totalTime) {
      simTime = result.totalTime;
      playing = false;
      updatePlayButtons();
      renderAt(simTime, true);
      drawCharts(undefined); // الرسوم كاملة عند النهاية
      return;
    }
    renderAt(simTime);
    rafId = requestAnimationFrame(loop);
  }

  function play() {
    if (!result || !result.ok || playing) return;
    if (simTime >= result.totalTime) { simTime = 0; frameIdx = 0; }
    playing = true;
    lastTs = null;
    updatePlayButtons();
    rafId = requestAnimationFrame(loop);
  }

  function pause() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    updatePlayButtons();
    renderAt(simTime, true);
  }

  function restart() {
    simTime = 0;
    frameIdx = 0;
    if (!playing) { play(); } else { lastTs = null; }
    renderAt(0, true);
  }

  function stepOnce() {
    if (!result || !result.ok) return;
    if (playing) pause();
    if (frameIdx < result.frames.length - 1) {
      frameIdx++;
      simTime = result.frames[frameIdx].t;
    }
    renderAt(simTime, true);
    drawCharts(simTime);
  }

  function updatePlayButtons() {
    document.getElementById('btn-play').disabled = playing || !result || !result.ok;
    document.getElementById('btn-pause').disabled = !playing;
  }

  // ---------------- إعادة الحساب ----------------
  var recomputeTimer = null;
  function recompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(doRecompute, 120);
  }

  function doRecompute() {
    pause();
    var params = UI.collectParams();
    result = Sim.run(params);

    UI.renderWarnings(result.errors, result.warnings);
    UI.renderResults(result.ok ? result : null);
    UI.renderValidation(result.ok ? result : null);
    UI.renderHowLive(result);
    UI.refreshDependentState();

    if (result.ok) {
      renderer.setResult(result);
      renderer.setOverlays(TrebSim.Scenarios.getOverlays());
      buildChartData();
      simTime = 0;
      frameIdx = 0;
      renderAt(0, true);
      drawCharts(undefined); // عرض الرسوم كاملة قبل التشغيل
    } else {
      renderer.result = null;
      renderer.render(null, 0);
      buildChartData();
      drawCharts(undefined);
    }
    updatePlayButtons();
  }

  // ---------------- ربط الأحداث ----------------
  function bindEvents() {
    document.getElementById('btn-play').addEventListener('click', play);
    document.getElementById('btn-pause').addEventListener('click', pause);
    document.getElementById('btn-restart').addEventListener('click', restart);
    document.getElementById('btn-step').addEventListener('click', stepOnce);
    document.getElementById('btn-defaults').addEventListener('click', function () {
      UI.setParams(Sim.defaults());
      doRecompute();
    });

    document.querySelectorAll('.btn-speed').forEach(function (btn) {
      btn.addEventListener('click', function () {
        speed = parseFloat(btn.dataset.speed);
        document.querySelectorAll('.btn-speed').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    document.getElementById('chk-trajectory').addEventListener('change', function (e) {
      renderer.showTrajectory = e.target.checked;
      renderAt(simTime, true);
    });
    document.getElementById('chk-forces').addEventListener('change', function (e) {
      renderer.showForces = e.target.checked;
      renderAt(simTime, true);
    });
    document.getElementById('chk-validation').addEventListener('change', function (e) {
      document.getElementById('validation-panel').hidden = !e.target.checked;
    });

    document.getElementById('btn-save-scenario').addEventListener('click', function () {
      var r = TrebSim.Scenarios.save(result);
      if (!r.ok) { alert(r.msg); return; }
      TrebSim.Scenarios.renderTable();
    });
    document.getElementById('btn-compare-last').addEventListener('click', function () {
      var r = TrebSim.Scenarios.compareLastTwo();
      if (!r.ok) alert(r.msg);
    });

    window.addEventListener('resize', function () {
      renderAt(simTime, true);
      drawCharts(playing ? simTime : undefined);
    });
  }

  // ---------------- الإقلاع ----------------
  function boot() {
    UI.build(document.getElementById('control-groups'), recompute);
    UI.bindToggles(recompute);
    UI.buildResults(document.getElementById('results-grid'));
    UI.setParams(Sim.defaults());
    TrebSim.Scenarios.init(function (overlays) {
      renderer.setOverlays(overlays);
      rebuildTrajLegend(overlays);
      buildChartData();
      renderAt(simTime, true);
      drawCharts(undefined);
    });
    bindEvents();
    doRecompute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
