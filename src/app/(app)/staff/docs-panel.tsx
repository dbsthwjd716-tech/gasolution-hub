import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC_KINDS, DOC_LABEL, missingDocs, type DocKind } from "@/lib/staff-docs";
import { ConfirmSubmit } from "../billing/panel";
import { addStaffDocs, removeStaffDoc } from "./doc-actions";
import { DocUploadForm } from "./doc-forms";

type Doc = { id: string; kind: DocKind; title: string | null; issued_on: string | null; file_name: string; file_size: number | null; note: string | null; created_at: string; uploader: { name: string } | null };
type View = { viewed_at: string; viewer: { name: string } | null; document_id: string };

const size = (n: number | null) => (n == null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const day = (v: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date(v));
const time = (v: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(v));

// 직원 서류함 (직원 관리 상세 · 내 계정에서 함께 씀)
export async function StaffDocsPanel({ supabase, staffId, active, manager, self }: { supabase: SupabaseClient; staffId: string; active: boolean; manager: boolean; self: boolean }) {
  const [{ data: docs }, { data: views }] = await Promise.all([
    supabase.from("staff_documents").select("id,kind,title,issued_on,file_name,file_size,note,created_at,uploader:uploaded_by(name)").eq("staff_id", staffId).order("created_at", { ascending: false }).returns<Doc[]>(),
    manager
      ? supabase.from("staff_document_views").select("viewed_at,document_id,viewer:viewed_by(name),doc:staff_documents!inner(staff_id)").eq("doc.staff_id", staffId).order("viewed_at", { ascending: false }).limit(20).returns<View[]>()
      : Promise.resolve({ data: [] as View[] }),
  ]);
  const list = docs ?? [];
  const missing = missingDocs(list.map((d) => d.kind), active);
  const byKind = DOC_KINDS.map((k) => ({ ...k, docs: list.filter((d) => d.kind === k.key) })).filter((k) => k.docs.length);
  const docName = new Map(list.map((d) => [d.id, `${DOC_LABEL[d.kind]}${d.title ? ` · ${d.title}` : ""}`]));

  return (
    <div className="space-y-4">
      <section className="glass p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold">서류함</h2>
          {missing.length ? (
            missing.map((k) => <span key={k} className="chip chip-warn">{DOC_LABEL[k]} 없음</span>)
          ) : (
            <span className="chip chip-ok">필수 서류 모두 있음</span>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-soft">대표·팀장과 {self ? "본인" : "해당 직원 본인"}만 볼 수 있고, 열 때마다 열람 기록이 남습니다.{manager ? "" : " 잘못 올린 서류는 팀장에게 삭제를 요청해 주세요."}</p>

        {byKind.length ? (
          <div className="mt-3 space-y-3">
            {byKind.map((k) => (
              <div key={k.key}>
                <p className="text-xs font-semibold text-ink-soft">{k.label}</p>
                <ul className="mt-1 divide-y divide-[#edf1f7] rounded-lg border border-[#edf1f7] bg-white/60">
                  {k.docs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <a href={`/staff/docs/${d.id}`} target="_blank" rel="noopener" className="font-semibold text-brand hover:underline">{d.title || d.file_name}</a>
                        <span className="block text-[11px] text-ink-soft">
                          {d.title ? `${d.file_name} · ` : ""}{size(d.file_size)}{d.issued_on ? ` · ${d.issued_on}` : ""} · {day(d.created_at)} {d.uploader?.name ?? ""} 올림{d.note ? ` · ${d.note}` : ""}
                        </span>
                      </span>
                      {manager && <ConfirmSubmit action={removeStaffDoc.bind(null, d.id)} label="삭제" confirmText={`${d.file_name} 서류를 지울까요? 파일도 함께 지워집니다.`} />}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">아직 올린 서류가 없습니다.</p>
        )}
      </section>

      <section className="glass p-5">
        <h2 className="mb-3 text-sm font-bold">서류 올리기</h2>
        <DocUploadForm action={addStaffDocs.bind(null, staffId)} staffId={staffId} defaultKind={missing[0] ?? "certificate"} />
      </section>

      {manager && (views ?? []).length > 0 && (
        <section className="glass p-5">
          <details>
            <summary className="cursor-pointer text-sm font-bold">열람 기록 (최근 20건)</summary>
            <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
              {(views ?? []).map((v, i) => (
                <li key={i}>{time(v.viewed_at)} · {v.viewer?.name ?? "-"} · {docName.get(v.document_id) ?? "지운 서류"}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
