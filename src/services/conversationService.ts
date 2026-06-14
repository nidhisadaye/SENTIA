import type { SupportedLanguage } from "./intentRouter";

export type ConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ConversationProvider = "openrouter" | "groq";

export type ConversationConfig = {
  provider?: ConversationProvider;
  openRouterApiKey?: string;
  groqApiKey?: string;
  model?: string;
};

const systemPrompt = `You are Sentia, a concise voice assistant for visually impaired users.
Answer in the user's language when possible: English, Hindi, or Marathi.
Keep responses short, clear, and spoken-friendly.
Do not handle navigation, directions, current location, or nearby places. Those are handled by Sentia Navigation Mode.`;

export class ConversationService {
  private history: ConversationMessage[] = [{ role: "system", content: systemPrompt }];
  private config: Required<ConversationConfig>;

  constructor(config?: ConversationConfig) {
    this.config = {
      provider: config?.provider ?? "openrouter",
      openRouterApiKey: config?.openRouterApiKey ?? process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? "",
      groqApiKey: config?.groqApiKey ?? process.env.EXPO_PUBLIC_GROQ_API_KEY ?? "",
      model: config?.model ?? process.env.EXPO_PUBLIC_SENTIA_CHAT_MODEL ?? "meta-llama/llama-3.1-8b-instruct",
    };
  }

  configure(config: ConversationConfig) {
    this.config = {
      ...this.config,
      ...config,
      provider: config.provider ?? this.config.provider,
      openRouterApiKey: config.openRouterApiKey ?? this.config.openRouterApiKey,
      groqApiKey: config.groqApiKey ?? this.config.groqApiKey,
      model: config.model ?? this.config.model,
    };
  }

  reset() {
    this.history = [{ role: "system", content: systemPrompt }];
  }

  async ask(userText: string, language: SupportedLanguage): Promise<string> {
    const languageHint = this.languageHint(language);
    this.history.push({ role: "user", content: `${languageHint}\n${userText}` });
    this.trimHistory();

    try {
      const reply = await this.requestCompletion();
      const concise = this.cleanReply(reply);
      this.history.push({ role: "assistant", content: concise });
      return concise;
    } catch (error) {
      this.history.pop();
      return this.networkFallback(language);
    }
  }

  private async requestCompletion() {
    if (this.config.provider === "groq") return this.requestGroq();
    return this.requestOpenRouter();
  }

  private async requestOpenRouter() {
    if (!this.config.openRouterApiKey) throw new Error("Missing OpenRouter API key.");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sentia.local",
        "X-Title": "Sentia",
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.history,
        temperature: 0.4,
        max_tokens: 180,
      }),
    });

    if (!response.ok) throw new Error(`OpenRouter failed: ${response.status}`);
    const json = await response.json();
    return json.choices?.[0]?.message?.content ?? "";
  }

  private async requestGroq() {
    if (!this.config.groqApiKey) throw new Error("Missing Groq API key.");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model || "llama-3.1-8b-instant",
        messages: this.history,
        temperature: 0.4,
        max_tokens: 180,
      }),
    });

    if (!response.ok) throw new Error(`Groq failed: ${response.status}`);
    const json = await response.json();
    return json.choices?.[0]?.message?.content ?? "";
  }

  private trimHistory() {
    const system = this.history[0];
    const recent = this.history.slice(-12);
    this.history = [system, ...recent.filter((message) => message.role !== "system")];
  }

  private cleanReply(text: string) {
    return (text || "I am sorry, I could not prepare an answer.")
      .replace(/\s+/g, " ")
      .replace(/\*\*/g, "")
      .trim()
      .slice(0, 700);
  }

  private languageHint(language: SupportedLanguage) {
    if (language === "hi") return "Reply in Hindi.";
    if (language === "mr") return "Reply in Marathi.";
    return "Reply in English.";
  }

  private networkFallback(language: SupportedLanguage) {
    if (language === "hi") return "माफ कीजिए, अभी नेटवर्क समस्या है। कृपया फिर से पूछें।";
    if (language === "mr") return "माफ करा, सध्या नेटवर्क समस्या आहे. कृपया पुन्हा विचारा.";
    return "Sorry, I am having network trouble. Please ask again.";
  }
}

export const conversationService = new ConversationService();
