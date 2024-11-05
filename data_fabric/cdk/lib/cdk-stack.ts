import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as athena from "aws-cdk-lib/aws-athena";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const resourcePrefix = "data-fabric";

    const userDataBucket = new s3.Bucket(this, "UserDataBucket", {
      bucketName: `${resourcePrefix}-data`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
    });

    const athenaResultsBucket = new s3.Bucket(this, "AthenaResultsBucket", {
      bucketName: `${resourcePrefix}-athena-results`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
    });

    const workGroup = new athena.CfnWorkGroup(this, "AthenaWorkGroup", {
      name: `${resourcePrefix}-workgroup`,
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaResultsBucket.bucketName}/`,
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
      },
    });

    const database = new glue.CfnDatabase(this, "UserDatabase", {
      catalogId: this.account,
      databaseInput: {
        name: `${resourcePrefix}_db`,
        description: "Database for user data analysis",
      },
    });

    const table = new glue.CfnTable(this, "UserTable", {
      catalogId: this.account,
      databaseName: database.ref,
      tableInput: {
        name: `${resourcePrefix}_data`,
        tableType: "EXTERNAL_TABLE",
        parameters: {
          classification: "csv",
          "skip.header.line.count": "1",
        },
        storageDescriptor: {
          location: `s3://${userDataBucket.bucketName}/`,
          inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
          outputFormat:
            "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
          serdeInfo: {
            serializationLibrary:
              "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
            parameters: {
              "field.delim": ",",
            },
          },
          columns: [
            { name: "user_id", type: "string" },
            { name: "timestamp", type: "timestamp" },
            { name: "document_id", type: "string" },
            { name: "document_type", type: "string" },
          ],
        },
      },
    });

    new s3deploy.BucketDeployment(this, "DeployData", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "..", "..", "data")),
      ],
      destinationBucket: userDataBucket,
      destinationKeyPrefix: "data", // This matches the prefix in the Glue table definition
      include: ["user_learning_data.csv"], // Only include this specific file
    });

    new cdk.CfnOutput(this, "DataBucketName", {
      value: userDataBucket.bucketName,
      description: "The name of the S3 bucket containing the data",
    });

    new cdk.CfnOutput(this, "AthenaBucketName", {
      value: athenaResultsBucket.bucketName,
      description: "The name of the S3 bucket containing Athena results",
    });
  }
}
