/**
 * جدار الهدف وفيزياء الاصطدام — Target Wall & Impact Physics
 * ============================================================
 * الهدف جدار رأسي عند مسافة يحددها المستخدم، بمادة وسماكة وارتفاع
 * يتحكم بها، ويُحكم على انهياره فيزيائيًا عبر ضرر تراكمي من القذائف.
 *
 * مقاييس الاصطدام (كميات معرفة تمامًا):
 *   - طاقة الحركة:              KE = ½·m·v²
 *   - الطاقة العمودية الهادمة:   KE⊥ = ½·m·vx²   (الجدار رأسي، فمركبة
 *     السرعة الأفقية هي التي تهدم — القذيفة المسطحة أنفع من الساقطة)
 *   - الزخم:                    p = m·v
 *
 * «قوة الاصطدام» ليست معرفة بدون زمن تلامس، لذا تُعرض القوة المتوسطة
 * عبر مبرهنة الشغل/الدفع مع مسافة انسحاق مميزة d لكل مادة:
 *   F_avg = KE ÷ d      ،      P = F_avg ÷ A   (A مقطع المقذوف)
 *
 * نموذج الهدم (تعليمي معلَن الافتراضات):
 *   سعة هدم منطقة الاختراق:  E_cap = u · t · A_breach
 *   حيث u طاقة الهدم النوعية للمادة (J/m³) وt سماكة الجدار
 *   وA_breach = 0.25 m² مساحة ثغرة الاختراق المفترضة (تكفي لعبور القذيفة).
 *   ضرر القذيفة % = KE⊥ / E_cap × 100 ، وينهار الجدار عند 100%.
 *   عتبة مرنة: إصابة طاقتها العمودية < 2% من السعة ترتد بلا ضرر يُذكر.
 *
 * قيم المواد تقريبية تعليمية وليست قيم تصميم إنشائي.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Wall = (function () {
  'use strict';

  var A_BREACH = 0.25;         // m² مساحة ثغرة الاختراق (0.5×0.5 م تكفي لعبور القذيفة)
  var THRESHOLD_FRACTION = 0.02; // عتبة الضرر المرنة (نسبة من السعة)

  /**
   * مواد الجدار: الكثافة ρ، مقاومة الانضغاط σc، طاقة الهدم النوعية u،
   * مسافة الانسحاق المميزة d (لتقدير القوة المتوسطة)، ولون الرسم.
   */
  var MATERIALS = {
    wood: { name: 'خشب (سور خشبي)', rho: 600, sigmaC: 30e6, u: 350e3, crush: 0.06, color: '#8b5e34', dark: '#6b4423' },
    brick: { name: 'طوب', rho: 1800, sigmaC: 15e6, u: 800e3, crush: 0.03, color: '#b3573f', dark: '#8a3f2c' },
    stone: { name: 'حجر (بناء حجري)', rho: 2500, sigmaC: 80e6, u: 1600e3, crush: 0.02, color: '#8f8a80', dark: '#6d6960' },
    concrete: { name: 'خرسانة', rho: 2400, sigmaC: 35e6, u: 2600e3, crush: 0.012, color: '#a8a7a0', dark: '#83827c' }
  };

  function material(p) { return MATERIALS[p.wallMaterial] || MATERIALS.stone; }

  /** سعة هدم منطقة الاختراق: E_cap = u·t·A_breach (جول) */
  function capacity(p) {
    return material(p).u * p.wallThickness * A_BREACH;
  }

  /** عتبة الضرر المرنة (جول) — دونها ترتد القذيفة بلا ضرر يُذكر */
  function threshold(p) {
    return THRESHOLD_FRACTION * capacity(p);
  }

  /**
   * مقاييس الاصطدام بالجدار عند سرعة (vx, vy):
   * كلها من معادلات معرفة، والقوة المتوسطة بافتراض انسحاق معلَن.
   */
  function impactMetrics(p, vx, vy) {
    var m = p.projectileMass;
    var speed = Math.hypot(vx, vy);
    var ke = 0.5 * m * speed * speed;          // KE = ½mv²
    var keNormal = 0.5 * m * vx * vx;          // المركبة العمودية على الجدار
    var momentum = m * speed;                   // p = m·v
    var mat = material(p);
    var avgForce = ke / mat.crush;              // F = KE/d (شغل/دفع)
    var area = Math.PI * p.projectileDiameter * p.projectileDiameter / 4;
    var pressure = avgForce / area;             // P = F/A
    // زاوية السقوط على الجدار: 0° = عمودية تمامًا (أفقية)، 90° = موازية
    var incidenceDeg = Math.abs(Math.atan2(vy, Math.abs(vx))) * 180 / Math.PI;
    return {
      speed: speed, ke: ke, keNormal: keNormal, momentum: momentum,
      avgForce: avgForce, pressure: pressure, incidenceDeg: incidenceDeg,
      crush: mat.crush
    };
  }

  /** نسبة ضرر إصابة واحدة (٪ من سعة الهدم)، مع تطبيق العتبة المرنة */
  function hitDamagePct(p, keNormal) {
    var cap = capacity(p);
    if (cap <= 0) return 0;
    if (keNormal < threshold(p)) return 0; // ارتداد مرن — لا ضرر يُذكر
    return keNormal / cap * 100;
  }

  return {
    MATERIALS: MATERIALS,
    A_BREACH: A_BREACH,
    material: material,
    capacity: capacity,
    threshold: threshold,
    impactMetrics: impactMetrics,
    hitDamagePct: hitDamagePct
  };
})();
