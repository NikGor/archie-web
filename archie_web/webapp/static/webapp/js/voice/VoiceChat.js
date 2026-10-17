// VoiceChat — real-time, hands-free voice assistant.
//
// Flow (one session == one saved conversation):
//   mic press -> listen (STT, ru-RU) -> send {input, response_format:"gemini_tts"}
//   to the agent -> receive a director's-note + transcript block -> feed the whole
//   block verbatim to the persona's Gemini voice (POST /ai-assistant/api/tts/,
//   browser speechSynthesis fallback), show only the transcript on screen ->
//   listen again. After 10s of silence, or on the cancel (X) button, the session
//   ends. Every turn is persisted to the same conversation.
//
// Audio cues are the real WAV samples the Pi assistant uses (start/received/
// ready/end + looped thinking), with synthesized tones as fallback. Persona voice
// resolves from the user's persona server-side (same mapping as archie-voice).
//
// "Live" mode (toggle, remembered per browser) swaps the STT -> agent -> TTS chain
// for a realtime Gemini Live session (LiveSession.js); the agent is reached from
// there through the ask_archie tool. Turns are persisted the same way.

const VOICE_MODE_KEY = 'archie.voiceChat.mode';

const readVoiceMode = () => {
    try { return localStorage.getItem(VOICE_MODE_KEY) === 'live' ? 'live' : 'tts'; }
    catch (_) { return 'tts'; }
};

