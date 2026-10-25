'use client';

import { useEffect, useRef, useState } from 'react';
import type { Result } from '@zxing/library';
import type { IScannerControls } from '@zxing/browser';
import { Button } from '@/components/ui/button';
import { Camera, CameraOff } from 'lucide-react';

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
    ? `Could not start the camera: ${error.message}`
    : 'Could not start the camera.';
}

export function AssetTagCameraScanner({
  active,
  onDetected,
  onClose,
}: AssetTagCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let controls: IScannerControls | undefined;
    setCameraError(null);
    setCameraReady(false);

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera scanning requires a secure HTTPS connection and a supported browser.');
        return;
      }

      try {
        const [{ BrowserMultiFormatReader }, {
          BarcodeFormat,
          ChecksumException,
          FormatException,
          NotFoundException,
        }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (disposed || !videoRef.current) return;

        const reader = new BrowserMultiFormatReader();
        reader.possibleFormats = [
          BarcodeFormat.CODABAR,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_128,
          BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.EAN_8,
          BarcodeFormat.EAN_13,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ];

        const scannerControls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
            },
          },
          videoRef.current,
          (result: Result | undefined, error, callbackControls) => {
            if (disposed) return;
            if (result) {
              callbackControls.stop();
              onDetectedRef.current(result.getText());
              return;
            }
            if (
              error &&
              !(error instanceof NotFoundException) &&
              !(error instanceof ChecksumException) &&
              !(error instanceof FormatException)
            ) {
              callbackControls.stop();
              setCameraError(getCameraErrorMessage(error));
            }
          }
        );
        controls = scannerControls;
        if (disposed) {
          scannerControls.stop();
        } else {
          setCameraReady(true);
        }
      } catch (error) {
        if (!disposed) setCameraError(getCameraErrorMessage(error));
      }
    };

    void startScanner();
    return () => {
      disposed = true;
      controls?.stop();
    };
  }, [active, retryCount]);

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
          <video
            ref={videoRef}
            className="max-h-64 w-full rounded-md bg-black object-contain"
            aria-label="Live camera view for scanning an asset barcode"
            autoPlay
            muted
            playsInline
          />
          <p className="text-sm text-muted-foreground" role="status">
            {cameraReady
              ? 'Point the rear camera at the asset barcode or QR code.'
              : 'Starting camera…'}
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
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {cameraError ? 'Close' : 'Stop camera'}
        </Button>
      </div>
    </div>
  );
}
