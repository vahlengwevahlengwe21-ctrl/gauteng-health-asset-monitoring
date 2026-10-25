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

type OCRCandidate = {
  text: string;
  confidence: number;
};

function createOCRCanvases(video: HTMLVideoElement): HTMLCanvasElement[] {
  const cropWidth = video.videoWidth * 0.9;
  const cropHeight = video.videoHeight * 0.5;
  const sourceX = (video.videoWidth - cropWidth) / 2;
  const sourceY = (video.videoHeight - cropHeight) / 2;
  const width = Math.min(Math.round(cropWidth * 2), 2400);
  const height = Math.round((width / cropWidth) * cropHeight);
  const canvases = [document.createElement('canvas'), document.createElement('canvas')];

  for (const canvas of canvases) {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the camera image for text recognition.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      video,
      sourceX,
      sourceY,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height
    );
  }

  const enhancedContext = canvases[1].getContext('2d');
  if (!enhancedContext) throw new Error('Could not enhance the camera image.');
  const image = enhancedContext.getImageData(0, 0, width, height);
  const histogram = new Array<number>(256).fill(0);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = Math.round(
      image.data[index] * 0.299 +
        image.data[index + 1] * 0.587 +
        image.data[index + 2] * 0.114
    );
    image.data[index] = gray;
    image.data[index + 1] = gray;
    image.data[index + 2] = gray;
    histogram[gray] += 1;
  }

  const pixelCount = width * height;
  let weightedTotal = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    weightedTotal += value * histogram[value];
  }
  let backgroundWeight = 0;
  let backgroundTotal = 0;
  let threshold = 160;
  let bestVariance = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = pixelCount - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundTotal += value * histogram[value];
    const backgroundMean = backgroundTotal / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundTotal) / foregroundWeight;
    const variance =
      backgroundWeight *
      foregroundWeight *
      (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }

  for (let index = 0; index < image.data.length; index += 4) {
    const gray = image.data[index];
    const enhanced = gray < threshold ? 0 : 255;
    image.data[index] = enhanced;
    image.data[index + 1] = enhanced;
    image.data[index + 2] = enhanced;
  }
  enhancedContext.putImageData(image, 0, 0);

  return canvases;
}

function normalizeOCRText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getCameraErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'OCRTimeoutError') {
    return 'The text reader took too long to start on this device. Close other camera apps, check your connection, and tap Try again.';
  }
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
  const [preparationSeconds, setPreparationSeconds] = useState(0);

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
    setPreparationSeconds(0);
    setStatusMessage('Starting camera…');

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera scanning requires a secure HTTPS connection and a supported browser.');
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

        video.srcObject = stream;
        await video.play();
        if (disposed) return;

        setStatusMessage('Preparing on-device text recognition…');
        const { createWorker, PSM } = await import('tesseract.js');
        let initializationTimedOut = false;
        let initializationTimeoutId: number | undefined;
        let rejectWorkerFailure: (error: unknown) => void = () => {};
        const workerFailure = new Promise<never>((_, reject) => {
          rejectWorkerFailure = reject;
        });
        const workerInitialization = (async () => {
          const initializedWorker = await createWorker('eng', 1, {
            workerPath: '/ocr/worker.min.js',
            corePath: '/ocr/tesseract-core-lstm.wasm.js',
            langPath: '/ocr/4.0.0_best_int',
            workerBlobURL: false,
            logger: ({ status, progress }) => {
              if (disposed) return;
              const phase =
                status === 'loading tesseract core'
                  ? 'Loading the OCR engine'
                  : status === 'loading language traineddata'
                    ? 'Loading the English text model'
                    : status === 'initializing api'
                      ? 'Starting the OCR reader'
                      : 'Preparing the OCR reader';
              const percent = Number.isFinite(progress)
                ? ` (${Math.round(progress * 100)}%)`
                : '';
              setStatusMessage(`${phase}${percent}…`);
            },
            errorHandler: (error: unknown) => {
              console.error('OCR worker failed during initialization:', error);
              rejectWorkerFailure(
                error instanceof Error ? error : new Error(String(error))
              );
            },
          });
          if (disposed || initializationTimedOut) {
            await initializedWorker.terminate();
            throw new Error('OCR initialization was interrupted.');
          }
          await initializedWorker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
          if (disposed || initializationTimedOut) {
            await initializedWorker.terminate();
            throw new Error('OCR initialization was interrupted.');
          }
          return initializedWorker;
        })();
        const initializationTimeout = new Promise<never>((_, reject) => {
          initializationTimeoutId = window.setTimeout(() => {
            initializationTimedOut = true;
            const error = new Error('Text reader initialization timed out.');
            error.name = 'OCRTimeoutError';
            reject(error);
          }, 45_000);
        });
        try {
          worker = await Promise.race([
            workerInitialization,
            initializationTimeout,
            workerFailure,
          ]);
        } finally {
          if (initializationTimeoutId !== undefined) {
            window.clearTimeout(initializationTimeoutId);
          }
        }
        if (disposed) {
          await worker.terminate();
          return;
        }
        workerRef.current = worker;
        setStatusMessage('Keep the printed tag centered and steady.');
        setCameraReady(true);
      } catch (error) {
        if (!disposed) {
          setCameraError(getCameraErrorMessage(error));
        }
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
    if (!active || cameraReady || cameraError) return;

    const intervalId = window.setInterval(
      () => setPreparationSeconds((seconds) => seconds + 1),
      1000
    );
    return () => window.clearInterval(intervalId);
  }, [active, cameraError, cameraReady]);

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

      setSecondsRemaining(null);
      setStatusMessage('Capturing several frames and improving clarity…');
      void (async () => {
        const candidates: OCRCandidate[] = [];
        try {
          for (let frame = 0; frame < 3; frame += 1) {
            if (disposed) return;
            const canvases = createOCRCanvases(video);
            for (const canvas of canvases) {
              const { data } = await worker.recognize(canvas);
              const text = normalizeOCRText(data.text);
              if (text) candidates.push({ text, confidence: data.confidence });
            }
            if (frame < 2) {
              await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
          }

          if (disposed) return;
          if (candidates.length === 0) {
            setReadError('No text was clear enough to read. Move closer, improve the lighting, and try again.');
            return;
          }

          const grouped = new Map<string, OCRCandidate[]>();
          for (const candidate of candidates) {
            const key = candidate.text.toLocaleUpperCase();
            grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
          }
          const bestGroup = Array.from(grouped.values()).sort((left, right) => {
            if (left.length !== right.length) return right.length - left.length;
            const leftConfidence =
              left.reduce((sum, candidate) => sum + candidate.confidence, 0) / left.length;
            const rightConfidence =
              right.reduce((sum, candidate) => sum + candidate.confidence, 0) / right.length;
            return rightConfidence - leftConfidence;
          })[0];
          const bestCandidate = bestGroup.reduce((best, candidate) =>
            candidate.confidence > best.confidence ? candidate : best
          );
          onDetectedRef.current(bestCandidate.text);
        } catch (error: unknown) {
          if (disposed) return;
          console.error('Could not recognize text in the camera image:', error);
          setReadError('Could not read the captured image. Keep the tag centered and try again.');
        }
      })();
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
                : !cameraReady && preparationSeconds >= 15
                  ? `${statusMessage} This may take a little longer on this phone.`
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
