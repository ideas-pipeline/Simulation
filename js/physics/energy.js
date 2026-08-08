/**
 * ميزان الطاقة — Energy Balance
 * ==============================
 * تُحسب في كل لحظة:
 *   - طاقة وضع كل جسم:      PE = m·g·y   (المرجع: مستوى الأرض y = 0)
 *   - طاقة حركة الثقل:      KE = ½·Mc·|v_cw|²
 *   - طاقة دوران الذراع:    KE = ½·I_arm·ω²   (حول محور الارتكاز)
 *   - طاقة حركة المقذوف:    KE = ½·Mp·|v_p|²
 *   - الطاقة المفقودة تراكميًا بالاحتكاك والتخميد والسحب (تُجمع في المحاكاة)
 *
 * فحص حفظ الطاقة: يجب أن يبقى
 *      E_total(t) + E_lost(t) ≈ E_total(0)
 * وأي انحراف كبير يدل على خطأ عددي (خطوة زمنية كبيرة مثلًا).
 *
 * الكفاءة = طاقة حركة المقذوف لحظة التحرير ÷ طاقة الوضع التي فقدها
 *           الثقل الموازن حتى تلك اللحظة × 100
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Energy = (function () {
  'use strict';

  var Trebuchet = TrebSim.Trebuchet;

  /** طاقات النظام أثناء طور الذراع (المقذوف ما يزال متصلًا) */
  function armPhaseEnergies(p, q, qd) {
    var geo = Trebuchet.geometry(p, q);
    var vel = Trebuchet.velocities(p, q, qd);
    var g = p.gravity;
    var w = qd.theta;

    // طاقة الذراع = انتقال مركز كتلته + دوران حول مركز الكتلة
    // (تكافئ ½·I_pivot·ω² للمحور الثابت بمبرهنة المحور الموازي،
    //  وتصح أيضًا للذراع العائمة حيث يتحرك المحور نفسه)
    var Ltot = p.longArm + p.shortArm;
    var iCom = p.armInertiaCoeff * p.armMass * Ltot * Ltot;
    var keArm = 0.5 * iCom * w * w
      + 0.5 * p.armMass * (vel.armComV.x * vel.armComV.x + vel.armComV.y * vel.armComV.y);
    var keCW = 0.5 * p.counterweightMass * (vel.cwV.x * vel.cwV.x + vel.cwV.y * vel.cwV.y);
    var keProj = 0.5 * p.projectileMass * (vel.projV.x * vel.projV.x + vel.projV.y * vel.projV.y);

    var peArm = p.armMass * g * geo.armCom.y;
    var peCW = p.counterweightMass * g * geo.cw.y;
    var peProj = p.projectileMass * g * geo.proj.y;

    return {
      keArm: keArm, keCW: keCW, keProj: keProj,
      peArm: peArm, peCW: peCW, peProj: peProj,
      keTotal: keArm + keCW + keProj,
      peTotal: peArm + peCW + peProj,
      total: keArm + keCW + keProj + peArm + peCW + peProj
    };
  }

  /** طاقة المقذوف الطائر + طاقات الذراع/الثقل المستمرين بعد التحرير */
  function flightPhaseProjectileEnergies(p, x, y, vx, vy) {
    var ke = 0.5 * p.projectileMass * (vx * vx + vy * vy);
    var pe = p.projectileMass * p.gravity * y;
    return { ke: ke, pe: pe, total: ke + pe };
  }

  /**
   * قدرة الفقد اللحظية أثناء طور الذراع (واط):
   *   P = b·ω² + τf·|ω|   (تخميد لزج + احتكاك جاف)
   */
  function armLossPower(p, qd) {
    var w = Math.abs(qd.theta);
    return p.damping * qd.theta * qd.theta + p.pivotFriction * w;
  }

  /**
   * قدرة فقد السحب أثناء الطيران (واط): P = F_drag · v
   * (الجداء القياسي لقوة السحب مع سرعة المقذوف)
   */
  function dragLossPower(p, vx, vy) {
    var f = TrebSim.Projectile.dragForce(p, vx, vy);
    return -(f.fx * vx + f.fy * vy); // القوة عكس الحركة ⇒ الناتج موجب
  }

  /**
   * الكفاءة التقريبية:
   *   Efficiency = KE_projectile(release) / (Mc·g·Δh) × 100
   * حيث Δh هبوط الثقل الموازن الفعلي من البداية حتى لحظة التحرير.
   */
  function efficiency(keProjAtRelease, cwDropHeight, p) {
    var pe = p.counterweightMass * p.gravity * cwDropHeight;
    if (pe <= 1e-9) return null;
    return (keProjAtRelease / pe) * 100;
  }

  return {
    armPhaseEnergies: armPhaseEnergies,
    flightPhaseProjectileEnergies: flightPhaseProjectileEnergies,
    armLossPower: armLossPower,
    dragLossPower: dragLossPower,
    efficiency: efficiency
  };
})();
