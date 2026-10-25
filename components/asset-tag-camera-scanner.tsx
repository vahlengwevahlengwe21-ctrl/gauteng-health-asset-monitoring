'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { CameraOff, Loader2 } from 'lucide-react';

type AssetTagCameraScannerProps = {
  active: boolean;
  onDetected: (value: string) => void;
  onClose: () => void;
};

const MAX_CAPTURE_WIDTH = 1600;
const OCR_TIMEOUT_MS = 12_000;

function getCameraErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'The browser blocked camera access. Choose Allow if prompted. If no prompt appears, open this site’s browser permissions, set Camera to Allow, then tap Try again.';
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    return 'No camera was found on this device.';
  }
  return error instanceof Error
    ? `Could not start the camera: ${error.message}`
    : 'Could not start the camera.';
}

function capturePhoto(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error('The camera image is not ready. Try again.'));
  }

  const scale = Math.min(1, MAX_CAPTURE_WIDTH / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.reject(new Error('Could not capture the camera image. Try again.'));
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not capture the camera image. Try again.'));
      },
      'image/jpeg',
      0.88
    );
  });
}

export function AssetTagCameraScanner({
  active,
  onDetected,
  onClose,
}: AssetTagCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let stream: MediaStream | undefined;
    const video = videoRef.current;
    setCameraError(null);
    setAnalysisError(null);
    setCameraReady(false);
    setAnalyzing(false);
    setCapturedPhotoUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return null;
    });

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera capture requires a secure HTTPS connection and a supported browser.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (disposed || !video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        if (!disposed) setCameraReady(true);
      } catch (error) {
        if (!disposed) setCameraError(getCameraErrorMessage(error));
      }
    };

    void startCamera();
    return () => {
      disposed = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (video) video.srcObject = null;
    };
  }, [active, retryCount]);

  useEffect(
    () => () => {
      if (capturedPhotoUrl) URL.revokeObjectURL(capturedPhotoUrl);
    },
    [capturedPhotoUrl]
  );

  const analyzePhoto = async () => {
    const video = videoRef.current;
    if (!video || analyzing) return;

    setAnalysisError(null);
    setAnalyzing(true);
    try {
      const photo = await capturePhoto(video);
      const photoUrl = URL.createObjectURL(photo);
      setCapturedPhotoUrl((previousUrl) => {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return photoUrl;
      });

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      video.srcObject = null;
      setCameraReady(false);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch('/api/asset-tag-ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: photo,
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const result = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Could not read the text in this photo.');
      }
      const text = result.text?.trim();
      if (!text) {
        throw new Error('No clear text was found. Retake the photo closer to the label.');
      }
      onDetectedRef.current(text);
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'Text analysis took too long. Try a closer, clearer photo.'
          : error instanceof Error
            ? error.message
            : 'Could not read the text in this photo.';
      setAnalysisError(message);
    } finally {
      setAnalyzing(false);
    }
  };

  const retryCamera = () => {
    setAnalysisError(null);
    setCapturedPhotoUrl(null);
    setRetryCount((count) => count + 1);
  };

  if (!active) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      {cameraError ? (
        <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <CameraOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{cameraError}</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-md bg-black">
            {capturedPhotoUrl ? (
              <div className="relative h-64 w-full">
                <Image
                  src={capturedPhotoUrl}
                  alt="Captured image awaiting text analysis"
                  fill
                  unoptimized
                  className="object-contain"
                />
              </div>
            ) : (
              <video
                ref={videoRef}
                className="max-h-64 w-full object-contain"
                aria-label="Live camera view for photographing printed text"
                autoPlay
                muted
                playsInline
              />
            )}
          </div>
          <p
            className="text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {analyzing
              ? 'Analyzing the photo… It is processed for text only and is not saved in the app.'
              : analysisError ||
                (capturedPhotoUrl
                  ? 'Photo captured. Try again with a clearer image if needed.'
                  : cameraReady
                    ? 'Center the printed text, then take a photo.'
                    : 'Starting camera…')}
          </p>
          {!analyzing && cameraReady && (
            <p className="text-xs text-muted-foreground">
              The photo is sent to the AI reader for text analysis and is not saved by the app.
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {cameraError && (
          <Button type="button" variant="outline" size="sm" onClick={retryCamera}>
            Try again
          </Button>
        )}
        {!cameraError && cameraReady && (
          <Button
            type="button"
            size="sm"
            onClick={() => void analyzePhoto()}
            disabled={analyzing}
          >
            {analyzing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {analyzing ? 'Analyzing…' : 'Take photo & read text'}
          </Button>
        )}
        {!cameraError && (analysisError || capturedPhotoUrl) && !cameraReady && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retryCamera}
            disabled={analyzing}
          >
            Retake photo
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {cameraError ? 'Close' : 'Stop camera'}
        </Button>
      </div>
    </div>
  );
}
