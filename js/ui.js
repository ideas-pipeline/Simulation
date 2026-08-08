/**
 * عناصر التحكم — User Controls
 * =============================
 * يبني لوحة التحكم برمجيًا من مخطط بيانات (Schema): لكل متغير شريط
 * تمرير وحقل رقمي متزامنان مع وحدة SI ظاهرة، ويجمع القيم في كائن
 * المعاملات، ويعرض التحذيرات والنتائج ولوحة التحقق والقيم الحية
 * في قسم «كيف تم حساب النتيجة؟».
 */
window.TrebSim = window.TrebSim || {};

TrebSim.UI = (function () {
  'use strict';

  /** مخطط مجموعات التحكم — key يطابق حقل المعاملات في المحاكاة */
  var GROUPS = [
    {
      id: 'dims', title: 'أبعاد وزوايا المنجنيق', open: true,
      controls: [
        {
          key: 'armMode', label: 'نظام المحور', unit: '',
          select: [
            { v: 'standard', t: 'محور ثابت (منجنيق تقليدي)' },
            { v: 'fat', t: 'ذراع عائمة FAT — ثقل يسقط رأسيًا ومحور منزلق' }
          ]
        },
        { key: 'longArm', label: 'طول الذراع الطويل', unit: 'm', min: 1, max: 18, step: 0.1 },
        { key: 'shortArm', label: 'طول الذراع القصير', unit: 'm', min: 0.3, max: 8, step: 0.05 },
        { key: 'totalArm', label: 'طول الذراع الكلي', unit: 'm', computed: true },
        { key: 'pivotHeight', label: 'ارتفاع محور الارتكاز', unit: 'm', min: 0.5, max: 18, step: 0.1 },
        { key: 'startAngleDeg', label: 'زاوية بداية الذراع (من الأفقي)', unit: '°', min: -85, max: 0, step: 1 },
        { key: 'releaseAngleDeg', label: 'زاوية تحرير المقذوف', unit: '°', min: -20, max: 85, step: 1 },
        { key: 'slingLength', label: 'طول المقلاع', unit: 'm', min: 0.2, max: 16, step: 0.1, requires: 'slingEnabled' },
        { key: 'hangerLength', label: 'طول تعليق الثقل المتأرجح', unit: 'm', min: 0.1, max: 5, step: 0.05, requires: 'swingingCW' }
      ]
    },
    {
      id: 'masses', title: 'الكتل وتوزيعها', open: true,
      controls: [
        { key: 'projectileMass', label: 'كتلة المقذوف', unit: 'kg', min: 0.5, max: 500, step: 0.5 },
        { key: 'counterweightMass', label: 'كتلة الثقل الموازن', unit: 'kg', min: 10, max: 40000, step: 10 },
        { key: 'armMass', label: 'كتلة ذراع المنجنيق', unit: 'kg', min: 1, max: 5000, step: 1 },
        { key: 'armComPos', label: 'موقع مركز كتلة الذراع (+ نحو الطرف الطويل)', unit: 'm', min: -8, max: 18, step: 0.05 },
        { key: 'armInertiaCoeff', label: 'توزيع كتلة الذراع (معامل القصور k — للذراع المنتظم k = 1/12 ≈ 0.083)', unit: '', min: 0.02, max: 0.3, step: 0.005 }
      ]
    },
    {
      id: 'structure', title: 'المواد والمتانة — متى يتحطم المنجنيق؟', open: true,
      controls: [
        { key: 'structuralEnabled', label: 'تفعيل تحليل التحطم الواقعي', unit: '', checkbox: true },
        {
          key: 'armWood', label: 'مادة الذراع', unit: '', requires: 'structuralEnabled',
          select: Object.keys(TrebSim.Structure.WOODS).map(function (k) {
            var w = TrebSim.Structure.WOODS[k];
            return { v: k, t: w.name + ' — MOR ' + (w.mor / 1e6) + ' MPa، ρ ' + w.rho + ' kg/m³' };
          })
        },
        { key: 'armWidth', label: 'عرض مقطع الذراع b', unit: 'm', min: 0.05, max: 1.0, step: 0.005, requires: 'structuralEnabled' },
        { key: 'armHeight', label: 'ارتفاع مقطع الذراع h', unit: 'm', min: 0.05, max: 1.2, step: 0.005, requires: 'structuralEnabled' },
        { key: 'autoArmMass', label: 'حساب كتلة الذراع تلقائيًا من المادة والأبعاد (M = ρ·b·h·L)', unit: '', checkbox: true, requires: 'structuralEnabled' },
        { key: 'armMassComputed', label: 'كتلة الذراع من المادة والأبعاد', unit: 'kg', computed: true },
        { key: 'ropeDiameter', label: 'قطر حبل المقلاع (قنب)', unit: 'm', min: 0.005, max: 0.25, step: 0.001, requires: ['structuralEnabled', 'slingEnabled'] }
      ]
    },
    {
      id: 'physics', title: 'العوامل الفيزيائية', open: false,
      controls: [
        { key: 'gravity', label: 'تسارع الجاذبية g', unit: 'm/s²', min: 1, max: 25, step: 0.01 },
        { key: 'pivotFriction', label: 'احتكاك محور الارتكاز (عزم جاف)', unit: 'N·m', min: 0, max: 200, step: 1 },
        { key: 'damping', label: 'معامل التخميد اللزج', unit: 'N·m·s/rad', min: 0, max: 100, step: 0.5 }
      ]
    },
    {
      id: 'drag', title: 'مقاومة الهواء والرياح', open: false,
      controls: [
        { key: 'dragCd', label: 'معامل مقاومة الهواء Cd', unit: '', min: 0.05, max: 2, step: 0.01, requires: 'dragEnabled' },
        { key: 'airDensity', label: 'كثافة الهواء ρ', unit: 'kg/m³', min: 0.1, max: 3, step: 0.005, requires: 'dragEnabled' },
        { key: 'projectileDiameter', label: 'قطر المقذوف (كروي)', unit: 'm', min: 0.05, max: 1, step: 0.01, requires: 'dragEnabled' },
        { key: 'windSpeed', label: 'سرعة الرياح', unit: 'm/s', min: 0, max: 30, step: 0.5, requires: 'dragEnabled' },
        {
          key: 'windDirection', label: 'اتجاه الرياح', unit: '', requires: 'dragEnabled',
          select: [{ v: 'tail', t: 'مع اتجاه الرمي (مساعدة)' }, { v: 'head', t: 'عكس اتجاه الرمي (معاكسة)' }]
        }
      ]
    },
    {
      id: 'target', title: 'الهدف: الجدار (وضع الحصار)', open: true,
      controls: [
        { key: 'targetDistance', label: 'مسافة الهدف من محور الارتكاز', unit: 'm', min: 5, max: 1500, step: 1 },
        { key: 'wallEnabled', label: 'جدار قابل للهدم عند الهدف (عطّله لعلامة هدف بسيطة)', unit: '', checkbox: true },
        {
          key: 'wallMaterial', label: 'مادة الجدار', unit: '', requires: 'wallEnabled',
          select: Object.keys(TrebSim.Wall.MATERIALS).map(function (k) {
            var m = TrebSim.Wall.MATERIALS[k];
            return { v: k, t: m.name + ' — طاقة هدم ' + (m.u / 1000) + ' kJ/m³' };
          })
        },
        { key: 'wallThickness', label: 'سماكة الجدار', unit: 'm', min: 0.1, max: 3, step: 0.05, requires: 'wallEnabled' },
        { key: 'wallHeight', label: 'ارتفاع الجدار', unit: 'm', min: 1, max: 8, step: 0.25, requires: 'wallEnabled' }
      ]
    },
    {
      id: 'numerics', title: 'الإعدادات العددية', open: false,
      controls: [
        { key: 'timeStep', label: 'حجم الخطوة الزمنية Δt', unit: 's', min: 0.0005, max: 0.05, step: 0.0005 },
        {
          key: 'integrator', label: 'طريقة التكامل العددي', unit: '',
          select: [{ v: 'rk4', t: 'Runge-Kutta 4 (دقيقة — افتراضي)' }, { v: 'euler', t: 'أويلر شبه ضمني (وضع مبسط)' }]
        }
      ]
    }
  ];

  /** بنود لوحة النتائج الـ 13 */
  var RESULTS = [
    { key: 'range', label: 'المسافة الأفقية لنقطة السقوط (من المحور)', unit: 'm', digits: 2, highlight: true },
    { key: 'targetDiff', label: 'المسافة بين نقطة السقوط والهدف', unit: 'm', digits: 2, highlight: true },
    { key: 'targetSide', label: 'موقع السقوط بالنسبة للهدف', unit: '', text: true },
    { key: 'maxHeight', label: 'أقصى ارتفاع للمقذوف', unit: 'm', digits: 2 },
    { key: 'flightTime', label: 'زمن الطيران', unit: 's', digits: 3 },
    { key: 'releaseSpeed', label: 'سرعة المقذوف لحظة التحرير', unit: 'm/s', digits: 2 },
    { key: 'releaseAngleDeg', label: 'زاوية الإطلاق الفعلية (اتجاه السرعة)', unit: '°', digits: 1 },
    { key: 'impactSpeed', label: 'السرعة عند الاصطدام بالأرض', unit: 'm/s', digits: 2 },
    { key: 'omegaAtRelease', label: 'السرعة الزاوية للذراع لحظة التحرير', unit: 'rad/s', digits: 3 },
    { key: 'maxAlpha', label: 'أقصى تسارع زاوي', unit: 'rad/s²', digits: 2 },
    { key: 'initialPE', label: 'طاقة الوضع المستهلكة من الثقل حتى التحرير', unit: 'J', digits: 0 },
    { key: 'keAtRelease', label: 'طاقة حركة المقذوف لحظة التحرير', unit: 'J', digits: 0 },
    { key: 'efficiencyPct', label: 'نسبة الكفاءة', unit: '%', digits: 1 },
    // --- التحليل الإنشائي (تظهر «—» عند تعطيله)
    { key: 'structStatus', label: 'حالة البنية — هل تحطم المنجنيق؟', unit: '', text: true, structural: true, highlight: true },
    { key: 'maxStressMPa', label: 'أقصى إجهاد انحناء على الذراع', unit: 'MPa', digits: 2, structural: true },
    { key: 'armSF', label: 'معامل أمان الذراع الخشبي (MOR/σ)', unit: '', digits: 2, structural: true },
    { key: 'maxTensionKN', label: 'أقصى شد في حبل المقلاع', unit: 'kN', digits: 2, structural: true }
  ];

  var inputs = {};   // key → {range, number, row} أو {select}
  var toggles = {};  // chk ids
  var onChange = null;

  /**
   * أقفال التثبيت: أي مفتاح مقفول يحترمه مُحسِّن الكفاءة ولا يغيّره.
   * مفتاحا الوضع (المقلاع/الثقل المتأرجح) مثبتان افتراضيًا لأن اختيار
   * الوضع قرار صريح من المستخدم — يمكن فك القفل للسماح بتجربة الوضعين.
   */
  var DEFAULT_LOCKS = { slingEnabled: true, swingingCW: true };
  var locks = Object.assign({}, DEFAULT_LOCKS);
  var lockButtons = {}; // key → button element

  function refreshLockVisual(key) {
    var btn = lockButtons[key];
    if (!btn) return;
    var on = !!locks[key];
    btn.textContent = on ? '🔒' : '🔓';
    btn.classList.toggle('locked', on);
    btn.title = on
      ? 'مثبتة: المُحسِّن سيبقيها كما هي — اضغط لفك التثبيت'
      : 'تثبيت هذه القيمة عند تحسين الكفاءة';
    var inp = inputs[key];
    if (inp && inp.row) inp.row.classList.toggle('locked-row', on);
  }

  function setLock(key, on) {
    locks[key] = !!on;
    refreshLockVisual(key);
  }

  function getLocks() { return Object.assign({}, locks); }

  function clearLocks() {
    locks = Object.assign({}, DEFAULT_LOCKS);
    Object.keys(lockButtons).forEach(refreshLockVisual);
  }

  /** إنشاء زر قفل لمفتاح قابل للتحسين */
  function makeLockButton(key) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lock-btn';
    btn.setAttribute('aria-label', 'تثبيت القيمة عند التحسين');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      setLock(key, !locks[key]);
    });
    lockButtons[key] = btn;
    return btn;
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toFixed(digits);
  }

  /** بناء صف تحكم واحد (مزلاج + حقل رقمي أو قائمة) */
  function buildControl(ctrl, container) {
    var row = document.createElement('div');
    row.className = 'ctrl-row';
    row.dataset.key = ctrl.key;

    var label = document.createElement('div');
    label.className = 'ctrl-label';
    var name = document.createElement('span');
    name.textContent = ctrl.label;
    // زر تثبيت للمعاملات الداخلة في فضاء بحث مُحسِّن الكفاءة
    if (!ctrl.computed && !ctrl.checkbox && !ctrl.select &&
        TrebSim.Optimizer && TrebSim.Optimizer.LABELS[ctrl.key]) {
      name.appendChild(document.createTextNode(' '));
      name.appendChild(makeLockButton(ctrl.key));
    }
    label.appendChild(name);
    if (ctrl.unit) {
      var unit = document.createElement('span');
      unit.className = 'unit';
      unit.textContent = '(' + ctrl.unit + ')';
      label.appendChild(unit);
    }
    row.appendChild(label);

    var wrap = document.createElement('div');
    wrap.className = 'ctrl-inputs';

    if (ctrl.computed) {
      var stat = document.createElement('div');
      stat.className = 'ctrl-static';
      stat.id = 'computed-' + ctrl.key;
      wrap.appendChild(stat);
      inputs[ctrl.key] = { computed: true, el: stat };
    } else if (ctrl.checkbox) {
      var chkLabel = document.createElement('label');
      chkLabel.className = 'chip';
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.addEventListener('change', function () {
        refreshDependentState();
        if (onChange) onChange();
      });
      chkLabel.appendChild(chk);
      chkLabel.appendChild(document.createTextNode(' تفعيل'));
      wrap.appendChild(chkLabel);
      inputs[ctrl.key] = { checkbox: chk, row: row, requires: ctrl.requires };
    } else if (ctrl.select) {
      var sel = document.createElement('select');
      ctrl.select.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.v; op.textContent = o.t;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { if (onChange) onChange(); });
      wrap.appendChild(sel);
      inputs[ctrl.key] = { select: sel, row: row, requires: ctrl.requires };
    } else {
      var range = document.createElement('input');
      range.type = 'range';
      range.min = ctrl.min; range.max = ctrl.max; range.step = ctrl.step;
      var num = document.createElement('input');
      num.type = 'number';
      num.min = ctrl.min; num.max = ctrl.max; num.step = ctrl.step;
      num.setAttribute('aria-label', ctrl.label);

      range.addEventListener('input', function () {
        num.value = range.value;
        if (onChange) onChange();
      });
      num.addEventListener('change', function () {
        var v = parseFloat(num.value);
        if (!isFinite(v)) v = ctrl.min;
        v = Math.min(parseFloat(num.max), Math.max(parseFloat(num.min), v));
        num.value = v;
        range.value = v;
        if (onChange) onChange();
      });

      wrap.appendChild(range);
      wrap.appendChild(num);
      inputs[ctrl.key] = { range: range, number: num, row: row, requires: ctrl.requires };
    }
    row.appendChild(wrap);
    container.appendChild(row);
  }

  /** بناء اللوحة كاملة */
  function build(container, changeCb) {
    onChange = changeCb;
    GROUPS.forEach(function (g) {
      var det = document.createElement('details');
      det.className = 'ctrl-group';
      det.open = g.open;
      var sum = document.createElement('summary');
      sum.textContent = g.title;
      det.appendChild(sum);
      var body = document.createElement('div');
      body.className = 'ctrl-group-body';
      g.controls.forEach(function (c) { buildControl(c, body); });
      det.appendChild(body);
      container.appendChild(det);
    });
    Object.keys(lockButtons).forEach(refreshLockVisual);
  }

  /** وضع قيم المعاملات في عناصر التحكم */
  function setParams(p) {
    Object.keys(inputs).forEach(function (key) {
      var inp = inputs[key];
      if (inp.computed) return;
      if (inp.checkbox) { inp.checkbox.checked = !!p[key]; return; }
      if (inp.select) { inp.select.value = p[key]; return; }
      if (p[key] !== undefined) {
        inp.range.value = p[key];
        inp.number.value = p[key];
      }
    });
    toggles.drag.checked = !!p.dragEnabled;
    toggles.sling.checked = !!p.slingEnabled;
    toggles.swing.checked = !!p.swingingCW;
    refreshDependentState();
  }

  /** جمع المعاملات من عناصر التحكم */
  function collectParams() {
    var p = {};
    Object.keys(inputs).forEach(function (key) {
      var inp = inputs[key];
      if (inp.computed) return;
      if (inp.checkbox) { p[key] = inp.checkbox.checked; return; }
      if (inp.select) { p[key] = inp.select.value; return; }
      p[key] = parseFloat(inp.number.value);
    });
    p.dragEnabled = toggles.drag.checked;
    p.slingEnabled = toggles.sling.checked;
    p.swingingCW = toggles.swing.checked;
    return p;
  }

  /** تحديث الحقول التابعة: الطول الكلي، مدى مركز الكتلة، تفعيل/تعطيل الصفوف */
  function refreshDependentState() {
    var p = collectParams();
    var total = document.getElementById('computed-totalArm');
    if (total) total.innerHTML = 'Lp + Lc = <b>' + (p.longArm + p.shortArm).toFixed(2) + ' m</b>';

    // مدى موقع مركز كتلة الذراع محصور بين طرفي الذراع
    var com = inputs.armComPos;
    if (com && com.range) {
      com.range.min = (-p.shortArm).toFixed(2);
      com.range.max = p.longArm.toFixed(2);
      com.number.min = com.range.min;
      com.number.max = com.range.max;
      var v = parseFloat(com.number.value);
      var clamped = Math.min(p.longArm, Math.max(-p.shortArm, v));
      if (v !== clamped) { com.number.value = clamped; com.range.value = clamped; }
    }

    // الذراع العائمة: الثقل مقيد في قناة — خيار التأرجح غير متاح
    var fatMode = p.armMode === 'fat';
    if (toggles.swing) {
      toggles.swing.disabled = fatMode;
      var swingChip = toggles.swing.closest('.chip');
      if (swingChip) swingChip.classList.toggle('chip-disabled', fatMode);
      if (lockButtons.swingingCW) lockButtons.swingingCW.disabled = fatMode;
    }

    // شرط تفعيل صف تحكم: كل مفاتيح requires (نص أو مصفوفة) يجب أن تكون مفعلة
    function reqOn(k) {
      if (k === 'dragEnabled') return toggles.drag.checked;
      if (k === 'slingEnabled') return toggles.sling.checked;
      if (k === 'swingingCW') return toggles.swing.checked && !fatMode;
      var dep = inputs[k];
      return dep && dep.checkbox ? dep.checkbox.checked : true;
    }
    Object.keys(inputs).forEach(function (key) {
      var inp = inputs[key];
      if (!inp.requires || !inp.row) return;
      var enabled = [].concat(inp.requires).every(reqOn);
      inp.row.classList.toggle('disabled', !enabled);
    });

    // كتلة الذراع المحسوبة من المادة والأبعاد + تعطيل المزلاج اليدوي عند التفعيل
    var autoOn = p.structuralEnabled && p.autoArmMass;
    var massComputed = document.getElementById('computed-armMassComputed');
    if (massComputed) {
      var mAuto = TrebSim.Structure.autoArmMass(p);
      massComputed.innerHTML = 'M = ρ·b·h·L = <b>' + mAuto.toFixed(1) + ' kg</b>' +
        (autoOn ? ' (مستخدمة في المحاكاة)' : ' (للمرجعية فقط)');
    }
    if (inputs.armMass && inputs.armMass.row) {
      inputs.armMass.row.classList.toggle('disabled', autoOn);
    }
  }

  /** ربط أزرار الاختيار (chips) العلوية */
  function bindToggles(changeCb) {
    toggles.drag = document.getElementById('chk-drag');
    toggles.sling = document.getElementById('chk-sling');
    toggles.swing = document.getElementById('chk-swing');
    [toggles.drag, toggles.sling, toggles.swing].forEach(function (t) {
      t.addEventListener('change', function () {
        refreshDependentState();
        changeCb();
      });
    });
    // أقفال وضعي المقلاع والثقل المتأرجح (بجوار الـ chips)
    [['lock-sling', 'slingEnabled'], ['lock-swing', 'swingingCW']].forEach(function (pair) {
      var btn = document.getElementById(pair[0]);
      if (!btn) return;
      lockButtons[pair[1]] = btn;
      btn.addEventListener('click', function () { setLock(pair[1], !locks[pair[1]]); });
      refreshLockVisual(pair[1]);
    });
  }

  // ---------------- التحذيرات ----------------
  function renderWarnings(errors, warnings) {
    var box = document.getElementById('warnings');
    box.innerHTML = '';
    (errors || []).forEach(function (e) {
      var d = document.createElement('div');
      d.className = 'error-item';
      d.textContent = e;
      box.appendChild(d);
    });
    (warnings || []).forEach(function (wtext) {
      var d = document.createElement('div');
      d.className = 'warning-item';
      d.textContent = wtext;
      box.appendChild(d);
    });
  }

  // ---------------- النتائج ----------------
  function buildResults(container) {
    RESULTS.forEach(function (rs) {
      var item = document.createElement('div');
      item.className = 'result-item' + (rs.highlight ? ' highlight' : '');
      item.id = 'res-' + rs.key;
      var lab = document.createElement('div');
      lab.className = 'rlabel';
      lab.textContent = rs.label;
      var val = document.createElement('div');
      val.className = 'rvalue';
      val.innerHTML = '— <span class="unit">' + rs.unit + '</span>';
      item.appendChild(lab);
      item.appendChild(val);
      container.appendChild(item);
    });
  }

  function renderResults(result) {
    var stats = result && result.stats;
    var struct = result && result.structural;
    RESULTS.forEach(function (rs) {
      var item = document.getElementById('res-' + rs.key);
      var val = item.querySelector('.rvalue');
      item.classList.remove('result-warn');

      // بنود التحليل الإنشائي تُقرأ من result.structural (وقد توجد حتى لو فشل الإطلاق)
      if (rs.structural) {
        if (!struct) {
          val.innerHTML = '— <span class="unit">' + rs.unit + '</span>';
          return;
        }
        if (rs.key === 'structStatus') {
          var f = struct.failure;
          var txt = !f ? '✔ سليمة — لم يتحطم شيء'
            : f.type === 'arm' ? '⚡ تحطم الذراع عند t = ' + f.t.toFixed(2) + ' s'
            : '⚡ انقطع الحبل عند t = ' + f.t.toFixed(2) + ' s';
          val.innerHTML = txt;
          if (f) item.classList.add('result-warn');
          return;
        }
        var sv = rs.key === 'maxStressMPa' ? struct.maxStress / 1e6
          : rs.key === 'armSF' ? struct.armSF
          : rs.key === 'maxTensionKN' ? (struct.maxTension !== null ? struct.maxTension / 1000 : null)
          : null;
        val.innerHTML = fmt(sv, rs.digits) + ' <span class="unit">' + rs.unit + '</span>';
        if (rs.key === 'armSF' && sv !== null && sv < 1.5) item.classList.add('result-warn');
        return;
      }

      if (!stats) {
        val.innerHTML = rs.text ? '—' : '— <span class="unit">' + rs.unit + '</span>';
        return;
      }
      if (rs.key === 'targetSide') {
        var diff = stats.targetDiff;
        var txt = stats.hitWall ? '🧱 أصاب الجدار'
          : stats.overWall ? '↷ تجاوز الجدار من فوقه'
          : diff === null || diff === undefined ? '—'
          : Math.abs(diff) < 0.5 ? '🎯 أصاب الهدف تقريبًا'
          : diff < 0 ? 'سقط قبل الهدف' : 'سقط بعد الهدف';
        val.innerHTML = txt;
        if (diff !== null && diff !== undefined && Math.abs(diff) >= 0.5) item.classList.add('result-warn');
        return;
      }
      var v = stats[rs.key];
      if (rs.key === 'targetDiff' && v !== null && v !== undefined) v = Math.abs(v);
      val.innerHTML = fmt(v, rs.digits) + ' <span class="unit">' + rs.unit + '</span>';
    });
  }

  // ---------------- التحقق الفيزيائي ----------------
  function renderValidation(result) {
    var box = document.getElementById('validation-content');
    if (!result || !result.validation) {
      box.innerHTML = '<p class="panel-note">لا توجد نتيجة طيران بعد — شغّل تجربة ناجحة أولًا.</p>';
      return;
    }
    var v = result.validation;
    if (!v.applicable) {
      box.innerHTML = '<p class="panel-note">⚠ ' + v.reason + '.</p>';
      return;
    }
    var a = v.analytic;
    var html = '';
    html += '<div class="validation-formula">' + (a.levelGround
      ? 'Range = v0² · sin(2φ) / g   (launch level = landing level)'
      : 't = (vy + √(vy² + 2·g·y0)) / g ,   Range = vx · t   (y0 = ' + result.release.y.toFixed(2) + ' m)') + '</div>';
    function row(lab, val, cls) {
      return '<div class="vrow"><span>' + lab + '</span><span class="vvalue ' + (cls || '') + '">' + val + '</span></div>';
    }
    html += row('المدى الأفقي منذ التحرير — عدديًا', v.numericDeltaX.toFixed(3) + ' m');
    html += row('المدى الأفقي منذ التحرير — تحليليًا', a.deltaX.toFixed(3) + ' m');
    if (a.simpleRange !== null) html += row('v0²·sin(2φ)/g (المستويان متساويان)', a.simpleRange.toFixed(3) + ' m');
    html += row('زمن الطيران — عدديًا', v.numericFlightTime.toFixed(4) + ' s');
    html += row('زمن الطيران — تحليليًا', a.flightTime.toFixed(4) + ' s');
    var ok = v.rangeErrorPct !== null && v.rangeErrorPct < 0.5;
    html += row('نسبة الخطأ في المدى',
      (v.rangeErrorPct === null ? '—' : v.rangeErrorPct.toExponential(2) + ' %'), ok ? 'vgood' : 'vbad');
    html += row('نسبة الخطأ في زمن الطيران',
      (v.timeErrorPct === null ? '—' : v.timeErrorPct.toExponential(2) + ' %'), ok ? 'vgood' : 'vbad');
    html += '<p class="panel-note">' + (ok
      ? '✔ الخطأ العددي صغير جدًا — التكامل العددي يطابق الحل التحليلي.'
      : '✖ الخطأ كبير — جرّب خطوة زمنية أصغر أو مكامل RK4.') + '</p>';
    box.innerHTML = html;
  }

  // ---------------- القيم الحية في قسم «كيف تم حساب النتيجة؟» ----------------
  function renderHowLive(result) {
    var box = document.getElementById('how-live');
    if (!result || !result.ok) { box.innerHTML = ''; return; }
    var p = result.params;
    var T = TrebSim.Trebuchet;
    var iArm = T.armInertiaAboutPivot(p);
    var iTot = T.momentOfInertia(p);
    var th0 = p.startAngleDeg * Math.PI / 180;
    var tq = T.torqueBreakdown(p, { theta: th0 }, { theta: 0 });
    var rows = [
      ['عزم قصور الذراع حول المحور I_arm', iArm.toFixed(1) + ' kg·m²'],
      ['عزم القصور الكلي I_total = I_arm + Mc·Lc² + Mp·Lp²', iTot.toFixed(1) + ' kg·m²'],
      ['عزم الثقل الموازن عند البداية τc', tq.tauCW.toFixed(1) + ' N·m'],
      ['عزم المقذوف عند البداية τp', tq.tauProj.toFixed(1) + ' N·m'],
      ['عزم وزن الذراع عند البداية', tq.tauArm.toFixed(1) + ' N·m'],
      ['العزم المحصل عند البداية Στ', tq.net.toFixed(1) + ' N·m'],
      ['التسارع الزاوي الابتدائي α = Στ/I', (tq.net / iTot).toFixed(3) + ' rad/s²'],
      ['وزن الثقل الموازن W = Mc·g', (p.counterweightMass * p.gravity).toFixed(0) + ' N'],
      ['وزن المقذوف W = Mp·g', (p.projectileMass * p.gravity).toFixed(0) + ' N']
    ];
    if (p.structuralEnabled) {
      var wd = TrebSim.Structure.wood(p);
      rows.push(['معامل مقطع الذراع S = b·h²/6',
        (TrebSim.Structure.sectionModulus(p.armWidth, p.armHeight) * 1e6).toFixed(0) + ' cm³']);
      rows.push(['معامل تمزق الخشب (' + wd.name + ') MOR', (wd.mor / 1e6).toFixed(0) + ' MPa']);
      if (p.slingEnabled) {
        rows.push(['قوة قطع حبل القنب F = σt·π·d²/4',
          (TrebSim.Structure.ropeBreakForce(p.ropeDiameter) / 1000).toFixed(1) + ' kN']);
      }
    }
    var html = '<h3>بالقيم الحالية (تُحدّث مع كل تعديل)</h3><table>';
    rows.forEach(function (r2) {
      html += '<tr><td>' + r2[0] + '</td><td>' + r2[1] + '</td></tr>';
    });
    html += '</table>';
    box.innerHTML = html;
  }

  return {
    GROUPS: GROUPS,
    build: build,
    bindToggles: bindToggles,
    setParams: setParams,
    collectParams: collectParams,
    refreshDependentState: refreshDependentState,
    buildResults: buildResults,
    renderResults: renderResults,
    renderWarnings: renderWarnings,
    renderValidation: renderValidation,
    renderHowLive: renderHowLive,
    getLocks: getLocks,
    setLock: setLock,
    clearLocks: clearLocks,
    fmt: fmt
  };
})();
