import boto3
import os

def handler(event, context):
    # Skip delete events
    if event['RequestType'] == 'Delete':
        return {
            'PhysicalResourceId': event.get('PhysicalResourceId', 'datasource-run'),
            'Status': 'SUCCESS'
        }
    
    # For Create/Update, start the data source run
    datazone = boto3.client('datazone')
    response = datazone.start_data_source_run(
        dataSourceIdentifier=os.environ['DATA_SOURCE_IDENTIFIER'],
        domainIdentifier=os.environ['DOMAIN_IDENTIFIER']
    )
    
    return {
        'PhysicalResourceId': event.get('PhysicalResourceId', 'datasource-run'),
        'Status': 'SUCCESS'
    }