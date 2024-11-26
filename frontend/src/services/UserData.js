import { Athena, StartQueryExecutionCommand } from "@aws-sdk/client-athena";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

async function assumeRole(sts) {
  try {
    const command = new AssumeRoleCommand({
      RoleArn: process.env.REACT_APP_DATAZONE_ROLE_ARN,
      RoleSessionName: "DataZoneReactAppSession",
      //DurationSeconds: 3600, // 1 hour
    });

    const response = await sts.send(command);

    // These are the temporary credentials
    return {
      accessKeyId: response.Credentials.AccessKeyId,
      secretAccessKey: response.Credentials.SecretAccessKey,
      sessionToken: response.Credentials.SessionToken,
      expiration: response.Credentials.Expiration
    };

  } catch (error) {
    console.error("Error assuming role:", error);
    throw error;
  }
}

export default class UserDataClient {
  region = "us-east-1";
  databaseName = process.env.REACT_APP_DB_NAME;
  tableName = process.env.REACT_APP_TABLE_NAME;
  s3OutputBucket = process.env.REACT_APP_S3_OUTPUT_BUCKET;
  athena;
  chat;
  learningData;
  sts;
  isInitialized = false;

  async initialize(chat) {
    console.log("Initializing UserDataClient.");

    this.chat = chat;

    // This function seems to happen async, which means we need to make
    // the whole initialization process of this object also async.
    const sts = new STSClient({
      region: this.region,
      credentials: {
        accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
      },
    });


    const role = process.env.REACT_APP_DATAZONE_ROLE_ARN;
    const credentials = await assumeRole(sts, role)

    this.athena = new Athena({
      region: this.region,
      credentials: {
        accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
      },
    });

    this.isInitialized = true;
  }

  constructor(chat) {
    this.initializationPromise = this.initialize(chat);
  }

  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }
  }

  async executeQuery(query) {
    await this.ensureInitialized();

    console.log(`Calling Athena to ${this.databaseName}.${this.tableName}`);

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

    const { ResultSet } = await this.athena.getQueryResults({
      QueryExecutionId,
    });

    console.log("Query results:", ResultSet);
    const rows = ResultSet.Rows.slice(1);
    console.log("Query rows:", rows);
    return rows;
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
    await this.ensureInitialized();
    const results = await this.executeQuery(
      `SELECT DISTINCT user_id FROM "${this.databaseName}"."${this.tableName}"`
    );
    return results.map((row) => row.Data[0].VarCharValue);
  }

  async explainCustomization(userName, learningData, selectedModel) {
    const learningDataString = JSON.stringify(learningData, null, 2);
    console.log(
      "Generating explanation from learning data:",
      learningDataString
    );

    const prompt = `
    You are an assistant which provides personalized content for users of an online learning platform. You tailor your content ot match a user's preferences.

    You can decide what learning style (AKA "learning plan") a user should be put on. You should decide what plan to put a user on in accordance with their past learning behavior. The following learning plans are available:
  1. "Provide technical explanations"
  2. "Provide explanations in simple language."

  You should decide what plan to put a learner on, and give 1-2 sentences explaining your decision.

  A good response looks like this: "I put ${userName} on plan <selected-plan/>. I chose to do this because I see that ${userName}'s learning history <explanation/>"

  For user ${userName}, please use their past learning history and select a learning plan, and explain your choice. Their past learning history is as follows: <history>${learningDataString}</history>`;
    return await this.chat.getResponse(prompt, selectedModel);
  }
}
