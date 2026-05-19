-- ============================================================
-- Seed PLU Ballan-Miré — modification n°5 (29/01/2018)
-- Source : PLU-Ballan-Reglement.pdf + analyse NotebookLM
-- À exécuter sur la base Railway via psql ou l'interface Railway
-- ============================================================

BEGIN;

-- ── Commune ──────────────────────────────────────────────────
INSERT INTO communes (id, name, insee_code, zip_code, created_at, updated_at)
VALUES (gen_random_uuid(), 'Ballan-Miré', '37018', '37510', now(), now())
ON CONFLICT (insee_code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
RETURNING id;

-- On stocke l'id dans une variable temporaire via CTE
WITH commune AS (
  SELECT id FROM communes WHERE insee_code = '37018'
),

-- ── Zones ─────────────────────────────────────────────────────
zone_ua AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UA', 'Zone UA – Centre ancien', 'U',
    'Cœur historique de Ballan-Miré, bâti traditionnel dense en étoile autour de l''église.',
    'active', true, 1, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_ub AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UB', 'Zone UB – Extensions du centre', 'U',
    'Extensions urbaines du centre : collectifs R+3, nouvelle mairie, ZAC des Prés, quartier gare.',
    'active', true, 2, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_uc AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UC', 'Zone UC – Quartiers pavillonnaires', 'U',
    'Zone majoritaire : lotissements, ZAC des Prés, hameaux de Miré et des Vallées.',
    'active', true, 3, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_ud AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UD', 'Zone UD – Quartiers verdoyants (Haute Lande, Miré)', 'U',
    'Habitat individuel très peu dense en espaces boisés. Terrain min 2000m². Limite séparative interdite.',
    'active', true, 4, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_uz AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UZ', 'Zone UZ – ZAC de la Pasqueraie', 'U',
    'Zone d''habitat récent mixte. UZa : collectifs R+3-4. UZb : formes compactes.',
    'active', true, 5, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_ux AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UX', 'Zone UX – Activités La Châtaigneraie', 'U',
    'Zone d''activités économiques. Reculs stricts RD751/RD751c.',
    'active', true, 6, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_uy AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UY', 'Zone UY – Activités Carrefour en Touraine', 'U',
    'Grande zone d''activités économiques. Hauteurs jusqu''à 15m.',
    'active', true, 7, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_ul AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UL', 'Zone UL – Sports et Loisirs', 'U',
    'Équipements sportifs : centre équestre, camping, base nautique.',
    'active', true, 8, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_us AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'US', 'Zone US – Établissements sanitaires et sociaux', 'U',
    'IEM Charlemagne, centre rééducation cardiaque, centre formation SDIS.',
    'active', true, 9, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_uv AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'UV', 'Zone UV – Village Vacances', 'U',
    'Opération de village-vacances en cours. Recul 10m des voies.',
    'active', true, 10, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_1au AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, '1AU', 'Zone 1AU – La Savatterie', 'AU',
    'Secteur résidentiel à urbaniser à court terme dans le vallon.',
    'active', true, 11, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_1auz AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, '1AUZ', 'Zone 1AUZ – ZAC Pasqueraie 3e tranche', 'AU',
    'Dernière tranche ZAC Pasqueraie. 25% logements sociaux requis.',
    'active', true, 12, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_auh AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'AUH', 'Zone AUH – Urbanisation future résidentielle', 'AU',
    'Secteurs futurs non constructibles sans révision PLU.',
    'active', true, 13, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_auy AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'AUY', 'Zone AUY – Urbanisation future économique', 'AU',
    'Extension future zone Carrefour en Touraine.',
    'active', true, 14, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_a AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'A', 'Zone A – Agricole', 'A',
    'Protège le potentiel agronomique. Secteurs Ad, Ah, Ap.',
    'active', true, 15, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_n AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'N', 'Zone N – Naturelle et forestière', 'N',
    'Espaces naturels protégés. Secteurs Nh, Ng, Na, Nb, Nf.',
    'active', true, 16, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
),
zone_ni AS (
  INSERT INTO zones (id, commune_id, zone_code, zone_label, zone_type, summary, status, is_active, display_order, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'NI', 'Zone NI – Inondable (vallée du Cher)', 'N',
    'Soumis au PPRI. NI1/NI2/NI3 selon aléa. Sous-sols interdits.',
    'active', true, 17, now(), now()
  FROM commune c
  ON CONFLICT DO NOTHING
  RETURNING id, zone_code
)

SELECT 1; -- termine le WITH principal

-- ── Règles zone UA ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (6,  'Art. 6 – Recul voirie',         'recul_voie',   'Recul entre 0 et 1 m, ou alignement sur construction voisine, ou recul minimal de 6 m.', 0::float8,  6::float8,  'm',  NULL,                   '0-1m ou alignement ou ≥6m'),
  (7,  'Art. 7 – Recul limites',         'recul_limite', 'En limite séparative ou distance ≥ H/2 avec minimum 3 m.', 3::float8,  NULL,       'm',  'H/2 minimum 3m',       'En limite ou H/2 (min 3m)'),
  (9,  'Art. 9 – Emprise au sol',        'emprise_sol',  'Emprise au sol non réglementée en zone UA.', NULL,        NULL,       NULL, NULL,                   'Non réglementé'),
  (10, 'Art. 10 – Hauteur max.',         'hauteur',      '6,5 m à l''égout de toiture ou à l''acrotère ; 9 m au faîtage.', NULL, 6.5::float8, 'm', 'Faîtage: 9m',          '6,5m égout / 9m faîtage'),
  (12, 'Art. 12 – Stationnement',        'stationnement','1 place/logement 1P ; 2 places/logement ≥2P. Activités : 1 place/50m². Commerces ≤100m² : 0 place.', NULL, NULL, NULL, NULL, '2 places/logement (≥2P)'),
  (13, 'Art. 13 – Espaces verts',        'espaces_verts','≥25% d''espaces libres en pleine terre. 1 arbre haute tige/100m².', 25::float8, NULL, '%', NULL, '≥25% pleine terre')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UA' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UB ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (6,  'Art. 6 – Recul voirie',         'recul_voie',   'Recul minimal de 6 m par rapport aux voies.', 6::float8, NULL, 'm', NULL, '≥6m'),
  (7,  'Art. 7 – Recul limites',         'recul_limite', 'En limite séparative ou H/2 min 3 m. UBa : jamais en limite.', 3::float8, NULL, 'm', 'UBa: jamais en limite', 'En limite ou H/2 (min 3m)'),
  (9,  'Art. 9 – Emprise au sol',        'emprise_sol',  'Emprise au sol maximale 50%. UBai (inondable) : 10%.', NULL, 50::float8, '%', 'UBai: 10%', '≤50% (UBai: 10%)'),
  (10, 'Art. 10 – Hauteur max.',         'hauteur',      '9 m à l''égout ou à l''acrotère ; 14 m au faîtage (R+3).', NULL, 9::float8, 'm', 'Faîtage: 14m', '9m égout / 14m faîtage'),
  (12, 'Art. 12 – Stationnement',        'stationnement','2 places/logement (1 pour logements aidés). Quota social : 20% pour 5-20 logts, 30% au-delà.', NULL, NULL, NULL, NULL, '2 places/logement, quota social 20-30%'),
  (13, 'Art. 13 – Espaces verts',        'espaces_verts','≥35% d''espaces libres en pleine terre.', 35::float8, NULL, '%', NULL, '≥35% pleine terre')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UB' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UC ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (6,  'Art. 6 – Recul voirie',         'recul_voie',   'Recul minimal de 3 m. RD751 : 45 m depuis l''axe de la voie.', 3::float8, NULL, 'm', 'RD751: 45m depuis axe', '≥3m (RD751: 45m)'),
  (7,  'Art. 7 – Recul limites',         'recul_limite', 'En limite séparative ou H/2 min 3 m.', 3::float8, NULL, 'm', 'H/2 minimum 3m', 'En limite ou H/2 (min 3m)'),
  (9,  'Art. 9 – Emprise au sol',        'emprise_sol',  'Emprise au sol maximale de 50%.', NULL, 50::float8, '%', NULL, '≤50%'),
  (10, 'Art. 10 – Hauteur max.',         'hauteur',      '6,5 m à l''égout ou à l''acrotère ; 9 m au faîtage (R+2).', NULL, 6.5::float8, 'm', 'Faîtage: 9m', '6,5m égout / 9m faîtage'),
  (12, 'Art. 12 – Stationnement',        'stationnement','2 places/logement (1 pour logements aidés). Quota social : 20% dès 5 logements.', NULL, NULL, NULL, NULL, '2 places/logement, quota social 20%'),
  (13, 'Art. 13 – Espaces verts',        'espaces_verts','≥40% d''espaces libres en pleine terre.', 40::float8, NULL, '%', NULL, '≥40% pleine terre')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UC' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UD ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (5,  'Art. 5 – Terrain min.',          'terrain_min',  'Superficie minimale des terrains constructibles : 2 000 m².', 2000::float8, NULL, 'm²', NULL, '≥2 000m² par terrain'),
  (6,  'Art. 6 – Recul voirie',          'recul_voie',   'Recul minimal de 7 m par rapport aux voies et emprises publiques.', 7::float8, NULL, 'm', NULL, '≥7m'),
  (7,  'Art. 7 – Recul limites',          'recul_limite', 'Implantation en limite séparative interdite. Recul minimum H/2 avec minimum 3 m.', 3::float8, NULL, 'm', 'Jamais en limite – H/2 min 3m', 'Jamais en limite, H/2 (min 3m)'),
  (9,  'Art. 9 – Emprise au sol',         'emprise_sol',  'Emprise au sol maximale de 20%.', NULL, 20::float8, '%', NULL, '≤20%'),
  (10, 'Art. 10 – Hauteur max.',          'hauteur',      '6,5 m à l''égout ou à l''acrotère ; 8,5 m au faîtage.', NULL, 6.5::float8, 'm', 'Faîtage: 8.5m', '6,5m égout / 8,5m faîtage'),
  (12, 'Art. 12 – Stationnement',         'stationnement','2 places par logement de 2 pièces et plus.', NULL, NULL, NULL, NULL, '2 places/logement'),
  (13, 'Art. 13 – Espaces verts',         'espaces_verts','≥60% d''espaces libres en pleine terre. Maintien obligatoire des arbres existants.', 60::float8, NULL, '%', NULL, '≥60% pleine terre')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UD' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UZ ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (6,  'Art. 6 – Recul voirie',  'recul_voie',   'Recul minimal de 5 m.', 5::float8, NULL, 'm', NULL, '≥5m'),
  (9,  'Art. 9 – Emprise au sol','emprise_sol',   'Emprise au sol max 50% (40% en UZa logements collectifs).', NULL, 50::float8, '%', 'UZa: 40%', '≤50% (UZa: 40%)'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',       '14 m en UZa ; 11 m en UZb.', NULL, 14::float8, 'm', 'UZb: 11m', '14m (UZa) / 11m (UZb)'),
  (13, 'Art. 13 – Espaces verts','espaces_verts', '≥40% d''espaces libres en pleine terre.', 40::float8, NULL, '%', NULL, '≥40% pleine terre')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UZ' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UX ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (6,  'Art. 6 – Recul voirie',  'recul_voie',   'Recul 45 m depuis axe RD751. Recul 25 m depuis RD751c. Aucun accès individuel sur RD751c.', 45::float8, NULL, 'm', 'RD751: 45m axe; RD751c: 25m', '45m (RD751) / 25m (RD751c)'),
  (9,  'Art. 9 – Emprise au sol','emprise_sol',   'Emprise au sol maximale de 60%.', NULL, 60::float8, '%', NULL, '≤60%'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',       'Hauteur maximale de 10 m.', NULL, 10::float8, 'm', NULL, '≤10m'),
  (12, 'Art. 12 – Stationnement','stationnement', '1 place/50m² SP. Pré-équipement recharge électrique obligatoire.', NULL, NULL, NULL, NULL, '1 place/50m²')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UX' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UY ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (9,  'Art. 9 – Emprise au sol','emprise_sol','Emprise au sol maximale de 50%.', NULL, 50::float8, '%', NULL, '≤50%'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',    'Hauteur maximale de 15 m.', NULL, 15::float8, 'm', NULL, '≤15m')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UY' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UL ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (9,  'Art. 9 – Emprise au sol','emprise_sol','Emprise au sol non réglementée.', NULL, NULL, NULL, NULL, 'Non réglementé'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',    'Hauteur non réglementée.', NULL, NULL, NULL, NULL, 'Non réglementé')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UL' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone US ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (7,  'Art. 7 – Recul limites',  'recul_limite', 'Recul de 10 m par rapport aux limites séparatives.', 10::float8, NULL, 'm', NULL, '≥10m des limites'),
  (9,  'Art. 9 – Emprise au sol', 'emprise_sol',  'Emprise au sol non réglementée.', NULL, NULL, NULL, NULL, 'Non réglementé'),
  (10, 'Art. 10 – Hauteur max.',  'hauteur',      'Hauteur non réglementée.', NULL, NULL, NULL, NULL, 'Non réglementé')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'US' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone UV ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (6,  'Art. 6 – Recul voirie',  'recul_voie', 'Recul minimal de 10 m par rapport aux voies.', 10::float8, NULL, 'm', NULL, '≥10m'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',    'Hauteur maximale de 9 m au faîtage.', NULL, 9::float8, 'm', NULL, '≤9m faîtage')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'UV' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone 1AU ──────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (6,  'Art. 6 – Recul voirie',  'recul_voie',   'Recul minimal de 5 m.', 5::float8, NULL, 'm', NULL, '≥5m'),
  (9,  'Art. 9 – Emprise au sol','emprise_sol',   'Emprise au sol maximale de 50%.', NULL, 50::float8, '%', NULL, '≤50%'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',       'Hauteur maximale de 7,5 m au faîtage.', NULL, 7.5::float8, 'm', NULL, '≤7,5m faîtage'),
  (13, 'Art. 13 – Espaces verts','espaces_verts', '≥40% d''espaces libres en pleine terre.', 40::float8, NULL, '%', NULL, '≥40% pleine terre')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = '1AU' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone 1AUZ ─────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (10, 'Art. 10 – Hauteur max.', 'hauteur',       'Hauteur variable : 10 à 14 m selon l''emplacement.', 10::float8, 14::float8, 'm', NULL, '10-14m selon emplacement'),
  (13, 'Art. 13 – Espaces verts','espaces_verts', '≥25% d''espaces libres en pleine terre.', 25::float8, NULL, '%', NULL, '≥25% pleine terre')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = '1AUZ' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone AUH ──────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, 9, 'Art. 9 – Emprise au sol', 'emprise_sol',
  'Extensions existantes uniquement : +50% de l''emprise existante, maximum 50 m². Toute nouvelle construction nécessite une révision du PLU.',
  NULL, 50::float8, 'm²', 'Extensions uniquement; révision PLU pour construire', 'Extensions seules (+50% max 50m²)', 'valide', now(), now()
FROM zones z
WHERE z.zone_code = 'AUH' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone AUY ──────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, 9, 'Art. 9 – Emprise au sol', 'emprise_sol',
  'Extensions du bâti existant uniquement, dans la limite de 50% de l''emprise existante.',
  NULL, 50::float8, '%', 'Extensions bâti existant uniquement', 'Extensions seules (+50% existant)', 'valide', now(), now()
FROM zones z
WHERE z.zone_code = 'AUY' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone A ────────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (9,  'Art. 9 – Emprise au sol','emprise_sol','Libre pour l''exploitation agricole. Ah : +50% max 50m². Ap : inconstructible.', NULL, NULL, NULL, 'Ah: +50% max 50m²; Ap: inconstructible', 'Libre (Ah: +50% max 50m²; Ap: interdit)'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',    '4 m à l''égout pour les bâtiments d''habitation. Annexes Ah : 3 m max. Agricole : libre.', NULL, 4::float8, 'm', 'Habitation seule; agricole libre; Ah annexes 3m', '4m égout (habitation)')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'A' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone N ────────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (9,  'Art. 9 – Emprise au sol','emprise_sol','Inconstructible. Secteurs tolérés : Nh (+50% max 50m²), Ng (20%), Na (5%), Nb (300m²), Nf (50%).', NULL, NULL, NULL, 'Nh: +50% max 50m²; Ng: 20%; Na: 5%; Nb: 300m²', 'Inconstructible (secteurs: Nh/Ng/Na/Nb/Nf)'),
  (10, 'Art. 10 – Hauteur max.', 'hauteur',    'Non réglementé sauf : Nh (existant/3m annexes), Ng (5m), Nb et Na (6m), Nf (6m).', NULL, NULL, NULL, 'Nh ext./3m; Ng 5m; autres 6m', 'Libre (secteurs: Nh 3m; Ng 5m; autres 6m)')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'N' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Règles zone NI ───────────────────────────────────────────
INSERT INTO zone_regulatory_rules (id, zone_id, article_number, article_title, topic, rule_text, value_min, value_max, unit, conditions, summary, validation_status, created_at, updated_at)
SELECT gen_random_uuid(), z.id, r.art, r.title, r.topic, r.rule_text, r.vmin, r.vmax, r.unit, r.cond, r.summ, 'valide', now(), now()
FROM zones z
CROSS JOIN (VALUES
  (9,  'Art. 9 – Emprise au sol','emprise_sol','Extensions max 50 m² sous conditions strictes. Étage refuge obligatoire au-dessus des PHEC. Sous-sols interdits.', NULL, 50::float8, 'm²', 'PPRI; étage refuge; sous-sols interdits', 'Extensions ≤50m² avec étage refuge'),
  (10, 'Art. 10 – Hauteur / plancher','hauteur','Plancher habitable surélevé d''au moins 0,50 m par rapport au sol naturel. Étage refuge au-dessus des PHEC obligatoire.', 0.5::float8, NULL, 'm', 'Surélévation +0.50m NGF; étage refuge PHEC', 'Plancher +0.50m NGF; étage refuge')
) AS r(art, title, topic, rule_text, vmin, vmax, unit, cond, summ)
WHERE z.zone_code = 'NI' AND z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
ON CONFLICT DO NOTHING;

-- ── Vérification ─────────────────────────────────────────────
SELECT z.zone_code, count(r.id) AS nb_regles
FROM zones z
LEFT JOIN zone_regulatory_rules r ON r.zone_id = z.id
WHERE z.commune_id = (SELECT id FROM communes WHERE insee_code = '37018')
GROUP BY z.zone_code
ORDER BY z.zone_code;

COMMIT;
