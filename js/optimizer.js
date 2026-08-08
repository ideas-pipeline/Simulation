/**
 * مُحسِّن الكفاءة — Efficiency Optimizer
 * =======================================
 * يبدأ من إعدادات المستخدم الحالية ويبحث عن التوليفة الأعلى كفاءة
 * بالنزول الإحداثي الجشع (Greedy Coordinate Descent): في كل تمريرة
 * يجرّب لكل معامل شبكة قيم ويثبّت أفضلها، ويكرر ثلاث تمريرات.
 *
 * كل مرشح يقيَّم بتشغيل المحاكاة الفيزيائية الكاملة فعليًا
 * (Simulation.run) — لا تخمين ولا صيغ تقريبية.
 *
 * القيود المفروضة على أي مرشح مقبول:
 *   - إطلاق ناجح (بلوغ زاوية التحرير وهبوط المقذوف)
 *   - لا فشل إنشائي (لا يتحطم الذراع ولا ينقطع الحبل بمادة المستخدم الحالية)
 *   - مدى ≥ 10 m (حتى لا «يغش» المُحسِّن بإطلاق عديم الفائدة عالي النسبة)
 *
 * لا يمس المُحسِّن: الهدف، الجاذبية، مقاومة الهواء، الخطوة الزمنية،
 * مادة الخشب وأبعاد المقطع وقطر الحبل — تلك خيارات المستخدم الثابتة.
 * التطبيق دائمًا بموافقة صريحة من المستخدم (زر «تطبيق»).
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Optimizer = (function () {
  'use strict';

  var MIN_RANGE = 10;   // m أدنى مدى مقبول لتوليفة «مفيدة»
  var PASSES = 3;       // عدد تمريرات النزول الإحداثي
  var CHUNK = 15;       // تشغيلات لكل شريحة قبل إعادة الجدولة (حتى لا تتجمد الواجهة)

  /** شبكات القيم لكل معامل قابل للتحسين (ضمن حدود مزلاجات الواجهة) */
  var SWEEPS = {
    swingingCW: [false, true],
    slingEnabled: [false, true],
    releaseAngleDeg: [0, 10, 20, 30, 40, 45, 50, 55, 60, 70, 75],
    startAngleDeg: [-80, -70, -60, -50, -45, -35, -25],
    longArm: [3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 10, 14, 18],
    shortArm: [0.8, 1, 1.2, 1.5, 1.8, 2.2, 3, 4],
    armMass: [10, 15, 25, 40, 60, 90, 200, 500],
    counterweightMass: [100, 150, 200, 300, 450, 600, 900, 1200, 3000, 8000, 20000, 40000],
    projectileMass: [5, 10, 15, 20, 30, 60, 100, 200],
    hangerLength: [0.3, 0.5, 0.8, 1.2, 1.6],
    slingLength: [1, 1.5, 2, 2.5, 3, 4, 5, 8, 12, 16],
    pivotHeight: [2, 2.5, 3, 4, 5, 8, 12, 16]
  };

  /** الأسماء العربية للمعاملات (لعرض «ما الذي تغيّر») */
  var LABELS = {
    swingingCW: 'الثقل المتأرجح',
    slingEnabled: 'المقلاع (Sling)',
    releaseAngleDeg: 'زاوية التحرير (°)',
    startAngleDeg: 'زاوية البداية (°)',
    longArm: 'طول الذراع الطويل (m)',
    shortArm: 'طول الذراع القصير (m)',
    armMass: 'كتلة الذراع (kg)',
    counterweightMass: 'كتلة الثقل الموازن (kg)',
    projectileMass: 'كتلة المقذوف (kg)',
    hangerLength: 'طول تعليق الثقل (m)',
    slingLength: 'طول المقلاع (m)',
    pivotHeight: 'ارتفاع المحور (m)'
  };

  /** تقييم مرشح: الكفاءة إن كان مقبولًا، وإلا −1 */
  function evaluate(params) {
    var r = TrebSim.Simulation.run(params);
    if (!r.ok || !r.stats || r.stats.efficiencyPct === null) return { score: -1, stats: null };
    if (r.structFailure) return { score: -1, stats: null };
    if (!(r.stats.range >= MIN_RANGE)) return { score: -1, stats: null };
    return { score: r.stats.efficiencyPct, stats: r.stats };
  }

  /** هل المعامل قابل للتجربة في هذا السياق؟ */
  function applicable(key, cand) {
    if (key === 'hangerLength') return !!cand.swingingCW;
    if (key === 'slingLength') return !!cand.slingEnabled;
    if (key === 'armMass') return !cand.autoArmMass; // الكتلة التلقائية تتجاوز اليدوية
    return true;
  }

  /**
   * التحسين غير المتزامن. onProgress(fractionDone, bestEffSoFar) اختيارية.
   * تعيد Promise بالنتيجة: {base, best, baseScore, bestScore, baseStats,
   * bestStats, evaluated, changes: [{key, label, from, to}], lockedKeys}
   * cancelRef: كائن {cancelled} يمكن ضبطه لإيقاف البحث مبكرًا.
   *
   * locks: كائن {key: true} — كل مفتاح «مثبَّت» من المستخدم يُستبعد من
   * فضاء البحث ويبقى على قيمته حرفيًا، فيصبح السؤال: ما أقصى كفاءة
   * ممكنة في ظل هذه القيم المثبتة؟
   */
  function optimize(baseParams, onProgress, cancelRef, locks) {
    return new Promise(function (resolve) {
      locks = locks || {};
      var base = Object.assign(TrebSim.Simulation.defaults(), baseParams || {});
      var baseEval = evaluate(base);
      var best = Object.assign({}, base);
      var bestScore = baseEval.score;
      var bestStats = baseEval.stats;
      var evaluated = 1;

      // خطة العمل: (تمريرة، معامل، قيمة) بالتسلسل
      var jobs = [];
      for (var pass = 0; pass < PASSES; pass++) {
        Object.keys(SWEEPS).forEach(function (key) {
          if (locks[key]) return; // المفاتيح المثبتة خارج البحث
          SWEEPS[key].forEach(function (v) {
            jobs.push({ key: key, value: v });
          });
        });
      }
      var total = jobs.length;
      var idx = 0;

      function step() {
        if (cancelRef && cancelRef.cancelled) { finish(); return; }
        var end = Math.min(idx + CHUNK, total);
        for (; idx < end; idx++) {
          var job = jobs[idx];
          if (!applicable(job.key, best)) continue;
          if (best[job.key] === job.value) continue;
          var cand = Object.assign({}, best);
          cand[job.key] = job.value;
          var ev = evaluate(cand);
          evaluated++;
          if (ev.score > bestScore) {
            bestScore = ev.score;
            bestStats = ev.stats;
            best = cand;
          }
        }
        if (onProgress) onProgress(idx / total, bestScore);
        if (idx < total) {
          setTimeout(step, 0); // إفساح المجال للواجهة
        } else {
          finish();
        }
      }

      function finish() {
        var changes = [];
        Object.keys(SWEEPS).forEach(function (key) {
          if (best[key] !== base[key] && applicable(key, best)) {
            changes.push({ key: key, label: LABELS[key], from: base[key], to: best[key] });
          }
        });
        resolve({
          base: base, best: best,
          baseScore: baseEval.score, bestScore: bestScore,
          baseStats: baseEval.stats, bestStats: bestStats,
          evaluated: evaluated, changes: changes,
          lockedKeys: Object.keys(locks).filter(function (k) { return locks[k] && LABELS[k]; }),
          improved: bestScore > baseEval.score + 1e-9
        });
      }

      step();
    });
  }

  return { optimize: optimize, LABELS: LABELS, SWEEPS: SWEEPS, MIN_RANGE: MIN_RANGE };
})();
