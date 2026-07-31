/**
 * منسّق المحاكاة — Simulation Orchestrator
 * =========================================
 * يدير التجربة كاملة على طورين:
 *
 *   الطور الأول (طور الذراع): يُكامل معادلات لاغرانج للمنجنيق حتى بلوغ
 *   زاوية التحرير (مع استيفاء دقيق للحظة العبور)، أو حتى فشل الإطلاق.
 *
 *   الطور الثاني (طور الطيران): يتحول المقذوف إلى جسم مستقل يخضع لحركة
 *   المقذوفات (جاذبية + سحب اختياري) حتى الاصطدام بالأرض، بينما يستمر
 *   الذراع والثقل بالحركة بعد فقدان كتلة المقذوف.
 *
 * كل خطوة زمنية تُسجل في "إطار" يحوي الحالة والهندسة والطاقات، وتُبنى
 * منه لاحقًا الرسوم المتحركة والرسوم البيانية والنتائج.
 * جميع النتائج ناتجة عن التكامل العددي للمعادلات — لا شيء مُخمَّن.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Simulation = (function () {
  'use strict';

  var Integrator = TrebSim.Integrator;
  var Trebuchet = TrebSim.Trebuchet;
  var Projectile = TrebSim.Projectile;
  var Energy = TrebSim.Energy;
  var Validation = TrebSim.Validation;

  var MAX_ARM_TIME = 30;     // s — مهلة بلوغ زاوية التحرير
  var MAX_FLIGHT_TIME = 240; // s — مهلة الطيران
  var MAX_STEPS = 500000;    // حد أقصى لعدد الخطوات (حماية)

  /** القيم الافتراضية للتجربة الأولى (قيم تعليمية وليست توصيات هندسية) */
  function defaults() {
    return {
      longArm: 4,            // m  طول الذراع الطويل Lp
      shortArm: 1.5,         // m  طول الذراع القصير Lc
      pivotHeight: 2.5,      // m  ارتفاع محور الارتكاز H
      armMass: 60,           // kg كتلة الذراع
      armComPos: 1.25,       // m  موقع مركز كتلة الذراع (موجب نحو الطرف الطويل)
      armInertiaCoeff: 1 / 12, // معامل توزيع كتلة الذراع (1/12 للذراع المنتظم)
      projectileMass: 10,    // kg
      counterweightMass: 300, // kg
      startAngleDeg: -45,    // °
      releaseAngleDeg: 40,   // °
      slingEnabled: false,
      slingLength: 2,        // m
      swingingCW: false,
      hangerLength: 0.8,     // m طول تعليق الثقل المتأرجح
      gravity: 9.81,         // m/s²
      dragEnabled: false,
      dragCd: 0.47,          // معامل السحب لكرة
      airDensity: 1.225,     // kg/m³
      projectileDiameter: 0.2, // m
      pivotFriction: 0,      // N·m احتكاك جاف بالمحور
      damping: 0,            // N·m·s/rad تخميد لزج
      windSpeed: 0,          // m/s
      windDirection: 'tail', // 'tail' مع الرمي | 'head' عكسه
      timeStep: 0.005,       // s
      targetDistance: 20,    // m موقع الهدف
      integrator: 'rk4',     // 'rk4' | 'euler'
      // --- التحليل الإنشائي (تجربة واقعية: متى يتحطم المنجنيق؟)
      structuralEnabled: true,
      armWood: 'oak',        // نوع خشب الذراع
      armWidth: 0.15,        // m عرض مقطع الذراع b
      armHeight: 0.25,       // m ارتفاع مقطع الذراع h
      autoArmMass: false,    // حساب كتلة الذراع من المادة والأبعاد
      ropeDiameter: 0.016    // m قطر حبل المقلاع (قنب)
    };
  }

  /** فحوص المدخلات — تعيد {errors, warnings} قبل تشغيل أي محاكاة */
  function validateParams(p) {
    var errors = [];
    var warnings = [];

    function positive(v, name) {
      if (!(v > 0) || !isFinite(v)) errors.push('قيمة «' + name + '» يجب أن تكون موجبة وأكبر من صفر.');
    }
    positive(p.longArm, 'طول الذراع الطويل');
    positive(p.shortArm, 'طول الذراع القصير');
    positive(p.pivotHeight, 'ارتفاع المحور');
    positive(p.armMass, 'كتلة الذراع');
    positive(p.projectileMass, 'كتلة المقذوف');
    positive(p.counterweightMass, 'كتلة الثقل الموازن');
    positive(p.gravity, 'تسارع الجاذبية');
    positive(p.timeStep, 'الخطوة الزمنية');
    positive(p.projectileDiameter, 'قطر المقذوف');
    if (p.slingEnabled) positive(p.slingLength, 'طول المقلاع');
    if (p.swingingCW) positive(p.hangerLength, 'طول تعليق الثقل');

    if (p.releaseAngleDeg <= p.startAngleDeg) {
      errors.push('زاوية التحرير يجب أن تكون أكبر من زاوية البداية.');
    }
    if (p.releaseAngleDeg < -80 || p.releaseAngleDeg > 89) {
      errors.push('زاوية التحرير خارج النطاق المنطقي (−80° إلى 89°).');
    }
    if (p.timeStep > 0.05) {
      warnings.push('الخطوة الزمنية كبيرة (Δt > 0.05 s) — قد تتدهور الدقة العددية.');
    }

    // فحص كفاية الثقل الموازن: التسارع الزاوي الابتدائي يجب أن يدفع الذراع نحو التحرير
    if (errors.length === 0) {
      var y0 = Trebuchet.initialState(p);
      var s0 = Trebuchet.unpackState(p, y0);
      var qdd0 = Trebuchet.angularAcceleration(p, s0.q, s0.qd);
      if (qdd0[0] <= 1e-9) {
        warnings.push('تحذير: عزم الثقل الموازن غير كافٍ لتحريك الذراع من وضع البداية — زد كتلة الثقل أو عدّل الأبعاد.');
      }
      // طرف الذراع تحت مستوى الأرض عند البداية (نفترض وجود خندق للمقذوف)
      var geo0 = Trebuchet.geometry(p, s0.q);
      if (geo0.tip.y < 0) {
        warnings.push('طرف الذراع الطويل يبدأ تحت مستوى الأرض (' + geo0.tip.y.toFixed(2) + ' m) — تفترض المحاكاة وجود خندق للمقذوف أسفل المنجنيق.');
      }
      if (geo0.cw.y <= 0) {
        errors.push('الثقل الموازن يلامس الأرض في وضع البداية — ارفع المحور أو قصّر الذراع القصير/التعليق.');
      }
    }
    return { errors: errors, warnings: warnings };
  }

  /** تحويل مصفوفة التسارعات المعممة إلى كائن {theta, phi, psi} */
  function qddObject(names, qdd) {
    var o = { theta: 0, phi: 0, psi: 0 };
    for (var i = 0; i < names.length; i++) o[names[i]] = qdd[i];
    return o;
  }

  /** إطار تسجيل واحد أثناء طور الذراع */
  function makeArmFrame(p, t, y, lost) {
    var s = Trebuchet.unpackState(p, y);
    var qdd = Trebuchet.angularAcceleration(p, s.q, s.qd);
    var geo = Trebuchet.geometry(p, s.q);
    var vel = Trebuchet.velocities(p, s.q, s.qd);
    var en = Energy.armPhaseEnergies(p, s.q, s.qd);
    // التحليل الإنشائي اللحظي (قياس فقط — لا يغير الديناميكا)
    var struct = null;
    if (p.structuralEnabled) {
      struct = TrebSim.Structure.evaluate(p, s.q, s.qd, qddObject(s.names, qdd));
    }
    return {
      struct: struct,
      t: t, phase: 'arm',
      theta: s.q.theta, omega: s.qd.theta, alpha: qdd[0],
      phi: s.q.phi, psi: s.q.psi,
      tip: geo.tip, cw: geo.cw, shortEnd: geo.shortEnd, armCom: geo.armCom,
      proj: geo.proj, projV: vel.projV, tipV: vel.tipV,
      en: {
        keArm: en.keArm, keCW: en.keCW, keProj: en.keProj,
        peCW: en.peCW, peProj: en.peProj, peArm: en.peArm,
        lost: lost, total: en.total
      }
    };
  }

  /** تنفيذ التجربة كاملة وإعادة سجل النتائج والإطارات */
  function run(userParams) {
    var p = Object.assign(defaults(), userParams || {});
    // كتلة الذراع من المادة والأبعاد: M = ρ·b·h·L (عند تفعيل الخيار)
    if (p.structuralEnabled && p.autoArmMass) {
      p.armMass = TrebSim.Structure.autoArmMass(p);
    }
    var check = validateParams(p);
    var warnings = check.warnings.slice();
    if (check.errors.length) {
      return { ok: false, params: p, errors: check.errors, warnings: warnings, frames: [] };
    }

    var dt = p.timeStep;
    var method = p.integrator;
    var frames = [];
    var releaseInfo = null;
    var landing = null;
    var maxAlpha = 0;
    var armStopReason = null;
    var slingGroundWarned = false;
    var structFailure = null;   // {type: 'arm'|'rope', t, value}
    var maxStress = 0;          // Pa أقصى إجهاد انحناء
    var maxTension = 0;         // N أقصى شد للحبل

    // ================= الطور الأول: حركة الذراع =================
    var deriv = Trebuchet.derivFactory(p);
    var y = Trebuchet.initialState(p);
    var t = 0;
    var lost = 0; // الطاقة المفقودة تراكميًا (J)
    var thetaRel = p.releaseAngleDeg * Math.PI / 180;

    var frame0 = makeArmFrame(p, 0, y, 0);
    frames.push(frame0);
    if (frame0.struct) {
      maxStress = frame0.struct.sigma;
      if (frame0.struct.tension !== null) maxTension = frame0.struct.tension;
    }
    var E0 = frame0.en.total;         // الطاقة الميكانيكية الابتدائية
    var cwY0 = frame0.cw.y;           // ارتفاع الثقل الابتدائي
    var maxEnergyDrift = 0;
    var prevLossPower = Energy.armLossPower(p, Trebuchet.unpackState(p, y).qd);

    var steps = 0;
    while (steps++ < MAX_STEPS) {
      var yPrev = y;
      var tPrev = t;
      y = Integrator.step(method, deriv, t, y, dt);
      t = tPrev + dt;

      var s = Trebuchet.unpackState(p, y);

      // تكامل الطاقة المفقودة (شبه منحرف): ∫(b·ω² + τf·|ω|)dt
      var lossPower = Energy.armLossPower(p, s.qd);
      lost += 0.5 * (prevLossPower + lossPower) * dt;
      prevLossPower = lossPower;

      // --- كشف بلوغ زاوية التحرير (عبور من الأسفل مع دوران موجب)
      var thPrev = yPrev[0], thNew = y[0];
      if (thPrev < thetaRel && thNew >= thetaRel && s.qd.theta > 0) {
        // استيفاء دقيق: إعادة تنفيذ خطوة جزئية من الحالة السابقة
        var frac = (thetaRel - thPrev) / (thNew - thPrev);
        var subDt = Math.max(1e-9, frac * dt);
        var yRel = Integrator.step(method, deriv, tPrev, yPrev, subDt);
        var tRel = tPrev + subDt;
        var sRel = Trebuchet.unpackState(p, yRel);
        var geoRel = Trebuchet.geometry(p, sRel.q);
        var velRel = Trebuchet.velocities(p, sRel.q, sRel.qd);
        var enRel = Energy.armPhaseEnergies(p, sRel.q, sRel.qd);

        var relFrame = makeArmFrame(p, tRel, yRel, lost);
        frames.push(relFrame);
        if (relFrame.struct) {
          maxStress = Math.max(maxStress, relFrame.struct.sigma);
          if (relFrame.struct.tension !== null) maxTension = Math.max(maxTension, relFrame.struct.tension);
        }

        // سرعة المقذوف لحظة التحرير (projectileRelease):
        // بدون مقلاع: v = ω × r  (مماسية، مقدارها ω·Lp)
        // مع المقلاع: مشتقة موضع نهاية المقلاع (تشمل دوران المقلاع نفسه)
        releaseInfo = {
          t: tRel,
          x: geoRel.proj.x, y: geoRel.proj.y,
          vx: velRel.projV.x, vy: velRel.projV.y,
          speed: Math.hypot(velRel.projV.x, velRel.projV.y),
          angleDeg: Math.atan2(velRel.projV.y, velRel.projV.x) * 180 / Math.PI,
          omega: sRel.qd.theta,
          armThetaDeg: sRel.q.theta * 180 / Math.PI,
          keProj: enRel.keProj,
          cwDrop: cwY0 - geoRel.cw.y,
          armStateY: yRel
        };
        break;
      }

      var frame = makeArmFrame(p, t, y, lost);
      frames.push(frame);
      maxAlpha = Math.max(maxAlpha, Math.abs(frame.alpha));

      // ===== التحليل الإنشائي: هل تحطم شيء في هذه اللحظة؟ =====
      if (p.structuralEnabled && frame.struct) {
        maxStress = Math.max(maxStress, frame.struct.sigma);
        if (frame.struct.tension !== null) maxTension = Math.max(maxTension, frame.struct.tension);

        // انقطاع حبل المقلاع: T ≥ F_break ⇒ تحرير مبكر للمقذوف
        if (p.slingEnabled && frame.struct.tension !== null &&
            frame.struct.tension >= frame.struct.ropeBreak) {
          structFailure = { type: 'rope', t: t, value: frame.struct.tension, limit: frame.struct.ropeBreak };
          warnings.push('⚡ انقطع حبل المقلاع عند t = ' + t.toFixed(3) + ' s! الشد بلغ ' +
            (frame.struct.tension / 1000).toFixed(1) + ' kN متجاوزًا قوة قطع الحبل (' +
            (frame.struct.ropeBreak / 1000).toFixed(1) + ' kN) — تحرر المقذوف مبكرًا. كبّر قطر الحبل أو خفف المقذوف.');
          var sNow = Trebuchet.unpackState(p, y);
          var geoNow = Trebuchet.geometry(p, sNow.q);
          var velNow = Trebuchet.velocities(p, sNow.q, sNow.qd);
          var enNow = Energy.armPhaseEnergies(p, sNow.q, sNow.qd);
          releaseInfo = {
            t: t,
            x: geoNow.proj.x, y: geoNow.proj.y,
            vx: velNow.projV.x, vy: velNow.projV.y,
            speed: Math.hypot(velNow.projV.x, velNow.projV.y),
            angleDeg: Math.atan2(velNow.projV.y, velNow.projV.x) * 180 / Math.PI,
            omega: sNow.qd.theta,
            armThetaDeg: sNow.q.theta * 180 / Math.PI,
            keProj: enNow.keProj,
            cwDrop: cwY0 - geoNow.cw.y,
            armStateY: y,
            premature: true
          };
          break;
        }

        // تحطم الذراع الخشبي: σ ≥ MOR ⇒ فشل التجربة
        if (frame.struct.sigma >= frame.struct.mor) {
          structFailure = { type: 'arm', t: t, value: frame.struct.sigma, limit: frame.struct.mor };
          armStopReason = 'arm-broken';
          warnings.push('⚡ تحطم الذراع الخشبي عند t = ' + t.toFixed(3) + ' s! إجهاد الانحناء بلغ ' +
            (frame.struct.sigma / 1e6).toFixed(1) + ' MPa متجاوزًا معامل تمزق الخشب (' +
            (frame.struct.mor / 1e6).toFixed(0) + ' MPa) — لم يتم الإطلاق. كبّر مقطع الذراع أو اختر خشبًا أقوى أو خفف الثقل.');
          break;
        }
      }

      // فحص حفظ الطاقة لاكتشاف الأخطاء العددية:
      // يجب أن يبقى E(t) + E_lost(t) ≈ E(0)
      var drift = Math.abs((frame.en.total + lost - E0) / Math.max(Math.abs(E0), 1)) * 100;
      maxEnergyDrift = Math.max(maxEnergyDrift, drift);

      // --- اصطدام الثقل الموازن بالأرض
      if (frame.cw.y <= 0) {
        armStopReason = 'cw-ground';
        warnings.push('تحذير: اصطدم الثقل الموازن بالأرض قبل بلوغ زاوية التحرير — لم يتم الإطلاق. ارفع المحور أو عدّل الأبعاد.');
        break;
      }
      // --- المقذوف/المقلاع تحت الأرض بوضوح أثناء التأرجح
      if (!slingGroundWarned && frame.proj.y < -0.05 && p.slingEnabled) {
        slingGroundWarned = true;
        warnings.push('المقذوف يمر تحت مستوى الأرض أثناء التأرجح — تفترض المحاكاة وجود خندق (نموذج المقلاع قضيب صلب مبسط).');
      }
      // --- مهلة بلوغ زاوية التحرير
      if (t >= MAX_ARM_TIME) {
        armStopReason = 'timeout';
        warnings.push('تحذير: لم يبلغ الذراع زاوية التحرير خلال ' + MAX_ARM_TIME + ' ثانية — الثقل الموازن غير كافٍ أو النظام يتأرجح دون إطلاق.');
        break;
      }
    }
    if (steps >= MAX_STEPS && !releaseInfo && !armStopReason) {
      armStopReason = 'max-steps';
      warnings.push('تحذير: تجاوزت المحاكاة الحد الأقصى لعدد الخطوات — صغّر الزمن أو كبّر الخطوة الزمنية.');
    }

    if (maxAlpha === 0 && frames.length) maxAlpha = Math.abs(frames[0].alpha);

    // ================= الطور الثاني: طيران المقذوف =================
    var flightStart = null;
    var maxHeight = null;

    if (releaseInfo) {
      if (releaseInfo.y <= 0) {
        warnings.push('تحذير: المقذوف تحرر تحت مستوى الأرض — عدّل زاوية التحرير أو الأبعاد.');
        landing = { t: releaseInfo.t, x: releaseInfo.x, vx: releaseInfo.vx, vy: releaseInfo.vy, speed: releaseInfo.speed };
        maxHeight = Math.max(0, releaseInfo.y);
      } else {
        flightStart = releaseInfo.t;

        // استمرار الذراع والثقل بعد فقدان المقذوف (بلا مقذوف وبلا مقلاع)
        var pAfter = Object.assign({}, p, { projectileMass: 0, slingEnabled: false });
        var armDeriv = Trebuchet.derivFactory(pAfter);
        var armNames = Trebuchet.dofs(p);
        var afterNames = Trebuchet.dofs(pAfter);
        var yArm = [];
        (function () { // نقل الحالة مع إسقاط درجة حرية المقلاع
          var full = releaseInfo.armStateY;
          var n = armNames.length;
          for (var i = 0; i < afterNames.length; i++) {
            var idx = armNames.indexOf(afterNames[i]);
            yArm.push(full[idx]);
          }
          for (var j = 0; j < afterNames.length; j++) {
            var idx2 = armNames.indexOf(afterNames[j]);
            yArm.push(full[n + idx2]);
          }
        })();
        var armFrozen = false;
        var cwGroundAfterWarned = false;

        var fDeriv = Projectile.derivFactory(p);
        var fy = [releaseInfo.x, releaseInfo.y, releaseInfo.vx, releaseInfo.vy];
        var ft = releaseInfo.t;
        maxHeight = releaseInfo.y;
        var prevDragPower = Energy.dragLossPower(p, fy[2], fy[3]);
        var fSteps = 0;

        while (fSteps++ < MAX_STEPS) {
          var fyPrev = fy;
          var ftPrev = ft;
          fy = Integrator.step(method, fDeriv, ft, fy, dt);
          ft = ftPrev + dt;

          // فقد طاقة السحب: ∫ F_drag·v dt
          var dragPower = Energy.dragLossPower(p, fy[2], fy[3]);
          lost += 0.5 * (prevDragPower + dragPower) * dt;
          prevDragPower = dragPower;

          // استمرار حركة الذراع (ما لم يصطدم الثقل بالأرض فنجمّدها)
          if (!armFrozen) {
            yArm = Integrator.step(method, armDeriv, ftPrev, yArm, dt);
            var sArm = Trebuchet.unpackState(pAfter, yArm);
            var geoArm = Trebuchet.geometry(pAfter, sArm.q);
            if (geoArm.cw.y <= 0) {
              armFrozen = true;
              if (!cwGroundAfterWarned) {
                cwGroundAfterWarned = true;
                warnings.push('تحذير: اصطدم الثقل الموازن بالأرض بعد الإطلاق (جُمّدت حركة الذراع في العرض).');
              }
            }
          }

          maxHeight = Math.max(maxHeight, fy[1]);

          // كشف الاصطدام بالأرض مع استيفاء خطي لنقطة السقوط
          var hit = Projectile.groundCollision(fyPrev, fy, ftPrev, dt);

          var sArm2 = Trebuchet.unpackState(pAfter, yArm);
          var geoArm2 = Trebuchet.geometry(pAfter, sArm2.q);
          var enArm2 = Energy.armPhaseEnergies(pAfter, sArm2.q, sArm2.qd);
          var st = hit || { t: ft, x: fy[0], y: fy[1], vx: fy[2], vy: fy[3] };
          var enP = Energy.flightPhaseProjectileEnergies(p, st.x, st.y, st.vx, st.vy);

          frames.push({
            t: st.t, phase: 'flight',
            theta: sArm2.q.theta, omega: sArm2.qd.theta, alpha: 0,
            phi: sArm2.q.phi, psi: null,
            tip: geoArm2.tip, cw: geoArm2.cw, shortEnd: geoArm2.shortEnd, armCom: geoArm2.armCom,
            proj: { x: st.x, y: st.y }, projV: { x: st.vx, y: st.vy }, tipV: null,
            en: {
              keArm: enArm2.keArm, keCW: enArm2.keCW, keProj: enP.ke,
              peCW: enArm2.peCW, peProj: enP.pe, peArm: enArm2.peArm,
              lost: lost, total: enArm2.total + enP.total
            }
          });

          if (hit) {
            landing = { t: hit.t, x: hit.x, vx: hit.vx, vy: hit.vy, speed: Math.hypot(hit.vx, hit.vy) };
            break;
          }
          if (ft - flightStart > MAX_FLIGHT_TIME) {
            warnings.push('تحذير: تجاوز زمن الطيران الحد الأقصى للمحاكاة.');
            break;
          }
        }
      }
    }

    if (maxEnergyDrift > 2) {
      warnings.push('تحذير عددي: انحراف حفظ الطاقة بلغ ' + maxEnergyDrift.toFixed(2) + '% — صغّر الخطوة الزمنية أو استخدم مكامل RK4.');
    }

    // ===== ملخص التحليل الإنشائي =====
    var structural = null;
    if (p.structuralEnabled) {
      var wd = TrebSim.Structure.wood(p);
      var ropeBreak = p.slingEnabled ? TrebSim.Structure.ropeBreakForce(p.ropeDiameter) : null;
      structural = {
        woodName: wd.name,
        mor: wd.mor,
        maxStress: maxStress,
        armSF: maxStress > 1e-9 ? wd.mor / maxStress : null,
        maxTension: p.slingEnabled ? maxTension : null,
        ropeBreak: ropeBreak,
        ropeSF: (p.slingEnabled && maxTension > 1e-9) ? ropeBreak / maxTension : null,
        armMassUsed: p.armMass,
        failure: structFailure
      };
      if (!structFailure) {
        if (structural.armSF !== null && structural.armSF < 1.5) {
          warnings.push('تنبيه إنشائي: معامل أمان الذراع منخفض (' + structural.armSF.toFixed(2) +
            ') — الإجهاد اقترب من حد كسر الخشب.');
        }
        if (structural.ropeSF !== null && structural.ropeSF < 1.5) {
          warnings.push('تنبيه إنشائي: معامل أمان حبل المقلاع منخفض (' + structural.ropeSF.toFixed(2) +
            ') — الشد اقترب من قوة قطع الحبل.');
        }
      }
    }

    // ================= النتائج =================
    var stats = null;
    var validation = null;
    if (releaseInfo) {
      var effPct = Energy.efficiency(releaseInfo.keProj, releaseInfo.cwDrop, p);
      var initialPE = p.counterweightMass * p.gravity * releaseInfo.cwDrop;
      stats = {
        range: landing ? landing.x : null,                     // m من محور الارتكاز
        flightDistance: landing ? (landing.x - releaseInfo.x) : null, // m منذ التحرير
        flightTime: landing ? (landing.t - releaseInfo.t) : null,
        maxHeight: maxHeight,
        releaseSpeed: releaseInfo.speed,
        releaseAngleDeg: releaseInfo.angleDeg,
        armThetaAtReleaseDeg: releaseInfo.armThetaDeg,
        impactSpeed: landing ? landing.speed : null,
        omegaAtRelease: releaseInfo.omega,
        maxAlpha: maxAlpha,
        initialPE: initialPE,
        keAtRelease: releaseInfo.keProj,
        efficiencyPct: effPct,
        targetDistance: p.targetDistance,
        targetDiff: landing ? (landing.x - p.targetDistance) : null,
        energyDriftPct: maxEnergyDrift
      };
      if (landing) {
        validation = Validation.compare(releaseInfo, landing.x, landing.t - releaseInfo.t, p);
      }
    }

    return {
      ok: true,
      params: p,
      errors: [],
      warnings: warnings,
      frames: frames,
      dt: dt,
      release: releaseInfo,
      landing: landing,
      stats: stats,
      validation: validation,
      structural: structural,
      structFailure: structFailure,
      armStopReason: armStopReason,
      launched: !!releaseInfo,
      totalTime: frames.length ? frames[frames.length - 1].t : 0
    };
  }

  return { defaults: defaults, validateParams: validateParams, run: run };
})();
