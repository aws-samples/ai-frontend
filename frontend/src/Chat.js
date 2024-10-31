import { v4 as uuidv4 } from "uuid";

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

// Function which strips preceeding whitespace from the response.
const stripReply = (text) => {
  return text.replace(/^\s+/g, "").replace(/\n+$/, "");
};

const SESSION_ID = String(uuidv4());
export class Chat {
  timeoutSeconds = 180;
  id = SESSION_ID;
  apiKey = "";

  getUrl(path) {
    const host = process.env.REACT_APP_API_URL;
    return `${host}/${path}?sessionId=${this.id}`;
  }

  async getUploadUrl(file) {
    console.log("File type:", file.type);
    try {
      const response = await fetch(this.getUrl("upload"), {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": file.type,
        },
        body: file,
      });

      console.log("Upload URL response status:", response.status);
      console.log(
        "Upload URL response headers:",
        Object.fromEntries(response.headers.entries())
      );

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Error response body:", errorBody);
        throw new Error(
          `Failed to get upload URL: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      console.log("Upload URL data:", data);
      return data.uploadUrl;
    } catch (error) {
      console.error("Error getting upload URL:", error);
      throw error;
    }
  }

  async uploadFile(file) {
    try {
      // Step 1: Get the upload URL
      const uploadUrl = await this.getUploadUrl(file);

      // Step 2: Upload the file to the provided URL
      console.log("Starting file upload to:", uploadUrl);
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      console.log("File upload response status:", uploadResponse.status);
      console.log(
        "File upload response headers:",
        Object.fromEntries(uploadResponse.headers.entries())
      );

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text();
        console.error("Error response body:", errorBody);
        throw new Error(
          `Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}`
        );
      }

      console.log("File upload successful");
      return "File uploaded successfully";
    } catch (error) {
      console.error("Error in uploadFile:", error);
      throw error;
    }
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

  async post(payload) {
    const body = JSON.stringify(payload);
    console.log(`Making request with body: ${body}`);

    try {
      const response = await fetch(this.getUrl("message"), {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body,
      });

      if (response.status === 200) {
        console.log("Succeeded response body:", response.body);
        return response;
      } else {
        console.log("Request failed with status code:", response.status);
        console.log("Failed response object:", response);
        return null;
      }
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  }

  async getResponse(message, thoughtCallback = null, isReview = false) {
    console.log(isReview);
    try {
      const result = await this.sendMessage(message, thoughtCallback, isReview);
      console.log(`Result: ${JSON.stringify(result)}`);

      if (!result || !result.responses || result.responses.length === 0) {
        throw new Error("Invalid response format");
      }

      const lastStep = result.responses[result.responses.length - 1];
      const reply = stripReply(String(lastStep.data));
      const thoughts = result.responses.slice(0, result.responses.length - 1);

      // Extract sources from the result
      const sources = result.sources || [];

      return new AgentOutput(reply, thoughts, sources);
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  async sendMessage(message, thoughtCallback = null, isReview = false) {
    let payload = {};
    if (!isReview) {
      payload = {
        message: message,
      };
    } else {
      payload = {
        message: message,
        isReview: "true",
      };
    }

    const postResponse = await this.post(payload);
    const getResponse = await this.pollForResponse(
      postResponse,
      thoughtCallback
    );
    return getResponse;
  }

  async pollForResponse(response, thoughtCallback = null) {
    let currWaitTime = 0;
    let allResponses = [];
    while (currWaitTime < this.timeoutSeconds) {
      try {
        const response = await fetch(this.getUrl("poll"), {
          method: "GET",
          headers: {
            "x-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
        });

        if (response.status === 200) {
          const body = await response.json();
          console.log("Response Body:", body);
          if (body.status === "COMPLETE") {
            // If there are new thoughts, call the callback
            if (
              thoughtCallback &&
              body.responses.length > allResponses.length
            ) {
              const newThoughts = body.responses.slice(allResponses.length, -1);
              newThoughts.forEach((thought) => thoughtCallback(thought));
            }
            // Return both responses and sources
            return {
              responses: body.responses,
              sources: body.sources || [],
            };
          } else {
            // If there are new thoughts, call the callback
            if (
              thoughtCallback &&
              body.responses &&
              body.responses.length > allResponses.length
            ) {
              const newThoughts = body.responses.slice(allResponses.length);
              newThoughts.forEach((thought) => thoughtCallback(thought));
            }
            allResponses = body.responses || [];
            await new Promise((resolve) => setTimeout(resolve, 3000));
            currWaitTime += 3;
          }
        } else {
          console.log("Request failed with status code:", response.status);
          console.log("Failed response object:", response);
          return null;
        }
      } catch (error) {
        console.error("Error:", error);
        return null;
      }
    }
    throw new Error("Polling timed out");
  }
}
