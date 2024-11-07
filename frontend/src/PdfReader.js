import AWS from "aws-sdk";
import pdf2image from "pdf2image";
import { promises as fs } from "fs";

export class PdfImageAnalyzer {
  bedrock = new AWS.BedrockRuntime({
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
    },
  });

  async convertPdfToImages(pdfPath) {
    try {
      const pdfBuffer = await fs.readFile(pdfPath);
      const images = await pdf2image.convertBuffer(pdfBuffer, {
        format: "jpeg",
        density: 300,
      });
      return images;
    } catch (error) {
      throw new Error(`Error converting PDF to images: ${error.message}`);
    }
  }

  async imageToBase64(imageBuffer) {
    try {
      return imageBuffer.toString("base64");
    } catch (error) {
      throw new Error(`Error converting image to base64: ${error.message}`);
    }
  }

  async analyzeImage(
    imageBuffer,
    prompt = "Please provide a detailed summary of this image."
  ) {
    try {
      const base64Image = await this.imageToBase64(imageBuffer);

      const body = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      };

      const response = await this.bedrock
        .invokeModel({
          modelId: "anthropic.claude-3-sonnet",
          body: JSON.stringify(body),
        })
        .promise();

      const responseBody = JSON.parse(response.body.toString());
      return responseBody.content[0].text;
    } catch (error) {
      throw new Error(`Error analyzing image: ${error.message}`);
    }
  }

  async processPdf(pdfPath, prompt = null) {
    try {
      const images = await this.convertPdfToImages(pdfPath);
      const results = [];

      for (let i = 0; i < images.length; i++) {
        const pagePrompt =
          prompt ||
          `Please provide a detailed summary of page ${i + 1} of this document.`;
        const analysis = await this.analyzeImage(images[i], pagePrompt);
        results.push({
          page: i + 1,
          analysis,
        });
      }

      return results;
    } catch (error) {
      throw new Error(`Error processing PDF: ${error.message}`);
    }
  }
}
