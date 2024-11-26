# lambdas/accept_subscriptions.py

import json
import logging
import boto3
from botocore.exceptions import ClientError

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize DataZone client
datazone = boto3.client('datazone')

def handler(event, context):
    """
    Handler for DataZone subscription request events that auto-accepts subscriptions
    """
    logger.info('Event received: %s', json.dumps(event, indent=2))
    
    try:
        detail = event['detail']
        metadata = detail['metadata']
        data = detail['data']
        
        # Extract required parameters
        domain_id = metadata['domain']
        subscription_id = metadata['id']
        status = data['status']
        
        # Check if request is in PENDING status
        if status != 'PENDING':
            logger.info(f'Subscription {subscription_id} is not in PENDING status (current status: {status}). Skipping.')
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': f'Subscription not in PENDING status (current: {status})',
                    'subscriptionId': subscription_id
                })
            }
        
        # Accept the subscription request
        response = datazone.accept_subscription_request(
            decisionComment='Auto-approved for demo purposes',
            domainIdentifier=domain_id,
            identifier=subscription_id
        )
        
        logger.info('Successfully accepted subscription request: %s', json.dumps(response, indent=2))
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Successfully accepted subscription request',
                'subscriptionId': subscription_id,
                'response': response
            })
        }
        
    except KeyError as e:
        error_message = f'Missing required field in event: {str(e)}'
        logger.error(error_message)
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': error_message
            })
        }
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f'AWS API Error: {error_code} - {error_message}')
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': f'Failed to accept subscription: {error_code}',
                'message': error_message
            })
        }
        
    except Exception as e:
        logger.error('Unexpected error: %s', str(e))
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }