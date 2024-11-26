import * as cdk from "aws-cdk-lib";
import { RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as datazone from "aws-cdk-lib/aws-datazone";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Key } from "aws-cdk-lib/aws-kms";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lakeformation from "aws-cdk-lib/aws-lakeformation";
import * as cr from "aws-cdk-lib/custom-resources";

import { getConfig, AppConfig } from "../config/config";

import {
  AnyPrincipal,
  ArnPrincipal,
  CompositePrincipal,
  Effect,
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";

export class DatazoneStack extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // IMPORTANT: Deployment Steps
    // 1. Add your console role / application role in config/config.json
    // 2. In the LakeFormation console in the region you intend to deploy, click on "Data Catalog settings" under "Administration" and uncheck "Use only IAM access control for new databases" and "Use only IAM access control for new tables in new databases"
    // 3. Deploy this stack

    const randomDeploymentId = Math.random().toString(36).substring(2, 8);

    // Role that cdk deploys with needs to be made admin in LakeFormation
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

    // get config from config file
    const config = getConfig();

    // Domain Execution Role - Handles core DataZone operations within a domain, including data processing and resource access
    const domainExecutionRole = this.createDomainExecutionRole(
      config,
      randomDeploymentId
    );

    // DataZone Provisioning Role - Manages resource provisioning and setup of DataZone projects, environments, and workspaces
    const dzProvisioningRole =
      this.createDZProvisioningRole(randomDeploymentId);

    // Glue Manage Access Role - Controls Glue catalog operations and metadata management for DataZone
    const glueManageAccessRole =
      this.createGlueManageAccessRole(randomDeploymentId);

    // Domain KMS Key - Manages encryption for domain resources and controls access to encrypted data
    const domainKMSKey = this.createDomainKMSKey(config, randomDeploymentId);

    // Create DataZone domain
    const domain = new datazone.CfnDomain(this, `DZDomain`, {
      description: "DataZone domain for TLC207",
      domainExecutionRole: domainExecutionRole.roleArn,
      kmsKeyIdentifier: domainKMSKey.keyArn,
      name: `TLC207Domain`,

      tags: [
        {
          key: "CDKDomainTagKey",
          value: "CDKDomainTagValue",
        },
      ],
    });
    domain.node.addDependency(adminSetup);

    // Create S3 bucket and deploy the file under assets folder, which will become an asset in datazone
    const s3Bucket = this.createS3Bucket();

    new s3deploy.BucketDeployment(this, "DeployFiles", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "assets"))],
      destinationBucket: s3Bucket,
    });

    // DataZone data lake blue print configuration
    const DataLakeBlueprintConfiguration =
      new datazone.CfnEnvironmentBlueprintConfiguration(
        this,
        "DataLakeBlueprintConfiguration",
        {
          domainIdentifier: domain.attrId,
          enabledRegions: [this.region],
          environmentBlueprintIdentifier: "DefaultDataLake",
          manageAccessRoleArn: glueManageAccessRole.roleArn,
          provisioningRoleArn: dzProvisioningRole.roleArn,
          regionalParameters: [
            {
              region: this.region,
              parameters: {
                S3Location: "s3://" + s3Bucket.bucketName,
              },
            },
          ],
        }
      );

    DataLakeBlueprintConfiguration.node.addDependency(domain);

    // Create Producer Project
    const producerProjectId = this.createProducerProject(
      domain,
      config,
      glueManageAccessRole,
      dzProvisioningRole,
      DataLakeBlueprintConfiguration,
      s3Bucket
    );

    // Create Consumer Project
    const consumerProjectId = this.createConsumerProject(
      domain,
      config,
      glueManageAccessRole,
      dzProvisioningRole,
      DataLakeBlueprintConfiguration
    );
  }

  private createDomainExecutionRole(
    config: AppConfig,
    randomDeploymentId: string
  ) {
    const role = new Role(this, "DomainExecutionRoleForCDK", {
      roleName: `DomainExecutionRoleForCDK-${randomDeploymentId}`,
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("cloudformation.amazonaws.com"),
        new ArnPrincipal(config.adminRole)
      ),
      inlinePolicies: {
        DomainExecutionRolePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: [
                "datazone:*",
                "ram:GetResourceShareAssociations",
                "sso:CreateManagedApplicationInstance",
                "sso:DeleteManagedApplicationInstance",
                "sso:PutApplicationAssignmentConfiguration",
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:GenerateDataKey",
              ],
              effect: Effect.ALLOW,
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    const dataZoneAssumeRoleStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal("datazone.amazonaws.com")],
      actions: ["sts:AssumeRole", "sts:TagSession"],
      conditions: {
        StringEquals: {
          "aws:SourceAccount": this.account,
        },
        "ForAllValues:StringLike": {
          "aws:TagKeys": "datazone*",
        },
      },
    });
    role.assumeRolePolicy?.addStatements(dataZoneAssumeRoleStatement);

    return role;
  }

  private createDZProvisioningRole(randomDeploymentId: string) {
    const assumeRolePrincipals = [
      new ServicePrincipal("datazone.amazonaws.com").withConditions({
        StringEquals: {
          "aws:SourceAccount": this.account,
        },
      }),
      new ServicePrincipal("cloudformation.amazonaws.com").withConditions({
        StringEquals: {
          "aws:SourceAccount": this.account,
        },
      }),
    ];
    const compositePrincipal = new CompositePrincipal(...assumeRolePrincipals);

    return new Role(this, "DZProvisioningRoleForCDK", {
      roleName: `DZProvisioningRoleForCDK-${randomDeploymentId}`,
      assumedBy: compositePrincipal,
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonDataZoneRedshiftGlueProvisioningPolicy"
        ),
        ManagedPolicy.fromAwsManagedPolicyName("AWSGlueConsoleFullAccess"),
      ],
    });
  }

  private createGlueManageAccessRole(randomDeploymentId: string) {
    const glue_role = new Role(this, "DZGlueManageAccessRoleForCDK", {
      roleName: `DZGlueManageAccessRoleForCDK-${randomDeploymentId}`,
      assumedBy: new CompositePrincipal(
        new ServicePrincipal("datazone.amazonaws.com"),
        new ServicePrincipal("cloudformation.amazonaws.com"),
        new ServicePrincipal("lakeformation.amazonaws.com")
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonDataZoneGlueManageAccessRolePolicy"
        ),
        ManagedPolicy.fromAwsManagedPolicyName("AWSLakeFormationDataAdmin"),
      ],
    });

    glue_role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lakeformation:*", "glue:*", "s3:*", "athena:*"],
        resources: ["*"],
      })
    );
    return glue_role;
  }

  private createS3Bucket() {
    const bucket = new Bucket(this, "ProducerDzDataSource", {
      encryption: BucketEncryption.S3_MANAGED,
      bucketName: `datazone-s3-${this.account}-${this.region}-1`,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Add permissions for Glue and Athena - !
    bucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
        ],
        principals: [
          new ServicePrincipal("glue.amazonaws.com"),
          new ServicePrincipal("athena.amazonaws.com"),
        ],
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
        },
      })
    );

    // Add permissions for DataZone service - !
    bucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ],
        principals: [new ServicePrincipal("datazone.amazonaws.com")],
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
        },
      })
    );

    return bucket;
  }

  private createDomainKMSKey(config: AppConfig, randomDeploymentId: string) {
    return new Key(this, "data-domain-1-KMSKey", {
      description: "A key to use creating DataZone domain",
      alias: `data-domain-1-KMSKey-${randomDeploymentId}`,
      enableKeyRotation: true,
      enabled: true,
      policy: this.createKeyPolicy(config),
    });
  }

  private createKeyPolicy(config: AppConfig): PolicyDocument {
    const accountId = this.account;
    const adminPolicy = new PolicyStatement({
      sid: "KmsKeyAdminAccess",
      actions: ["kms:*"],
      effect: Effect.ALLOW,
      principals: [
        new ArnPrincipal(`arn:aws:iam::${accountId}:root`),
        new ArnPrincipal(config.adminRole),
      ],
      resources: ["*"],
    });

    const keyUsePolicy = new PolicyStatement({
      sid: "KmsKeyUseAccess",
      actions: [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
        "kms:CreateGrant",
        "kms:ListGrants",
        "kms:RevokeGrant",
      ],
      effect: Effect.ALLOW,
      principals: [new AnyPrincipal()],
      resources: ["*"],
      conditions: {
        StringEquals: {
          "kms:CallerAccount": accountId,
        },
      },
    });

    return new PolicyDocument({
      statements: [adminPolicy, keyUsePolicy],
    });
  }

  private createUser(
    project: any,
    domain: any,
    roleArn: string
  ): cdk.CfnResource {
    const randomString = Math.random().toString(36).substring(2, 8);

    const newMember = new datazone.CfnProjectMembership(
      this,
      `ProjectMembership-${project.name}-${randomString}`,
      {
        designation: "PROJECT_OWNER",
        domainIdentifier: domain.attrId,
        member: {
          userIdentifier: roleArn,
        },
        projectIdentifier: project.attrId,
      }
    );

    return new cdk.CfnResource(this, `UsersCreated-${randomString}`, {
      type: "AWS::CloudFormation::WaitConditionHandle",
      properties: {},
    });
  }

  private createConsumerProject(
    domain: datazone.CfnDomain,
    config: AppConfig,
    glueManageAccessRole: iam.Role,
    dzProvisioningRole: iam.Role,
    DataLakeBlueprintConfiguration: datazone.CfnEnvironmentBlueprintConfiguration
  ): string {
    // Create consumer project
    const consumerProject = new datazone.CfnProject(this, "ConsumerProject", {
      name: "ConsumerProject",
      description: "Consumer project for AWS re:Invent TLC 207",
      domainIdentifier: domain.attrId,
    });

    consumerProject.node.addDependency(domain);

    // Create consumer environment profile
    const consumerEnvironmentProfile = new datazone.CfnEnvironmentProfile(
      this,
      "ConsumerEnvironmentProfile",
      {
        awsAccountId: this.account,
        awsAccountRegion: this.region,
        description: "Consumer environment profile for TLC 207",
        domainIdentifier: domain.attrId,
        environmentBlueprintIdentifier:
          DataLakeBlueprintConfiguration.attrEnvironmentBlueprintId,
        name: "ConsumerEnvironmentProfile",
        projectIdentifier: consumerProject.attrId,
      }
    );
    consumerEnvironmentProfile.node.addDependency(
      DataLakeBlueprintConfiguration
    );

    // Create consumer environment
    const consumerEnvironment = new datazone.CfnEnvironment(
      this,
      "ConsumerEnvironment",
      {
        name: "ConsumerEnvironment7",
        description: "Consumer environment for TLC 207",
        domainIdentifier: domain.attrId,
        environmentProfileIdentifier: consumerEnvironmentProfile.attrId,
        projectIdentifier: consumerProject.attrId,
      }
    );

    consumerEnvironment.node.addDependency(consumerEnvironmentProfile);
    consumerEnvironmentProfile.node.addDependency(consumerProject);
    consumerEnvironmentProfile.node.addDependency(
      DataLakeBlueprintConfiguration
    );
    consumerProject.node.addDependency(DataLakeBlueprintConfiguration);

    // Create the admin user for the DataZone consumer project
    this.createUser(consumerProject, domain, config.adminRole);

    // Create lambda execution role for custom resource
    const lambdaRole = new iam.Role(this, "CrEditTrustPolicyLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    const roleArn = `arn:aws:iam::${this.account}:role/datazone_usr_${consumerEnvironment.attrId}`;

    // Add IAM permissions to modify roles
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:UpdateRole",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:UpdateAssumeRolePolicy",
        ],
        resources: [roleArn],
      })
    );
    lambdaRole.node.addDependency(consumerEnvironment);

    // Create custom resource lambda function to edit the trust policy on the datazone role, allowing out admin user to assume it programatically
    const customResourceLambda = new lambda.Function(
      this,
      "CustomResourceFunction",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "cr_edit_trust_policy.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../", "lambdas")),
        role: lambdaRole,
        timeout: cdk.Duration.minutes(5),
        environment: {
          DZ_ROLE_ARN: roleArn,
          USER_ADMIN_PRINCIPAL: config.adminRole,
        },
      }
    );
    customResourceLambda.node.addDependency(consumerEnvironment);

    // Create Custom Resource
    const customResource = new cdk.CustomResource(this, "MyCustomResource", {
      serviceToken: customResourceLambda.functionArn,
    });

    customResource.node.addDependency(consumerEnvironment);

    return consumerProject.attrId;
  }

  private createProducerProject(
    domain: datazone.CfnDomain,
    config: AppConfig,
    glueManageAccessRole: iam.Role,
    dzProvisioningRole: iam.Role,
    DataLakeBlueprintConfiguration: datazone.CfnEnvironmentBlueprintConfiguration,
    s3Bucket: s3.Bucket
  ): string {
    // s3 URI
    const s3BucketForDataLake = "s3://" + s3Bucket.bucketName;

    // Create producer project
    const producerProject = new datazone.CfnProject(this, "producerProject", {
      name: "ProducerProject",
      description: "Producer project TLC207",
      domainIdentifier: domain.attrId,
    });

    // Create producer environment profile
    const producerEnvironmentProfile = new datazone.CfnEnvironmentProfile(
      this,
      "producerEnvironmentProfile",
      {
        awsAccountId: this.account,
        awsAccountRegion: this.region,
        description: "Producer environment profile for TLC 207",
        domainIdentifier: domain.attrId,
        environmentBlueprintIdentifier:
          DataLakeBlueprintConfiguration.attrEnvironmentBlueprintId,
        name: "ProducerEnvironmentProfile",
        projectIdentifier: producerProject.attrId,
      }
    );
    producerEnvironmentProfile.node.addDependency(
      DataLakeBlueprintConfiguration
    );

    // Create producer environment
    const producerEnvironment = new datazone.CfnEnvironment(
      this,
      "producerEnvironment",
      {
        name: "ProducerEnvironment7",
        description: "Producer environment profile for TLC 207",
        domainIdentifier: domain.attrId,
        environmentProfileIdentifier: producerEnvironmentProfile.attrId,
        projectIdentifier: producerProject.attrId,
      }
    );

    producerEnvironment.node.addDependency(producerEnvironmentProfile);
    producerEnvironmentProfile.node.addDependency(producerProject);
    producerEnvironmentProfile.node.addDependency(
      DataLakeBlueprintConfiguration
    );
    producerProject.node.addDependency(DataLakeBlueprintConfiguration);

    // Role for glue crawler
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
        resources: [s3Bucket.bucketArn, `${s3Bucket.bucketArn}/*`],
      })
    );

    // Glue database that will be the data source for the producer project
    const glueDatabase = new glue.CfnDatabase(this, "ProducerGlueDatabase", {
      catalogId: this.account,
      databaseInput: {
        name: `producer_database_${this.account}5`,
        description: "Database for DataZone TLC 207",
        locationUri: s3BucketForDataLake,
      },
    });
    glueDatabase.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // Create the glue crawler
    const crawler = new glue.CfnCrawler(this, "ProducerGlueCrawler", {
      name: `dz-producer-crawler-${this.account}`,
      role: crawlerRole.roleArn,
      databaseName: glueDatabase.ref,
      targets: {
        s3Targets: [
          {
            path: s3BucketForDataLake,
          },
        ],
      },
    });
    crawler.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // LakeFormation perms for the glue crawler
    new lakeformation.CfnPermissions(this, "CrawlerDatabasePermissions", {
      dataLakePrincipal: {
        dataLakePrincipalIdentifier: crawlerRole.roleArn,
      },
      resource: {
        databaseResource: {
          name: glueDatabase.ref,
        },
      },
      permissions: ["CREATE_TABLE", "ALTER", "DROP"],
    });

    new lakeformation.CfnPermissions(this, "CrawlerTablePermissions", {
      dataLakePrincipal: {
        dataLakePrincipalIdentifier: crawlerRole.roleArn,
      },
      resource: {
        tableResource: {
          databaseName: glueDatabase.ref,
          tableWildcard: {},
        },
      },
      permissions: ["ALL"],
    });

    // Lambda function for custom resource that will run the glue crawler
    const startCrawlerFn = new lambda.Function(this, "StartCrawlerFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "trigger_glue.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambdas")),
      environment: {
        GLUE_CRAWLER_NAME: crawler.ref,
      },
      timeout: cdk.Duration.seconds(180),
    });

    startCrawlerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["glue:StartCrawler"],
        resources: [
          `arn:aws:glue:${this.region}:${this.account}:crawler/${crawler.ref}`,
        ],
      })
    );

    const crawlerTriggerProvider = new cr.Provider(this, "CrawlerTrigger", {
      onEventHandler: startCrawlerFn,
    });

    // Custom resource that runs the glue crawler
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

    // Registering the S3 bucket with LakeFormation - this is needed or the asset will show up as unmanaged, even if the glue database is registered as a data source
    const lakeFormationResource = new lakeformation.CfnResource(
      this,
      "LakeFormationS3Location",
      {
        resourceArn: s3Bucket.bucketArn,
        useServiceLinkedRole: false,
        roleArn: glueManageAccessRole.roleArn,
      }
    );

    // register the glue database as a data source in DataZone
    const dataSource = new datazone.CfnDataSource(this, "ProducerDataSource", {
      domainIdentifier: domain.attrId,
      environmentIdentifier: producerEnvironment.attrId,
      projectIdentifier: producerProject.attrId,
      name: "ProducerGlueDataSource",
      type: "GLUE",
      description: "Glue data source DZ producer project",
      enableSetting: "ENABLED",
      configuration: {
        glueRunConfiguration: {
          relationalFilterConfigurations: [
            {
              databaseName: glueDatabase.ref,
              filterExpressions: [
                {
                  expression: "*",
                  type: "INCLUDE",
                },
              ],
            },
          ],
          dataAccessRole: glueManageAccessRole.roleArn,
        },
      },
      publishOnImport: true,
      recommendation: {
        enableBusinessNameGeneration: false,
      },
      schedule: {
        schedule: "cron(0 0 * * ? *)",
        timezone: "UTC",
      },
    });
    dataSource.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // Create lambda execution role for custom resource that will start a DataZone data source run.
    const lambdaRole2 = new iam.Role(this, "CustomResourceLambdaRole2", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    // Add IAM permissions to modify roles
    lambdaRole2.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["datazone:StartDataSourceRun"],
        resources: ["*"],
      })
    );

    // Importantly, the role for the custom resource lambda must be registered as an admin user in the project
    const usersCreatedDummy = this.createUser(
      producerProject,
      domain,
      lambdaRole2.roleArn
    );

    // Create Lambda function for the custom resource to start a DataZone data source run. This needs to run after the glue crawler has finished so we can discover the asset.
    const customResourceLambda2 = new lambda.Function(
      this,
      "CustomResourceFunction2",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "dz_start_run.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../", "lambdas")),
        role: lambdaRole2,
        timeout: cdk.Duration.seconds(30),
        environment: {
          DOMAIN_IDENTIFIER: domain.attrId,
          DATA_SOURCE_IDENTIFIER: dataSource.attrId,
        },
      }
    );
    customResourceLambda2.node.addDependency(dataSource);
    customResourceLambda2.node.addDependency(triggerCrawlerResource);
    customResourceLambda2.node.addDependency(usersCreatedDummy);

    // Custom Resource
    const dataSourceProvider = new cr.Provider(this, "DataSourceProvider", {
      onEventHandler: customResourceLambda2,
    });

    const triggerDataSourceResource = new cdk.CustomResource(
      this,
      "TriggerDataSourceResource",
      {
        serviceToken: dataSourceProvider.serviceToken,
        properties: {
          triggerTimestamp: new Date().toISOString(),
        },
      }
    );

    // This lambda will auto-approve any subscription requests to assets in the producer project. Turn this off for a non demo use case.
    const subscriptionHandlerRole = new iam.Role(
      this,
      "SubscriptionHandlerRole",
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole"
          ),
        ],
        inlinePolicies: {
          DataZoneAccess: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["datazone:*"],
                resources: ["*"],
              }),
            ],
          }),
        },
      }
    );

    const subscriptionHandler = new lambda.Function(
      this,
      "SubscriptionHandler",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "accept_subscriptions.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../", "lambdas")),
        timeout: cdk.Duration.seconds(30),
        role: subscriptionHandlerRole,
      }
    );

    // Create EventBridge rule to trigger the lambda when a subscription request is created
    const onSubscribeRequestsRule = new events.Rule(
      this,
      "OnSubscribeEventRule",
      {
        eventPattern: {
          source: ["aws.datazone"],
          detailType: events.Match.equalsIgnoreCase(
            "Subscription Request Created"
          ),
        },
      }
    );

    // Add Lambda as target for the EventBridge rule
    onSubscribeRequestsRule.addTarget(
      new targets.LambdaFunction(subscriptionHandler)
    );

    dataSource.node.addDependency(producerEnvironment);
    crawler.node.addDependency(glueDatabase);
    crawler.node.addDependency(glueDatabase);

    // Create the users for the DataZone project
    this.createUser(producerProject, domain, config.adminRole);
    this.createUser(producerProject, domain, subscriptionHandlerRole.roleArn);

    crawler.node.addDependency(glueDatabase);
    dataSource.node.addDependency(crawler);
    dataSource.node.addDependency(glueDatabase);

    return producerProject.attrId;
  }
}
