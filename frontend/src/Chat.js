import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

// const LLM_GATEWAY_URL = `${process.env.REACT_APP_LLM_GATEWAY_URL}/api/v1`;
const LLM_GATEWAY_URL = `https://api.ajuny.people.aws.dev/api/v1`;
console.log(`LLM_GATEWAY_URL: ${LLM_GATEWAY_URL}`);

// TODO: Load environment variables with "dotenv" equivalent.

export class AgentOutput {
  reply;
  thoughts;
  sources;

  constructor(reply, thoughts, sources = []) {
    this.reply = reply;
    this.thoughts = thoughts;
    this.sources = sources;
  }
}

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

const SESSION_ID = String(uuidv4());
export class Chat {
  timeoutSeconds = 180;
  id = SESSION_ID;
  apiKey;
  client;
  model = "anthropic.claude-3-sonnet-20240229-v1:0";
  threadSafeSessionState = new ThreadSafeSessionState();

  refreshClient() {
    console.log(`Refreshing client with apiKey ${this.apiKey}`);
    this.client = new OpenAI({
      baseURL: LLM_GATEWAY_URL,
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  /* Function which strips preceeding whitespace from the response.
   */
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

      // Extract sources from the result
      const sources = result.sources || [];

      return new AgentOutput(reply, [], []);
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  async post(question, model) {
    const chatId = await this.threadSafeSessionState.get("chat_id");
    if (chatId) {
      // ToDo: Restore chat_id functionality to support server side history
      //message["chat_id"] = await this.threadSafeSessionState.get("chat_id");
      console.log(`found chat id ${chatId} in context`);
    } else {
      console.log("did not find chat id in context");
    }

    let fullResponse = "";
    try {
      const stream = await this.client.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: question }],
        max_tokens: 1000,
        temperature: 1,
        n: 1,
        stream: true,
        stream_options: { include_usage: true },
      });

      // ToDo: Restore chat_id functionality to support server side history
      // console.log(`Assigning chat id: ${response_json.get("chat_id")}`);
      // await this.threadSafeSessionState.set("chat_id", response_json.get("chat_id"));

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
}
