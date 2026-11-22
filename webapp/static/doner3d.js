// 3D dönen döner (Three.js). THREE yüklenemezse null döner, oyun CSS dönere düşer.
window.Doner3D = (() => {
  function meatTexture() {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const g = c.getContext("2d");
    // katman katman et
    for (let y = 0; y < 512; y += 2) {
      const band = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.031 + 1.3) * 0.5;
      const r = 150 + band * 30 + Math.random() * 14;
      const gg = 78 + band * 18 + Math.random() * 10;
      const b = 38 + band * 10;
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      g.fillRect(0, y, 512, 2);
    }
    // yağ çizgileri
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(245,215,170,${0.15 + Math.random() * 0.25})`;
      g.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 512;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 4);
      g.stroke();
    }
    // kızarmış / yanık lekeler
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, s = 2 + Math.random() * 9;
      const dark = Math.random();
      g.fillStyle = dark < 0.6 ? `rgba(90,40,15,${0.25 + Math.random() * 0.35})`
        : dark < 0.9 ? `rgba(60,25,8,${0.4 + Math.random() * 0.4})` : "rgba(255,190,120,0.35)";
      g.beginPath(); g.ellipse(x, y, s, s * 0.45, 0, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function create(container) {
    if (!window.THREE) return null;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch (e) { return null; }
    const W = () => container.clientWidth, H = () => container.clientHeight;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W(), H());
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, W() / H(), 0.1, 100);
    camera.position.set(0, 0.6, 7.4);
    camera.lookAt(0, -0.1, 0);

    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3a2414, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(3, 3, 5); scene.add(key);
    const fire = new THREE.PointLight(0xff6a00, 2.2, 6);
    fire.position.set(0, 0, -1.6); scene.add(fire);
    const rim = new THREE.PointLight(0xffb347, 1.2, 8);
    rim.position.set(-2.5, 1, -1); scene.add(rim);

    // Isıtıcı (arkada kor gibi parlayan panel)
    const heaterMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff4500, emissiveIntensity: 0.9, roughness: 1 });
    const heater = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.0, 0.15), heaterMat);
    heater.position.set(0, -0.05, -1.9); scene.add(heater);
    const grillMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.4 });
    for (let i = -4; i <= 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 0.05), grillMat);
      bar.position.set(0, i * 0.33 - 0.05, -1.8); scene.add(bar);
    }

    // Şiş
    const steel = new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.9, roughness: 0.25 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.0, 16), steel);
    scene.add(pole);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 40), steel);
    plate.position.y = -1.5; scene.add(plate);
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.95, 0.18, 40),
      new THREE.MeshStandardMaterial({ color: 0x868e96, metalness: 0.85, roughness: 0.35 }));
    tray.position.y = -1.95; scene.add(tray);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), steel);
    cap.position.y = 1.62; scene.add(cap);

    // Et konisi: üstte geniş, altta dar, hafif dalgalı profil
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, y = -1.45 + t * 2.95;
      const r = 0.48 + t * 0.62 + Math.sin(t * 18) * 0.025 + Math.sin(t * 7.0) * 0.03;
      pts.push(new THREE.Vector2(r, y));
    }
    pts.push(new THREE.Vector2(0.05, 1.5));
    const tex = meatTexture();
    const meatMat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.06, roughness: 0.55, metalness: 0.05, emissive: 0x3a1200, emissiveIntensity: 0.35 });
    const meat = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), meatMat);
    scene.add(meat);

    // Kesilen et parçacıkları
    const chips = [];
    const chipGeo = new THREE.BoxGeometry(0.22, 0.05, 0.12);
    const chipMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });

    let level = 1, t = 0;
    function update(dt, meatLevel) {
      t += dt;
      meat.rotation.y += dt * 0.7;
      const target = 0.45 + 0.55 * Math.max(0, Math.min(1, meatLevel / 100));
      level += (target - level) * Math.min(1, dt * 6);
      meat.scale.set(level, 1, level);
      fire.intensity = 2.0 + Math.sin(t * 9) * 0.25 + Math.sin(t * 23) * 0.15;
      heaterMat.emissiveIntensity = 0.85 + Math.sin(t * 5) * 0.08;
      for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i];
        c.v.y -= 9 * dt;
        c.m.position.addScaledVector(c.v, dt);
        c.m.rotation.x += dt * c.spin; c.m.rotation.z += dt * c.spin * 0.7;
        if (c.m.position.y < -1.85) { scene.remove(c.m); chips.splice(i, 1); }
      }
      renderer.render(scene, camera);
    }
    function slice() {
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(chipGeo, chipMat);
        const y = -0.6 + Math.random() * 1.6;
        const r = (0.48 + ((y + 1.45) / 2.95) * 0.62) * level;
        m.position.set(r * 0.9, y, r * 0.5);
        scene.add(m);
        chips.push({ m, v: new THREE.Vector3(0.6 + Math.random(), 0.5 + Math.random(), 0.8), spin: 6 + Math.random() * 6 });
      }
    }
    function resize() {
      renderer.setSize(W(), H());
      camera.aspect = W() / H(); camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    return { update, slice };
  }
  return { create };
})();
