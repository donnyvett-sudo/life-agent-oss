-- Раздел «Стиль» оказался ненужным: профиль, гардероб и разборы фото убраны
-- из бота и приложения. Таблицы были пустыми (одна строка профиля без данных),
-- поэтому просто сносим их вместе с политиками и индексами.
drop table if exists public.style_looks;
drop table if exists public.wardrobe;
drop table if exists public.style_profile;
