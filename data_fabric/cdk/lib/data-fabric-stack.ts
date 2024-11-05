import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lakeformation from "aws-cdk-lib/aws-lakeformation";
import * as glue from "aws-cdk-lib/aws-glue";
import { Construct } from "constructs";
import * as path from "path";
import { RemovalPolicy } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";

export class DataFabricStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ADMIN_ROLE_ARN = "arn:aws:iam::670015436176:role/Admin";

    new lakeformation.CfnDataLakeSettings(this, "DataLakeSettings", {
      admins: [
        {
          dataLakePrincipalIdentifier: ADMIN_ROLE_ARN,
        },
      ],
    });

    // Create S3 bucket for Lake Formation
    const dataBucket = new s3.Bucket(this, "DataLakeBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    require("child_process").execSync(
      "python3.11 ../scripts/generate_data.py",
      {
        stdio: "inherit",
      }
    );

    new s3deploy.BucketDeployment(this, "DeployFiles", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "assets"))],
      destinationBucket: dataBucket,
    });

    const crawlerRole = new Role(this, "GlueCrawlerRole", {
      assumedBy: new ServicePrincipal("glue.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSGlueServiceRole"
        ),
      ],
    });

    crawlerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ],
        resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
      })
    );

    // Create Glue Database
    const database = new glue.CfnDatabase(this, "GlueDatabase", {
      catalogId: this.account,
      databaseInput: {
        name: "data_lake_database",
        description: "Database for Lake Formation managed tables",
        locationUri: dataBucket.s3UrlForObject(),
      },
    });

    const crawler = new glue.CfnCrawler(this, "TestGlueCrawler", {
      name: `test-crawler-${this.account}`,
      role: crawlerRole.roleArn,
      databaseName: database.ref,
      targets: {
        s3Targets: [
          {
            path: "s3://" + dataBucket.bucketName,
          },
        ],
      },
      schedule: {
        scheduleExpression: "cron(0/15 * * * ? *)",
      },
    });
    crawler.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // Register the S3 bucket as a Lake Formation data lake location
    const lakeFormationResource = new lakeformation.CfnResource(
      this,
      "LakeFormationS3Location",
      {
        resourceArn: dataBucket.bucketArn,
        useServiceLinkedRole: true,
      }
    );

    database.node.addDependency(lakeFormationResource);

    // Grant Lake Formation permissions to the crawler role
    new lakeformation.CfnPermissions(this, "CrawlerDatabasePermissions", {
      dataLakePrincipal: {
        dataLakePrincipalIdentifier: crawlerRole.roleArn,
      },
      resource: {
        databaseResource: {
          name: database.ref,
        },
      },
      permissions: ["CREATE_TABLE", "ALTER", "DROP"],
    });

    // Grant Lake Formation permissions for the S3 location to the crawler
    new lakeformation.CfnPermissions(this, "CrawlerS3Permissions", {
      dataLakePrincipal: {
        dataLakePrincipalIdentifier: crawlerRole.roleArn,
      },
      resource: {
        dataLocationResource: {
          s3Resource: dataBucket.bucketArn + "/*",
        },
      },
      permissions: ["DATA_LOCATION_ACCESS"],
    });

    // Rest of your stack remains the same...
    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, "LakeFormationLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Role for Lambda to manage Lake Formation permissions",
    });

    // Add Lake Formation admin permissions to Lambda role
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "lakeformation:*",
          "glue:*",
          "s3:ListAllMyBuckets",
          "s3:GetBucketLocation",
        ],
        resources: ["*"],
      })
    );

    // Add specific S3 bucket permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ],
        resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
      })
    );

    // Add basic Lambda execution permissions
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    // L1 glue database construct doesn't expose the arn
    const databaseArn = cdk.Fn.join(":", [
      "arn",
      cdk.Aws.PARTITION,
      "glue",
      cdk.Aws.REGION,
      cdk.Aws.ACCOUNT_ID,
      "database",
      database.ref,
    ]);

    // Create Lambda function
    const adminLambda = new lambda.Function(this, "LakeFormationAdminLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "lake_manager.index",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda")),
      role: lambdaRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        GLUE_DATABASE_NAME: database.ref,
        DATA_BUCKET_NAME: dataBucket.bucketName,
        DATABASE_ARN: databaseArn,
      },
    });

    new lakeformation.CfnDataLakeSettings(this, "LambdaDataLakeSettings", {
      admins: [
        {
          dataLakePrincipalIdentifier: lambdaRole.roleArn,
        },
      ],
    });

    // Give the lambda full access to the glue database
    new lakeformation.CfnPermissions(this, "LambdaTablePermissions", {
      dataLakePrincipal: {
        dataLakePrincipalIdentifier: lambdaRole.roleArn,
      },
      resource: {
        tableResource: {
          databaseName: database.ref,
          tableWildcard: {},
        },
      },
      permissions: ["ALL"],
    });

    new lakeformation.CfnPermissions(this, "LambdaDBPermissions", {
      dataLakePrincipal: {
        dataLakePrincipalIdentifier: lambdaRole.roleArn,
      },
      resource: {
        databaseResource: {
          name: database.ref,
        },
      },
      permissions: ["ALL"],
    });

    const { apiKey, apiUrl } = this.createApiGateway(adminLambda);

    new cdk.CfnOutput(this, "ApiUrl", {
      value: apiUrl,
      description: "API Gateway URL",
    });

    new cdk.CfnOutput(this, "ApiKey", {
      value: apiKey.keyId,
      description: "API Key ID",
    });

    new cdk.CfnOutput(this, "DataLakeBucketName", {
      value: dataBucket.bucketName,
      description: "Name of the S3 bucket used as data lake",
    });

    new cdk.CfnOutput(this, "GlueDatabaseName", {
      value: database.ref,
      description: "Name of the Glue database",
    });

    new cdk.CfnOutput(this, "LambdaFunctionArn", {
      value: adminLambda.functionArn,
      description: "ARN of the Lake Formation admin Lambda function",
    });
  }

  createApiGateway(LakeFormationAdminlambda: lambda.Function) {
    const api = new apigateway.RestApi(this, "DataFabricAPI", {
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
    });

    // Create usage plan
    const usagePlan = api.addUsagePlan("DataFabricUsagePlan", {
      name: "Data Fabric Usage Plan",
    });

    // Let API Gateway handle the deployment and stage
    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    const apiKey = api.addApiKey("DataFabricApiKey");
    usagePlan.addApiKey(apiKey);

    function createEndpoint(
      method: string,
      suffix: string,
      fn: lambda.Function,
      integrationSettings: object = {},
      resourceSettings: object = {}
    ) {
      const resource = api.root.addResource(suffix);
      resource.addMethod(
        method,
        new apigateway.LambdaIntegration(fn, { ...integrationSettings }),
        {
          apiKeyRequired: true,
          methodResponses: [
            {
              statusCode: "200",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Origin": true,
              },
            },
          ],
          ...resourceSettings,
        }
      );

      let allowedMethods = [method];
      if (method === "POST") {
        allowedMethods = allowedMethods.concat(["OPTIONS"]);
      }

      resource.addCorsPreflight({
        allowOrigins: ["*"],
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
        allowMethods: allowedMethods,
      });
    }

    createEndpoint("POST", "request-permission", LakeFormationAdminlambda);
    createEndpoint("GET", "list-assets", LakeFormationAdminlambda);

    return {
      apiKey,
      apiUrl: api.urlForPath(),
    };
  }
}
