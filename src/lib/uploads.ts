// 화면에서 올린 파일 목록(숨은 칸의 JSON)을 서버에서 안전하게 읽기
export type UploadedFile = { path: string; name: string; type: string; size: number };

export function parseUploaded(raw: FormDataEntryValue | null, folder: string): UploadedFile[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(v)) return [];
    const re = new RegExp(`^${folder.replace(/[/]/g, "\\/")}\\/\\d{4}-\\d{2}\\/[\\w.-]+$`);
    return v
      .filter((f) => f && typeof f.path === "string" && re.test(f.path) && typeof f.name === "string")
      .map((f) => ({ path: f.path, name: String(f.name).slice(0, 200), type: String(f.type ?? ""), size: Number(f.size) || 0 }));
  } catch {
    return [];
  }
}
