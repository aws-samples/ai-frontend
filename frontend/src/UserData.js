import { Athena, StartQueryExecutionCommand } from "@aws-sdk/client-athena";

const DB_NAME = "data-fabric_db";
const TABLE_NAME = "data-fabric_data";
const S3_OUTPUT_BUCKET = process.env.REACT_APP_S3_OUTPUT_BUCKET;

const athena = new Athena({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
  },
});

async function executeQuery(query, mapper) {
  const command = new StartQueryExecutionCommand({
    QueryString: query,
    QueryExecutionContext: { Database: "data-fabric_db" },
    ResultConfiguration: { OutputLocation: S3_OUTPUT_BUCKET },
  });

  const { QueryExecutionId } = await athena.send(command);

  if (!QueryExecutionId) {
    return [];
  }
  console.log(`QueryExecutionId: ${QueryExecutionId}`);

  while (true) {
    const result = await athena.getQueryExecution({
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

  const { ResultSet } = await athena.getQueryResults({ QueryExecutionId });
  return ResultSet.Rows.slice(1);
}

export async function getDocumentTypeCounts(userId) {
  const results = await executeQuery(
    `SELECT document_type, COUNT(document_type) as count
     FROM "data-fabric_db"."data-fabric_data"
     WHERE user_id = '${userId}'
     GROUP BY document_type`,
    S3_OUTPUT_BUCKET
  );
  return results.reduce(
    (acc, row) => ({
      ...acc,
      [row.Data[0].VarCharValue]: parseInt(row.Data[1].VarCharValue),
    }),
    {}
  );
}

export async function listUserIds() {
  const results = await executeQuery(
    `SELECT DISTINCT user_id FROM "data-fabric_db"."data-fabric_data"`,
    S3_OUTPUT_BUCKET
  );
  return results.map((row) => row.Data[0].VarCharValue);
}
