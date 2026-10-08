-- 거래처 삭제: 대표뿐 아니라 팀장도 (연결된 계약·정산·바이럴이 있으면 외래키로 막힘)
create policy clients_delete_manager on public.clients for delete to authenticated using (public.is_manager());
