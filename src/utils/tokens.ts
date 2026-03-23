import { Tiktoken } from "js-tiktoken"
import cl100k_base from "js-tiktoken/ranks/cl100k_base"
import o200k_base from "js-tiktoken/ranks/o200k_base"
import { countTokens as countAnthropicTokens } from "@anthropic-ai/tokenizer"
import type { ModelConfig } from "./models"

export function countTokens(text: string, modelConfig: ModelConfig): number {
  const provider = modelConfig.provider

  if (provider === "openai") {
    return countOpenAITokens(text, modelConfig.id)
  } else if (provider === "anthropic") {
    return countAnthropicTokens(text)
  } else if (provider === "google") {
    return Math.ceil(text.length / 4)
  }

  return Math.ceil(text.length / 4)
}

function countOpenAITokens(text: string, modelId: string): number {
  try {
    let encoding: Tiktoken

    if (
      modelId.includes("gpt-4o") ||
      modelId.includes("gpt-4.1") ||
      modelId.includes("gpt-5")
    ) {
      encoding = new Tiktoken(o200k_base)
    } else {
      encoding = new Tiktoken(cl100k_base)
    }

    const tokens = encoding.encode(text)
    return tokens.length
  } catch (error) {
    return Math.ceil(text.length / 4)
  }
}
