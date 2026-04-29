export interface Config {
  openaiApiKey: string
  openaiBaseUrl?: string
  openaiProviderRoute?: string
  openaiProviderQuantization?: string
  anthropicApiKey: string
  googleApiKey: string
}

const openrouterBaseUrl = process.env.OPENROUTER_API_KEY
  ? "https://openrouter.ai/api/v1"
  : undefined

export const config: Config = {
  openaiApiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: process.env.OPENROUTER_BASE_URL || process.env.OPENAI_BASE_URL || openrouterBaseUrl,
  openaiProviderRoute: process.env.OPENROUTER_PROVIDER || "gmicloud",
  openaiProviderQuantization: process.env.OPENROUTER_QUANTIZATION || "fp8",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  googleApiKey: process.env.GOOGLE_API_KEY || "",
}

export function getProviderConfig(provider: string): { apiKey: string; baseUrl?: string } {
  switch (provider) {
    case "gspot":
      return { apiKey: "local" }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

export function getJudgeConfig(judge: string): { apiKey: string; model?: string } {
  switch (judge) {
    case "openai":
      return { apiKey: config.openaiApiKey }
    case "anthropic":
      return { apiKey: config.anthropicApiKey }
    case "google":
      return { apiKey: config.googleApiKey }
    default:
      throw new Error(`Unknown judge: ${judge}`)
  }
}
