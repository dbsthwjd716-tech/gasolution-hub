// 시험용 데이터베이스: 실제 Postgres(PGlite)에 Supabase 흉내(auth 스키마, 역할)를 만들고 모든 migration을 적용
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const U = {
  ceo: '00000000-0000-0000-0000-00000000000a',
  lead: '00000000-0000-0000-0000-00000000000b',
  kim: '00000000-0000-0000-0000-00000000000c',
  lee: '00000000-0000-0000-0000-00000000000d',
};

export async function setup() {
  const { PGlite } = await import(process.env.PGLITE_PATH ?? '@electric-sql/pglite');
  const here = dirname(fileURLToPath(import.meta.url));
  const migDir = join(here, '..', 'migrations');
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    -- 로그인 계정 만들기용 (실제 Supabase의 pgcrypto 흉내)
    create schema extensions;
    create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select decode(repeat('ab', $1), 'hex') $$;
    create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
    create function extensions.crypt(text, text) returns text language sql as $$ select md5($1 || $2) $$;
    -- 금고(vault)·pg_net 흉내
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
    create function vault.create_secret(secret text, name text default null, description text default '') returns uuid language sql as $$ insert into vault.secrets(secret, name, description) values ($1, $2, $3) returning id $$;
    create function vault.update_secret(id uuid, secret text default null, name text default null, description text default null) returns void language sql as $$ update vault.secrets set secret = coalesce($2, secret) where vault.secrets.id = $1 $$;
    create schema net;
    create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
    -- 새 Supabase 프로젝트와 같게: 표를 만들어도 자동으로 권한을 주지 않음 (migration이 직접 줘야 함)
  `);
  for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'));
  }
  await db.exec(`
    insert into auth.users values ('${U.ceo}'),('${U.lead}'),('${U.kim}'),('${U.lee}');
    insert into staff(auth_user_id,name,email,role) values
     ('${U.ceo}','대표','ceo@x','ceo'),('${U.lead}','팀장','lead@x','lead'),
     ('${U.kim}','김직원','kim@x','staff'),('${U.lee}','이직원','lee@x','staff');
  `);

  async function as(user, sql, params = []) {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ? U[user] : '']);
    await db.exec(user ? 'set role authenticated' : 'set role anon');
    try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
  }

  const result = { pass: 0, fail: 0 };
  async function expectOk(name, fn) {
    try { const r = await fn(); result.pass++; console.log('  ✓', name); return r; }
    catch (e) { result.fail++; console.log('  ✗', name, '→', e.message); }
  }
  async function expectBlocked(name, fn) {
    try {
      const r = await fn();
      if (r && 'affectedRows' in r && r.affectedRows === 0) { result.pass++; console.log('  ✓', name, '(0건 처리)'); return; }
      result.fail++; console.log('  ✗', name, '→ 막혀야 하는데 통과됨');
    } catch (e) { result.pass++; console.log('  ✓', name, `(막힘: ${e.message.slice(0, 40)})`); }
  }
  function finish() {
    console.log(`\n결과: ${result.pass}개 통과, ${result.fail}개 실패`);
    return result.fail;
  }
  return { db, as, expectOk, expectBlocked, finish };
}
