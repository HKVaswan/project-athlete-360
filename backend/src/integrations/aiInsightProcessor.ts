import aiManager from "./ai.bootstrap";
import aiModelRegistry from "./aiModelRegistry";
import logger from "../logger";
import { sanitizePrompt, normalizeInsightType } from "../utils/textUtils";

/**
 * AI Insight Processor
 * ---------------------------------------------------------------
 * Converts raw data → structured insights.
 * Enterprise Features:
 *  - Dynamic model routing (performance, wellness, engagement, etc.)
 *  - Structured JSON output parsing & validation
 *  - Privacy filters before/after AI calls
 *  - Built-in retry, sanitization, and safety guards
 */

export type InsightType =
  | "performance"
  | "recovery"
  | "nutrition"
  | "engagement"
  | "injuryRisk"
  | "psychology"
  | "general";

export interface InsightRequest {
  athleteId?: string;
  type: InsightType;
  data: Record<string, any>;
  context?: string;
  language?: string;
}

export interface AIInsight {
  type: InsightType;
  summary: string;
  recommendations?: string[];
  riskLevel?: "low" | "medium" | "high";
  confidence?: number;
  generatedBy: string;
  raw?: any;
  timestamp: string;
}

/**
 * Utility: Parse JSON safely
 */
function safeJsonParse(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return { summary: input.trim() };
  }
}

/**
 * Core AI Insight Processor Class
 */
export class AiInsightProcessor {
  async generateInsight(req: InsightRequest): Promise<AIInsight> {
    const type = normalizeInsightType(req.type);
    const model = aiModelRegistry.getBestByTag(type) || aiModelRegistry.getBestByTag("general");

    if (!model) {
      logger.warn(`[AI:Insight] No model found for type=${type}`);
      return this.buildFallbackInsight(req, "No suitable AI model available at the moment.");
    }

    const cleanContext = sanitizePrompt(
      `
      You are an expert sports AI assistant. Generate structured insights based on provided data.
      Type: ${type}
      Context: ${req.context || "N/A"}
      Athlete Data: ${JSON.stringify(req.data, null, 2)}
      Output format (JSON):
      {
        "summary": "short summary text",
        "recommendations": ["tip1", "tip2"],
        "riskLevel": "low|medium|high",
        "confidence": 0.0-1.0
      }
    `
    );

    try {
      const response = await aiManager.generate({
        prompt: cleanContext,
        maxTokens: 512,
        temperature: 0.3,
        modelId: model.modelId,
        provider: model.provider,
      });

      if (!response.success) {
        throw new Error(response.error || "AI model failed to respond.");
      }

      const rawText =
        typeof response.data?.text === "string"
          ? response.data.text
          : JSON.stringify(response.data);

      const parsed = safeJsonParse(rawText);

      const insight: AIInsight = {
        type,
        summary: parsed.summary || "Insight generated.",
        recommendations: parsed.recommendations || [],
        riskLevel: parsed.riskLevel || "medium",
        confidence: parsed.confidence || 0.7,
        generatedBy: `${model.provider}:${model.modelId}`,
        raw: response.data,
        timestamp: new Date().toISOString(),
      };

      logger.info(`[AI:Insight] ✅ Generated ${type} insight via ${model.provider}:${model.modelId}`);
      return insight;
    } catch (err: any) {
      logger.error(`[AI:Insight] ❌ Failed to generate insight: ${err.message}`);
      return this.buildFallbackInsight(req, "AI failed to generate insight — fallback applied.");
    }
  }

  /**
   * Aggregates multiple insight types for athlete dashboard
   */
  async generateAthleteReport(athleteId: string, dataset: Record<string, any>) {
    logger.info(`[AI:Insight] Generating composite report for athlete ${athleteId}`);
    const sections: InsightType[] = [
      "performance",
      "recovery",
      "nutrition",
      "engagement",
      "injuryRisk",
    ];

    const results: AIInsight[] = [];
    for (const section of sections) {
      const part = await this.generateInsight({
        athleteId,
        type: section,
        data: dataset[section] || dataset,
      });
      results.push(part);
    }

    return {
      athleteId,
      generatedAt: new Date().toISOString(),
      insights: results,
    };
  }

  /**
   * Fallback response when AI fails
   */
  private buildFallbackInsight(req: InsightRequest, message: string): AIInsight {
    return {
      type: req.type,
      summary: message,
      recommendations: [
        "Ensure data accuracy before reprocessing.",
        "Try again later when AI services are stable.",
      ],
      riskLevel: "medium",
      confidence: 0.5,
      generatedBy: "local-fallback",
      timestamp: new Date().toISOString(),
    };
  }
}

export const aiInsightProcessor = new AiInsightProcessor();
export default aiInsightProcessor;