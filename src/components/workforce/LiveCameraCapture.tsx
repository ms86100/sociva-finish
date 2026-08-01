// @ts-nocheck
import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, RotateCcw, Check } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';

interface LiveCameraCaptureProps {
  onCapture: (imageBlob: Blob) => void;
  capturedPreview?: string | null;
  onClear?: () => void;
}

export function LiveCameraCapture({ onCapture, capturedPreview, onClear }: LiveCameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const handleNativeCapture = useCallback(async () => {
    setIsCapturing(true);
    try {
      const { capturePhotoFromCamera } = await import('@/lib/native-media');
      const blob = await capturePhotoFromCamera();
      if (blob) onCapture(blob);
    } catch (err: any) {
      console.error('Native camera error:', err);
      const msg = err?.message || '';
      if (!msg.includes('cancel') && !msg.includes('Cancel')) {
        toast.error(msg.includes('permission') || msg.includes('Permission') ? msg : 'Failed to capture photo. Please try again.');
      }
    } finally {
      setIsCapturing(false);
    }
  }, [onCapture]);

  const startCamera = useCallback(async () => {
    // On native platforms, use the native camera plugin
    if (Capacitor.isNativePlatform()) {
      handleNativeCapture();
      return;
    }
    // Web fallback
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
      setStream(mediaStream);
      setIsStreaming(true);
    } catch (err) {
      console.error('Camera access denied:', err);
    }
  }, [handleNativeCapture]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [stream]);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
    setIsStreaming(false);
  }, [stream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (blob) onCapture(blob);
      stopCamera();
    }, 'image/jpeg', 0.85);
  }, [onCapture, stopCamera]);

  if (capturedPreview) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-border">
        <img src={capturedPreview} alt="Captured" className="w-full h-48 object-cover" />
        <div className="absolute bottom-2 right-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => { onClear?.(); startCamera(); }}>
            <RotateCcw size={14} className="mr-1" /> Retake
          </Button>
          <Button size="sm" variant="default" disabled>
            <Check size={14} className="mr-1" /> Captured
          </Button>
        </div>
      </div>
    );
  }

  if (isStreaming) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-border">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-48 object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={stopCamera}>Cancel</Button>
          <Button size="sm" onClick={capturePhoto}>
            <Camera size={14} className="mr-1" /> Capture
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startCamera}
      disabled={isCapturing}
      className="w-full h-48 rounded-xl border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors bg-muted/30"
    >
      <Camera size={32} className="text-muted-foreground" />
      <span className="text-sm text-muted-foreground">
        {isCapturing ? 'Opening camera...' : 'Tap to capture live photo'}
      </span>
      <span className="text-[10px] text-muted-foreground/70">Gallery upload not allowed</span>
    </button>
  );
}
