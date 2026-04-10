alter table post_queue
  add column if not exists target_threads_account_id text;

create index if not exists idx_post_queue_target_threads_account
  on post_queue(target_threads_account_id);
