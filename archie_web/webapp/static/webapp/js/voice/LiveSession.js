// LiveVoiceSession — realtime voice over the Gemini Live API (Voice Chat "Live" mode).
//
// Flow:
//   POST /ai-assistant/api/live-token/ -> single-use ephemeral token whose config
//   (model, persona voice, system instruction, ask_archie tool) is locked server-side
//   -> WebSocket straight to Gemini (BidiGenerateContentConstrained) -> stream the
//   mic as PCM16 @ 16 kHz in realtimeInput.audio (Gemini 3.x ignores the legacy
//   `media` field) -> play the model's PCM16 @ 24 kHz as it arrives.
//   Voice activity detection and barge-in happen on the model side.
//   The model delegates real data/actions to the Archie agent via the ask_archie
//   tool: we run it through /ai-assistant/api/chat/ as a level2_answer, answer the
//   model with its text and hand its quick-action buttons to the UI.
//   Typed input (a pressed assistant_button) goes in as realtimeInput.text —
//   Gemini 3.x only accepts clientContent for seeding history.
//
// The session owns no UI and saves nothing itself: VoiceChat gets callbacks for
// status, live transcript, quick-action buttons, finished turns (text + WAV) and
// close/error.

class LiveVoiceSession {
    static IN_RATE = 16000;
    static OUT_RATE = 24000;
    static TOOL_NAME = 'ask_archie';
    // Mic level that counts as "user is speaking" for the idle timeout.
    static SPEECH_RMS = 0.02;
    // While the model is speaking only louder input passes (barge-in). Chrome's
    // echo canceller doesn't see Web Audio output, so without this gate the model
    // would hear — and interrupt — itself on speakers.
    static BARGE_IN_RMS = 0.08;

