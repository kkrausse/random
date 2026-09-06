// Windowed-sinc low-pass interpolation. Absolute sample positions and FIR history
// survive worklet blocks; delaying by half the filter avoids block-edge artifacts.
export class AudioResampler {
  private samples: number[] = [];
  private base = 0;
  private total = 0;
  private position = 0;
  private outputSamples = 0;
  private finished = false;
  private readonly radius = 32;
  private readonly step: number;
  private readonly cutoff: number;
  constructor(rate: number) {
    if (!Number.isFinite(rate) || rate < 16000 || rate > 192000) throw new Error("Unsupported microphone sample rate");
    this.step = rate / 16000;
    this.cutoff = 0.45 / this.step;
  }
  push(input: Float32Array, final = false): Float32Array {
    if (this.finished) return new Float32Array();
    for (const sample of input) this.samples.push(sample);
    this.total += input.length;
    const output: number[] = [];
    while (this.position < this.total && (final || Math.floor(this.position) + this.radius < this.total)) {
      const center = Math.floor(this.position);
      let value = 0;
      let weight = 0;
      for (let index = center - this.radius + 1; index <= center + this.radius; index++) {
        const distance = index - this.position;
        const x = 2 * this.cutoff * distance;
        const sinc = Math.abs(x) < 1e-10 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const window = 0.5 + 0.5 * Math.cos(Math.PI * distance / this.radius);
        const coefficient = 2 * this.cutoff * sinc * window;
        value += (this.samples[index - this.base] ?? 0) * coefficient;
        weight += coefficient;
      }
      output.push(value / weight);
      this.position = ++this.outputSamples * this.step;
    }
    const discard = Math.max(0, Math.min(this.samples.length, Math.floor(this.position) - this.radius - this.base));
    this.samples.splice(0, discard);
    this.base += discard;
    this.finished = final;
    return Float32Array.from(output);
  }
}
