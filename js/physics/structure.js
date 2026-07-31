/**
 * التحليل الإنشائي — Structural Analysis (تجربة واقعية)
 * ======================================================
 * متى يتحطم المنجنيق؟ تُحسب في كل خطوة زمنية الإجهادات الديناميكية
 * على الذراع الخشبي وحبل المقلاع وتُقارن بمقاومة المادة:
 *
 * 1) عزم الانحناء على الذراع (المقطع الحرج عند محور الارتكاز):
 *    القوى العرضية (العمودية على الذراع) على كل جانب تولّد عزم انحناء.
 *    - حمل نقطي في الطرف:      M = F⊥ · L
 *    - الحمل الموزع للذراع:    M = λ·(|α|·L³/3 + g·|cosθ|·L²/2)
 *      حيث λ = M_arm / L_total الكثافة الخطية للذراع.
 *    التقدير تحفظي: تُجمع مقادير الأحمال (لا إشاراتها) لتقدير أسوأ حالة.
 *
 * 2) إجهاد الانحناء لمقطع مستطيل b×h:
 *        σ = M·c / I = M / S ،   S = b·h²/6
 *    ويقارن بمعامل تمزق الخشب MOR (Modulus of Rupture):
 *        معامل الأمان SF = MOR / σ
 *    الكسر عندما σ ≥ MOR.
 *
 * 3) شد حبل المقلاع (قضيب/حبل مشدود):
 *        T = Mp · (a⃗_p − g⃗) · û
 *    حيث û متجه الوحدة من المقذوف نحو طرف الذراع، وa⃗_p تسارع المقذوف
 *    الناتج من حل معادلات لاغرانج. قوة قطع الحبل:
 *        F_break = σ_t · π·d²/4
 *    ينقطع الحبل عندما T ≥ F_break (فيتحرر المقذوف مبكرًا).
 *
 * قيم المواد تقريبية تعليمية (خشب جاف، حبل قنب) وليست قيم تصميم هندسي.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Structure = (function () {
  'use strict';

  /** أنواع الخشب: الكثافة ρ (kg/m³) ومعامل التمزق MOR (Pa) */
  var WOODS = {
    oak: { name: 'بلوط Oak', rho: 750, mor: 90e6 },
    ash: { name: 'دردار Ash', rho: 680, mor: 100e6 },
    pine: { name: 'صنوبر Pine', rho: 500, mor: 60e6 },
    spruce: { name: 'شوح Spruce', rho: 450, mor: 63e6 },
    weak: { name: 'خشب رديء منخفض الجودة', rho: 400, mor: 30e6 }
  };

  /** حبل المقلاع: قنب طبيعي، مقاومة شد فعالة تقريبية */
  var ROPE = { name: 'قنب Hemp', sigmaT: 90e6 };

  function wood(p) { return WOODS[p.armWood] || WOODS.oak; }

  /** كتلة الذراع المحسوبة من المادة والأبعاد: M = ρ·b·h·L_total */
  function autoArmMass(p) {
    return wood(p).rho * p.armWidth * p.armHeight * (p.longArm + p.shortArm);
  }

  /** معامل مقطع مستطيل: S = b·h²/6 (الانحناء حول المحور الأفقي للمقطع) */
  function sectionModulus(b, h) { return b * h * h / 6; }

  /** إجهاد الانحناء σ = M/S */
  function bendingStress(M, b, h) { return M / sectionModulus(b, h); }

  /** قوة قطع الحبل F_break = σ_t·π·d²/4 */
  function ropeBreakForce(d) { return ROPE.sigmaT * Math.PI * d * d / 4; }

  /**
   * تسارع طرف الذراع الطويل (لموضع tip = pivot + Lp·(−cosθ, sinθ)):
   *   a = Lp·θ̈·(sinθ, cosθ) + Lp·θ̇²·(cosθ, −sinθ)
   */
  function tipAcceleration(p, q, qd, alphaTheta) {
    var s = Math.sin(q.theta), c = Math.cos(q.theta);
    var w2 = qd.theta * qd.theta;
    return {
      x: p.longArm * (alphaTheta * s + w2 * c),
      y: p.longArm * (alphaTheta * c - w2 * s)
    };
  }

  /**
   * شد حبل المقلاع: T = Mp·((a⃗_p − g⃗)·û)
   * a⃗_p = تسارع الطرف + مركبة دوران المقلاع، û = (−sinψ, cosψ)
   */
  function slingTension(p, q, qd, qdd) {
    var aTip = tipAcceleration(p, q, qd, qdd.theta);
    var sPsi = Math.sin(q.psi), cPsi = Math.cos(q.psi);
    var wp2 = qd.psi * qd.psi;
    var ap = {
      x: aTip.x + p.slingLength * (qdd.psi * cPsi - wp2 * sPsi),
      y: aTip.y + p.slingLength * (qdd.psi * sPsi + wp2 * cPsi)
    };
    // û من المقذوف نحو الطرف، وg⃗ = (0, −g)
    var T = p.projectileMass * (ap.x * (-sPsi) + (ap.y + p.gravity) * cPsi);
    return Math.max(0, T); // الحبل لا يدفع
  }

  /** شد تعليق الثقل المتأرجح (نفس منطق المقلاع على الطرف القصير) */
  function hangerTension(p, q, qd, qdd) {
    var s = Math.sin(q.theta), c = Math.cos(q.theta);
    var w2 = qd.theta * qd.theta;
    // تسارع طرف الذراع القصير A = pivot + Lc·(cosθ, −sinθ)
    var aA = {
      x: -p.shortArm * (qdd.theta * s + w2 * c),
      y: -p.shortArm * (qdd.theta * c - w2 * s)
    };
    var sPhi = Math.sin(q.phi), cPhi = Math.cos(q.phi);
    var wf2 = qd.phi * qd.phi;
    var ac = {
      x: aA.x + p.hangerLength * (qdd.phi * cPhi - wf2 * sPhi),
      y: aA.y + p.hangerLength * (qdd.phi * sPhi + wf2 * cPhi)
    };
    var T = p.counterweightMass * (ac.x * (-sPhi) + (ac.y + p.gravity) * cPhi);
    return Math.max(0, T);
  }

  /**
   * عزم الانحناء عند مقطع المحور من كل جانب (تقدير تحفظي بالمقادير)
   * يعيد أيضًا شد الحبل/التعليق إن وُجدا.
   */
  function armBendingMoment(p, q, qd, qdd) {
    var g = p.gravity;
    var alpha = qdd.theta;
    var absA = Math.abs(alpha);
    var absC = Math.abs(Math.cos(q.theta));
    var lambda = p.armMass / (p.longArm + p.shortArm); // كثافة خطية

    var tension = null;

    // --- الجانب الطويل (المقذوف)
    var fTip;
    if (p.slingEnabled) {
      tension = slingTension(p, q, qd, qdd);
      // المركبة العمودية على الذراع من قوة الحبل: |T·cos(θ+ψ)|
      fTip = tension * Math.abs(Math.cos(q.theta + q.psi));
    } else {
      // F⊥ = Mp·(Lp·α + g·cosθ)
      fTip = p.projectileMass * Math.abs(p.longArm * alpha + g * Math.cos(q.theta));
    }
    var mLong = fTip * p.longArm
      + lambda * (absA * Math.pow(p.longArm, 3) / 3 + g * absC * p.longArm * p.longArm / 2);

    // --- الجانب القصير (الثقل الموازن)
    var fShort;
    if (p.swingingCW) {
      var Tc = hangerTension(p, q, qd, qdd);
      fShort = Tc * Math.abs(Math.cos(q.theta + q.phi));
    } else {
      fShort = p.counterweightMass * Math.abs(p.shortArm * alpha - g * Math.cos(q.theta));
    }
    var mShort = fShort * p.shortArm
      + lambda * (absA * Math.pow(p.shortArm, 3) / 3 + g * absC * p.shortArm * p.shortArm / 2);

    return { mLong: mLong, mShort: mShort, mMax: Math.max(mLong, mShort), tension: tension };
  }

  /**
   * التقييم الكامل لخطوة واحدة:
   * إجهاد الانحناء ومعامل الأمان وشد الحبل ومعامل أمانه.
   */
  function evaluate(p, q, qd, qdd) {
    var w = wood(p);
    var bm = armBendingMoment(p, q, qd, qdd);
    var sigma = bendingStress(bm.mMax, p.armWidth, p.armHeight);
    var out = {
      mMax: bm.mMax,
      sigma: sigma,
      mor: w.mor,
      sf: sigma > 1e-9 ? w.mor / sigma : Infinity,
      tension: bm.tension,
      ropeBreak: null,
      ropeSF: null
    };
    if (p.slingEnabled && bm.tension !== null) {
      out.ropeBreak = ropeBreakForce(p.ropeDiameter);
      out.ropeSF = bm.tension > 1e-9 ? out.ropeBreak / bm.tension : Infinity;
    }
    return out;
  }

  return {
    WOODS: WOODS,
    ROPE: ROPE,
    wood: wood,
    autoArmMass: autoArmMass,
    sectionModulus: sectionModulus,
    bendingStress: bendingStress,
    ropeBreakForce: ropeBreakForce,
    slingTension: slingTension,
    hangerTension: hangerTension,
    armBendingMoment: armBendingMoment,
    evaluate: evaluate
  };
})();
