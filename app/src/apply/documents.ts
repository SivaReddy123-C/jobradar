import type { ResumeAsset } from "../../../shared/candidate.js";
const DB = "jobradar-documents-v1";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try { return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction("files", mode), req = action(tx.objectStore("files"));
    tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("Document save interrupted"));
  }); } finally { db.close(); }
}
export const getDocument = (id: string) => transact<Blob | undefined>("readonly", s => s.get(id));
export const deleteDocument = (id: string) => transact("readwrite", s => s.delete(id));
export async function saveDocument(file: File): Promise<ResumeAsset> {
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error("Choose a PDF or DOCX smaller than 2 MB.");
  const mime = /\.pdf$/i.test(file.name) ? "application/pdf" : /\.docx$/i.test(file.name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "";
  if (!mime) throw new Error("PDF and DOCX are supported.");
  const bytes = await file.arrayBuffer(), head = new Uint8Array(bytes.slice(0, 5));
  if (mime === "application/pdf" ? new TextDecoder().decode(head) !== "%PDF-" : head[0] !== 80 || head[1] !== 75) throw new Error("The file contents do not match its PDF/DOCX extension.");
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  const asset = { id: sha256, sha256, name: file.name, mime, size: file.size, createdAt: new Date().toISOString() };
  await transact("readwrite", s => s.put(new Blob([bytes], { type: mime }), sha256));
  return asset;
}
export async function documentBase64(id: string): Promise<string> {
  const blob = await getDocument(id);
  if (!blob) throw new Error("The selected résumé is missing on this device. Upload it again.");
  return await new Promise<string>((resolve, reject) => { const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
}
export async function downloadDocument(asset: ResumeAsset) {
  const file = await getDocument(asset.id); if (!file) throw new Error("Document not available on this device.");
  const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = asset.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
