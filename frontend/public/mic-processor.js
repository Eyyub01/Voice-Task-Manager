class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetSize = 4800;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const chunk = input[0];
      for (let i = 0; i < chunk.length; i++) {
        this._buffer.push(chunk[i]);
      }
      if (this._buffer.length >= this._targetSize) {
        this.port.postMessage(new Float32Array(this._buffer));
        this._buffer = [];
      }
    }
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
