import Link from "next/link";
import { loadDupCandidates } from "@/lib/leads-data";
import { getMe } from "@/lib/supabase/server";
import { createLead } from "../actions";
import { LeadForm } from "../forms";

export default async function NewLeadPage() {
  const { supabase, me } = await getMe();
  const [candidates, { data: staff }] = await Promise.all([
    loadDupCandidates(supabase),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
  ]);
  return (
    <div className="space-y-4">
      <Link href="/leads" className="text-sm text-ink-soft hover:text-brand">← 인입 문의</Link>
      <div className="glass max-w-4xl p-6">
        <h1 className="text-xl font-bold">문의 등록</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">같은 연락처나 업체명이 이미 있으면 바로 알려 줍니다. 등록 후 상세 화면에서 담당에게 보낼 전달 문구를 복사할 수 있습니다.</p>
        <LeadForm action={createLead} submitLabel="등록" isNew staff={staff ?? []} canAssign={me?.role !== "staff"} candidates={candidates} selfId={me?.id} />
      </div>
    </div>
  );
}
