// Normalização de volume dos arquivos locais (AudioWorklet).
// Mesmo algoritmo do Android (LoudnessNormalizer.java): mede a sonoridade com o filtro K
// (EBU R128), ajusta o ganho devagar e usa um limitador para não distorcer.
const BLOCK_S = 0.1, TAU_S = 4, TAU_WARMUP_S = 1, WARMUP_S = 3;
const MAX_BOOST_DB = 10, MAX_CUT_DB = -15, LIMIT = 0.89, SILENCE_LUFS = -50;
const toEnergy = lufs => 10 ** ((lufs + 0.691) / 10);
const toLufs = e => -0.691 + 10 * Math.log10(e + 1e-12);

class Normalizer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.target = o.target ?? -14;
    this.enabled = o.enabled ?? true;
    this.blockFrames = Math.max(1, Math.round(sampleRate * BLOCK_S));
    this.limRelease = 1 - Math.exp(-1 / (0.15 * sampleRate));
    this.energy = toEnergy(this.target);
    this.gainDb = 0; this.curGain = 1; this.nextGain = 1; this.limiter = 1;
    this.blockEnergy = 0; this.blockCount = 0; this.warmup = WARMUP_S;
    this.z = [];
    this.design();
    this.port.onmessage = ({ data }) => {
      if ('enabled' in data) this.enabled = data.enabled;
      if (data.newTrack) { this.warmup = WARMUP_S; this.z.forEach(s => s.fill(0)); }
    };
  }

  design() {
    const fs = sampleRate;
    let f0 = 1681.974450955533, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / fs);
    const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
    let a0 = 1 + K / Q + K * K;
    this.sb = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0];
    this.sa = [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    f0 = 38.13547087602444; Q = 0.5003270373238773;
    K = Math.tan(Math.PI * f0 / fs);
    a0 = 1 + K / Q + K * K;
    this.ha = [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  }

  kWeight(s, x) {
    const { sb, sa, ha } = this;
    const y1 = sb[0] * x + s[0];
    s[0] = sb[1] * x - sa[0] * y1 + s[1];
    s[1] = sb[2] * x - sa[1] * y1;
    const y2 = y1 + s[2];
    s[2] = -2 * y1 - ha[0] * y2 + s[3];
    s[3] = y1 - ha[1] * y2;
    return y2;
  }

  endBlock(on) {
    const z = this.blockEnergy / this.blockFrames;
    this.blockEnergy = 0; this.blockCount = 0;
    const blockLufs = toLufs(z);
    let est = toLufs(this.energy);
    const warm = this.warmup > 0;
    // no início da música não usa o gate relativo: ela pode ser bem mais baixa que a anterior
    if (blockLufs > SILENCE_LUFS && (warm || blockLufs > est - 20)) {
      this.energy += (1 - Math.exp(-BLOCK_S / (warm ? TAU_WARMUP_S : TAU_S))) * (z - this.energy);
      est = toLufs(this.energy);
    }
    if (warm) this.warmup -= BLOCK_S;
    const desired = on ? Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB, this.target - est)) : 0;
    let up = (warm ? 6 : 1) * BLOCK_S, down = (warm ? 12 : 4) * BLOCK_S;
    if (!on) up = down = 12 * BLOCK_S;
    this.gainDb += Math.max(-down, Math.min(up, desired - this.gainDb));
    if (!on && Math.abs(this.gainDb) < 0.05) this.gainDb = 0;
    this.curGain = this.nextGain;
    this.nextGain = this.gainDb === 0 ? 1 : 10 ** (this.gainDb / 20);
  }

  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!input?.length) return true;
    const on = this.enabled;
    const chs = Math.min(input.length, output.length);
    if (!on && this.curGain === 1 && this.nextGain === 1 && this.limiter === 1) {
      for (let c = 0; c < chs; c++) output[c].set(input[c]);
      return true;
    }
    while (this.z.length < chs) this.z.push(new Float64Array(4));
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      const g = this.curGain + (this.nextGain - this.curGain) * this.blockCount / this.blockFrames;
      let peak = 0;
      for (let c = 0; c < chs; c++) {
        const x = input[c][i];
        const k = this.kWeight(this.z[c], x);
        this.blockEnergy += k * k;
        const y = x * g;
        output[c][i] = y;
        const a = Math.abs(y);
        if (a > peak) peak = a;
      }
      if (on || this.limiter < 1) {
        if (peak * this.limiter > LIMIT) this.limiter = LIMIT / peak;
        else this.limiter += (1 - this.limiter) * this.limRelease;
        if (this.limiter > 0.99999) this.limiter = 1;
      }
      if (this.limiter !== 1) for (let c = 0; c < chs; c++) output[c][i] *= this.limiter;
      if (++this.blockCount >= this.blockFrames) this.endBlock(on);
    }
    return true;
  }
}

registerProcessor('sonora-normalizer', Normalizer);
