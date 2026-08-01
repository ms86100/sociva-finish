// @ts-nocheck
import { useEffect, useRef, useCallback } from 'react';

export function useUrgentOrderSound(isActive: boolean) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingRef = useRef(false);

  // Load and decode the audio file once
  const loadAudio = useCallback(async () => {
    try {
      if (audioBufferRef.current) return;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      const response = await fetch('/sounds/gate_bell.mp3');
      const arrayBuffer = await response.arrayBuffer();
      audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer);
    } catch {
      console.log('Could not load notification sound');
    }
  }, []);

  const playOnce = useCallback(() => {
    const ctx = audioContextRef.current;
    const buffer = audioBufferRef.current;
    if (!ctx || !buffer || !isPlayingRef.current) return;

    try {
      // Resume context if suspended (required by browsers after user gesture)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      sourceNodeRef.current = source;

      // Schedule next play after this buffer finishes
      timeoutRef.current = setTimeout(() => {
        if (isPlayingRef.current) {
          playOnce();
        }
      }, buffer.duration * 1000 + 500); // small gap between loops
    } catch {
      console.log('Could not play notification sound');
    }
  }, []);

  const playBeep = useCallback(async () => {
    isPlayingRef.current = true;
    await loadAudio();
    playOnce();
  }, [loadAudio, playOnce]);

  const stopRinging = useCallback(() => {
    isPlayingRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      if (sourceNodeRef.current) {
        sourceNodeRef.current.stop();
        sourceNodeRef.current = null;
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isActive) {
      playBeep();
    } else {
      stopRinging();
    }

    return () => {
      stopRinging();
    };
  }, [isActive, playBeep, stopRinging]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      try {
        audioContextRef.current?.close();
      } catch {}
    };
  }, []);

  return { playBeep, stopRinging };
}
