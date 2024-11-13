import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import * as path from "path";

const DEPLOYMENT_PREFIX = process.env.DEPLOYMENT_PREFIX;

export class MainStack extends cdk.Stack {
  makeOrFetchBucket(bucketName: string): s3.IBucket {
    try {
      return s3.Bucket.fromBucketName(this, "ExistingPdfBucket", bucketName);
    } catch {
      return new s3.Bucket(this, "PdfBucket", {
        bucketName: bucketName,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
      });
    }
  }

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the textraction stack before anything else.
    const pdfBucketName = DEPLOYMENT_PREFIX + "pdf-storage";
    let pdfBucket = new s3.Bucket(this, "PdfBucket", {
      bucketName: pdfBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const textractLambda = new lambda.Function(this, "TextractFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambdas", "textract")
      ),
      timeout: cdk.Duration.minutes(1),
      environment: {
        REGION: this.region,
        BUCKET_NAME: pdfBucket.bucketName,
      },
    });

    pdfBucket.grantRead(textractLambda);
    pdfBucket.grantWrite(textractLambda);
    pdfBucket.grantDelete(textractLambda);

    textractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection",
        ],
        resources: ["*"],
      })
    );

    /*
    const accessLogsBucketName = DEPLOYMENT_PREFIX + "static-website-logs";
    let accessLogsBucket = this.makeOrFetchBucket(accessLogsBucket)

    const websiteBucket = new s3.Bucket(this, "StaticReactWebsiteBucket", {
      bucketName: DEPLOYMENT_PREFIX + "static-website",
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "access-logs/",
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "OAI"
    );

    // Grant read access to CloudFront
    websiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [websiteBucket.arnForObjects("*")],
        principals: [originAccessIdentity.grantPrincipal],
      })
    );


    const distribution = new cloudfront.Distribution(
      this,
      "CloudFrontDistribution",
      {
        defaultBehavior: {
          origin: new origins.S3Origin(websiteBucket, { originAccessIdentity }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
        ],
      }
    );

    // Deploy site contents to S3 bucket
    new s3deploy.BucketDeployment(this, "DeployWebsite", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "..", "..", "build")),
      ],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // Output the CloudFront URL
    new cdk.CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "The URL of the CloudFront distribution",
    });

   */
    // Add Lambda ARN and function name to outputs
    new cdk.CfnOutput(this, "TextractLambdaArn", {
      value: textractLambda.functionArn,
      description: "The ARN of the Textract Lambda function",
    });

    new cdk.CfnOutput(this, "TextractLambdaName", {
      value: textractLambda.functionName,
      description: "The name of the Textract Lambda function",
    });
  }
}
