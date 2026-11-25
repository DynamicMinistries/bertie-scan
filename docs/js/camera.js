// The phone's camera: live picture, torch, and taking the sharpest still the phone allows.
export class Camera {
  constructor(video) { this.video = video; this.stream = null; this.canPhoto = typeof ImageCapture !== 'undefined' && 'takePhoto' in ImageCapture.prototype; }

  async start() {
    this.stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocamera');
    // where the phone can take a full photo a lighter live picture is fine; otherwise ask for the sharpest live picture
    const size = this.canPhoto ? { width: { ideal: 1920 }, height: { ideal: 1440 } } : { width: { ideal: 3840 }, height: { ideal: 2160 } };
    const ask = v => navigator.mediaDevices.getUserMedia({ audio: false, video: v });
    let s;
    try { s = await ask({ facingMode: { ideal: 'environment' }, ...size }); } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
      s = await ask(true);
    }
    this.stream = s;
    this.track = s.getVideoTracks()[0];
    this.video.srcObject = s;
    await this.video.play().catch(() => {});
    if (!this.video.videoWidth) await new Promise(r => { this.video.onloadedmetadata = r; setTimeout(r, 3000); });
    const caps = this.caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    this.hasTorch = !!caps.torch;
    this.torchOn = false;
    if (this.canPhoto) try { this.ic = new ImageCapture(this.track); } catch { this.canPhoto = false; }
    return this;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.ic = null;
    if (this.video) this.video.srcObject = null;
  }

  async torch(on) { await this.track.applyConstraints({ advanced: [{ torch: on }] }); this.torchOn = on; }

  frame() {
    const v = this.video, c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return new Promise((ok, bad) => c.toBlob(b => b ? ok(b) : bad(new Error('The picture could not be taken. Try again.')), 'image/jpeg', 0.94));
  }

  async still() {
    const vw = Math.max(this.video.videoWidth, this.video.videoHeight);
    if (this.canPhoto && this.ic && vw < 3000) {
      try {
        const opts = {};
        if (this.photoSize === undefined) {
          this.photoSize = null;
          const pc = await this.ic.getPhotoCapabilities();
          if (pc.imageWidth && pc.imageHeight) {
            // about 12 megapixels is plenty for a page; more only makes it slow
            let k = Math.min(1, 4096 / Math.max(pc.imageWidth.max, pc.imageHeight.max));
            this.photoSize = { imageWidth: Math.round(pc.imageWidth.max * k), imageHeight: Math.round(pc.imageHeight.max * k) };
          }
        }
        if (this.photoSize) Object.assign(opts, this.photoSize);
        const late = new Promise((_, bad) => setTimeout(() => bad(new Error('slow')), 5000));
        const b = await Promise.race([this.ic.takePhoto(opts), late]);
        if (b && b.size > 20000) return { blob: b, photo: true };
      } catch { this.canPhoto = false; }
    }
    return { blob: await this.frame(), photo: false };
  }
}

// Watches the moving page and says when it is steady enough to take the picture by itself.
export class Steady {
  constructor() { this.reset(); }
  reset() { this.hist = []; this.smooth = null; this.missed = 0; this.waitFor = null; this.lost = 0; }
  // after a picture: wait until the page has moved or gone before taking another
  taken() { this.waitFor = this.smooth && this.smooth.map(p => [...p]); this.hist = []; this.lost = 0; }
  static move(a, b) { return Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]))); }
  push(r, now) {
    if (!r) {
      this.missed++;
      if (this.missed > 3) { this.smooth = null; this.hist = []; }
      if (++this.lost > 5) this.waitFor = null;
      return { quad: this.smooth, progress: 0 };
    }
    this.missed = 0; this.lost = 0;
    const jump = this.smooth ? Steady.move(this.smooth, r.quad) : 1;
    this.smooth = !this.smooth || jump > 0.09 ? r.quad : this.smooth.map((p, i) => [p[0] * 0.5 + r.quad[i][0] * 0.5, p[1] * 0.5 + r.quad[i][1] * 0.5]);
    if (this.waitFor && Steady.move(this.waitFor, r.quad) > 0.12) this.waitFor = null;
    this.hist.push({ t: now, q: r.quad, s: r.score, a: r.area });
    this.hist = this.hist.filter(h => now - h.t < 1300);
    const ready = r.score > 0.76 && r.area > 0.16;
    let progress = 0;
    if (ready && !this.waitFor) {
      let i = this.hist.length - 1;
      while (i > 0 && Steady.move(this.hist[i - 1].q, r.quad) < 0.022 && this.hist[i - 1].s > 0.72) i--;
      progress = Math.min(1, (now - this.hist[i].t) / 950);
      if (this.hist.length - i < 4) progress = Math.min(progress, 0.6);
    }
    return { quad: this.smooth, progress, good: ready, waiting: !!this.waitFor };
  }
}
