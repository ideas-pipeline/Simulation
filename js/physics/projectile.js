/**
 * نموذج المقذوف — Projectile Model
 * =================================
 * بعد لحظة التحرير يصبح المقذوف جسمًا مستقلًا يخضع لحركة المقذوفات:
 *
 *   بدون مقاومة هواء:   ax = 0 ،  ay = −g
 *
 *   مع مقاومة الهواء:   Fd = ½ · ρ · Cd · A · v²
 *   حيث v سرعة المقذوف نسبةً إلى الهواء (تشمل أثر الرياح)،
 *   واتجاه القوة عكس اتجاه هذه السرعة النسبية.
 *
 *   مساحة المقطع لمقذوف كروي:  A = π · d² / 4
 *
 * حالة المقذوف: y = [x, y, vx, vy] وتُكامل بنفس طرق المكامل العددي.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Projectile = (function () {
  'use strict';

  /** مساحة المقطع العرضي لكرة قطرها d:  A = π·d²/4 */
  function crossSectionArea(diameter) {
    return Math.PI * diameter * diameter / 4;
  }

  /** سرعة الرياح الأفقية الموقعة (+ مع اتجاه الرمي، − عكسه) */
  function windX(p) {
    return p.dragEnabled ? p.windSpeed * (p.windDirection === 'head' ? -1 : 1) : 0;
  }

  /**
   * تسارع مقاومة الهواء (aerodynamicDrag):
   *   Fd = ½·ρ·Cd·A·|v_rel|²  عكس اتجاه السرعة النسبية للهواء
   * يعيد [ax, ay] الناتجين عن السحب فقط.
   */
  function dragAcceleration(p, vx, vy) {
    if (!p.dragEnabled) return [0, 0];
    var rvx = vx - windX(p);
    var rvy = vy;
    var v = Math.hypot(rvx, rvy);
    if (v < 1e-12) return [0, 0];
    var A = crossSectionArea(p.projectileDiameter);
    var Fd = 0.5 * p.airDensity * p.dragCd * A * v * v;
    var a = Fd / p.projectileMass;
    return [-a * rvx / v, -a * rvy / v];
  }

  /** مقدار قوة السحب بالنيوتن (للعرض ولحساب الطاقة المفقودة) */
  function dragForce(p, vx, vy) {
    if (!p.dragEnabled) return { fx: 0, fy: 0, mag: 0 };
    var acc = dragAcceleration(p, vx, vy);
    return {
      fx: acc[0] * p.projectileMass,
      fy: acc[1] * p.projectileMass,
      mag: Math.hypot(acc[0], acc[1]) * p.projectileMass
    };
  }

  /**
   * دالة مشتقات حركة المقذوف (projectileMotion):
   *   dx/dt = vx ، dy/dt = vy
   *   dvx/dt = ax(drag) ، dvy/dt = −g + ay(drag)
   */
  function derivFactory(p) {
    return function (t, y) {
      var drag = dragAcceleration(p, y[2], y[3]);
      return [y[2], y[3], drag[0], -p.gravity + drag[1]];
    };
  }

  /**
   * كشف الاصطدام بالأرض (groundCollision):
   * عند عبور y مستوى الأرض بين خطوتين، نستوفي خطيًا لإيجاد لحظة
   * ونقطة السقوط الدقيقتين (يقلل خطأ التقدير من O(Δt) إلى O(Δt²)).
   */
  function groundCollision(prevState, curState, tPrev, dt) {
    if (curState[1] > 0) return null;
    var y0 = prevState[1], y1 = curState[1];
    var s = (y1 - y0) !== 0 ? y0 / (y0 - y1) : 1; // نسبة الخطوة حتى y = 0
    var lerp = function (a, b) { return a + (b - a) * s; };
    return {
      t: tPrev + s * dt,
      x: lerp(prevState[0], curState[0]),
      y: 0,
      vx: lerp(prevState[2], curState[2]),
      vy: lerp(prevState[3], curState[3])
    };
  }

  return {
    crossSectionArea: crossSectionArea,
    windX: windX,
    dragAcceleration: dragAcceleration,
    dragForce: dragForce,
    derivFactory: derivFactory,
    groundCollision: groundCollision
  };
})();