const VoiceChat = () => {
    const { useState, useRef, useEffect, useCallback } = React;

    const [status, setStatus] = useState('idle'); // idle | connecting | listening | thinking | speaking
    const [answer, setAnswer] = useState('');
    const [buttons, setButtons] = useState([]); // Live: quick actions from the last agent answer
    const [error, setError] = useState(null);
    const [mode, setMode] = useState(readVoiceMode); // tts | live

    // Browser capability checks
    const SpeechRecognition = typeof window !== 'undefined'
        ? (window.SpeechRecognition || window.webkitSpeechRecognition)
        : undefined;
    const AudioCtx = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : undefined;
    const sttSupported = !!SpeechRecognition;
    const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    // TTS mode: STT is essential; playback works through Web Audio (persona TTS)
    // or the browser fallback, so either audio path is enough.
    // Live mode: mic capture + Web Audio playback + a WebSocket to Gemini.
    const liveSupported = !!AudioCtx && !!navigator.mediaDevices?.getUserMedia
        && typeof WebSocket !== 'undefined' && typeof window.LiveVoiceSession === 'function';
    const supported = mode === 'live'
        ? liveSupported
        : sttSupported && (!!AudioCtx || ttsSupported);

    // Session refs (kept in refs so async callbacks always see fresh values)
    const sessionActiveRef = useRef(false);
    const conversationIdRef = useRef(null);
    const recognitionRef = useRef(null);
    const listenDeadlineRef = useRef(0);
    const turnGotResultRef = useRef(false);
    const audioCtxRef = useRef(null);
    const currentSourceRef = useRef(null); // active answer BufferSource, for stop()
    const cueBuffersRef = useRef({}); // cue type -> decoded AudioBuffer (cached)
    const thinkingSourceRef = useRef(null); // looping "thinking" cue source
    const micStreamRef = useRef(null); // getUserMedia stream for recording the user
    const recSourceRef = useRef(null); // MediaStreamAudioSourceNode
    const recProcessorRef = useRef(null); // ScriptProcessorNode capturing PCM
    const recSinkRef = useRef(null); // zero-gain sink so the mic isn't echoed
    const recPcmRef = useRef([]); // Float32Array chunks for the current utterance
    const recRateRef = useRef(16000); // AudioContext sample rate at capture time
    const workletReadyRef = useRef(null); // Promise<bool>: AudioWorklet module loaded
    const liveRef = useRef(null); // active LiveVoiceSession (Live mode)
    const liveSaveChainRef = useRef(Promise.resolve()); // keeps saved turns in order

    const LISTEN_WINDOW_MS = 10000; // end the session after 10s of silence

    // ── Web Audio: shared context + synthesized cues ────────────────────────
    const getAudioCtx = () => {
        if (!AudioCtx) return null;
        if (!audioCtxRef.current) {
            try { audioCtxRef.current = new AudioCtx(); } catch (_) { return null; }
        }
        const ctx = audioCtxRef.current;
        // Autoplay policy: unlock on the user gesture that starts the session.
        if (ctx.state === 'suspended') ctx.resume().catch(() => { /* noop */ });
        return ctx;
    };

    // Real WAV cue samples (same files the Pi assistant uses), resolved to
    // hashed static URLs in the template. Fetched + decoded once, then cached.
    const loadCueBuffer = async (type) => {
        if (cueBuffersRef.current[type]) return cueBuffersRef.current[type];
        const url = (window.VOICE_CUE_URLS || {})[type];
        const ctx = getAudioCtx();
        if (!url || !ctx) return null;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`cue HTTP ${resp.status}`);
            const buf = await ctx.decodeAudioData(await resp.arrayBuffer());
            cueBuffersRef.current[type] = buf;
            return buf;
        } catch (e) {
            console.warn(`VoiceChat: cue "${type}" load failed, using tone`, e);
            return null;
        }
    };

    // Warm the cache on session start so cues fire without a decode delay.
    const preloadCues = () => {
        ['start', 'received', 'ready', 'end', 'thinking'].forEach(loadCueBuffer);
    };

    const playCueBuffer = (ctx, buffer, loop = false) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = loop;
        src.connect(ctx.destination);
        src.start();
        return src;
    };

    // Synthesized fallback for when a WAV cue has no URL (error) or fails to load.
    const TONE_CUES = {
        start: [[660, 0, 0.12], [880, 0.10, 0.14]],
        received: [[540, 0, 0.11]],
        ready: [[784, 0, 0.13]],
        end: [[540, 0, 0.11], [340, 0.10, 0.17]],
        error: [[220, 0, 0.28, 0.12]],
    };

    const tone = (ctx, freq, startAt, dur, peak = 0.14) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + dur + 0.03);
    };

    const toneFallback = (type) => {
        const ctx = getAudioCtx();
        const seq = TONE_CUES[type];
        if (!ctx || !seq) return;
        const t0 = ctx.currentTime + 0.01;
        seq.forEach(([f, off, dur, peak]) => tone(ctx, f, t0 + off, dur, peak));
    };

    // Play a one-shot cue: prefer the WAV sample, fall back to a tone.
    const beep = (type) => {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const buf = cueBuffersRef.current[type];
        if (buf) { playCueBuffer(ctx, buf); return; }
        if ((window.VOICE_CUE_URLS || {})[type]) {
            loadCueBuffer(type).then((b) => {
                const c = getAudioCtx();
                if (b && c) playCueBuffer(c, b);
                else toneFallback(type);
            });
            return;
        }
        toneFallback(type);
    };

    // Loop the "thinking" cue while waiting for the agent (matches the Pi).
    const startThinking = () => {
        stopThinking();
        const ctx = getAudioCtx();
        if (!ctx) return;
        const buf = cueBuffersRef.current['thinking'];
        if (buf) {
            thinkingSourceRef.current = playCueBuffer(ctx, buf, true);
            return;
        }
        loadCueBuffer('thinking').then((b) => {
            const c = getAudioCtx();
            if (b && c && sessionActiveRef.current && !thinkingSourceRef.current) {
                thinkingSourceRef.current = playCueBuffer(c, b, true);
            }
        });
    };

    const stopThinking = () => {
        try { thinkingSourceRef.current?.stop?.(); } catch (_) { /* noop */ }
        thinkingSourceRef.current = null;
    };

    // ── Helpers ────────────────────────────────────────────────────────────
    const genUUID = () => {
        // crypto.randomUUID needs a secure context; fall back for plain-http LAN
        if (window.crypto?.randomUUID) {
            try { return window.crypto.randomUUID(); } catch (_) { /* fall through */ }
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    };

    const decodeEntities = (s) => {
        const t = document.createElement('textarea');
        t.innerHTML = s;
        return t.value;
    };

    // gemini_tts marker separating the director's note from the spoken transcript.
    const TRANSCRIPT_RE = /##\s*Transcript:\s*/i;

    // What to feed the TTS engine: the whole gemini_tts block verbatim — the
    // director's note + [inline tags] IS the prompt (Gemini reads it as style and
    // speaks only the transcript). Mirrors archie-voice agent.for_tts().
    const forTts = (raw) => {
        if (!raw) return '';
        return decodeEntities(String(raw)).trim(); // keep note + tags, unescape only
    };

    // What to show/persist: the spoken words only — keep the "## Transcript:"
    // section, drop <tags> and [inline tags]. Mirrors agent.for_display().
    const forDisplay = (raw) => {
        if (!raw) return '';
        let text = String(raw);
        const parts = text.split(TRANSCRIPT_RE);
        if (parts.length >= 2) text = parts.slice(1).join(' ');
        text = text.replace(/<[^>]+>/g, ' ').replace(/\[[^\]]*\]/g, ' ');
        text = decodeEntities(text);
        return text.replace(/\s+/g, ' ').trim();
    };

    const extractSsml = (payload) => {
        if (!payload) return '';
        if (typeof payload === 'string') return payload;
        const c = payload.content;
        if (typeof c === 'string') return c;
        return c?.ssml || c?.text || payload?.ssml || payload?.text || c?.plain || '';
    };

    const pickRuVoice = () => {
        const voices = window.speechSynthesis.getVoices() || [];
        return voices.find(v => v.lang === 'ru-RU')
            || voices.find(v => v.lang?.toLowerCase().startsWith('ru'))
            || null;
    };

    const clearListenTimers = () => {
        listenDeadlineRef.current = 0;
    };

    const stopPlayback = () => {
        stopThinking();
        try { currentSourceRef.current?.stop?.(); } catch (_) { /* noop */ }
        currentSourceRef.current = null;
        if (ttsSupported) {
            try { window.speechSynthesis.cancel(); } catch (_) { /* noop */ }
        }
    };

    // ── User audio recording (MediaRecorder alongside SpeechRecognition) ─────
    // SpeechRecognition yields only text, so to keep the user's actual recording
    // we capture the mic in parallel with a MediaRecorder, one clip per utterance.
    const ensureMicStream = async () => {
        if (micStreamRef.current) return micStreamRef.current;
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            return null;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStreamRef.current = stream;
            return stream;
        } catch (e) {
            console.warn('VoiceChat: mic for recording unavailable', e);
            return null;
        }
    };

    // Tear down the capture graph (called before a new utterance and on stop).
    const teardownRecordingNodes = () => {
        const node = recProcessorRef.current;
        if (node) {
            node.onaudioprocess = null;        // ScriptProcessorNode
            if (node.port) node.port.onmessage = null; // AudioWorkletNode
        }
        try { node?.disconnect(); } catch (_) { /* noop */ }
        try { recSourceRef.current?.disconnect(); } catch (_) { /* noop */ }
        try { recSinkRef.current?.disconnect(); } catch (_) { /* noop */ }
        recProcessorRef.current = null;
        recSourceRef.current = null;
        recSinkRef.current = null;
    };

    // Load the AudioWorklet module once (cached). Returns false if unavailable.
    const ensureWorklet = (ctx) => {
        if (!ctx.audioWorklet || !window.VOICE_WORKLET_URL) return Promise.resolve(false);
        if (!workletReadyRef.current) {
            workletReadyRef.current = ctx.audioWorklet
                .addModule(window.VOICE_WORKLET_URL)
                .then(() => true)
                .catch((e) => {
                    console.warn('VoiceChat: AudioWorklet load failed', e);
                    return false;
                });
        }
        return workletReadyRef.current;
    };

    // Capture the user's mic as raw PCM via Web Audio. We avoid MediaRecorder here
    // because its opus/webm output plays back at the wrong speed when the mic rate
    // differs from opus' fixed 48 kHz. Raw PCM lets us write a WAV whose header rate
    // matches the data. Prefer an AudioWorklet (audio-thread capture, glitch-free);
    // fall back to a ScriptProcessorNode where AudioWorklet is unavailable.
    const startUserRecording = async () => {
        const stream = await ensureMicStream();
        if (!stream || !sessionActiveRef.current) return;
        const ctx = getAudioCtx();
        if (!ctx) return;
        const useWorklet = await ensureWorklet(ctx);
        if (!sessionActiveRef.current) return;
        teardownRecordingNodes(); // discard a previous (e.g. silent) utterance
        try {
            recRateRef.current = ctx.sampleRate;
            recPcmRef.current = [];
            const source = ctx.createMediaStreamSource(stream);
            const sink = ctx.createGain();
            sink.gain.value = 0; // don't echo the mic to the speakers

            let node;
            if (useWorklet && typeof AudioWorkletNode !== 'undefined') {
                node = new AudioWorkletNode(ctx, 'pcm-recorder');
                node.port.onmessage = (e) => recPcmRef.current.push(e.data);
            } else if (ctx.createScriptProcessor) {
                node = ctx.createScriptProcessor(4096, 1, 1);
                node.onaudioprocess = (e) => {
                    recPcmRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
                };
            } else {
                return;
            }

            source.connect(node);
            node.connect(sink);
            sink.connect(ctx.destination); // keeps the node "pulled"
            recSourceRef.current = source;
            recProcessorRef.current = node;
            recSinkRef.current = sink;
        } catch (e) {
            console.warn('VoiceChat: PCM capture start failed', e);
            teardownRecordingNodes();
        }
    };

    // Stop capture and return a WAV Blob of the utterance (or null).
    const stopUserRecording = () => {
        const chunks = recPcmRef.current;
        recPcmRef.current = [];
        const rate = recRateRef.current;
        teardownRecordingNodes();
        if (!chunks.length) return null;
        let total = 0;
        for (const c of chunks) total += c.length;
        if (!total) return null;
        // Concatenate float32 chunks, convert to PCM16, wrap in a WAV container.
        const pcm16 = new Int16Array(total);
        let off = 0;
        for (const c of chunks) {
            for (let i = 0; i < c.length; i++) {
                let s = c[i];
                s = s < -1 ? -1 : s > 1 ? 1 : s;
                pcm16[off++] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
        }
        return pcm16ToWavBlob(pcm16, rate);
    };

    // Build a mono 16-bit WAV Blob from PCM16 samples at `rate`.
    const pcm16ToWavBlob = (pcm16, rate) => {
        const dataSize = pcm16.length * 2;
        const buf = new ArrayBuffer(44 + dataSize);
        const dv = new DataView(buf);
        const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
        ws(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
        ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
        dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
        dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
        ws(36, 'data'); dv.setUint32(40, dataSize, true);
        new Int16Array(buf, 44).set(pcm16);
        return new Blob([buf], { type: 'audio/wav' });
    };

    const releaseMicStream = () => {
        teardownRecordingNodes();
        try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch (_) { /* noop */ }
        micStreamRef.current = null;
    };

    // ── Persistence ────────────────────────────────────────────────────────
    // Save a message and return its id (so the caller can attach an audio clip).
    const saveMessage = useCallback(async (role, text) => {
        const messageId = genUUID();
        try {
            await fetch('/ai-assistant/api/save-message/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: conversationIdRef.current,
                    message: {
                        message_id: messageId,
                        role,
                        content: { content_format: 'plain', text }
                    }
                })
            });
        } catch (e) {
            console.error('VoiceChat: failed to save message', e);
        }
        return messageId;
    }, []);

    // Attach a voice recording (Blob) to a saved message.
    const uploadAudio = async (messageId, blob) => {
        if (!messageId || !blob || !blob.size) return;
        try {
            await fetch(`/ai-assistant/api/messages/${messageId}/audio/`, {
                method: 'POST',
                headers: { 'Content-Type': blob.type || 'audio/webm' },
                body: blob
            });
        } catch (e) {
            console.error('VoiceChat: audio upload failed', e);
        }
    };

    // ── TTS ────────────────────────────────────────────────────────────────
    // Browser speechSynthesis — fallback when persona TTS is unavailable.
    const speakBrowser = (text, onDone) => {
        if (!ttsSupported) { onDone && onDone(); return; }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        const voice = pickRuVoice();
        if (voice) utterance.voice = voice;
        utterance.onend = () => onDone && onDone();
        utterance.onerror = () => onDone && onDone();
        window.speechSynthesis.speak(utterance);
    };

    // Fetch persona-voice TTS as raw WAV bytes (for both playback and saving);
    // returns an ArrayBuffer, or null when the backend TTS is unavailable.
    const synthTts = async (text) => {
        if (!text) return null;
        try {
            const resp = await fetch('/ai-assistant/api/tts/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    user_name: window.CURRENT_USER_NAME || 'guest'
                })
            });
            if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
            return await resp.arrayBuffer();
        } catch (e) {
            console.warn('VoiceChat: persona TTS unavailable', e);
            return null;
        }
    };

    // Play WAV bytes through the AudioContext; returns true if playback started.
    const playWav = async (arrayBuffer, onDone) => {
        const ctx = getAudioCtx();
        if (!ctx || !arrayBuffer) return false;
        try {
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            if (!sessionActiveRef.current) { onDone && onDone(); return true; }
            const src = ctx.createBufferSource();
            src.buffer = audioBuffer;
            src.connect(ctx.destination);
            src.onended = () => {
                if (currentSourceRef.current === src) currentSourceRef.current = null;
                onDone && onDone();
            };
            currentSourceRef.current = src;
            src.start();
            return true;
        } catch (e) {
            console.warn('VoiceChat: WAV playback failed', e);
            return false;
        }
    };

    // ── One user turn ──────────────────────────────────────────────────────
    const handleUserInput = useCallback(async (transcript) => {
        if (!sessionActiveRef.current) return;
        setStatus('thinking');
        startThinking();

        // Finish the user's recording, save the message, attach the clip.
        const userBlob = stopUserRecording();
        const userMsgId = await saveMessage('user', transcript);
        if (userBlob) uploadAudio(userMsgId, userBlob);

        let spoken = '';   // verbatim gemini_tts block (note + tags) for the TTS
        let display = '';  // transcript only, for the screen + persistence
        try {
            const resp = await fetch('/ai-assistant/api/chat/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_name: window.CURRENT_USER_NAME || 'guest',
                    input: transcript,
                    response_format: 'gemini_tts',
                    conversation_id: conversationIdRef.current
                })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const raw = extractSsml(data);
            spoken = forTts(raw);
            display = forDisplay(raw);
        } catch (e) {
            console.error('VoiceChat: agent request failed', e);
            stopThinking();
            beep('error');
            setError('Voice assistant is unavailable');
            endSession(false);
            return;
        }

        // Synthesize the answer up front so we can both save and play the audio.
        const wavBuf = await synthTts(spoken || display);

        stopThinking();
        if (!sessionActiveRef.current) return;

        if (spoken || display) {
            beep('ready');
            if (display) setAnswer(display);
            const asstMsgId = await saveMessage('assistant', display || '');
            if (wavBuf) uploadAudio(asstMsgId, new Blob([wavBuf], { type: 'audio/wav' }));
        }

        // Speak the answer (director's note styles it), then listen for the next turn.
        setStatus('speaking');
        const onDone = () => { if (sessionActiveRef.current) startListening(); };
        const played = wavBuf ? await playWav(wavBuf, onDone) : false;
        if (!played) speakBrowser(display || '', onDone);
    }, [saveMessage]);

    // ── STT (one listening turn, auto-restarts until the 10s window closes) ──
    const startListening = useCallback(() => {
        if (!sessionActiveRef.current || !sttSupported) return;

        setStatus('listening');
        listenDeadlineRef.current = Date.now() + LISTEN_WINDOW_MS;
        turnGotResultRef.current = false;

        const beginRecognition = () => {
            if (!sessionActiveRef.current) return;
            const recognition = new SpeechRecognition();
            recognition.lang = 'ru-RU';
            recognition.interimResults = false;
            recognition.continuous = false;
            recognition.maxAlternatives = 1;

            recognition.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map(r => r[0]?.transcript || '')
                    .join(' ')
                    .trim();
                if (!transcript) return;
                turnGotResultRef.current = true;
                clearListenTimers();
                beep('received');
                handleUserInput(transcript);
            };

            recognition.onerror = (event) => {
                // "no-speech"/"aborted" are expected during silence — keep waiting
                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    beep('error');
                    setError('Microphone access is blocked');
                    endSession(false);
                }
            };

            recognition.onend = () => {
                if (!sessionActiveRef.current || turnGotResultRef.current) return;
                // Still within the listening window? keep listening. Otherwise end.
                if (Date.now() < listenDeadlineRef.current) {
                    beginRecognition();
                } else {
                    endSession(true);
                }
            };

            recognitionRef.current = recognition;
            startUserRecording(); // record this utterance in parallel with STT
            try {
                recognition.start();
            } catch (e) {
                console.error('VoiceChat: recognition.start failed', e);
            }
        };

        beginRecognition();
    }, [sttSupported, handleUserInput]);

    // ── Session lifecycle ────────────────────────────────────────────────────
    // cue=true plays the "session ended" tone (silence timeout / cancel button);
    // navigation-away and error paths pass false to stay silent.
    const endSession = useCallback((cue = false) => {
        const wasActive = sessionActiveRef.current;
        sessionActiveRef.current = false;
        clearListenTimers();
        turnGotResultRef.current = true; // stop any pending onend restart
        try { recognitionRef.current?.abort?.(); } catch (_) { /* noop */ }
        liveRef.current?.stop();
        liveRef.current = null;
        stopUserRecording();
        releaseMicStream();
        stopPlayback();
        if (cue && wasActive) beep('end');
        setStatus('idle');
        // Surface the freshly saved conversation in the sidebar chat list
        if (typeof window.loadChats === 'function') {
            try { window.loadChats(); } catch (_) { /* noop */ }
        }
    }, [ttsSupported]);

    // Persist one Live turn (user + assistant transcripts with their audio clips).
    const saveLiveTurn = useCallback(({ userText, userWav, assistantText, assistantWav }) => {
        liveSaveChainRef.current = liveSaveChainRef.current.then(async () => {
            if (userText) uploadAudio(await saveMessage('user', userText), userWav);
            if (assistantText) uploadAudio(await saveMessage('assistant', assistantText), assistantWav);
        });
    }, [saveMessage]);

    // initialText: a quick-action request to send as soon as the session is up.
    const startLiveSession = async (initialText) => {
        setStatus('connecting');
        const session = new window.LiveVoiceSession({
            audioCtx: getAudioCtx(),
            ensureWorklet,
            userName: window.CURRENT_USER_NAME || 'guest',
            conversationId: conversationIdRef.current,
            idleTimeoutMs: LISTEN_WINDOW_MS,
            on: {
                status: (s) => {
                    if (!sessionActiveRef.current) return;
                    if (s === 'thinking') { startThinking(); setButtons([]); } else stopThinking();
                    setStatus(s);
                },
                transcript: (text) => sessionActiveRef.current && setAnswer(text),
                buttons: (list) => sessionActiveRef.current && setButtons(list),
                turn: saveLiveTurn,
                close: () => endSession(true),
                error: (message) => {
                    console.error('VoiceChat: Live session failed —', message);
                    beep('error');
                    setError('Live voice is unavailable');
                    endSession(false);
                }
            }
        });
        liveRef.current = session;
        if (initialText) session.sendText(initialText); // queued until setupComplete
        try {
            await session.start();
        } catch (e) {
            console.error('VoiceChat: Live session start failed', e);
            if (liveRef.current !== session) return; // cancelled meanwhile
            beep('error');
            setError(e?.name === 'NotAllowedError' ? 'Microphone access is blocked' : 'Live voice is unavailable');
            endSession(false);
        }
    };

    const startSession = useCallback(async (initialText) => {
        if (sessionActiveRef.current) return;
        if (!supported) {
            setError('Voice chat is not supported in this browser');
            return;
        }
        setError(null);
        setAnswer('');
        setButtons([]);
        conversationIdRef.current = genUUID();
        sessionActiveRef.current = true;
        preloadCues();  // unlocks the AudioContext on this user gesture + warms cache
        beep('start');
        if (mode === 'live') { await startLiveSession(initialText); return; }
        // Acquire the mic up front so the first utterance is recorded (not just STT).
        await ensureMicStream();
        if (!sessionActiveRef.current) return; // cancelled during the permission prompt
        startListening();
    }, [supported, mode, startListening, saveLiveTurn]);

    // Quick action: assistant_button goes into the Live session as a typed turn
    // (reopening the session if it has ended), frontend_button runs locally.
    const runQuickAction = (button) => {
        if (button.type === 'frontend_button') {
            handleFrontendCommand(button.command, {}, button);
            return;
        }
        if (button.type !== 'assistant_button' || !button.assistant_request) return;
        if (sessionActiveRef.current && liveRef.current) {
            liveRef.current.sendText(button.assistant_request);
        } else {
            startSession(button.assistant_request);
        }
    };

    const switchMode = (next) => {
        if (sessionActiveRef.current || next === mode) return;
        setMode(next);
        setButtons([]);
        setError(null);
        try { localStorage.setItem(VOICE_MODE_KEY, next); } catch (_) { /* noop */ }
    };

    // Allow external navigation (leaving the voice view) to stop the session
    useEffect(() => {
        window.stopVoiceSession = () => endSession(false);
        return () => {
            endSession(false);
            if (window.stopVoiceSession) delete window.stopVoiceSession;
        };
    }, [endSession]);

    // Refresh Lucide icons when the button icons change
    useEffect(() => {
        if (typeof lucide !== 'undefined') {
            setTimeout(() => lucide.createIcons(), 0);
        }
    }, [status, buttons]);

    // ── Render ───────────────────────────────────────────────────────────────
    const isActive = status !== 'idle';
    const statusLabel = {
        idle: 'Press the microphone to start',
        connecting: 'Connecting…',
        listening: 'Listening…',
        thinking: 'Thinking…',
        speaking: 'Speaking…'
    }[status];

    // TTS | Live segmented switch, locked while a session runs.
    const modeSwitch = React.createElement('div', {
        key: 'mode',
        role: 'radiogroup',
        'aria-label': 'Voice mode',
        className: `absolute top-6 left-1/2 -translate-x-1/2 z-[3] flex p-1 rounded-full border border-white/10 bg-white/5 ${
            isActive ? 'opacity-40' : ''
        }`
    }, [['tts', 'TTS', 'Speech recognition → Archie agent → persona TTS'],
        ['live', 'Live', 'Realtime Gemini Live voice (agent as a tool)']].map(([value, label, hint]) =>
        React.createElement('button', {
            key: value,
            type: 'button',
            role: 'radio',
            'aria-checked': mode === value,
            title: hint,
            disabled: isActive,
            onClick: () => switchMode(value),
            className: `px-4 py-1 rounded-full text-[0.65rem] font-medium uppercase tracking-[0.2em] transition-colors ${
                mode === value ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/45 hover:text-white/75'
            } ${isActive ? 'cursor-not-allowed' : ''}`
        }, label)
    ));

    if (!supported) {
        return React.createElement('div', {
            className: 'relative h-full w-full flex items-center justify-center text-center px-6'
        }, [
            modeSwitch,
            React.createElement('p', {
                key: 'msg',
                className: 'text-white/70 max-w-md'
            }, mode === 'live'
                ? 'Live voice needs microphone access and Web Audio, served over HTTPS or localhost.'
                : 'Voice chat needs a browser with Speech Recognition and Speech Synthesis (Chrome or Edge), served over HTTPS or localhost.')
        ]);
    }

    const orbStateClass = status === 'listening'
        ? 'voice-orb--listening'
        : status === 'speaking' ? 'voice-orb--speaking' : '';

    return React.createElement('div', {
        className: `voice-stage voice-stage--${status} relative h-full w-full overflow-hidden`
    }, [
        modeSwitch,

        // Reactive orb — dead center. Rings + core stacked in one cell.
        React.createElement('div', {
            key: 'orb-wrap',
            className: 'voice-orb-stage absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[1]'
        }, [
            React.createElement('span', { key: 'r1', className: 'voice-ring r1' }),
            React.createElement('span', { key: 'r2', className: 'voice-ring r2' }),
            React.createElement('div', { key: 'orb', className: `voice-orb ${orbStateClass}` })
        ]),

        // Status + spoken answer, upper third, centered above the orb
        React.createElement('div', {
            key: 'stage',
            className: 'absolute left-1/2 -translate-x-1/2 top-[14%] w-full max-w-2xl px-6 flex flex-col items-center gap-5 text-center pointer-events-none z-[2]'
        }, [
            React.createElement('div', {
                key: 'status',
                className: `flex items-center gap-2 text-[0.7rem] font-medium uppercase tracking-[0.28em] ${
                    isActive ? 'text-cyan-300' : 'text-white/40'
                }`
            }, [
                isActive && React.createElement('span', { key: 'dot', className: 'voice-dot' }),
                React.createElement('span', { key: 'lbl' }, statusLabel)
            ].filter(Boolean)),
            answer && React.createElement('div', {
                key: answer, // re-key on a new answer so the entrance re-triggers
                className: 'voice-answer max-w-xl text-2xl md:text-[1.7rem] font-light leading-snug tracking-tight text-white/95 [text-shadow:0_2px_20px_rgba(0,0,0,0.6)]'
            }, answer),
            buttons.length > 0 && React.createElement('div', {
                key: 'actions',
                className: `voice-actions pointer-events-auto flex flex-wrap justify-center gap-2 ${
                    status === 'connecting' || status === 'thinking' ? 'opacity-40 pointer-events-none' : ''
                }`
            }, buttons.map((button, i) => React.createElement('button', {
                key: `${i}-${button.text}`,
                type: 'button',
                onClick: () => runQuickAction(button),
                title: getButtonTooltip(button),
                className: `flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors ${
                    button.style === 'primary'
                        ? 'bg-cyan-500/15 text-cyan-100 border-cyan-400/40 hover:bg-cyan-500/25'
                        : 'bg-white/5 text-white/80 border-white/15 hover:bg-white/10 hover:text-white'
                }`
            }, [
                // Wrapper span: lucide swaps the <i> for an <svg> behind React's back,
                // so React must only ever remove the wrapper.
                button.icon && React.createElement('span', { key: 'icon', className: 'flex' },
                    React.createElement('i', { 'data-lucide': button.icon, className: 'w-4 h-4' })),
                React.createElement('span', { key: 'text' }, button.text)
            ].filter(Boolean)))),
            error && React.createElement('div', {
                key: 'error',
                className: 'text-red-400 text-sm'
            }, error)
        ]),

        // Bottom controls: mic (primary) + end (secondary), centered cluster
        React.createElement('div', {
            key: 'controls',
            className: 'absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-6 z-[3]'
        }, [
            React.createElement('div', {
                key: 'mic-wrap',
                className: 'relative'
            }, [
                status === 'listening' && React.createElement('span', {
                    key: 'ping',
                    className: 'voice-mic-ping'
                }),
                React.createElement('button', {
                    key: 'mic',
                    type: 'button',
                    onClick: () => startSession(),
                    disabled: isActive,
                    title: 'Start voice chat',
                    'aria-label': 'Start voice chat',
                    className: `voice-ctl relative w-[4.5rem] h-[4.5rem] rounded-full flex items-center justify-center border ${
                        isActive
                            ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40 cursor-default'
                            : 'bg-white/10 text-white border-white/20 hover:bg-white/15 hover:border-white/35'
                    }`
                }, React.createElement('i', {
                    'data-lucide': 'mic',
                    className: 'w-7 h-7'
                }))
            ].filter(Boolean)),
            React.createElement('button', {
                key: 'cancel',
                type: 'button',
                onClick: () => endSession(true),
                disabled: !isActive,
                title: 'Stop voice chat',
                'aria-label': 'Stop voice chat',
                className: `voice-ctl w-14 h-14 rounded-full flex items-center justify-center border ${
                    isActive
                        ? 'bg-red-500/15 text-red-300 border-red-400/40 hover:bg-red-500/25'
                        : 'bg-white/5 text-white/25 border-white/10 cursor-not-allowed'
                }`
            }, React.createElement('i', {
                'data-lucide': 'x',
                className: 'w-6 h-6'
            }))
        ])
    ]);
};

// Mount into the voice view root
document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('voice-assistant-root');
    if (el && typeof React !== 'undefined' && typeof ReactDOM !== 'undefined') {
        try {
            ReactDOM.createRoot(el).render(React.createElement(VoiceChat));
        } catch (e) {
            console.error('Failed to initialize VoiceChat:', e);
        }
    }
});
