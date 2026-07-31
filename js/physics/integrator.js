/**
 * المكامل العددي — Numerical Integrator
 * ======================================
 * يوفر طريقتين لحل جملة المعادلات التفاضلية  dy/dt = f(t, y):
 *
 * 1) Runge-Kutta من الرتبة الرابعة (RK4) — الطريقة الافتراضية:
 *      k1 = f(t, y)
 *      k2 = f(t + Δt/2, y + Δt/2·k1)
 *      k3 = f(t + Δt/2, y + Δt/2·k2)
 *      k4 = f(t + Δt,   y + Δt·k3)
 *      y(t+Δt) = y + Δt/6·(k1 + 2k2 + 2k3 + k4)
 *    خطأها المحلي من رتبة O(Δt⁵) لذا تعطي دقة عالية بخطوات معقولة.
 *
 * 2) أويلر شبه الضمني (Semi-Implicit / Symplectic Euler) — للوضع المبسط:
 *      v(t+Δt) = v(t) + a(t)·Δt        ← أولًا نحدّث السرعة
 *      q(t+Δt) = q(t) + v(t+Δt)·Δt     ← ثم الموضع بالسرعة الجديدة
 *    مستقرة طاقيًا أكثر من أويلر الصريح.
 *
 * تمثيل الحالة: y = [q1..qn, v1..vn] (المواضع المعممة ثم سرعاتها).
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Integrator = (function () {
  'use strict';

  /** خطوة RK4 واحدة. deriv(t, y) تعيد dy/dt. */
  function rk4Step(deriv, t, y, dt) {
    const n = y.length;
    const k1 = deriv(t, y);

    const y2 = new Array(n);
    for (let i = 0; i < n; i++) y2[i] = y[i] + 0.5 * dt * k1[i];
    const k2 = deriv(t + 0.5 * dt, y2);

    const y3 = new Array(n);
    for (let i = 0; i < n; i++) y3[i] = y[i] + 0.5 * dt * k2[i];
    const k3 = deriv(t + 0.5 * dt, y3);

    const y4 = new Array(n);
    for (let i = 0; i < n; i++) y4[i] = y[i] + dt * k3[i];
    const k4 = deriv(t + dt, y4);

    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
    return out;
  }

  /**
   * خطوة أويلر شبه ضمنية واحدة.
   * تفترض أن y = [q(n), v(n)] وأن deriv تعيد [v, a].
   */
  function semiImplicitStep(deriv, t, y, dt) {
    const d = deriv(t, y);
    const n = y.length / 2;
    const out = y.slice();
    // السرعة أولًا بالتسارع المحسوب عند الحالة الحالية
    for (let i = 0; i < n; i++) out[n + i] = y[n + i] + dt * d[n + i];
    // ثم الموضع بالسرعة الجديدة (هذا ما يجعلها "شبه ضمنية")
    for (let i = 0; i < n; i++) out[i] = y[i] + dt * out[n + i];
    return out;
  }

  /** خطوة واحدة حسب الطريقة المختارة ('rk4' أو 'euler'). */
  function step(method, deriv, t, y, dt) {
    return method === 'euler'
      ? semiImplicitStep(deriv, t, y, dt)
      : rk4Step(deriv, t, y, dt);
  }

  /**
   * حل الجملة الخطية A·x = b بحذف غاوس مع اختيار محور جزئي.
   * تستخدم لحل معادلات لاغرانج بصيغة المصفوفة  M(q)·q̈ = f(q, q̇).
   * الأبعاد صغيرة (حتى 3×3) لذا الكلفة مهملة.
   */
  function solveLinear(A, b) {
    const n = b.length;
    // نسخ حتى لا نُفسد المدخلات
    const M = A.map(function (row) { return row.slice(); });
    const x = b.slice();

    for (let col = 0; col < n; col++) {
      // اختيار المحور الأكبر (partial pivoting) للاستقرار العددي
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-12) return null; // مصفوفة شاذة
      if (piv !== col) {
        const tmpRow = M[col]; M[col] = M[piv]; M[piv] = tmpRow;
        const tmpB = x[col]; x[col] = x[piv]; x[piv] = tmpB;
      }
      for (let r = col + 1; r < n; r++) {
        const factor = M[r][col] / M[col][col];
        for (let c = col; c < n; c++) M[r][c] -= factor * M[col][c];
        x[r] -= factor * x[col];
      }
    }
    // تعويض عكسي
    for (let r = n - 1; r >= 0; r--) {
      let s = x[r];
      for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
      x[r] = s / M[r][r];
    }
    return x;
  }

  return { rk4Step: rk4Step, semiImplicitStep: semiImplicitStep, step: step, solveLinear: solveLinear };
})();
