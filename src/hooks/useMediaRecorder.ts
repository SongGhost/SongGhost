"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function formatRecordingTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Browser mic capture for SongHost Studio voice breaks.
 * Uses `getUserMedia` + `MediaRecorder`; preview URL is a local object URL.
 */
export function useMediaRecorder() {
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState("00:00");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const discardOnStopRef = useRef(false);

  const revokeAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioUrl(null);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStreamTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported in this browser");
    }
    if (mediaRecorderRef.current?.state === "recording") return;

    revokeAudioUrl();
    setAudioBlob(null);
    chunksRef.current = [];
    discardOnStopRef.current = false;
    secondsRef.current = 0;
    setRecordingTime("00:00");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeType = pickRecorderMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      clearTimer();
      stopStreamTracks();
      setIsRecording(false);

      if (discardOnStopRef.current) {
        chunksRef.current = [];
        discardOnStopRef.current = false;
        setAudioBlob(null);
        revokeAudioUrl();
        secondsRef.current = 0;
        setRecordingTime("00:00");
        return;
      }

      const blobType = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      chunksRef.current = [];
      setAudioBlob(blob);

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioUrl(url);
    };

    recorder.start(250);
    setIsRecording(true);

    clearTimer();
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setRecordingTime(formatRecordingTime(secondsRef.current));
    }, 1000);
  }, [clearTimer, revokeAudioUrl, stopStreamTracks]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    discardOnStopRef.current = false;
    recorder.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      chunksRef.current = [];
      setAudioBlob(null);
      revokeAudioUrl();
      secondsRef.current = 0;
      setRecordingTime("00:00");
      clearTimer();
      stopStreamTracks();
      setIsRecording(false);
      return;
    }
    discardOnStopRef.current = true;
    recorder.stop();
  }, [clearTimer, revokeAudioUrl, stopStreamTracks]);

  useEffect(() => {
    return () => {
      clearTimer();
      stopStreamTracks();
      if (mediaRecorderRef.current?.state === "recording") {
        discardOnStopRef.current = true;
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, [clearTimer, stopStreamTracks]);

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    audioBlob,
    audioUrl,
    isRecording,
    recordingTime,
  };
}
