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
import * as cr from "aws-cdk-lib/custom-resources";

export class DataFabricStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ADMIN_ROLE_ARN = `arn:aws:iam::${this.account}:role/cdk-hnb659fds-cfn-exec-role-${this.account}-${this.region}`;

    const adminSetup = new lakeformation.CfnDataLakeSettings(
      this,
      "DataLakeSettings",
      {
        admins: [
          {
            dataLakePrincipalIdentifier: ADMIN_ROLE_ARN,
          },
        ],
      }
    );

    // Create S3 bucket for Lake Formation
    const dataBucket = new s3.Bucket(this, "DataLakeBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    require("child_process").execSync("python ../scripts/generate_data.py", {
      stdio: "inherit",
    });

    const deployment = new s3deploy.BucketDeployment(this, "DeployFiles", {
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

    const csvClassifier = new glue.CfnClassifier(
      this,
      "DocumentsCSVClassifier",
      {
        csvClassifier: {
          name: "documents-csv-classifier",
          delimiter: ",",
          containsHeader: "PRESENT",
          header: ["user_id", "timestamp", "document_id", "document_type"],
          disableValueTrimming: false,
          allowSingleColumn: false,
        },
      }
    );

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
        scheduleExpression: "cron(0 * * * ? *)",
      },
      classifiers: [csvClassifier.ref],
    });
    crawler.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // L1 crawler construct does not expose arn so we construct it like this
    const crawlerArn = `arn:aws:glue:${this.region}:${this.account}:crawler/${crawler.ref}`;

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
    lakeFormationResource.node.addDependency(adminSetup);

    // Grant Lake Formation permissions to the crawler role
    const CrawlerDBPerms = new lakeformation.CfnPermissions(
      this,
      "CrawlerDatabasePermissions",
      {
        dataLakePrincipal: {
          dataLakePrincipalIdentifier: crawlerRole.roleArn,
        },
        resource: {
          databaseResource: {
            name: database.ref,
          },
        },
        permissions: ["CREATE_TABLE", "ALTER", "DROP"],
      }
    );
    CrawlerDBPerms.node.addDependency(adminSetup);

    // Grant Lake Formation permissions for the S3 location to the crawler
    const CrawlerS3Perms = new lakeformation.CfnPermissions(
      this,
      "CrawlerS3Permissions",
      {
        dataLakePrincipal: {
          dataLakePrincipalIdentifier: crawlerRole.roleArn,
        },
        resource: {
          dataLocationResource: {
            s3Resource: dataBucket.bucketArn + "/*",
          },
        },
        permissions: ["DATA_LOCATION_ACCESS"],
      }
    );
    CrawlerS3Perms.node.addDependency(adminSetup);

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

    const LambdaLakeAdmin = new lakeformation.CfnDataLakeSettings(
      this,
      "LambdaDataLakeSettings",
      {
        admins: [
          {
            dataLakePrincipalIdentifier: lambdaRole.roleArn,
          },
        ],
      }
    );
    LambdaLakeAdmin.node.addDependency(adminSetup);

    // Give the lambda full access to the glue database
    const LambdaTablePerms = new lakeformation.CfnPermissions(
      this,
      "LambdaTablePermissions",
      {
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
      }
    );
    LambdaTablePerms.node.addDependency(adminSetup);

    const LambdaDbPerms = new lakeformation.CfnPermissions(
      this,
      "LambdaDBPermissions",
      {
        dataLakePrincipal: {
          dataLakePrincipalIdentifier: lambdaRole.roleArn,
        },
        resource: {
          databaseResource: {
            name: database.ref,
          },
        },
        permissions: ["ALL"],
      }
    );
    LambdaDbPerms.node.addDependency(adminSetup);

    const { apiKey, apiUrl } = this.createApiGateway(adminLambda);

    const startCrawlerFn = new lambda.Function(this, "StartCrawlerFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "trigger_glue.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda")),
      environment: {
        GLUE_CRAWLER_NAME: crawler.ref,
      },
      timeout: cdk.Duration.seconds(10),
    });

    startCrawlerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["glue:StartCrawler"],
        resources: [crawlerArn],
      })
    );

    const crawlerTriggerProvider = new cr.Provider(this, "CrawlerTrigger", {
      onEventHandler: startCrawlerFn,
    });

    const triggerCrawlerResource = new cdk.CustomResource(
      this,
      "TriggerCrawlerResource",
      {
        serviceToken: crawlerTriggerProvider.serviceToken,
        properties: {
          triggerTimestamp: new Date().toISOString(),
        },
      }
    );

    triggerCrawlerResource.node.addDependency(crawler);
    triggerCrawlerResource.node.addDependency(deployment);

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
