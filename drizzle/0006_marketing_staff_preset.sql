-- "Marketing staff": the Staff defaults plus logging their own marketing activity.
-- Admins can edit it on the Team page like the Manager and Staff presets.
INSERT INTO `role_presets` (`id`, `name`, `description`, `sort`) VALUES
  ('marketing_staff', 'Marketing staff', 'Staff who log their own calls, emails and referrals: home, their own tasks, the calendar, chat, and marketing (view and log, own activity only).', 35);
--> statement-breakpoint
INSERT INTO `preset_permissions` (`preset_id`, `module`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_export`, `scope`) VALUES
  ('marketing_staff', 'home', 1, 0, 0, 0, 0, 'own'),
  ('marketing_staff', 'tasks', 1, 1, 1, 0, 0, 'assigned'),
  ('marketing_staff', 'calendar', 1, 1, 1, 0, 0, 'assigned'),
  ('marketing_staff', 'chat', 1, 1, 1, 0, 0, 'assigned'),
  ('marketing_staff', 'marketing', 1, 1, 0, 0, 0, 'own');
