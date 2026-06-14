"use client";

/**
 * CameraSheet — reusable full-screen device-camera surface for BOTH:
 *   • mode="photo"  → live preview + shutter → returns a captured File
 *                     (onCapture). Used wherever the app previously only
 *                     accepted a gallery upload (AI image search, seller
 *                     product photos, OCR import…).
 *   • mode="scan"   → live QR / barcode reader via @zxing/browser
 *                     (works on iOS Safari too, unlike BarcodeDetector) →
 *                     returns the decoded text (onResult).
 *
 * Senior-grade robustness:
 *   • getUserMedia is requested with facingMode "environment" (rear cam);
 *     a front/back switch is offered when >1 camera exists.
 *   • Graceful fallback: if the live camera is unavailable or permission
 *     is denied, photo mode degrades to a native
 *     <input type="file" accept="image/*" capture="environment"> so the
 *     user can still take/pick a photo; scan mode shows a clear message.
 *   • All MediaStream tracks + the zxing reader are torn down on close /
 *     unmount (no camera-light-stays-on leak).
 *   • Captured frames are downscaled to ≤1600px and exported as JPEG to
 *     keep uploads small.
 *
 * The component NEVER uploads — it hands a File / decoded string back to
 * the caller, so each surface keeps its own (working, correctly-authed)
 * upload path. UI strings Mongolian; code English.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Camera, SwitchCamera, ImagePlus, Loader2, ScanLine, AlertTriangle } from "lucide-react";

type Mode = "photo" | "scan";

export default function CameraSheet({
  mode,
  title,
  onCapture,
  onResult,
  onClose,
}: {
  mode: Mode;
  title?: string;
  onCapture?: (file: File) => void;
  onResult?: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // zxing controls (IScannerControls) — kept untyped to avoid a hard type dep.
  const scanControlsRef = useRef<{ stop: () => void } | null>(null);
  const fileFallbackRef = useRef<HTMLInputElement | null>(null);

  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [multiCam, setMultiCam] = useState(false);

  const stopAll = useCallback(() => {
    try { scanControlsRef.current?.stop(); } catch { /* noop */ }
    scanControlsRef.current = null;
    const s = streamRef.current;
    if (s) { s.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } }); }
    streamRef.current = null;
  }, []);

  const close = useCallback(() => { stopAll(); onClose(); }, [stopAll, onClose]);

  // Start the camera (photo) or the zxing reader (scan) whenever facing changes.
  useEffect(() => {
    let cancelled = false;
    setReady(false); setErr("");

    async function startPhoto() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-getusermedia");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        try {
          const cams = (await navigator.mediaDevices.enumerateDevices())
            .filter((d) => d.kind === "videoinput");
          if (!cancelled) setMultiCam(cams.length > 1);
        } catch { /* enumerate may be blocked pre-permission */ }
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setErr("camera");
      }
    }

    async function startScan() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: facing } } },
          videoRef.current as HTMLVideoElement,
          (result) => {
            if (result) {
              const text = result.getText();
              if (text) { try { controls.stop(); } catch { /* noop */ } stopAll(); onResult?.(text); onClose(); }
            }
          },
        );
        if (cancelled) { try { controls.stop(); } catch { /* noop */ } return; }
        scanControlsRef.current = controls as unknown as { stop: () => void };
        // zxing owns the stream; grab it for cleanup + multi-cam detection.
        const ms = (videoRef.current?.srcObject as MediaStream) || null;
        streamRef.current = ms;
        try {
          const cams = (await navigator.mediaDevices.enumerateDevices())
            .filter((d) => d.kind === "videoinput");
          if (!cancelled) setMultiCam(cams.length > 1);
        } catch { /* noop */ }
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setErr("camera");
      }
    }

    if (mode === "scan") startScan(); else startPhoto();
    return () => { cancelled = true; stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, mode]);

  // Capture the current video frame → downscaled JPEG File.
  const snap = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    try {
      const maxW = 1600;
      const scale = Math.min(1, maxW / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { setBusy(false); return; }
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
          stopAll();
          onCapture?.(file);
          onClose();
        }
        setBusy(false);
      }, "image/jpeg", 0.85);
    } catch {
      setBusy(false);
      setErr("camera");
    }
  }, [onCapture, onClose, stopAll]);

  const onFallbackFile = (file: File | null) => {
    if (file) { onCapture?.(file); }
    onClose();
  };

  const heading = title || (mode === "scan" ? "QR / баркод уншуулах" : "Камераар зураг авах");

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 h-14 text-white shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <span className="text-[15px] font-semibold flex items-center gap-2">
          {mode === "scan" ? <ScanLine size={18} /> : <Camera size={18} />} {heading}
        </span>
        <button onClick={close} aria-label="Хаах"
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 cursor-pointer border-none text-white">
          <X size={20} />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex-1 overflow-hidden flex items-center justify-center">
        {err === "camera" ? (
          <div className="text-center px-6 max-w-sm">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle size={26} className="text-amber-400" />
            </div>
            <p className="text-white text-[14px] font-medium mb-1">Камер нээгдсэнгүй</p>
            <p className="text-white/70 text-[12px] mb-4">
              {mode === "scan"
                ? "Камерын зөвшөөрөл олгоогүй эсвэл төхөөрөмж дэмжихгүй байна. Та зургаа галерейгээс сонгож болно."
                : "Камерын зөвшөөрөл олгоогүй байна. Доорхоос зураг авах/сонгох боломжтой."}
            </p>
            <label className="inline-flex items-center gap-2 bg-white text-gray-900 rounded-xl px-4 py-2.5 text-[13px] font-semibold cursor-pointer">
              <ImagePlus size={15} /> Зураг сонгох / авах
              <input ref={fileFallbackRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => onFallbackFile(e.target.files?.[0] || null)} />
            </label>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay
              className="w-full h-full object-cover" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 size={26} className="text-white animate-spin" />
              </div>
            )}
            {mode === "scan" && ready && (
              // Reticle to aim the code.
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-60 h-60 max-w-[70vw] max-h-[70vw] border-2 border-white/90 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              </div>
            )}
          </>
        )}
      </div>

      {/* Controls */}
      {err !== "camera" && (
        <div className="shrink-0 px-6 pb-6 pt-3 flex items-center justify-center gap-8"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}>
          {multiCam ? (
            <button onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
              aria-label="Камер солих"
              className="w-12 h-12 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 cursor-pointer border-none text-white">
              <SwitchCamera size={20} />
            </button>
          ) : <span className="w-12" />}

          {mode === "photo" ? (
            <button onClick={snap} disabled={!ready || busy} aria-label="Зураг авах"
              className="w-18 h-18 w-[72px] h-[72px] rounded-full bg-white border-4 border-white/40 disabled:opacity-50 cursor-pointer flex items-center justify-center">
              {busy ? <Loader2 size={26} className="animate-spin text-gray-700" /> : <span className="w-14 h-14 rounded-full bg-white ring-2 ring-gray-900/10" />}
            </button>
          ) : (
            <span className="text-white/80 text-[13px] text-center">Кодыг хүрээнд багтаана уу</span>
          )}

          <label className="w-12 h-12 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 cursor-pointer text-white" aria-label="Галерейгээс">
            <ImagePlus size={20} />
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => onFallbackFile(e.target.files?.[0] || null)} />
          </label>
        </div>
      )}
    </div>
  );
}
