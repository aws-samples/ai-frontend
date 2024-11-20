import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { Buffer } from "buffer";

export async function readPdf(pdfFile) {
  const lambda = new LambdaClient({
    region: process.env.REGION || "us-west-2",
    credentials: {
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
    },
  });

  const buffer = await pdfFile.arrayBuffer();
  const pdfBytes = Buffer.from(buffer).toString("base64");

  const command = new InvokeCommand({
    FunctionName: process.env.REACT_APP_PDF_FUNCTION_NAME || "",
    Payload: JSON.stringify({ pdf_content: String(pdfBytes) }),
  });

  const response = await lambda.send(command);
  const payload = Buffer.from(response.Payload || "").toString();
  const result = JSON.parse(payload);

  if (result.statusCode !== 200) {
    throw new Error(result.body);
  }
  return result.body;
}
