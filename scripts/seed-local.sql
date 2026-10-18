-- Local test data only. Run with: npm run db:seed
INSERT INTO clients (email, name, company, time_zone) VALUES
  ('sarah@example.com', 'Sarah Connor', 'Cyberdyne Alternatives', 'America/Los_Angeles'),
  ('miles@example.com', 'Miles Dyson', 'Dyson Research', 'America/Chicago');
INSERT INTO sites (client_id, label, url) VALUES
  (1, 'Main site', 'https://example.com'),
  (1, 'Shop', 'https://shop.example.com'),
  (2, 'Lab site', 'https://lab.example.com');
