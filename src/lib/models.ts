/** Rows shared by server-rendered templates. SQL columns remain the storage contract. */
export interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  time_zone: string | null;
  ai_notes: string | null;
  active: number;
  open_count: number;
}
export interface Site {
  id: number;
  client_id: number;
  label: string | null;
  url: string | null;
  active: number;
}
export interface Ticket {
  id: number;
  ref: string;
  client_id: number;
  site_id: number | null;
  type: string;
  title: string;
  body: string;
  page: string | null;
  links: string | null;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  closure_reason: string | null;
  duplicate_of_ticket_id: number | null;
  client_name: string | null;
  client_company: string | null;
  client_email: string;
  site_label: string | null;
  site_url: string | null;
  has_draft: number;
  draft_source: string | null;
}
export interface Message {
  id: number;
  client_id: number;
  ticket_id: number;
  author: string;
  body: string;
  visibility: string;
  links: string | null;
  created_at: string;
}
export interface Attachment {
  id: number;
  ticket_id: number;
  message_id: number | null;
  filename: string;
  content_type: string;
  size: number;
}
export interface Delivery {
  id: number;
  message_id: number | null;
  status: string;
  kind: string;
  last_error: string | null;
  recipient_email: string;
  created_at: string;
  updated_at: string;
  attempt_count: number;
}
export interface Draft {
  id: number;
  revision: number;
  body: string;
  status: string;
  source: string;
  updated_at: string;
  error: string | null;
}
export interface History {
  at: string;
  data: { action?: string; reason?: string; note?: string; duplicateRef?: string };
}
export interface ThreadFile {
  kind: string;
  href: string;
  label: string;
}
