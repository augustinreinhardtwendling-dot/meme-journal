-- Second cerveau : pourquoi un coin appartient à une meta (une phrase rédigée par Claude Code).
alter table coin_metas add column if not exists reason text;
