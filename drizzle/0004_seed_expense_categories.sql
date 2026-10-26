-- Starting list of expense categories (editable in Settings).
INSERT INTO `expense_categories` (`name`, `sort`) VALUES
  ('Hosting', 10), ('Software', 20), ('Payroll', 30), ('Contractors', 40), ('Marketing', 50),
  ('Office', 60), ('Travel', 70), ('Fees', 80), ('Domains', 90), ('Database', 100), ('Other', 900);
--> statement-breakpoint
-- Keep every category already used by an expense, so existing records stay valid.
INSERT IGNORE INTO `expense_categories` (`name`, `sort`)
SELECT DISTINCT `category`, 500 FROM `expenses`;
