'use client';

import { useEffect, useRef, useState } from 'react';
import type { Worker } from 'tesseract.js';
import { Button } from '@/components/ui/button';
import { CameraOff } from 'lucide-react';

type AssetTagCameraScannerProps = {
  active: boolean;
  onDetected: (value: string) => void;
  onClose: () => void;
};

function getCameraErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'The browser blocked camera access. Choose Allow if prompted. If no prompt appears, open this site’s browser permissions, set Camera to Allow, then tap Try again.';
  }
  if (error instanceof Error && error.name === 'NotFoundError') {
    return 'No camera was found on this device.';
  }
  return error instanceof Error
    ? `Could not start text scanning: ${error.message}`
    : 'Could not start text scanning.';
}

export function AssetTagCameraScanner({
  active,
  onDetected,
  onClose,
}: AssetTagCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [captureAttempt, setCaptureAttempt] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('Starting camera…');
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let stream: MediaStream | undefined;
    let worker: Worker | undefined;
    const video = videoRef.current;
    workerRef.current = null;
    setCameraError(null);
    setReadError(null);
    setCameraReady(false);
    setSecondsRemaining(null);
    setStatusMessage('Starting camera…');

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera scanning requires a secure HTTPS connection and a supported browser.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (disposed || !video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = stream;
        await video.play();
        if (disposed) return;

        setStatusMessage('Preparing on-device text recognition…');
        const { createWorker, PSM } = await import('tesseract.js');
        worker = await createWorker(
          'eng',
          1,
          {
            workerPath: '/ocr/worker.min.js',
            corePath: '/ocr',
            langPath: '/ocr/4.0.0_best_int',
            workerBlobURL: true,
            logger: ({ status }) => {
              if (!disposed) setStatusMessage(`Preparing text reader: ${status}…`);
            },
          }
        );
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        if (disposed) {
          await worker.terminate();
          return;
        }
        workerRef.current = worker;
        setStatusMessage('Keep the printed tag centered and steady.');
        setCameraReady(true);
      } catch (error) {
        if (!disposed) setCameraError(getCameraErrorMessage(error));
      }
    };

    void startScanner();
    return () => {
      disposed = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
      workerRef.current = null;
      if (worker) void worker.terminate();
    };
  }, [active, retryCount]);

  useEffect(() => {
    if (!active || !cameraReady) return;

    let disposed = false;
    let seconds = 3;
    setSecondsRemaining(seconds);
    const intervalId = window.setInterval(() => {
      seconds -= 1;
      setSecondsRemaining(seconds);
      if (seconds > 0) return;

      window.clearInterval(intervalId);
      const video = videoRef.current;
      const worker = workerRef.current;
      if (!video || !worker || video.videoWidth === 0 || video.videoHeight === 0) {
        setReadError('The camera image was not ready. Keep the tag visible and try again.');
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        setReadError('Could not capture the camera image. Try again.');
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setSecondsRemaining(null);
      setStatusMessage('Reading the captured image…');
      void worker
        .recognize(canvas)
        .then(({ data }) => {
          if (disposed) return;
          const text = data.text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join(' ');
          if (!text) {
            setReadError('No text was clear enough to read. Move closer, improve the lighting, and try again.');
            return;
          }
          onDetectedRef.current(text);
        })
        .catch((error: unknown) => {
          if (disposed) return;
          console.error('Could not recognize text in the camera image:', error);
          setReadError('Could not read the captured image. Keep the tag centered and try again.');
        });
    }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [active, cameraReady, captureAttempt]);

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
          <div className="relative overflow-hidden rounded-md bg-black">
            <video
              ref={videoRef}
              className="max-h-64 w-full object-contain"
              aria-label="Live camera view for reading printed asset tag text"
              autoPlay
              muted
              playsInline
            />
            {cameraReady && secondsRemaining !== null && (
              <div
                className="pointer-events-none absolute inset-x-[8%] top-1/2 h-16 -translate-y-1/2 rounded-md border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.2)]"
                aria-hidden="true"
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {readError
              ? readError
              : cameraReady && secondsRemaining !== null
                ? `Hold the tag in the guide and keep steady. Capturing in ${secondsRemaining} seconds…`
                : statusMessage}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {cameraError && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Try again
          </Button>
        )}
        {readError && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setReadError(null);
              setCaptureAttempt((attempt) => attempt + 1);
            }}
          >
            Capture again
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {cameraError ? 'Close' : 'Stop camera'}
        </Button>
      </div>
    </div>
  );
}