    constructor({ audioCtx, ensureWorklet, userName, conversationId, idleTimeoutMs, on }) {
        this.ctx = audioCtx;
        this.ensureWorklet = ensureWorklet;
        this.userName = userName;
        this.conversationId = conversationId;
        this.idleTimeoutMs = idleTimeoutMs;
        this.on = on; // { status, transcript, buttons, turn, close, error }

        this.ws = null;
        this.stream = null;
        this.nodes = [];
        this.closed = false;
        this.ready = false; // setupComplete received, input is accepted
        this.queuedText = null; // text sent before the session was ready
        this.status = 'connecting';

        // Playback queue
        this.sources = new Set();
        this.playhead = 0;

        // Current turn
        this.resampleTail = new Float32Array(0);
        this.userText = '';
        this.assistantText = '';
        this.userPcm = [];
        this.assistantPcm = [];
        this.capturingUser = true; // mic audio belongs to the user's turn until the model answers
        this.pendingTools = new Set();
        this.lastActivity = Date.now();
        this.idleTimer = null;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────
    async start() {
        const resp = await fetch('/ai-assistant/api/live-token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_name: this.userName })
        });
        if (!resp.ok) throw new Error(`Live token HTTP ${resp.status}`);
        const { token, ws_url: wsUrl, model } = await resp.json();
        if (this.closed) return;

        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (this.closed) { this._releaseMic(); return; }

        const ws = new WebSocket(`${wsUrl}?access_token=${encodeURIComponent(token)}`);
        ws.binaryType = 'arraybuffer'; // Gemini sends JSON in binary frames
        this.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ setup: { model } }));
        ws.onmessage = (e) => this._onMessage(e.data);
        ws.onerror = () => this._fail('Live connection error');
        ws.onclose = (e) => {
            if (this.closed) return;
            console.warn('LiveVoiceSession: socket closed', e.code, e.reason);
            if (e.code === 1000 || e.code === 1001) this._finish('closed');
            else this._fail(e.reason || `Live connection closed (${e.code})`);
        };
    }

    stop() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.idleTimer);
        this._stopPlayback();
        this._releaseMic();
        try { this.ws?.close(1000); } catch (_) { /* noop */ }
        this.ws = null;
    }

    _finish(reason) {
        if (this.closed) return;
        this._flushTurn();
        this.stop();
        this.on.close?.(reason);
    }

    _fail(message) {
        if (this.closed) return;
        this.stop();
        this.on.error?.(message);
    }

    _setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.on.status?.(status);
    }

    // Typed user turn (a pressed quick-action button). Queued until setupComplete.
    sendText(text) {
        if (this.closed || !text) return;
        if (!this.ready) { this.queuedText = text; return; }
        // Cut off the current answer, like a spoken barge-in would.
        this._stopPlayback();
        this._flushTurn();
        this.userText = text;
        this.capturingUser = false; // no mic clip for a typed turn
        this.lastActivity = Date.now();
        this.ws.send(JSON.stringify({ realtimeInput: { text } }));
        this._setStatus('thinking');
    }

    // ── Server messages ──────────────────────────────────────────────────────
    _onMessage(data) {
        let msg;
        try {
            msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
        } catch (e) {
            console.warn('LiveVoiceSession: bad frame', e);
            return;
        }
        if (msg.setupComplete) { this._onReady(); return; }
        if (msg.toolCall) { this._onToolCall(msg.toolCall); return; }
        if (msg.toolCallCancellation) {
            (msg.toolCallCancellation.ids || []).forEach(id => this.pendingTools.delete(id));
            return;
        }
        if (msg.goAway) { this._finish('goaway'); return; }

        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.interrupted) {
            // User barged in: drop the queued answer, keep what was said so far.
            this._stopPlayback();
            this._flushTurn();
            this._setStatus('listening');
            return;
        }
        if (sc.inputTranscription?.text) {
            this.userText += sc.inputTranscription.text;
            this.lastActivity = Date.now();
        }
        if (sc.outputTranscription?.text) {
            this.assistantText += sc.outputTranscription.text;
            this.on.transcript?.(this.assistantText.trim());
        }
        for (const part of sc.modelTurn?.parts || []) {
            if (part.inlineData?.data) this._enqueueAudio(part.inlineData.data);
        }
        if (sc.turnComplete) {
            this._flushTurn();
            if (!this.sources.size) this._setStatus('listening');
        }
    }

    async _onReady() {
        await this._startMic();
        if (this.closed) return;
        this.ready = true;
        const text = this.queuedText;
        this.queuedText = null;
        if (text) this.sendText(text);
    }

    // ask_archie -> Archie agent (level2_answer) -> text as toolResponse, buttons to the UI
    async _onToolCall(toolCall) {
        this.capturingUser = false;
        const calls = toolCall.functionCalls || [];
        this._setStatus('thinking');
        const responses = await Promise.all(calls.map(async (fc) => {
            this.pendingTools.add(fc.id);
            let response;
            if (fc.name !== LiveVoiceSession.TOOL_NAME) {
                response = { error: `Unknown tool ${fc.name}` };
            } else {
                try {
                    const { text, buttons } = await this._askArchie(fc.args?.request || '');
                    response = { result: text };
                    if (!this.closed && buttons.length) this.on.buttons?.(buttons);
                } catch (e) {
                    console.error('LiveVoiceSession: ask_archie failed', e);
                    response = { error: 'Archie agent is unavailable right now.' };
                }
            }
            return { id: fc.id, name: fc.name, response };
        }));
        const live = responses.filter(r => this.pendingTools.delete(r.id));
        this.lastActivity = Date.now();
        if (this.closed || !live.length) return;
        this.ws?.send(JSON.stringify({ toolResponse: { functionResponses: live } }));
    }

    async _askArchie(request) {
        const resp = await fetch('/ai-assistant/api/chat/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_name: this.userName,
                input: request,
                response_format: 'level2_answer',
                conversation_id: this.conversationId
            })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const c = data?.content;
        if (typeof c === 'string') return { text: c, buttons: [] };
        // level2_answer.text is a {type, text} block; fall back to plain content.text.
        const l2 = c?.level2_answer;
        const text = (typeof l2?.text === 'string' ? l2.text : l2?.text?.text) || c?.text || '';
        return { text, buttons: l2?.quick_action_buttons?.buttons || [] };
    }

    // ── Mic -> PCM16 @ 16 kHz -> realtimeInput.audio ─────────────────────────
    async _startMic() {
        const ctx = this.ctx;
        const useWorklet = await this.ensureWorklet(ctx);
        if (this.closed) return;
        const source = ctx.createMediaStreamSource(this.stream);
        const sink = ctx.createGain();
        sink.gain.value = 0; // keep the node pulled without echoing the mic
        let node;
        if (useWorklet && typeof AudioWorkletNode !== 'undefined') {
            node = new AudioWorkletNode(ctx, 'pcm-recorder');
            node.port.onmessage = (e) => this._onMicChunk(e.data);
        } else {
            node = ctx.createScriptProcessor(4096, 1, 1);
            node.onaudioprocess = (e) => this._onMicChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
        }
        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        this.nodes = [source, node, sink];

        this.lastActivity = Date.now();
        this.idleTimer = setInterval(() => this._checkIdle(), 1000);
        this._setStatus('listening');
    }

    _onMicChunk(float32) {
        if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return;
        const pcm = LiveVoiceSession._toPcm16(this._downsample(float32));
        if (!pcm.length) return;

        let sum = 0;
        for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
        const rms = Math.sqrt(sum / float32.length);
        if (rms > LiveVoiceSession.SPEECH_RMS) this.lastActivity = Date.now();
        if (this.sources.size && rms < LiveVoiceSession.BARGE_IN_RMS) pcm.fill(0);
        if (this.capturingUser) this.userPcm.push(pcm);

        this.ws.send(JSON.stringify({
            realtimeInput: {
                audio: { data: LiveVoiceSession._b64(pcm.buffer), mimeType: `audio/pcm;rate=${LiveVoiceSession.IN_RATE}` }
            }
        }));
    }

    // Box-filter decimation from the context rate to 16 kHz; the fractional
    // remainder is carried over so chunk boundaries don't drift.
    _downsample(input) {
        const ratio = this.ctx.sampleRate / LiveVoiceSession.IN_RATE;
        if (ratio === 1) return input;
        const buf = new Float32Array(this.resampleTail.length + input.length);
        buf.set(this.resampleTail);
        buf.set(input, this.resampleTail.length);
        const outLen = Math.floor(buf.length / ratio);
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
            const s = Math.floor(i * ratio);
            const e = Math.min(buf.length, Math.floor((i + 1) * ratio));
            let acc = 0;
            for (let j = s; j < e; j++) acc += buf[j];
            out[i] = acc / Math.max(1, e - s);
        }
        this.resampleTail = buf.slice(Math.floor(outLen * ratio));
        return out;
    }

    _checkIdle() {
        if (this.status !== 'listening' || this.sources.size || this.pendingTools.size) return;
        if (Date.now() - this.lastActivity > this.idleTimeoutMs) this._finish('idle');
    }

    _releaseMic() {
        this.nodes.forEach((n) => {
            if (n.port) n.port.onmessage = null;
            n.onaudioprocess = null;
            try { n.disconnect(); } catch (_) { /* noop */ }
        });
        this.nodes = [];
        try { this.stream?.getTracks().forEach(t => t.stop()); } catch (_) { /* noop */ }
        this.stream = null;
    }

    // ── Model audio (PCM16 @ 24 kHz) -> gapless playback queue ───────────────
    _enqueueAudio(b64) {
        if (this.closed) return;
        this.capturingUser = false;
        const pcm = new Int16Array(LiveVoiceSession._unb64(b64));
        this.assistantPcm.push(pcm);
        const buffer = this.ctx.createBuffer(1, pcm.length, LiveVoiceSession.OUT_RATE);
        const ch = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.ctx.destination);
        const at = Math.max(this.ctx.currentTime + 0.05, this.playhead);
        src.start(at);
        this.playhead = at + buffer.duration;
        this.sources.add(src);
        src.onended = () => {
            this.sources.delete(src);
            if (!this.sources.size && !this.closed) {
                this.lastActivity = Date.now();
                if (!this.pendingTools.size) this._setStatus('listening');
            }
        };
        this._setStatus('speaking');
    }

    _stopPlayback() {
        this.sources.forEach((s) => {
            s.onended = null;
            try { s.stop(); } catch (_) { /* noop */ }
        });
        this.sources.clear();
        this.playhead = 0;
    }

    // Hand the finished turn (transcripts + WAV clips) to the caller, then reset.
    _flushTurn() {
        const userText = this.userText.trim();
        const assistantText = this.assistantText.trim();
        if (userText || assistantText) {
            this.on.turn?.({
                userText,
                userWav: userText ? LiveVoiceSession._wav(this.userPcm, LiveVoiceSession.IN_RATE) : null,
                assistantText,
                assistantWav: assistantText ? LiveVoiceSession._wav(this.assistantPcm, LiveVoiceSession.OUT_RATE) : null
            });
        }
        this.userText = '';
        this.assistantText = '';
        this.userPcm = [];
        this.assistantPcm = [];
        this.capturingUser = true;
    }

    // ── Encoding helpers ─────────────────────────────────────────────────────
    static _toPcm16(float32) {
        const out = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return out;
    }

    static _b64(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
    }

    static _unb64(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    }

    // Mono 16-bit WAV Blob from PCM16 chunks.
    static _wav(chunks, rate) {
        const total = chunks.reduce((n, c) => n + c.length, 0);
        if (!total) return null;
        const dataSize = total * 2;
        const buf = new ArrayBuffer(44 + dataSize);
        const dv = new DataView(buf);
        const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
        ws(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
        ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
        dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
        dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
        ws(36, 'data'); dv.setUint32(40, dataSize, true);
        const pcm = new Int16Array(buf, 44);
        let off = 0;
        for (const c of chunks) { pcm.set(c, off); off += c.length; }
        return new Blob([buf], { type: 'audio/wav' });
    }
}

window.LiveVoiceSession = LiveVoiceSession;
