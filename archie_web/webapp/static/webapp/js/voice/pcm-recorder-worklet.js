// AudioWorklet processor: captures mono PCM on the audio render thread and posts
// Float32 chunks to the main thread. Runs off the main thread so it doesn't glitch
// under load (unlike ScriptProcessorNode), giving smooth user-voice recordings.

class PcmRecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._chunks = [];
        this._count = 0;
        this._target = 2048; // batch ~2048 samples per message to limit overhead
    }

    process(inputs) {
        const input = inputs[0];
        if (input && input[0] && input[0].length) {
            this._chunks.push(input[0].slice(0));
            this._count += input[0].length;
            if (this._count >= this._target) {
                const out = new Float32Array(this._count);
                let o = 0;
                for (const c of this._chunks) { out.set(c, o); o += c.length; }
                this.port.postMessage(out, [out.buffer]);
                this._chunks = [];
                this._count = 0;
            }
        }
        return true; // keep the processor alive until the node is disconnected
    }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor);
