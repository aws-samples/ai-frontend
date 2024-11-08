import boto3
import time
import os

AWS_REGION = os.getenv("REGION", "us-east-1")
BUCKET_NAME = os.getenv("BUCKET_NAME")

textract = boto3.client("textract", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)


def extract_text_from_pdf(object_name, bucket):
    try:
        response = textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": object_name}}
        )

        job_id = response["JobId"]

        while True:
            response = textract.get_document_text_detection(JobId=job_id)
            status = response["JobStatus"]
            if status in ["SUCCEEDED", "FAILED"]:
                break
            time.sleep(5)

        if status == "FAILED":
            raise Exception("Textract job failed")

        pages = []
        pages.append(response)

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

        s3.delete_object(Bucket=bucket, Key=object_name)
        return text.strip()
    except Exception as e:
        s3.delete_object(Bucket=bucket, Key=object_name)
        raise Exception(f"Error extracting text: {str(e)}")


def lambda_handler(event, context):
    try:
        object_key = event.get("object_key")
        text = extract_text_from_pdf(object_key, BUCKET_NAME)
        print(text)
    except Exception as e:
        print(f"Error: {str(e)}")
