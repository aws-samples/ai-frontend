import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

const LLM_GATEWAY_URL = process.env.REACT_APP_LLM_GATEWAY_URL

export class ThreadSafeSessionState {
  constructor() {
    this.lock = false;
    this.sessionState = {};
  }

  async withLock(fn) {
    while (this.lock) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    this.lock = true;
    try {
      return fn();
    } finally {
      this.lock = false;
    }
  }

  async get(key) {
    return this.withLock(() => this.sessionState[key]);
  }

  async set(key, value) {
    return this.withLock(() => {
      this.sessionState[key] = value;
    });
  }

  async delete(key) {
    return this.withLock(() => {
      delete this.sessionState[key];
    });
  }
}

export class ChatClient {
  timeoutSeconds = 180;
  id = String(uuidv4());
  apiKey = process.env.REACT_APP_API_KEY || "";
  client;
  model = "anthropic.claude-3-sonnet-20240229-v1:0";
  threadSafeSessionState = new ThreadSafeSessionState();
  documentText = null;

  refreshClient() {
    console.log(`Refreshing client with apiKey ${this.apiKey}`);
    this.client = new OpenAI({
      baseURL: LLM_GATEWAY_URL,
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  // Function which strips preceeding whitespace from the response.
  stripReply = (text) => {
    return text.replace(/^\s+/g, "").replace(/\n+$/, "");
  };

  getUrl(path) {
    const host = process.env.REACT_APP_API_URL;
    return `${host}/${path}?sessionId=${this.id}`;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.refreshClient();
  }

  async postWithRetries(payload, retryLimit = 10) {
    let nRetries = 0;
    console.log(`retry limit: ${retryLimit.toString()}`);
    while (nRetries < retryLimit) {
      const llmResponse = this.post(payload);
      if (llmResponse.status === 200) {
        return llmResponse;
      }
      nRetries++;
    }
  }

  async getResponse(message, model) {
    try {
      const result = await this.post(message, model);

      const reply = result

      return reply
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  async post(message, model) {
    const chatId = await this.threadSafeSessionState.get("chat_id");
    if (chatId) {
      console.log(`found chat id ${chatId} in context`);
    } else {
      console.log("did not find chat id in context");
    }

    if (this.documentText) {
      message = message + `\nThis document may help you: <document>${this.documentText}</document>`
      console.log("Augmented message:", message)
    }

    let fullResponse = "";
    try {
      console.log(message, model)
      const stream = await this.client.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: message }],
        max_tokens: 1000,
        temperature: 1,
        n: 1,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        console.log(chunk);
        try {
          fullResponse += chunk.choices[0]?.delta?.content || "";
        } catch (error) {
          console.error("Error:", error);
          fullResponse += "Error while processing the response!";
        }
      }
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        if (error.status === 429) {
          fullResponse += error.message; // Return the error message from the API
        } else {
          fullResponse += `API error occurred: ${error.status} - ${error.message}`;
        }
      } else {
        console.error(
          `Caught an exception of type: ${error?.constructor.name}`
        );
        fullResponse += `An unexpected error occurred: ${error?.toString()} of type: ${error?.constructor.name}`;
      }
    }

    console.log("response:", fullResponse);
    return fullResponse;
  }

  async getResponseWithLearningStyle(message, model, learningStyle = null) {
    let augmented_message = message;
    if (learningStyle) {
      augmented_message = message + `This user prefers their answers to match the following learning style ${learningStyle}. Your answer should explicitly be tailored to this style of learning.`
    }
    return await this.post(augmented_message, model)
  }
}

export default ChatClient;
