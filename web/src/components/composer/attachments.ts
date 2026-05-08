export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  base64: string;
  dataUrl: string;
};

export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export function fileToBase64(file: File): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
      resolve({ base64, dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

export type ProcessFilesResult = {
  accepted: Omit<Attachment, 'id'>[];
  error: string | null;
};

export async function processAttachmentFiles(files: File[]): Promise<ProcessFilesResult> {
  const accepted: Omit<Attachment, 'id'>[] = [];
  let error: string | null = null;
  for (const f of files) {
    if (!SUPPORTED_IMAGE_TYPES.has(f.type)) {
      error = `unsupported file type: ${f.type || f.name}`;
      continue;
    }
    if (f.size > MAX_ATTACHMENT_BYTES) {
      error = `${f.name} is too large (max ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)}MB)`;
      continue;
    }
    try {
      const { base64, dataUrl } = await fileToBase64(f);
      accepted.push({
        name: f.name || 'image',
        mediaType: f.type,
        base64,
        dataUrl,
      });
    } catch {
      error = `failed to read ${f.name}`;
    }
  }
  return { accepted, error };
}
