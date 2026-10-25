-- Reference data every install needs. Runs once, on an empty database.
INSERT INTO `settings` (`id`) VALUES (1);
--> statement-breakpoint
INSERT INTO `role_presets` (`id`, `name`, `description`, `sort`) VALUES
  ('admin', 'Admin', 'Full control, including team, settings and the audit log. Two-factor required.', 10),
  ('manager', 'Manager', 'Runs finances, marketing and the team''s work. No team, settings or audit access.', 20),
  ('staff', 'Staff', 'Least privilege: home, their own tasks, the calendar and chat. No finance access.', 30),
  ('custom', 'Custom', 'Hand-edited permissions for one person.', 40);
--> statement-breakpoint
-- Admin: everything, all rows
INSERT INTO `preset_permissions` (`preset_id`, `module`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_export`, `scope`) VALUES
  ('admin', 'home', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'finances', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'transactions', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'payments', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'streams', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'countries', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'representatives', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'marketing', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'calendar', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'tasks', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'chat', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'team', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'settings', 1, 1, 1, 1, 1, 'all'),
  ('admin', 'audit', 1, 1, 1, 1, 1, 'all');
--> statement-breakpoint
-- Manager: operational modules, no team/settings/audit. Deletes only on calendar, tasks, chat and marketing.
INSERT INTO `preset_permissions` (`preset_id`, `module`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_export`, `scope`) VALUES
  ('manager', 'home', 1, 1, 1, 0, 1, 'all'),
  ('manager', 'finances', 1, 1, 1, 0, 1, 'all'),
  ('manager', 'transactions', 1, 1, 1, 0, 1, 'all'),
  ('manager', 'payments', 1, 1, 1, 0, 1, 'all'),
  ('manager', 'streams', 1, 1, 1, 0, 1, 'all'),
  ('manager', 'countries', 1, 1, 1, 0, 1, 'all'),
  ('manager', 'representatives', 1, 1, 1, 0, 1, 'all'),
  ('manager', 'marketing', 1, 1, 1, 1, 1, 'all'),
  ('manager', 'calendar', 1, 1, 1, 1, 1, 'all'),
  ('manager', 'tasks', 1, 1, 1, 1, 1, 'all'),
  ('manager', 'chat', 1, 1, 1, 1, 0, 'all');
--> statement-breakpoint
-- Staff: home, own tasks, calendar events they are invited to, chat
INSERT INTO `preset_permissions` (`preset_id`, `module`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_export`, `scope`) VALUES
  ('staff', 'home', 1, 0, 0, 0, 0, 'own'),
  ('staff', 'tasks', 1, 1, 1, 0, 0, 'assigned'),
  ('staff', 'calendar', 1, 1, 1, 0, 0, 'assigned'),
  ('staff', 'chat', 1, 1, 1, 0, 0, 'assigned');
--> statement-breakpoint
INSERT INTO `streams` (`name`, `sort`) VALUES
  ('Upwork', 10), ('Fiverr', 20), ('PeoplePerHour', 30), ('Website direct', 40), ('Individual representatives', 50);
--> statement-breakpoint
INSERT INTO `countries` (`code`, `name`, `sort`) VALUES
  ('GB', 'United Kingdom', 10), ('AU', 'Australia', 20), ('OTHER', 'Other', 30);
