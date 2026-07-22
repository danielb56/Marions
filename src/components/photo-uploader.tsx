"use client";

import { useEffect, useState } from "react";
import { Camera, CheckCircle2, CloudOff, LoaderCircle } from "lucide-react";
import { enqueuePhoto, flushPhotoQueue } from "@/lib/offline-queue";

async function resize(file: File, max: number, quality: number) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d", { alpha: false })!.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not process image")), "image/jpeg", quality));
  return { blob, width, height };
}

export function PhotoUploader({ submissionId }: { submissionId: number }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const flush = () => void flushPhotoQueue(setStatus).then((count) => count && setStatus(`${count} queued photo${count === 1 ? "" : "s"} sent.`)).catch(() => setStatus("Upload will retry when the connection improves.")); window.addEventListener("online", flush); flush(); return () => window.removeEventListener("online", flush); }, []);
  const choose = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    try {
      let index = 0;
      for (const file of Array.from(files).slice(0, 20)) {
        index += 1; setStatus(`Preparing ${index} of ${files.length}...`);
        const full = await resize(file, 1920, .82); const thumb = await resize(file, 480, .72);
        await enqueuePhoto({ id: crypto.randomUUID(), submissionId, blob: full.blob, thumbnail: thumb.blob, width: full.width, height: full.height, createdAt: new Date().toISOString() });
      }
      if (navigator.onLine) { const count = await flushPhotoQueue(setStatus); setStatus(`${count} photo${count === 1 ? "" : "s"} uploaded.`); } else setStatus("Saved on this device. Photos will send when you are online.");
    } catch { setStatus("Photos are saved on this device and will retry."); } finally { setBusy(false); }
  };
  return <div className="rounded-2xl border border-[#d9d4c9] bg-white p-4"><label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#003f70] px-4 font-semibold text-white"><Camera className="h-5 w-5" />Add completion photos<input className="sr-only" type="file" accept="image/*" capture="environment" multiple onChange={(event) => void choose(event.target.files)} disabled={busy} /></label>{status && <p className="mt-3 flex items-center gap-2 text-sm text-[#66716e]">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : navigator.onLine ? <CheckCircle2 className="h-4 w-4 text-[#2f6249]" /> : <CloudOff className="h-4 w-4 text-[#9a6324]" />}{status}</p>}<p className="mt-2 text-xs leading-5 text-[#7b8582]">Photos are resized and re-encoded before upload, removing location metadata. Failed uploads queue on this device.</p></div>;
}
