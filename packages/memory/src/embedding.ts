import type { Memory } from '@zero-os/shared'

export interface EmbeddingConfig {
  baseUrl: string
  apiKey: string
  model: string
  dimensions?: number
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  memoryToText(memory: Memory): string
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>
}

export class EmbeddingClient implements EmbeddingProvider {
  constructor(private config: EmbeddingConfig) {}

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text])
    if (!vector) {
      throw new Error('Embedding service returned an empty result')
    }
    return vector
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
        ...(this.config.dimensions ? { dimensions: this.config.dimensions } : {}),
      }),
    })

    if (!response.ok) {
      throw new Error(`Embedding request failed with status ${response.status}`)
    }

    const payload = await response.json() as EmbeddingResponse
    const vectors = payload.data?.map((entry) => entry.embedding).filter((entry): entry is number[] => Array.isArray(entry))
    if (!vectors || vectors.length !== texts.length) {
      throw new Error('Embedding service returned an unexpected payload')
    }

    return vectors
  }

  memoryToText(memory: Memory): string {
    const tags = memory.tags.join(' ')
    const content = memory.content.replace(/\s+/g, ' ').trim().slice(0, 500)
    return [memory.title, tags, content].filter(Boolean).join('\n')
  }
}
