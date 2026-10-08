import { getMe } from "@/lib/supabase/server";
import { StaffDocsPanel } from "../staff/docs-panel";
import { PasswordForm } from "./form";

// 내 계정: 비밀번호 변경 + 내 서류
export default async function Account() {
  const { supabase, me, preview } = await getMe();
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">내 계정</h1>
      <section className="glass max-w-md p-5">
        <h2 className="mb-3 text-sm font-bold">비밀번호 변경</h2>
        <PasswordForm />
      </section>
      {me && !preview && (
        <>
          <h2 className="pt-2 text-lg font-bold">내 서류</h2>
          <StaffDocsPanel supabase={supabase} staffId={me.id} active manager={me.role !== "staff"} self />
        </>
      )}
    </div>
  );
}
