import { PasswordForm } from "./form";

export default function Account() {
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">비밀번호 변경</h1>
      <section className="glass p-5"><PasswordForm /></section>
    </div>
  );
}
