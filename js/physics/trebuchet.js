/**
 * نموذج المنجنيق — Trebuchet Model
 * =================================
 * نظام الإحداثيات:
 *   - المحور x الموجب باتجاه الرمي، والمحور y للأعلى، والأرض عند y = 0.
 *   - محور الارتكاز (Pivot) عند النقطة (0, H) حيث H ارتفاع المحور.
 *
 * زاوية الذراع θ معرفة بحيث يشير الذراع الطويل باتجاه المتجه:
 *      u = (−cosθ, sinθ)
 * أي أن θ = −45° تعني أن طرف الذراع الطويل خلف المحور وتحته (وضع البداية)،
 * ومع سقوط الثقل الموازن تزداد θ حتى زاوية التحرير.
 *
 * مواضع النقاط:
 *   طرف الذراع الطويل:  B = pivot + Lp·u
 *   طرف الذراع القصير:  A = pivot − Lc·u
 *   الثقل الموازن:      مثبت عند A، أو متأرجح: A + Lh·(sinφ, −cosφ)
 *   المقذوف:            عند B، أو بمقلاع: B + Ls·(sinψ, −cosψ)
 *
 * المعادلات مشتقة بصيغة لاغرانج وتُحل بصيغة المصفوفة:
 *      M(q)·q̈ = f(q, q̇)
 * حيث q = [θ] أو [θ, φ] أو [θ, ψ] أو [θ, φ, ψ] حسب الخيارات المفعلة.
 *
 * في النمط المبسط (ثقل مثبت بلا مقلاع) تؤول المعادلات إلى قانون نيوتن
 * الثاني للدوران:  Στ = I·α  حيث:
 *      Στ = Mc·g·Lc·cosθ − Mp·g·Lp·cosθ − Marm·g·d·cosθ − b·ω − τf·sign(ω)
 *      I  = I_arm + Mc·Lc² + Mp·Lp²
 * (تظهر cosθ هنا لأن θ مقاسة من الأفقي؛ وهي نفسها صيغة M·g·L·sin(θ′)
 *  عندما تقاس الزاوية θ′ من الرأسي، إذ sin(θ′) = cos(θ).)
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Trebuchet = (function () {
  'use strict';

  var Integrator = TrebSim.Integrator;

  /** ثابت تنعيم إشارة الاحتكاك لتجنب عدم الاستقرار العددي عند ω ≈ 0 */
  var FRICTION_SMOOTH_OMEGA = 0.01; // rad/s

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** قائمة درجات الحرية الفعالة حسب الخيارات */
  function dofs(p) {
    var d = ['theta'];
    if (p.swingingCW) d.push('phi');
    if (p.slingEnabled) d.push('psi');
    return d;
  }

  /**
   * عزم القصور الذاتي للذراع حول محور الارتكاز (momentOfInertia)
   * باستخدام مبرهنة المحور الموازي:
   *    I_arm = k·Marm·Ltot²  (حول مركز الكتلة، k = 1/12 للذراع المنتظم)
   *          + Marm·d²       (نقل المحور من مركز الكتلة إلى محور الارتكاز)
   * حيث d الموقع الموقّع لمركز كتلة الذراع (موجب باتجاه الذراع الطويل).
   */
  function armInertiaAboutPivot(p) {
    var Ltot = p.longArm + p.shortArm;
    var iCom = p.armInertiaCoeff * p.armMass * Ltot * Ltot;
    return iCom + p.armMass * p.armComPos * p.armComPos;
  }

  /**
   * عزم القصور الذاتي الكلي حول المحور (للنمط المبسط وللعرض التعليمي):
   *    I_total = I_arm + Mc·Lc² + Mp·Lp²
   */
  function momentOfInertia(p) {
    return armInertiaAboutPivot(p)
      + p.counterweightMass * p.shortArm * p.shortArm
      + p.projectileMass * p.longArm * p.longArm;
  }

  /** المواضع الهندسية لكل الأجزاء عند حالة معممة q */
  function geometry(p, q) {
    var th = q.theta, H = p.pivotHeight;
    var ux = -Math.cos(th), uy = Math.sin(th);
    var pivot = { x: 0, y: H };
    var tip = { x: p.longArm * ux, y: H + p.longArm * uy };
    var shortEnd = { x: -p.shortArm * ux, y: H - p.shortArm * uy };
    var armCom = { x: p.armComPos * ux, y: H + p.armComPos * uy };

    var cw;
    if (p.swingingCW) {
      cw = {
        x: shortEnd.x + p.hangerLength * Math.sin(q.phi),
        y: shortEnd.y - p.hangerLength * Math.cos(q.phi)
      };
    } else {
      cw = { x: shortEnd.x, y: shortEnd.y };
    }

    var proj;
    if (p.slingEnabled) {
      proj = {
        x: tip.x + p.slingLength * Math.sin(q.psi),
        y: tip.y - p.slingLength * Math.cos(q.psi)
      };
    } else {
      proj = { x: tip.x, y: tip.y };
    }

    return { pivot: pivot, tip: tip, shortEnd: shortEnd, armCom: armCom, cw: cw, proj: proj };
  }

  /** السرعات الخطية للأجزاء (مشتقات المواضع بالنسبة للزمن) */
  function velocities(p, q, qd) {
    var th = q.theta, w = qd.theta;
    // مشتقة u = (−cosθ, sinθ) هي θ̇·(sinθ, cosθ)
    var tipV = { x: p.longArm * w * Math.sin(th), y: p.longArm * w * Math.cos(th) };
    var shortEndV = { x: -p.shortArm * w * Math.sin(th), y: -p.shortArm * w * Math.cos(th) };

    var cwV;
    if (p.swingingCW) {
      cwV = {
        x: shortEndV.x + p.hangerLength * qd.phi * Math.cos(q.phi),
        y: shortEndV.y + p.hangerLength * qd.phi * Math.sin(q.phi)
      };
    } else {
      cwV = shortEndV;
    }

    var projV;
    if (p.slingEnabled) {
      projV = {
        x: tipV.x + p.slingLength * qd.psi * Math.cos(q.psi),
        y: tipV.y + p.slingLength * qd.psi * Math.sin(q.psi)
      };
    } else {
      projV = tipV;
    }

    return { tipV: tipV, shortEndV: shortEndV, cwV: cwV, projV: projV };
  }

  /**
   * تفكيك عزوم الجاذبية المعممة حول θ (torque) — للعرض التعليمي:
   * ملاحظة: cos(θ) هنا ≡ sin(θ′) عند قياس الزاوية θ′ من الرأسي.
   */
  function torqueBreakdown(p, q, qd) {
    var c = Math.cos(q.theta), g = p.gravity;
    var w = qd ? qd.theta : 0;
    var tauCW = p.counterweightMass * g * p.shortArm * c;      // عزم الثقل (محرك)
    var tauProj = -p.projectileMass * g * p.longArm * c;       // عزم المقذوف (مقاوم بداية)
    var tauArm = -p.armMass * g * p.armComPos * c;             // عزم وزن الذراع
    var tauDamp = -p.damping * w;                              // التخميد اللزج
    var tauFric = -p.pivotFriction * Math.tanh(w / FRICTION_SMOOTH_OMEGA); // احتكاك المحور
    return {
      tauCW: tauCW, tauProj: tauProj, tauArm: tauArm,
      tauDamp: tauDamp, tauFric: tauFric,
      net: tauCW + tauProj + tauArm + tauDamp + tauFric
    };
  }

  /**
   * بناء مصفوفة الكتلة M(q) ومتجه القوى المعممة f(q, q̇)
   * بحيث M·q̈ = f (معادلات لاغرانج المشتقة يدويًا — انظر توثيق أعلى الملف).
   */
  function massMatrixAndForces(p, q, qd) {
    var names = dofs(p);
    var n = names.length;
    var g = p.gravity;
    var Lp = p.longArm, Lc = p.shortArm;
    var Mc = p.counterweightMass, Mp = p.projectileMass;
    var th = q.theta, w = qd.theta;
    var cosTh = Math.cos(th);

    var M = [];
    var f = [];
    for (var i = 0; i < n; i++) { M.push(new Array(n).fill(0)); f.push(0); }

    var iTheta = 0;
    var iPhi = names.indexOf('phi');
    var iPsi = names.indexOf('psi');

    // --- الذراع نفسه: I_arm·θ̈ ، وعزم وزنه −Marm·g·d·cosθ
    M[iTheta][iTheta] += armInertiaAboutPivot(p);
    f[iTheta] += -p.armMass * g * p.armComPos * cosTh;

    // --- الثقل الموازن
    // في الحالتين يضيف Mc·Lc² إلى القصور حول θ وعزمًا محركًا +Mc·g·Lc·cosθ
    M[iTheta][iTheta] += Mc * Lc * Lc;
    f[iTheta] += Mc * g * Lc * cosTh;
    if (p.swingingCW) {
      // بندول بطول Lh معلق بطرف الذراع القصير — حد التزاوج:
      //   T_cross = −Mc·Lc·Lh·sin(θ+φ)·θ̇·φ̇
      var Lh = p.hangerLength;
      var sTF = Math.sin(th + q.phi), cTF = Math.cos(th + q.phi);
      M[iTheta][iPhi] += -Mc * Lc * Lh * sTF;
      M[iPhi][iTheta] += -Mc * Lc * Lh * sTF;
      M[iPhi][iPhi] += Mc * Lh * Lh;
      f[iTheta] += Mc * Lc * Lh * cTF * qd.phi * qd.phi;
      f[iPhi] += Mc * Lc * Lh * cTF * w * w - Mc * g * Lh * Math.sin(q.phi);
    }

    // --- المقذوف
    // في الحالتين يضيف Mp·Lp² حول θ وعزمًا مقاومًا −Mp·g·Lp·cosθ
    M[iTheta][iTheta] += Mp * Lp * Lp;
    f[iTheta] += -Mp * g * Lp * cosTh;
    if (p.slingEnabled) {
      // مقلاع بطول Ls معلق بطرف الذراع الطويل — حد التزاوج:
      //   T_cross = +Mp·Lp·Ls·sin(θ+ψ)·θ̇·ψ̇
      var Ls = p.slingLength;
      var sTP = Math.sin(th + q.psi), cTP = Math.cos(th + q.psi);
      M[iTheta][iPsi] += Mp * Lp * Ls * sTP;
      M[iPsi][iTheta] += Mp * Lp * Ls * sTP;
      M[iPsi][iPsi] += Mp * Ls * Ls;
      f[iTheta] += -Mp * Lp * Ls * cTP * qd.psi * qd.psi;
      f[iPsi] += -Mp * Lp * Ls * cTP * w * w - Mp * g * Ls * Math.sin(q.psi);
    }

    // --- القوى غير المحافظة على محور الارتكاز:
    // تخميد لزج −b·ω واحتكاك جاف −τf·sign(ω) (بإشارة منعّمة عدديًا)
    f[iTheta] += -p.damping * w - p.pivotFriction * Math.tanh(w / FRICTION_SMOOTH_OMEGA);

    return { names: names, M: M, f: f };
  }

  /** تحويل متجه الحالة y = [q..., q̇...] إلى كائنات {theta, phi, psi} */
  function unpackState(p, y) {
    var names = dofs(p);
    var n = names.length;
    var q = {}, qd = {};
    for (var i = 0; i < n; i++) {
      q[names[i]] = y[i];
      qd[names[i]] = y[n + i];
    }
    return { q: q, qd: qd, n: n, names: names };
  }

  /**
   * التسارع الزاوي المعمم (angularAcceleration):
   * حل الجملة M(q)·q̈ = f(q, q̇) بحذف غاوس.
   */
  function angularAcceleration(p, q, qd) {
    var sys = massMatrixAndForces(p, q, qd);
    var qdd = Integrator.solveLinear(sys.M, sys.f);
    if (!qdd) qdd = new Array(sys.names.length).fill(0); // حماية من مصفوفة شاذة
    return qdd;
  }

  /** دالة المشتقات dy/dt لطور الذراع، للاستخدام مع المكامل العددي */
  function derivFactory(p) {
    return function (t, y) {
      var s = unpackState(p, y);
      var qdd = angularAcceleration(p, s.q, s.qd);
      var out = new Array(2 * s.n);
      for (var i = 0; i < s.n; i++) {
        out[i] = y[s.n + i]; // dq/dt = q̇
        out[s.n + i] = qdd[i]; // dq̇/dt = q̈
      }
      return out;
    };
  }

  /**
   * الحالة الابتدائية:
   *  θ = زاوية البداية، φ = 0 (الثقل معلق رأسيًا)،
   *  ψ تُختار بحيث يستقر المقذوف على مستوى الأرض خلف طرف الذراع إن أمكن
   *  (تقريب لموضع المقذوف في مجرى الإطلاق)، وإلا يتدلى المقلاع رأسيًا.
   */
  function initialState(p) {
    var th0 = p.startAngleDeg * Math.PI / 180;
    var names = dofs(p);
    var q = { theta: th0, phi: 0, psi: 0 };
    if (p.slingEnabled) {
      var tipY0 = p.pivotHeight + p.longArm * Math.sin(th0);
      q.psi = -Math.acos(clamp(tipY0 / p.slingLength, -1, 1));
    }
    var y = [];
    var i;
    for (i = 0; i < names.length; i++) y.push(q[names[i]]);
    for (i = 0; i < names.length; i++) y.push(0); // سرعات ابتدائية صفرية
    return y;
  }

  return {
    dofs: dofs,
    armInertiaAboutPivot: armInertiaAboutPivot,
    momentOfInertia: momentOfInertia,
    geometry: geometry,
    velocities: velocities,
    torqueBreakdown: torqueBreakdown,
    massMatrixAndForces: massMatrixAndForces,
    unpackState: unpackState,
    angularAcceleration: angularAcceleration,
    derivFactory: derivFactory,
    initialState: initialState
  };
})();
