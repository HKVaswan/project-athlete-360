// src/lib/ai/aiClient.ts
import logger from "../../logger";

export type AiCompletionRequest = {
  model?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
};

class AiClient {
  async complete(req: AiCompletionRequest) {
    logger.debug("[AiClient] complete called", { model: req.model || "local", promptLen: req.prompt.length });
    // Safe placeholder: return an echo-like response. Replace with Mistral/Gemini/OG providers.
    return {
      id: "local-echo-1",
      model: req.model ?? "local-echo",
      output: `ECHO: ${req.prompt.slice(0, 1000)}`,
    };
  }
}

export const aiClient = new AiClient();
export default aiClient;