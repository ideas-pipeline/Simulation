/**
 * صفحة العرض ثلاثي الأبعاد — 3D Page Controller
 * ==============================================
 * تعيد استخدام محرك المحاكاة ولوحة التحكم المشتركة كما هما (نفس
 * الفيزياء تمامًا)، وتستبدل العرض ثنائي الأبعاد بمشهد Three.js
 * ببيئة مفتوحة وكاميرا حرة.
 */
(function () {
  'use strict';

  var Sim = TrebSim.Simulation;
  var UI = TrebSim.UI;

  var result = null;
  var simTime = 0;
  var playing = false;
  var speed = 1;
  var lastTs = null;
  var frameIdx = 0;

  var r3d = new TrebSim.Renderer3D.Renderer3D(document.getElementById('scene3d'));

  function fmt(v, d, unit) {
    return (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(d) + ' ' + unit;
  }

  function updateHud(frame) {
    document.getElementById('h-time').textContent = simTime.toFixed(3) + ' s';
    var phase = '—';
    if (result && frame) {
      if (result.structFailure && result.structFailure.type === 'arm' && simTime >= result.structFailure.t) phase = '⚡ تحطم الذراع';
      else if (result.landing && simTime >= result.landing.t - 1e-9) phase = 'انتهت';
      else if (result.wallImpact && simTime >= result.wallImpact.t - 1e-9) phase = '🧱 اصطدم بالجدار';
      else phase = frame.phase === 'arm' ? 'تأرجح الذراع' : 'طيران';
    }
    document.getElementById('h-phase').textContent = phase;
    var s = result && result.stats;
    document.getElementById('h-vrel').textContent = s ? fmt(s.releaseSpeed, 1, 'm/s') : '—';
    document.getElementById('h-range').textContent = s ? fmt(s.range, 1, 'm') : '—';
    document.getElementById('h-eff').textContent = s && s.efficiencyPct !== null ? fmt(s.efficiencyPct, 1, '%') : '—';
  }

  function frameAt(t) {
    var frames = result.frames;
    if (!frames.length) return null;
    if (frameIdx >= frames.length) frameIdx = frames.length - 1;
    while (frameIdx > 0 && frames[frameIdx].t > t) frameIdx--;
    while (frameIdx < frames.length - 1 && frames[frameIdx + 1].t <= t) frameIdx++;
    return frames[frameIdx];
  }

  // حلقة رسم دائمة (الكاميرا حية حتى أثناء الإيقاف)
  function animate(ts) {
    requestAnimationFrame(animate);
    if (playing && result && result.ok) {
      if (lastTs !== null) simTime += (ts - lastTs) / 1000 * speed;
      if (simTime >= result.totalTime) {
        simTime = result.totalTime;
        playing = false;
        updateButtons();
      }
    }
    lastTs = ts;
    if (result && result.ok && result.frames.length) {
      var f = frameAt(simTime);
      r3d.renderFrame(f, simTime);
      updateHud(f);
    }
    r3d.render();
  }

  function updateButtons() {
    document.getElementById('btn-play').disabled = playing || !result || !result.ok;
    document.getElementById('btn-pause').disabled = !playing;
  }

  var recomputeTimer = null;
  function recompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(doRecompute, 150);
  }

  function doRecompute() {
    playing = false;
    var params = UI.collectParams();
    result = Sim.run(params);
    UI.renderWarnings(result.errors, result.warnings, 'warnings3d');
    UI.refreshDependentState();
    if (result.ok) {
      r3d.setResult(result);
      simTime = 0;
      frameIdx = 0;
    }
    updateButtons();
  }

  function bind() {
    document.getElementById('btn-play').addEventListener('click', function () {
      if (!result || !result.ok || playing) return;
      if (simTime >= result.totalTime) { simTime = 0; frameIdx = 0; }
      playing = true;
      updateButtons();
    });
    document.getElementById('btn-pause').addEventListener('click', function () {
      playing = false;
      updateButtons();
    });
    document.getElementById('btn-restart').addEventListener('click', function () {
      simTime = 0; frameIdx = 0; playing = true; updateButtons();
    });
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
    document.getElementById('chk-follow').addEventListener('change', function (e) {
      r3d.followProjectile = e.target.checked;
    });
    document.getElementById('btn-camera').addEventListener('click', function () {
      r3d.resetCamera();
    });
    document.getElementById('btn-panel').addEventListener('click', function () {
      document.getElementById('controls3d-wrap').classList.toggle('hidden');
    });
  }

  function boot() {
    UI.build(document.getElementById('control-groups'), recompute);
    UI.bindToggles(recompute);
    UI.setParams(Sim.defaults());
    bind();
    doRecompute();
    requestAnimationFrame(animate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
