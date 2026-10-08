-- 거래처별 기본 수수료(마크업) 조건 — 예전 정산·계약 시스템에서 거래처 등록 때 정하던 값
--   예: 고정 22만원(광고비와 관계없이), 14.3%, 12.1%
--   정산서를 쓸 때 그 날짜에 맞는 계약이 있으면 계약 조건, 없으면 이 기본 조건을 자동으로 채움
alter table public.clients
  add column fee_markup_type text not null default 'none' check (fee_markup_type in ('rate','fixed','none')),
  add column fee_markup_rate numeric(5,2) not null default 0 check (fee_markup_rate >= 0 and fee_markup_rate < 100),
  add column fee_markup_fixed bigint not null default 0 check (fee_markup_fixed >= 0),
  add column fee_min_fee bigint not null default 0 check (fee_min_fee >= 0),
  add column fee_vat_mode text not null default 'included' check (fee_vat_mode in ('included','excluded')),
  add column fee_note text;
comment on column public.clients.fee_markup_type is '기본 수수료 방식: rate=광고비의 %, fixed=고정 금액, none=없음';
comment on column public.clients.fee_note is '수수료 조건 설명 (예: 쿠팡 광고비와 관계없이 월 22만원)';
