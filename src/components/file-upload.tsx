"use client";

import { useState } from "react";
import { browserClient, FILE_BUCKET } from "@/lib/supabase/browser";

import type { UploadedFile } from "@/lib/uploads";

export type { UploadedFile };

let seq = 0;

// 파일을 고르면 바로 보관함에 올리고, 올린 목록을 숨은 칸(name)에 담아 양식과 함께 보냄
export function FileUpload({
  name,
  folder,
  accept = "application/pdf,image/png,image/jpeg,image/webp",
  multiple = true,
  hint,
  onBusyChange,
  onChange,
}: {
  name: string;
  folder: string;
  accept?: string;
  multiple?: boolean;
  hint?: string;
  onBusyChange?: (busy: boolean) => void;
  onChange?: (files: UploadedFile[]) => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (next: UploadedFile[]) => {
    setFiles(next);
    onChange?.(next);
  };

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setError("");
    setBusy(true);
    onBusyChange?.(true);
    const supabase = browserClient();
    const added: UploadedFile[] = [];
    const ym = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
    for (const file of Array.from(list)) {
      if (file.size > 20 * 1024 * 1024) {
        setError(`${file.name}: 20MB보다 큰 파일은 올릴 수 없습니다.`);
        continue;
      }
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${folder}/${ym}/${Date.now()}-${++seq}.${ext || "bin"}`;
      const { error: e } = await supabase.storage.from(FILE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (e) {
        setError(`${file.name}: 올리지 못했습니다 (${e.message})`);
        continue;
      }
      added.push({ path, name: file.name, type: file.type, size: file.size });
    }
    update(multiple ? [...files, ...added] : added.slice(-1));
    setBusy(false);
    onBusyChange?.(false);
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(files)} />
      <label className={`btn btn-ghost cursor-pointer ${busy ? "opacity-50" : ""}`}>
        {busy ? "올리는 중…" : "파일 선택"}
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
      {files.length > 0 && (
        <ul className="space-y-1 text-sm">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-2">
              <span className="chip chip-ok">올림</span>
              <span className="truncate">{f.name}</span>
              <button type="button" className="text-xs text-danger underline" onClick={() => update(files.filter((x) => x.path !== f.path))}>
                빼기
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
