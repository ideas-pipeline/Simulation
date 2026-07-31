/**
 * مقارنة السيناريوهات — Scenario Comparison
 * ==========================================
 * حفظ حتى خمس تجارب (المعاملات + النتائج + مسار الطيران) في جدول
 * مقارنة، مع اختيار تجربتين لعرض مساريهما على المشهد ومخطط المسار
 * بنمطي خط مختلفين. تُحفظ التجارب في localStorage عند توفره.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Scenarios = (function () {
  'use strict';

  var MAX = 5;
  var STORAGE_KEY = 'trebsim.scenarios.v1';
  var OVERLAY_STYLES = [
    { color: '#eb6834', dash: [10, 5] },  // برتقالي — متقطع طويل
    { color: '#1baf7a', dash: [3, 5] }    // أخضر مائي — منقّط
  ];

  var list = [];
  var selected = [];   // ids المختارة للعرض (بحد أقصى 2)
  var counter = 1;
  var onSelectionChange = null;

  function loadStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        list = data.list || [];
        counter = data.counter || (list.length + 1);
      }
    } catch (e) { /* التخزين غير متاح (مثلاً file:// ببعض المتصفحات) */ }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: list, counter: counter }));
    } catch (e) { /* تجاهل */ }
  }

  /** تقليل نقاط المسار للتخزين والعرض */
  function decimatePath(pts, maxPts) {
    if (!pts || pts.length <= maxPts) return pts || [];
    var stride = Math.ceil(pts.length / maxPts);
    var out = [];
    for (var i = 0; i < pts.length; i += stride) out.push({ x: pts[i].x, y: pts[i].y });
    out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    return out;
  }

  /** حفظ نتيجة التجربة الحالية */
  function save(result) {
    if (!result || !result.ok || !result.stats) return { ok: false, msg: 'لا توجد نتيجة صالحة للحفظ — شغّل تجربة ناجحة أولًا.' };
    var p = result.params, s = result.stats;
    var flight = [];
    result.frames.forEach(function (f) {
      if (f.phase === 'flight') flight.push({ x: f.proj.x, y: f.proj.y });
    });
    var sc = {
      id: 'sc' + Date.now() + '-' + counter,
      name: 'تجربة ' + counter,
      params: {
        projectileMass: p.projectileMass,
        counterweightMass: p.counterweightMass,
        longArm: p.longArm,
        shortArm: p.shortArm,
        releaseAngleDeg: p.releaseAngleDeg,
        slingLength: p.slingEnabled ? p.slingLength : null
      },
      stats: {
        releaseSpeed: s.releaseSpeed,
        range: s.range,
        maxHeight: s.maxHeight,
        flightTime: s.flightTime,
        efficiencyPct: s.efficiencyPct
      },
      traj: decimatePath(flight, 250)
    };
    counter++;
    list.push(sc);
    var removed = null;
    if (list.length > MAX) {
      removed = list.shift();
      selected = selected.filter(function (id) { return id !== removed.id; });
    }
    persist();
    return { ok: true, removedName: removed ? removed.name : null };
  }

  function remove(id) {
    list = list.filter(function (sc) { return sc.id !== id; });
    selected = selected.filter(function (sid) { return sid !== id; });
    persist();
    renderTable();
    if (onSelectionChange) onSelectionChange(getOverlays());
  }

  /** آخر تجربتين محفوظتين تُختاران للعرض */
  function compareLastTwo() {
    if (list.length < 2) return { ok: false, msg: 'تحتاج إلى تجربتين محفوظتين على الأقل للمقارنة.' };
    selected = [list[list.length - 2].id, list[list.length - 1].id];
    renderTable();
    if (onSelectionChange) onSelectionChange(getOverlays());
    return { ok: true };
  }

  /** المسارات المختارة للعرض فوق المشهد ومخطط المسار */
  function getOverlays() {
    return selected.map(function (id, idx) {
      var sc = list.find(function (s) { return s.id === id; });
      if (!sc) return null;
      var st = OVERLAY_STYLES[idx % OVERLAY_STYLES.length];
      return { label: sc.name, color: st.color, dash: st.dash, points: sc.traj };
    }).filter(Boolean);
  }

  function fmt(v, d) {
    return (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toFixed(d);
  }

  function renderTable() {
    var tbody = document.getElementById('scenario-rows');
    tbody.innerHTML = '';
    if (!list.length) {
      var tr0 = document.createElement('tr');
      tr0.className = 'empty-row';
      tr0.innerHTML = '<td colspan="14">لا توجد تجارب محفوظة بعد — شغّل تجربة ثم اضغط «حفظ السيناريو الحالي».</td>';
      tbody.appendChild(tr0);
      return;
    }
    list.forEach(function (sc) {
      var tr = document.createElement('tr');
      var selIdx = selected.indexOf(sc.id);
      var swatch = selIdx >= 0
        ? '<span class="scenario-swatch" style="background:' + OVERLAY_STYLES[selIdx % OVERLAY_STYLES.length].color + '"></span>'
        : '';
      tr.innerHTML =
        '<td><input type="checkbox" data-id="' + sc.id + '" ' + (selIdx >= 0 ? 'checked' : '') + ' aria-label="عرض ' + sc.name + '"></td>' +
        '<td>' + sc.name + swatch + '</td>' +
        '<td class="num">' + fmt(sc.params.projectileMass, 1) + '</td>' +
        '<td class="num">' + fmt(sc.params.counterweightMass, 0) + '</td>' +
        '<td class="num">' + fmt(sc.params.longArm, 2) + '</td>' +
        '<td class="num">' + fmt(sc.params.shortArm, 2) + '</td>' +
        '<td class="num">' + fmt(sc.params.releaseAngleDeg, 0) + '</td>' +
        '<td class="num">' + (sc.params.slingLength === null ? 'بلا' : fmt(sc.params.slingLength, 1)) + '</td>' +
        '<td class="num">' + fmt(sc.stats.releaseSpeed, 2) + '</td>' +
        '<td class="num">' + fmt(sc.stats.range, 2) + '</td>' +
        '<td class="num">' + fmt(sc.stats.maxHeight, 2) + '</td>' +
        '<td class="num">' + fmt(sc.stats.flightTime, 2) + '</td>' +
        '<td class="num">' + fmt(sc.stats.efficiencyPct, 1) + '</td>' +
        '<td><button class="btn-delete" data-del="' + sc.id + '" title="حذف التجربة">🗑</button></td>';
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('input[type="checkbox"]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var id = chk.dataset.id;
        if (chk.checked) {
          if (selected.length >= 2) selected.shift(); // أقصى تجربتين معروضتين
          selected.push(id);
        } else {
          selected = selected.filter(function (sid) { return sid !== id; });
        }
        renderTable();
        if (onSelectionChange) onSelectionChange(getOverlays());
      });
    });
    tbody.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () { remove(btn.dataset.del); });
    });
  }

  function init(selectionCb) {
    onSelectionChange = selectionCb;
    loadStored();
    renderTable();
  }

  return {
    init: init,
    save: save,
    remove: remove,
    compareLastTwo: compareLastTwo,
    getOverlays: getOverlays,
    renderTable: renderTable
  };
})();
