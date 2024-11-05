import { Athena } from "aws-sdk";

const DB_NAME = "data-fabric_db";
const TABLE_NAME = "data-fabric_data";
const S3_OUTPUT_BUCKET = process.env.S3_OUTPUT_BUCKET

async function executeQuery(query, mapper) {
  const athena = new Athena();
  const { QueryExecutionId } = await athena
    .startQueryExecution({
      QueryString,
      QueryExecutionContext: { Database: "data-fabric_db" },
      ResultConfiguration: { OutputLocation: S3_OUTPUT_BUCKET },
    })
    .promise();

  while (true) {
    const { QueryExecution } = await athena
      .getQueryExecution({ QueryExecutionId })
      .promise();
    if (
      ["SUCCEEDED", "FAILED", "CANCELLED"].includes(QueryExecution.Status.State)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const { ResultSet } = await athena
    .getQueryResults({ QueryExecutionId })
    .promise();
  return mapper(ResultSet.Rows.slice(1));
}

export function getDocumentTypeCounts(userId) {
  executeQuery(
    `SELECT document_type, COUNT(document_type) as count
     FROM "data-fabric_db"."data-fabric_data"
     WHERE user_id = '${userId}'
     GROUP BY document_type`,
    S3_OUTPUT_BUCKET,
    (rows) =>
      rows.map((row) => ({
        documentType: row.Data[0].VarCharValue,
        count: parseInt(row.Data[1].VarCharValue),
      }))
  );
}

export function listUserIds() {
  executeQuery(
    `SELECT DISTINCT user_id FROM "data-fabric_db"."data-fabric_data"`,
    S3_OUTPUT_BUCKET,
    (rows) => rows.map((row) => row.Data[0].VarCharValue)
  );
}
