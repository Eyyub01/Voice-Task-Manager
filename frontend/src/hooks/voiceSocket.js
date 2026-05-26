import { useState, useCallback, useRef } from 'react';

const TARGET_SAMPLE_RATE = 24000;

function float32ToPcm16Base64(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const float32 = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < float32.length; i++) {
    float32[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return float32;
}

export const useVoiceSocket = (onEvent) => {
  const [status, setStatus] = useState('idle');
  const socketRef = useRef(null);
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const processorRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef([]);
  const activeResponseRef = useRef(false);
  const workletLoadedRef = useRef(false);

  const scheduleNextChunk = useCallback(() => {
    if (playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const float32 = playbackQueueRef.current.shift();
    const audioBuffer = ctx.createBuffer(1, float32.length, TARGET_SAMPLE_RATE);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      scheduleNextChunk();
    };
  }, []);

  const enqueueAudioChunk = useCallback((base64) => {
    const float32 = pcm16Base64ToFloat32(base64);
    playbackQueueRef.current.push(float32);
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      scheduleNextChunk();
    }
  }, [scheduleNextChunk]);

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
    activeSourcesRef.current.forEach(s => {
      try { s.stop(); } catch (_) {}
    });
    activeSourcesRef.current = [];
  }, []);

  const startMic = useCallback(async (socket) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;

    const ctx = audioCtxRef.current;

    if (!workletLoadedRef.current) {
      await ctx.audioWorklet.addModule('/mic-processor.js');
      workletLoadedRef.current = true;
    }

    const source = ctx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(ctx, 'mic-processor');
    processorRef.current = workletNode;

    workletNode.port.onmessage = (e) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      let samples = e.data;

      if (ctx.sampleRate !== TARGET_SAMPLE_RATE) {
        const ratio = ctx.sampleRate / TARGET_SAMPLE_RATE;
        const outLength = Math.round(samples.length / ratio);
        const resampled = new Float32Array(outLength);
        for (let i = 0; i < outLength; i++) {
          resampled[i] = samples[Math.round(i * ratio)] ?? 0;
        }
        samples = resampled;
      }

      const base64 = float32ToPcm16Base64(samples);
      socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    };

    source.connect(workletNode);
  }, []);

  const stopMic = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.port.onmessage = null;
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    if (socketRef.current) return;

    setStatus('connecting');

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    } else if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    const wsUrl = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000')
      .replace(/^http/, 'ws') + '/media-stream';
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = async () => {
      setStatus('connected');
      try {
        await startMic(socket);
      } catch (err) {
        console.error('Microphone access denied:', err);
        onEvent({ type: 'error', message: 'Microphone access denied. Please allow mic permissions and try again.' });
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type;

        if (type === 'response.output_audio.delta' && data.delta) {
          enqueueAudioChunk(data.delta);
        } else if (type === 'input_audio_buffer.speech_started') {
          stopPlayback();
          if (activeResponseRef.current) {
            socket.send(JSON.stringify({ type: 'response.cancel' }));
          }
          onEvent({ type: 'user_speaking' });
        } else if (type === 'response.output_audio_transcript.delta' && data.delta) {
          onEvent({ type: 'ai_transcript_delta', delta: data.delta });
        } else if (type === 'conversation.item.input_audio_transcription.completed') {
          onEvent({ type: 'user_transcript', text: data.transcript });
        } else if (type === 'response.output_audio.done') {
          onEvent({ type: 'ai_audio_done' });
        } else if (type === 'response.created') {
          activeResponseRef.current = true;
        } else if (type === 'response.done') {
          activeResponseRef.current = false;
        } else if (type === 'task_list_updated') {
          onEvent({ type: 'task_list_updated' });
        } else if (type === 'error') {
          if (data.error?.code === 'response_cancel_not_active') return;
          console.error('OpenAI error event:', data);
          onEvent({ type: 'error', message: data.error?.message || 'Unknown error' });
        }
        onEvent(data);
      } catch (e) {
        console.error('Backend Error or Non-JSON Message:', event.data);
      }
    };

    socket.onclose = () => {
      setStatus('disconnected');
      socketRef.current = null;
      stopMic();
      stopPlayback();
      onEvent({ type: 'disconnected' });
    };

    socket.onerror = (err) => {
      setStatus('error');
      console.error('WebSocket error:', err);
      socketRef.current = null;
      stopMic();
      stopPlayback();
      onEvent({ type: 'error', message: 'Connection error' });
    };
  }, [onEvent, startMic, stopMic, enqueueAudioChunk, stopPlayback]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }
  }, []);

  return { status, connect, disconnect };
};
