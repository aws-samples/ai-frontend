#!/opt/homebrew/opt/node/bin/node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DatazoneStack } from "../lib/datazone-stack";

const app = new cdk.App();
new DatazoneStack(app, "DatazoneStack");
