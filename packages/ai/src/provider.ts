/**
 * The AI provider surface (14_AI_AGENT.md §2). One transport only: an OpenAI-compatible
 * `/v1/chat/completions` endpoint the user configures (Ollama, LM Studio, a g4f server, …).
 * No endpoint configured → `unavailableProvider()`, and every capability degrades to
 * "AI unavailable" instead of guessing.
 */

export class AIUnavailableError extends Error {
  constructor(message = 'No AI endpoint is configured') {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

export interface AIProvider {
  readonly modelId: string;
  /** Returns the assistant message text. Implementations must not retry silently. */
  complete(prompt: string, signal?: AbortSignal): Promise<string>;
}

export interface OpenAICompatibleOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  /** Injected so tests never touch the network. */
  readonly fetchImpl?: typeof fetch;
  readonly temperature?: number;
}

export function unavailableProvider(): AIProvider {
  return {
    modelId: 'none',
    complete: () => Promise.reject(new AIUnavailableError()),
  };
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

export function openAICompatibleProvider(options: OpenAICompatibleOptions): AIProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${stripTrailingSlashes(options.baseUrl)}/chat/completions`;
  return {
    modelId: options.model,
    async complete(prompt, signal) {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({
          model: options.model,
          temperature: options.temperature ?? 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        throw new AIUnavailableError(`AI endpoint returned ${String(response.status)}`);
      }
      const body: unknown = await response.json();
      const text = firstChoiceText(body);
      if (text === undefined) throw new AIUnavailableError('AI endpoint returned no choices');
      return text;
    },
  };
}

function firstChoiceText(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  return typeof content === 'string' ? content : undefined;
}
