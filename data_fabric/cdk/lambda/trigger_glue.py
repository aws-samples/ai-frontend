import boto3
import os

def handler(event, context):
    glue = boto3.client('glue')
    # Just start the crawler and return immediately
    glue.start_crawler(Name=os.environ['GLUE_CRAWLER_NAME'])
    return {
        'PhysicalResourceId': event.get('PhysicalResourceId', 'crawler-trigger'),
        'Status': 'SUCCESS'
    }