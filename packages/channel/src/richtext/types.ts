export type TelegramEntityType =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'code'
  | 'pre'
  | 'text_link'
  | 'blockquote'
  | 'expandable_blockquote'

export interface TelegramTextEntity {
  type: TelegramEntityType
  offset: number
  length: number
  url?: string
  language?: string
}

export interface TelegramRichText {
  text: string
  entities: TelegramTextEntity[]
}
