/**
 * العرض ثلاثي الأبعاد — 3D Renderer (Three.js)
 * =============================================
 * بيئة مفتوحة بكاميرا حرة (Orbit) حول المنجنيق: أرض ممتدة، سماء وضباب
 * بعيد، إضاءة شمسية بظلال — بينما تأتي كل الحركة من نفس محرك الفيزياء
 * (إطارات Simulation.run المسبقة الحساب): الفيزياء تُحسب في المستوي
 * الرأسي x–y وتُعرض في عالم ثلاثي الأبعاد عند z = 0.
 *
 * لا شيء في هذا الملف يغيّر الديناميكا — عرض فقط.
 */
window.TrebSim = window.TrebSim || {};

TrebSim.Renderer3D = (function () {
  'use strict';

  var C = {
    sky: 0xbfd8ee,
    ground: 0x8aa15f,
    groundFar: 0x77904f,
    wood: 0x8b5e34,
    woodDark: 0x6b4423,
    steel: 0x6f7378,
    metal: 0x52514e,
    cw: 0x3f3e3b,
    projectile: 0x1b1a18,
    rope: 0xa5814e,
    traj: 0x2a78d6,
    flag: 0xd03b3b
  };

  function Renderer3D(canvas) {
    var self = this;
    this.canvas = canvas;
    this.result = null;
    this.followProjectile = true;

    this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C.sky);
    this.scene.fog = new THREE.Fog(C.sky, 250, 2200);

    this.camera = new THREE.PerspectiveCamera(55, 2, 0.1, 5000);
    this.camera.position.set(35, 18, 42);

    this.controls = new THREE.OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 8, 0);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // أي تدخل يدوي بالكاميرا يوقف التتبع التلقائي
    this.controls.addEventListener('start', function () { self._userDragging = true; });
    this.controls.addEventListener('end', function () { self._userDragging = false; });

    this._buildEnvironment();
    this.machine = new THREE.Group();
    this.scene.add(this.machine);
    this.dynamic = {}; // الأجزاء المتحركة
  }

  /** الأرض والسماء والإضاءة — البيئة المفتوحة */
  Renderer3D.prototype._buildEnvironment = function () {
    var hemi = new THREE.HemisphereLight(0xe8f2ff, 0x67754a, 0.85);
    this.scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff3df, 1.0);
    sun.position.set(-120, 180, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
    sun.shadow.camera.far = 600;
    this.scene.add(sun);
    this.sun = sun;

    // أرض ممتدة + شبكة خفيفة قرب الآلة
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(2500, 64),
      new THREE.MeshLambertMaterial({ color: C.ground })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    var grid = new THREE.GridHelper(400, 40, 0x5f7040, 0x748752);
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    this.scene.add(grid);

    // تلال بعيدة بسيطة (أنصاف كرات) لإحساس البيئة المفتوحة
    var hillMat = new THREE.MeshLambertMaterial({ color: C.groundFar });
    for (var i = 0; i < 9; i++) {
      var r = 120 + (i * 47) % 160;
      var hill = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      var ang = (i / 9) * Math.PI * 2 + 0.6;
      var dist = 900 + (i * 137) % 700;
      hill.position.set(Math.cos(ang) * dist, -r * 0.55, Math.sin(ang) * dist);
      hill.scale.y = 0.35;
      this.scene.add(hill);
    }
  };

  function box(w, h, d, color, castShadow) {
    var m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: color })
    );
    m.castShadow = castShadow !== false;
    m.receiveShadow = true;
    return m;
  }

  /** وضع صندوق بين نقطتين في المستوي x–y (كعضو إنشائي) */
  function spanBox(mesh, x1, y1, x2, y2, len) {
    var dx = x2 - x1, dy = y2 - y1;
    var L = len || Math.hypot(dx, dy);
    mesh.scale.x = L / mesh.geometry.parameters.width;
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    mesh.rotation.z = Math.atan2(dy, dx);
  }

  /** بناء هيكل الآلة من الأشكال الأولية حسب النمط والمعاملات */
  Renderer3D.prototype.buildMachine = function (p) {
    var g = this.machine;
    while (g.children.length) g.remove(g.children[0]);
    // إزالة الأجسام المضافة على مستوى المشهد قبل تصفير المراجع
    // (وإلا تراكمت مقذوفات وحبال يتيمة مع كل إعادة حساب)
    var self = this;
    ['projMesh', 'sling', 'hanger'].forEach(function (k) {
      if (self.dynamic && self.dynamic[k]) self.scene.remove(self.dynamic[k]);
    });
    this.dynamic = {};
    var H = p.pivotHeight, Lc = p.shortArm, Lp = p.longArm;
    var steel = p.armWood === 'steel';
    var frameColor = steel ? C.steel : C.woodDark;
    var armColor = steel ? C.steel : C.wood;

    if (p.armMode === 'fat') {
      // برجا قناة الثقل + السكة الأفقية
      var towH = H + Lc + 0.6;
      [-1, 1].forEach(function (side) {
        [-0.35, 0.35].forEach(function (zOff) {
          var t = box(0.28, towH, 0.28, frameColor);
          t.position.set(side * 0.45, towH / 2, zOff * 2.2);
          g.add(t);
        });
      });
      // سكة المحور
      [-0.8, 0.8].forEach(function (z) {
        var rail = box(Lc + 1.4, 0.22, 0.22, frameColor);
        rail.position.set(-(Lc + 1.4) / 2 + 0.5, H, z);
        g.add(rail);
      });
      // عمود دعم بعيد
      [-0.8, 0.8].forEach(function (z) {
        var post = box(0.26, H, 0.26, frameColor);
        post.position.set(-Lc - 0.6, H / 2, z);
        g.add(post);
      });
    } else {
      // إطارا A على جانبي الذراع
      var spread = Math.max(0.8, H * 0.45);
      [-1, 1].forEach(function (z) {
        [[-spread, 0], [spread, 0]].forEach(function (foot) {
          var leg = box(Math.hypot(spread, H) + 0.2, 0.3, 0.3, frameColor);
          spanBox(leg, foot[0], 0.15, 0, H, Math.hypot(spread, H));
          leg.position.z = z * 1.6;
          g.add(leg);
        });
        var base = box(spread * 2 + 1, 0.25, 0.35, frameColor);
        base.position.set(0, 0.15, z * 1.6);
        g.add(base);
      });
      // محور عرضي
      var axleBar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 3.8, 16),
        new THREE.MeshLambertMaterial({ color: C.metal })
      );
      axleBar.rotation.x = Math.PI / 2;
      axleBar.position.set(0, H, 0);
      axleBar.castShadow = true;
      g.add(axleBar);
    }

    // الذراع (صندوق يُمدّ بين طرفيه كل إطار)
    var armH = Math.max(0.25, p.armHeight || 0.3);
    var arm = box(1, armH, Math.max(0.2, p.armWidth || 0.3), armColor);
    g.add(arm);
    this.dynamic.arm = arm;

    // الثقل الموازن
    var side = Math.max(0.6, Math.cbrt(p.counterweightMass / 2500));
    var cw = box(side, side, side, C.cw);
    g.add(cw);
    this.dynamic.cw = cw;

    // عجلتا المحور المنزلق (للذراع العائمة)
    if (p.armMode === 'fat') {
      var wheels = new THREE.Group();
      [-0.8, 0.8].forEach(function (z) {
        var w = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 0.2, 18),
          new THREE.MeshLambertMaterial({ color: C.woodDark })
        );
        w.rotation.x = Math.PI / 2;
        w.position.z = z;
        w.castShadow = true;
        wheels.add(w);
      });
      g.add(wheels);
      this.dynamic.axle = wheels;
    }

    // المقذوف
    var projR = Math.max(0.25, p.projectileDiameter / 2);
    var proj = new THREE.Mesh(
      new THREE.SphereGeometry(projR, 20, 14),
      new THREE.MeshLambertMaterial({ color: C.projectile })
    );
    proj.castShadow = true;
    this.scene.add(proj);
    this.dynamic.projMesh = proj;

    // المقلاع (خط)
    if (p.slingEnabled) {
      var slingGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      var sling = new THREE.Line(slingGeo, new THREE.LineBasicMaterial({ color: C.rope }));
      this.scene.add(sling);
      this.dynamic.sling = sling;
    }
    // حبل تعليق الثقل المتأرجح
    if (p.swingingCW && p.armMode !== 'fat') {
      var hgGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      var hanger = new THREE.Line(hgGeo, new THREE.LineBasicMaterial({ color: C.metal }));
      this.scene.add(hanger);
      this.dynamic.hanger = hanger;
    }
  };

  /** تهيئة نتيجة جديدة: المسار، الهدف/الجدار، الإضاءة على مدى الرمية */
  Renderer3D.prototype.setResult = function (result) {
    var p = result.params;
    this.result = result;
    this.buildMachine(p);

    // خط المسار المتقطع (يُكشف تدريجيًا مع الزمن)
    if (this.trajLine) { this.scene.remove(this.trajLine); this.trajLine = null; }
    var pts = [];
    this.flightTimes = [];
    for (var i = 0; i < result.frames.length; i++) {
      var f = result.frames[i];
      if (f.phase === 'flight') {
        pts.push(new THREE.Vector3(f.proj.x, Math.max(0, f.proj.y), 0));
        this.flightTimes.push(f.t);
      }
    }
    if (pts.length > 1) {
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var line = new THREE.Line(geo, new THREE.LineDashedMaterial({
        color: C.traj, dashSize: 1.6, gapSize: 1.1, linewidth: 2
      }));
      line.computeLineDistances();
      line.geometry.setDrawRange(0, 0);
      this.scene.add(line);
      this.trajLine = line;
    }

    // الهدف: جدار أو علم
    if (this.targetGroup) { this.scene.remove(this.targetGroup); }
    var tg = new THREE.Group();
    var D = p.targetDistance;
    if (p.wallEnabled) {
      var mat = TrebSim.Wall.material(p);
      var wall = box(p.wallThickness, p.wallHeight, 12, parseInt(mat.color.slice(1), 16), true);
      wall.position.set(D + p.wallThickness / 2, p.wallHeight / 2, 0);
      tg.add(wall);
    } else {
      var pole = box(0.15, 6, 0.15, C.metal);
      pole.position.set(D, 3, 0);
      tg.add(pole);
      var flag = new THREE.Mesh(
        new THREE.ConeGeometry(1.2, 2.4, 4),
        new THREE.MeshLambertMaterial({ color: C.flag })
      );
      flag.rotation.z = -Math.PI / 2;
      flag.position.set(D + 1.2, 5.4, 0);
      tg.add(flag);
    }
    this.scene.add(tg);
    this.targetGroup = tg;
  };

  /** تحديث المشهد عند إطار فيزيائي معين */
  Renderer3D.prototype.renderFrame = function (frame, simTime) {
    if (!this.result || !frame) return;
    var p = this.result.params;
    var d = this.dynamic;

    // الذراع بين طرفيها
    spanBox(d.arm, frame.shortEnd.x, frame.shortEnd.y, frame.tip.x, frame.tip.y);
    // الثقل
    d.cw.position.set(frame.cw.x, Math.max(frame.cw.y, 0.35), 0);
    // المحور المنزلق (ذراع عائمة): على امتداد الذراع عند مسافة Lc من الطرف القصير
    if (d.axle) {
      var frac = p.shortArm / (p.shortArm + p.longArm);
      d.axle.position.set(
        frame.shortEnd.x + (frame.tip.x - frame.shortEnd.x) * frac,
        frame.shortEnd.y + (frame.tip.y - frame.shortEnd.y) * frac, 0);
    }
    // المقذوف
    var landed = this.result.landing && simTime >= this.result.landing.t - 1e-9;
    var px = landed ? this.result.landing.x : frame.proj.x;
    var py = landed ? 0.25 : Math.max(frame.proj.y, 0.25);
    d.projMesh.position.set(px, py, 0);
    // المقلاع يظهر فقط قبل التحرير
    if (d.sling) {
      var attached = frame.phase === 'arm';
      d.sling.visible = attached;
      if (attached) {
        d.sling.geometry.setFromPoints([
          new THREE.Vector3(frame.tip.x, frame.tip.y, 0),
          new THREE.Vector3(frame.proj.x, frame.proj.y, 0)
        ]);
      }
    }
    if (d.hanger) {
      d.hanger.geometry.setFromPoints([
        new THREE.Vector3(frame.shortEnd.x, frame.shortEnd.y, 0),
        new THREE.Vector3(frame.cw.x, frame.cw.y, 0)
      ]);
    }
    // كشف المسار حتى الزمن الحالي
    if (this.trajLine) {
      var n = 0;
      while (n < this.flightTimes.length && this.flightTimes[n] <= simTime) n++;
      this.trajLine.geometry.setDrawRange(0, n);
    }
    // تتبع الكاميرا للمقذوف أثناء الطيران
    if (this.followProjectile && frame.phase === 'flight' && !landed && !this._userDragging) {
      this.controls.target.lerp(new THREE.Vector3(px, py, 0), 0.06);
      // أبعد الكاميرا تدريجيًا لتبقى الرمية في الكادر
      var dist = this.camera.position.distanceTo(this.controls.target);
      var want = Math.max(45, py * 1.6);
      if (dist < want) {
        var dir = this.camera.position.clone().sub(this.controls.target).normalize();
        this.camera.position.copy(this.controls.target.clone().add(dir.multiplyScalar(want)));
      }
    }
  };

  /** حلقة الرسم (تُستدعى كل rAF) */
  Renderer3D.prototype.render = function () {
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** إعادة الكاميرا لوضع البداية حول الآلة */
  Renderer3D.prototype.resetCamera = function () {
    this.camera.position.set(35, 18, 42);
    this.controls.target.set(0, 8, 0);
  };

  return { Renderer3D: Renderer3D };
})();
