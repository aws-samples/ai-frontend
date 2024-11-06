import { Athena, StartQueryExecutionCommand } from "@aws-sdk/client-athena";

console.log(process.env.REACT_APP_S3_OUTPUT_BUCKET)

export class UserDataClient {
  databaseName = "data-fabric_db";  // TODO: Use env vars
  tableName = "data-fabric_data";  // TODO: Use env vars
  s3OutputBucket = process.env.REACT_APP_S3_OUTPUT_BUCKET;
  athena = new Athena({
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
    },
  });
  chat;
  learningData;

  constructor(chat) {
    this.chat = chat
  }

  async executeQuery(query) {
    const command = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: "data-fabric_db" },
      ResultConfiguration: { OutputLocation: this.s3OutputBucket },
    });

    const { QueryExecutionId } = await this.athena.send(command);

    if (!QueryExecutionId) {
      return [];
    }
    console.log(`QueryExecutionId: ${QueryExecutionId}`);

    while (true) {
      const result = await this.athena.getQueryExecution({
        QueryExecutionId,
      });
      if (
        result &&
        result.QueryExecution &&
        result.QueryExecution.Status &&
        result.QueryExecution.Status.State
      ) {
        if (
          ["SUCCEEDED", "FAILED", "CANCELLED"].includes(
            result.QueryExecution.Status.State
          )
        ) {
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const { ResultSet } = await this.athena.getQueryResults({ QueryExecutionId });
    return ResultSet.Rows.slice(1);
  }

  async getDocumentTypeCounts(userId) {
    const results = await this.executeQuery(
     `SELECT document_type, COUNT(document_type) as count
     FROM "${this.databaseName}"."${this.tableName}"
     WHERE user_id = '${userId}'
     GROUP BY document_type`
    );
    return results.reduce(
      (acc, row) => ({
        ...acc,
        [row.Data[0].VarCharValue]: parseInt(row.Data[1].VarCharValue),
      }),
      {}
    );
  }

  async listUserIds() {
    const results = await this.executeQuery(
      `SELECT DISTINCT user_id FROM "data-fabric_db"."data-fabric_data"`
    );
    return results.map((row) => row.Data[0].VarCharValue);
  }

  async explainCustomization(userName, learningData, selectedModel) {
    const learningDataString = JSON.stringify(learningData, null, 2)
    console.log("Generating explanation from learning data:", learningDataString)

    const prompt = `
    You are an assistant which provides personalized content for users of an online learning platform. You tailor your content ot match a user's preferences.

    You can decide what learning style (AKA "learning plan") a user should be put on. You should decide what plan to put a user on in accordance with their past learning behavior. The following learning plans are available:
  1. "Provide technical explanations"
  2. "Provide explanations in simple language."

  You should decide what plan to put a learner on, and give 1-2 sentences explaining your decision.

  A good response looks like this: "I put ${userName} on plan <selected-plan/>. I chose to do this because I see that ${userName}'s learning history <explanation/>"

  For user ${userName}, please use their past learning history and select a learning plan, and explain your choice. Their past learning history is as follows: <history>${learningDataString}</history>`
    return await this.chat.getResponse(prompt, selectedModel)
  }
}
