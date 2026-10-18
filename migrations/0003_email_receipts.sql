-- Preserve early receipts so provider acceptance can reconcile them atomically.
ALTER TABLE email_webhook_events ADD COLUMN status TEXT;
ALTER TABLE email_webhook_events ADD COLUMN detail TEXT;
CREATE INDEX email_webhook_message ON email_webhook_events(email_id);
