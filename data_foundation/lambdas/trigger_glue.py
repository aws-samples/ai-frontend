import boto3
import os

def handler(event, context):
    # Skip crawler execution on stack deletion
    if event.get('RequestType') == 'Delete':
        return {
            'PhysicalResourceId': event.get('PhysicalResourceId', 'crawler-trigger'),
            'Status': 'SUCCESS'
        }
    
    # For Create/Update events, start the crawler
    glue = boto3.client('glue')
    glue.start_crawler(Name=os.environ['GLUE_CRAWLER_NAME'])
    
    return {
        'PhysicalResourceId': event.get('PhysicalResourceId', 'crawler-trigger'),
        'Status': 'SUCCESS'
    }