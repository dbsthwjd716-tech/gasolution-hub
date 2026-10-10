-- 10/10 광고 데이터 전환: 예전 대시보드에서 기준 표를 가져오던 아침 작업(ads-sync-ref)을 끔
--   지우지 않고 꺼 둠 (되살리기: select cron.alter_job(job_id := <id>, active := true))
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.alter_job(job_id := j.jobid, active := false) from cron.job j where j.jobname = 'ads-sync-ref';
  end if;
end $$;
