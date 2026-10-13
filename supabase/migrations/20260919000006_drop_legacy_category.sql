-- Текстовая категория этапа 1 заменена на category_id (таблица categories).
alter table public.transactions drop column category;
