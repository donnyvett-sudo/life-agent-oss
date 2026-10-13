-- Агент чата ищет «только что созданную» запись по created_at (для отмены).
alter table public.meal_logs add column created_at timestamptz not null default now();
