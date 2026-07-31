/**
 * التحقق الفيزيائي — Validation Tests
 * ====================================
 * مقارنة نتيجة التكامل العددي لطور الطيران بالحل التحليلي المعروف
 * لحركة المقذوفات (صالح فقط عند تعطيل مقاومة الهواء):
 *
 * إذا تساوى ارتفاعا الإطلاق والهبوط (y0 = 0):
 *      Range = v0² · sin(2φ) / g
 *
 * وإذا كان الإطلاق من ارتفاع y0 مختلف عن الهبوط (الأرض عند y = 0):
 *      زمن السقوط:  t = ( vy + √(vy² + 2·g·y0) ) / g
 *      المدى:       Δx = vx · t
 *
 * تُعرض نسبة الخطأ بين الحل العددي والتحليلي، ويجب أن تكون صغيرة جدًا
 * عند خطوة زمنية مناسبة — وإلا فهناك خلل عددي.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Validation = (function () {
  'use strict';

  /** هل يُعد الارتفاع y0 مساويًا لمستوى الهبوط عمليًا؟ */
  var LEVEL_EPS = 1e-3; // متر

  /**
   * الحل التحليلي لحركة مقذوف (بدون سحب) يُطلق من (x0, y0)
   * بسرعة (vx, vy) ويهبط عند y = 0.
   */
  function analyticFlight(x0, y0, vx, vy, g) {
    var disc = vy * vy + 2 * g * y0;
    if (disc < 0) return null; // لا يصل إلى مستوى الأرض (حالة غير فيزيائية هنا)
    var t = (vy + Math.sqrt(disc)) / g;
    if (t <= 0) return null;

    var v0 = Math.hypot(vx, vy);
    var phi = Math.atan2(vy, vx);
    var levelGround = Math.abs(y0) < LEVEL_EPS;

    // معادلة المدى المختصرة صالحة فقط عند تساوي مستويي الإطلاق والهبوط
    var simpleRange = levelGround ? (v0 * v0 * Math.sin(2 * phi) / g) : null;

    var maxHeight = y0 + (vy > 0 ? (vy * vy) / (2 * g) : 0);

    return {
      flightTime: t,
      deltaX: vx * t,          // الإزاحة الأفقية منذ التحرير
      landingX: x0 + vx * t,   // موضع السقوط (من محور الارتكاز)
      maxHeight: maxHeight,
      levelGround: levelGround,
      simpleRange: simpleRange,
      formula: levelGround
        ? 'Range = v0^2 * sin(2*phi) / g'
        : 't = (vy + sqrt(vy^2 + 2*g*y0)) / g ,  Range = vx * t'
    };
  }

  /**
   * مقارنة نتيجة المحاكاة العددية بالحل التحليلي.
   * تعيد نسب الخطأ في المدى وزمن الطيران (٪).
   */
  function compare(release, numericLandingX, numericFlightTime, p) {
    if (p.dragEnabled) {
      return { applicable: false, reason: 'المقارنة التحليلية تصح فقط عند تعطيل مقاومة الهواء' };
    }
    var ana = analyticFlight(release.x, release.y, release.vx, release.vy, p.gravity);
    if (!ana) return { applicable: false, reason: 'لا يوجد حل تحليلي لهذه الحالة' };

    var numDx = numericLandingX - release.x;
    var rangeErr = Math.abs(ana.deltaX) > 1e-9
      ? Math.abs(numDx - ana.deltaX) / Math.abs(ana.deltaX) * 100 : null;
    var timeErr = ana.flightTime > 1e-9
      ? Math.abs(numericFlightTime - ana.flightTime) / ana.flightTime * 100 : null;

    return {
      applicable: true,
      analytic: ana,
      numericDeltaX: numDx,
      numericFlightTime: numericFlightTime,
      rangeErrorPct: rangeErr,
      timeErrorPct: timeErr
    };
  }

  return { analyticFlight: analyticFlight, compare: compare };
})();
