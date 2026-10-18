-- Fictional data for scripts/demo.mjs. Loaded into a throwaway local
-- database only; never applied to a real one.
INSERT INTO clients (id, email, name, company, time_zone, ai_notes) VALUES
  (1, 'sarah@example.com', 'Sarah Connor', 'Cyberdyne Alternatives', 'America/Los_Angeles', 'Runs a resistance training studio for women over 40. Calls her clients members, never customers. We rebuilt her site in March; she approves every photo herself.'),
  (2, 'miles@example.com', 'Miles Dyson', 'Dyson Research', 'America/Chicago', NULL);
INSERT INTO sites (id, client_id, label, url) VALUES
  (1, 1, 'Main site', 'https://example.com'),
  (2, 1, 'Shop', 'https://shop.example.com'),
  (3, 2, 'Lab site', 'https://lab.example.com');

INSERT INTO tickets (id, ref, client_id, site_id, type, title, body, page, links, status, revision, created_at, updated_at, resolved_at) VALUES
  (1, 'SUP-2026-0001', 1, 2, 'change', 'Swap the hero photo on the shop homepage', 'Please swap the hero photo on the shop homepage for the new one attached. The current one is from last spring.', 'Home', '["https://drive.example.com/folder/new-photos"]', 'waiting', 2, '2026-10-01 15:04:00', '2026-10-02 16:30:00', NULL),
  (2, 'SUP-2026-0002', 1, 1, 'urgent', 'Urgent: The contact form is not sending anything', 'The contact form is not sending anything since this morning. Two clients told me they tried to reach me.', 'Contact', NULL, 'new', 1, '2026-10-08 13:20:00', '2026-10-08 13:20:00', NULL),
  (3, 'SUP-2026-0003', 1, 1, 'question', 'Question: Can we add a second booking calendar for workshops?', 'Can we add a second booking calendar for workshops? I want people to pick a date for group sessions separately from private sessions.', NULL, NULL, 'done', 3, '2026-09-20 18:00:00', '2026-09-22 14:00:00', '2026-09-22 14:00:00'),
  (4, 'SUP-2026-0004', 2, 3, 'change', 'Update the team page with two new researchers', 'Please add two new researchers to the team page. Bios and photos are in the linked folder.', 'Team', '["https://drive.example.com/folder/team"]', 'open', 1, '2026-10-06 17:45:00', '2026-10-07 09:10:00', NULL);

INSERT INTO messages (id, client_id, ticket_id, author, body, visibility, created_at) VALUES
  (1, 1, 1, 'owner', 'Happy to. The photo you attached is portrait, so it will crop on wide screens. Do you have a landscape version, or should I use the second photo in your folder?', 'client', '2026-10-02 16:30:00'),
  (2, 1, 1, 'owner', 'Second photo in the folder is the better crop if she has no landscape version.', 'internal', '2026-10-02 16:31:00'),
  (3, 1, 3, 'owner', 'Yes. I added a Workshops calendar with its own booking page and linked it from the Services menu: https://example.com/workshops', 'client', '2026-09-22 13:58:00'),
  (4, 1, 3, 'client', 'This is perfect, thank you!', 'client', '2026-09-22 14:30:00'),
  (5, 2, 4, 'client', 'Also, one of them goes by Dr. Silberman on the site, please.', 'client', '2026-10-07 09:10:00');

INSERT INTO reply_drafts (id, client_id, ticket_id, body, status, source, model, sent_message_id, revision) VALUES
  (1, 1, 3, 'Yes. I added a Workshops calendar with its own booking page and linked it from the Services menu: https://example.com/workshops', 'sent', 'owner', NULL, 3, 2),
  (2, 1, 2, 'Hi Sarah, thanks for flagging this. I am checking the contact form now and will tell you as soon as messages are coming through again.', 'ready', 'ai', 'claude-opus-5-5', NULL, 1);

INSERT INTO email_deliveries (id, client_id, ticket_id, message_id, kind, recipient_email, subject, payload_json, status, idempotency_key, provider_message_id, last_error) VALUES
  (1, 1, 1, 1, 'reply', 'sarah@example.com', 'Kyle replied to your request', '{}', 'delivered', 'design-1', 'em_1', NULL),
  (2, 1, 2, NULL, 'new_request_owner', 'you@your_domain.com', 'URGENT SUP-2026-0002', '{}', 'failed', 'design-2', NULL, 'The email service rejected the message.'),
  (3, 1, 2, NULL, 'request_received_client', 'sarah@example.com', 'We received your urgent request (SUP-2026-0002)', '{}', 'accepted', 'design-3', 'em_3', NULL);

INSERT INTO events (ticket_id, client_id, type, data, at) VALUES
  (3, 1, 'request_state', '{"action":"resolve","previousStatus":"open"}', '2026-09-22 14:00:00');

INSERT INTO sessions (id, client_id, admin_email, expires_at) VALUES
  ('a59409967f6cca035acccea68a3c9bd9e876c5a73b3a11ebfa33907b90da1553', 1, NULL, '2099-01-01T00:00:00.000Z'),
  ('fe8f671e90f4bef14aa6658a8f90884157d0378f6fbc2fe6436804d87f95a72a', NULL, 'you@your_domain.com', '2099-01-01T00:00:00.000Z');

INSERT INTO counters (key, value) VALUES ('ticket_ref_2026', 4);
