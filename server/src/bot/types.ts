// Channel-neutral outbound message shapes. The WhatsApp adapter converts these to Graph API payloads
// and enforces Meta limits; the simulator renders them in the admin panel.

export type Button = { id: string; title: string };
export type ListRow = { id: string; title: string; description?: string };
export type ListSection = { title: string; rows: ListRow[] };

export type Outbound =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'buttons'; body: string; buttons: Button[]; headerImage?: string; headerText?: string; footer?: string }
  | { type: 'list'; body: string; buttonText: string; sections: ListSection[]; headerText?: string; footer?: string };

export type Inbound = {
  waId: string;
  name?: string;
  waMessageId?: string;
  kind: 'text' | 'reply' | 'image' | 'other';
  text?: string; // for text, or caption
  replyId?: string; // interactive button_reply.id / list_reply.id / template button payload
  replyTitle?: string;
  mediaId?: string; // WhatsApp media id of an image the customer sent
  imageUrl?: string; // already-stored image (simulator)
};

// Meta limits (validate again in the dashboard for your API version)
export const LIMITS = {
  buttons: 3,
  buttonTitle: 20,
  listRowsTotal: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listButtonText: 20,
  listSectionTitle: 24,
  body: 1024,
  header: 60,
  footer: 60,
  caption: 1024,
  text: 4096,
  id: 256,
};
