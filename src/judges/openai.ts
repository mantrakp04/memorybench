import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"
import type { Judge, JudgeConfig, JudgeInput, JudgeResult } from "../types/judge"
import type { ProviderPrompts } from "../types/prompts"
import { buildJudgePrompt, parseJudgeResponse, getJudgePrompt } from "./base"
import { logger } from "../utils/logger"
import { getModelConfig, ModelConfig, DEFAULT_JUDGE_MODELS } from "../utils/models"
import { config as benchConfig } from "../utils/config"

export class OpenAIJudge implements Judge {
  name = "openai"
  private modelConfig: ModelConfig | null = null
  private client: ReturnType<typeof createOpenAI> | null = null

  async initialize(config: JudgeConfig): Promise<void> {
    this.client = createOpenAI({
      apiKey: config.apiKey,
      baseURL: benchConfig.openaiBaseUrl,
      headers: {
        "HTTP-Referer": "https://github.com/mantrakp04/g-spot",
        "X-Title": "g-spot MemoryBench",
      },
      fetch: createOpenRouterFetch(),
    })
    const modelAlias = config.model || DEFAULT_JUDGE_MODELS.openai
    this.modelConfig = getModelConfig(modelAlias)
    logger.info(
      `Initialized OpenAI judge with model: ${this.modelConfig.displayName} (${this.modelConfig.id})`
    )
  }

  async evaluate(input: JudgeInput): Promise<JudgeResult> {
    if (!this.client || !this.modelConfig) throw new Error("Judge not initialized")

    const prompt = buildJudgePrompt(input)

    const params: Record<string, unknown> = {
      model: benchConfig.openaiBaseUrl?.includes("openrouter.ai")
        ? this.client.chat(this.modelConfig.id)
        : this.client(this.modelConfig.id),
      prompt,
    }

    if (this.modelConfig.supportsTemperature) {
      params.temperature = this.modelConfig.defaultTemperature
    }

    params.maxTokens = this.modelConfig.defaultMaxTokens

    const { text } = await this.generateTextWithRetries(
      params as Parameters<typeof generateText>[0]
    )

    return parseJudgeResponse(text)
  }

  getPromptForQuestionType(questionType: string, providerPrompts?: ProviderPrompts): string {
    return getJudgePrompt(questionType, providerPrompts)
  }

  getModel() {
    if (!this.client || !this.modelConfig) throw new Error("Judge not initialized")
    if (benchConfig.openaiBaseUrl?.includes("openrouter.ai")) {
      return this.client.chat(this.modelConfig.id)
    }
    return this.client(this.modelConfig.id)
  }

  private async generateTextWithRetries(params: Parameters<typeof generateText>[0], attempts = 8) {
    let lastError: unknown

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await generateText(params)
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        if (!benchConfig.openaiBaseUrl?.includes("openrouter.ai") || attempt === attempts) {
          throw error
        }
        logger.warn(`OpenRouter judge request failed (${attempt}/${attempts}): ${message}`)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }

    throw lastError
  }
}

type OpenAIFetch = NonNullable<Parameters<typeof createOpenAI>[0]>["fetch"]

function createOpenRouterFetch(): OpenAIFetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (!benchConfig.openaiBaseUrl?.includes("openrouter.ai") || typeof init?.body !== "string") {
      return fetch(input, init)
    }

    if (!benchConfig.openaiProviderRoute && !benchConfig.openaiProviderQuantization) {
      return fetch(input, init)
    }

    const body = JSON.parse(init.body) as Record<string, unknown>
    body.provider = {
      ...(benchConfig.openaiProviderRoute ? { only: [benchConfig.openaiProviderRoute] } : {}),
      ...(benchConfig.openaiProviderQuantization
        ? { quantizations: [benchConfig.openaiProviderQuantization] }
        : {}),
    }

    return fetch(input, {
      ...init,
      body: JSON.stringify(body),
    })
  }) as OpenAIFetch
}

export default OpenAIJudge
