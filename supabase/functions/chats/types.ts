export interface TextMessageContent {
  type: "text";
  text: string;
}

export interface ImageUrlMessageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export type MessageContent = TextMessageContent | ImageUrlMessageContent;

export interface ChatMessage {
  id: string;
  chat_id: string;
  sender_profile_id: string | null;
  sender_character_id: string | null;
  content: MessageContent[];
  created_at: string;
}
