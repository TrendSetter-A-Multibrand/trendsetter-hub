-- ШАГ 0. Новая база хаба и пользователь приложения.
-- Выполнять в pgAdmin под doadmin, подключившись к базе defaultdb (Query Tool).
-- Хаб полностью отдельный от purchasing_dashboard: своя база, его таблицы мы не читаем.
--
-- ВАЖНО: пароль ниже — заглушка. Замените её на сгенерированный пароль ТОЛЬКО в окне pgAdmin,
-- не сохраняйте файл с настоящим паролем и не кладите его в репозиторий.
-- Проще всего вместо этого шага создать пользователя и базу в панели DigitalOcean
-- (Databases → ваш кластер → Users & Databases): тогда пароль покажет сама панель.

-- 1. Пользователь, под которым будет работать приложение (не doadmin, без прав на изменение структуры)
CREATE ROLE hub_app LOGIN PASSWORD 'ЗАМЕНИТЕ_НА_СГЕНЕРИРОВАННЫЙ_ПАРОЛЬ';

-- 2. База хаба
CREATE DATABASE trendsetter_hab OWNER doadmin;

-- 3. Подключаться к базе может только doadmin и hub_app
REVOKE ALL ON DATABASE trendsetter_hab FROM PUBLIC;
GRANT CONNECT ON DATABASE trendsetter_hab TO hub_app;
