-- Snipers : on mesure désormais la part de la supply qu'ils détiennent encore
-- (décision de calibrage du 10/10/2026). snipers_pct reste = part achetée dans les premières secondes.
alter table evaluations add column if not exists snipers_held_pct numeric;

-- Wash trading : seuil relevé de 8 à 15 transactions par wallet unique (même décision).
update settings
set config = jsonb_set(config, '{stage_b,wash_max_tx_per_wallet}', '15'::jsonb), updated_at = now()
where id = 1 and (config #>> '{stage_b,wash_max_tx_per_wallet}')::numeric = 8;
