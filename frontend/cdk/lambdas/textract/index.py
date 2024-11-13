import boto3
import time
import os
from botocore.exceptions import ClientError
import uuid

AWS_REGION = os.getenv("REGION", "us-west-2")
BUCKET_NAME = os.getenv("BUCKET_NAME")

print("REGION:", AWS_REGION)
print("BUCKET_NAME:", BUCKET_NAME)

textract = boto3.client("textract", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)

def upload_file_to_s3(file_content, bucket, object_key):
    try:
        s3.put_object(Body=file_content, Bucket=bucket, Key=object_key)
        return object_key
    except ClientError as e:
        raise Exception(f"Error uploading to S3: {str(e)}")

def delete_file_from_s3(bucket, object_key):
    try:
        s3.delete_object(Bucket=bucket, Key=object_key)
    except ClientError as e:
        print(f"Warning: Error deleting file from S3: {str(e)}")

def extract_text_from_pdf(object_key, bucket):
    try:
        print(f"Extracting from s3://{bucket}/{object_key}")
        response = textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": object_key}}
        )
        print(response)
        job_id = response["JobId"]

        while True:
            response = textract.get_document_text_detection(JobId=job_id)
            status = response["JobStatus"]
            if status in ["SUCCEEDED", "FAILED"]:
                break
            time.sleep(5)

        if status == "FAILED":
            return response
            raise Exception("Textract job failed")

        pages = [response]
        next_token = response.get("NextToken")
        while next_token:
            response = textract.get_document_text_detection(
                JobId=job_id, NextToken=next_token
            )
            pages.append(response)
            next_token = response.get("NextToken")

        text = ""
        for page in pages:
            for item in page["Blocks"]:
                if item["BlockType"] == "LINE":
                    text += item["Text"] + "\n"

        return text.strip()
    except Exception as e:
        raise Exception(f"Error extracting text: {str(e)}")

def lambda_handler(event, context):
    print("Received event:", event)
    try:
        if "pdf_content" not in event or not event["pdf_content"]:
            raise Exception("No PDF content provided in the event")

        pdf_filename = f"upload_{uuid.uuid4()}.pdf"

        try:
            upload_file_to_s3(event["pdf_content"], BUCKET_NAME, pdf_filename)
            text = extract_text_from_pdf(pdf_filename, BUCKET_NAME)
            delete_file_from_s3(BUCKET_NAME, pdf_filename)

            return {
                "statusCode": 200,
                "body": text
            }

        except Exception as e:
            delete_file_from_s3(BUCKET_NAME, pdf_filename)
            raise e

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            "statusCode": 500,
            "body": f"Error processing PDF: {str(e)}"
        }
