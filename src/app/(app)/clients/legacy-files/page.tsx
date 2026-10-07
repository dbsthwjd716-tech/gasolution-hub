import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { copyLegacyFiles } from "./actions";
import { legacyPaths } from "./data";
import { CopyForm } from "./form";

export default async function LegacyFiles() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">대표·팀장만 볼 수 있습니다.</p>;
  const list = await legacyPaths(supabase);
  return (
    <div className="space-y-4">
      <Link href="/clients" className="text-sm text-ink-soft hover:text-brand">← 거래처</Link>
      <header>
        <h1 className="text-2xl font-bold">예전 정산·계약 파일 옮기기</h1>
        <p className="text-sm text-ink-soft">사업자등록증·광고비 증빙·서명된 계약서·계약서 양식을 예전 정산 시스템에서 통합 시스템 보관함으로 복사합니다. 여러 번 눌러도 이미 있는 파일은 건너뜁니다.</p>
      </header>
      <section className="glass space-y-3 p-5">
        <p className="text-sm">옮길 파일 {list.length}개</p>
        <CopyForm action={copyLegacyFiles} />
      </section>
    </div>
  );
}
