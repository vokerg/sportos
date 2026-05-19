-- These rules are intentionally data, not code. Adjust in Rules Studio later.
-- The importer also stores spreadsheet totals so app totals can be compared against Excel totals while coefficients are tuned.
insert into scoring_rules(code, name, activity_type, rule_kind, metric, coefficient, description)
values
  ('steps.base', 'Steps: 1 point per step', 'steps', 'coefficient', 'steps', 1.0, 'Base step score from the daily ledger.'),
  ('bike.km.default', 'Bike: default km to step-equivalent points', 'bike', 'coefficient', 'distance_km', 650.0, 'Observed in workbook formulas; version this if historical coefficients changed.'),
  ('swim.m.default', 'Swim: meters to step-equivalent points', 'swim', 'coefficient', 'distance_m', 7.5, 'Observed in workbook formulas as Swim * 7.5.'),
  ('run.km.default', 'Run: km to step-equivalent points', 'run', 'coefficient', 'distance_km', 1000.0, 'Initial placeholder. Tune against imported workbook totals.'),
  ('workout.manual', 'Workout/manual points', 'workout', 'manual_points', 'effort_points', 1.0, 'Manual workout points from WOtotal.'),
  ('power.manual', 'Power/extra-effort points', 'power_bonus', 'manual_points', 'effort_points', 1.0, 'Manual power bonus points from Pow.')
on conflict (code) do nothing;

insert into scoring_rules(code, name, activity_type, rule_kind, metric, threshold_operator, threshold_value, threshold_unit, points, description)
values
  ('run.5k.sub25.bonus', '5k run under 25 minutes', 'run', 'achievement', 'duration_s', 'lt', 1500, 's', 1000, 'Bonus described by user.'),
  ('run.10k.completed.bonus', '10k run completed', 'run', 'achievement', 'distance_m', 'gte', 10000, 'm', 2000, 'Bonus described by user.'),
  ('swim.1k.sub20.bonus', '1km swim under 20 minutes', 'swim', 'achievement', 'duration_s', 'lt', 1200, 's', 1000, 'Applies when distance is at least 1km; scoring engine checks distance too.'),
  ('bike.10k.easy.bonus', '10k ride below 20 km/h', 'bike', 'achievement', 'avg_speed_kmh', 'lt', 20, 'kmh', 1000, 'Bonus described by user; semantics can be adjusted in Rules Studio.')
on conflict (code) do nothing;
