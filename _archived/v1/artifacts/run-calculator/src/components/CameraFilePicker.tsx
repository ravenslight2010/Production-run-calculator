import { useEffect, useRef, useState } from "react";
import { Camera, QrCode, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function cameraSupportMessage(): string | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) return "Camera access needs a secure connection (HTTPS). You can still upload a photo.";
  if (!navigator.mediaDevices?.getUserMedia) return "This browser does not provide camera access. You can still upload a photo.";
  return null;
}

export function CameraFilePicker({
  accept = "image/*",
  multiple = false,
  disabled = false,
  onFiles,
}: {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);

  const pick = (input: HTMLInputElement, camera: boolean) => {
    if (camera) {
      const message = cameraSupportMessage();
      if (message) {
        setCameraMessage(message);
        return;
      }
    }
    input.click();
  };
  const changed = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    const bad = files.find((file) => !file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
    if (bad) {
      setCameraMessage(`"${bad.name}" is not an image. Choose a JPEG, PNG, or WebP photo.`);
      input.value = "";
      return;
    }
    onFiles(files);
    input.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 text-sm"
          disabled={disabled}
          onClick={() => pick(cameraRef.current!, true)}
          aria-label="Take photo with camera"
        >
          <Camera className="w-4 h-4" /> Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 text-sm"
          disabled={disabled}
          onClick={() => pick(uploadRef.current!, false)}
          aria-label="Upload photo"
        >
          <Upload className="w-4 h-4" /> Upload {multiple ? "photos" : "photo"}
        </Button>
      </div>
      <input ref={cameraRef} type="file" accept={accept} multiple={multiple} capture="environment" className="hidden" onChange={(e) => changed(e.currentTarget)} />
      <input ref={uploadRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => changed(e.currentTarget)} />
      {cameraMessage && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300" role="status">
          <span>{cameraMessage}</span>
          <button type="button" className="shrink-0" aria-label="Dismiss camera message" onClick={() => setCameraMessage(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function BarcodeScanner({
  onDetected,
  disabled = false,
}: {
  onDetected: (value: string) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setOpen(false);
  };
  useEffect(() => () => stop(), []);

  async function start() {
    const unsupported = cameraSupportMessage();
    if (unsupported) {
      setStatus(`${unsupported} Enter the barcode manually or use a still photo.`);
      return;
    }
    if (!("BarcodeDetector" in window)) {
      setStatus("Live barcode scanning is not supported in this browser. Enter the code manually or use a still photo.");
      return;
    }
    try {
      const Detector = (window as Window & { BarcodeDetector: new (opts?: { formats?: string[] }) => { detect(video: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
      const detector = new Detector({ formats: ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "data_matrix"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setOpen(true);
      setStatus("Point the rear camera at a QR code or barcode.");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      let active = true;
      const scan = async () => {
        if (!active || !streamRef.current) return;
        try {
          const found = await detector.detect(video);
          const value = found.find((item) => item.rawValue?.trim())?.rawValue?.trim();
          if (value) {
            active = false;
            onDetected(value);
            stop();
            return;
          }
        } catch {
          // Keep the preview alive; a frame can be unreadable while orientation changes.
        }
        requestAnimationFrame(scan);
      };
      void scan();
    } catch (error) {
      stop();
      setStatus(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Camera permission was denied. Enter the barcode manually or use a still photo."
        : "The camera is unavailable. Check that no other app is using it, then try again or use a still photo.");
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => (open ? stop() : void start())}>
        <QrCode className="w-3.5 h-3.5" /> {open ? "Stop scanner" : "Scan QR/barcode"}
      </Button>
      {open && <video ref={videoRef} muted playsInline className="w-full max-h-48 rounded-md bg-black object-contain" aria-label="Live barcode camera preview" />}
      {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}
      <div className="flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Enter barcode manually"
          aria-label="Barcode value"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 text-xs"
        />
        <Button type="button" size="sm" className="h-8 text-xs" disabled={!manual.trim()} onClick={() => { onDetected(manual.trim()); setManual(""); }}>
          Use code
        </Button>
      </div>
    </div>
  );
}