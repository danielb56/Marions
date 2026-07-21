"use client";

type QueuedPhoto = { id: string; submissionId: number; blob: Blob; thumbnail: Blob; width: number; height: number; createdAt: string };
const DB_NAME = "marion-worker-queue";
const STORE = "photos";

function openQueue() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueuePhoto(photo: QueuedPhoto) {
  const db = await openQueue();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(photo); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}

async function queuedPhotos() {
  const db = await openQueue();
  const rows = await new Promise<QueuedPhoto[]>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close(); return rows;
}

async function removePhoto(id: string) {
  const db = await openQueue();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}

async function putWithRetry(url: string, body: Blob) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body }); if (!response.ok) throw new Error(`Upload failed (${response.status})`); return; }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt)); }
  }
  throw lastError;
}

export async function flushPhotoQueue(onProgress?: (message: string) => void) {
  if (!navigator.onLine) return 0;
  const photos = await queuedPhotos();
  let uploaded = 0;
  for (const photo of photos) {
    onProgress?.(`Uploading ${uploaded + 1} of ${photos.length}...`);
    const presign = await fetch("/api/photos/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId: photo.submissionId, contentType: "image/jpeg", size: photo.blob.size, width: photo.width, height: photo.height }) });
    if (!presign.ok) throw new Error("Could not prepare photo upload");
    const details = await presign.json() as { uploadUrl: string; thumbnailUploadUrl: string; storageKey: string; thumbnailKey: string };
    await putWithRetry(details.uploadUrl, photo.blob);
    await putWithRetry(details.thumbnailUploadUrl, photo.thumbnail);
    const completed = await fetch("/api/photos/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId: photo.submissionId, storageKey: details.storageKey, thumbnailKey: details.thumbnailKey, contentType: "image/jpeg", size: photo.blob.size, width: photo.width, height: photo.height }) });
    if (!completed.ok) throw new Error("Could not record uploaded photo");
    await removePhoto(photo.id); uploaded += 1;
  }
  return uploaded;
}
