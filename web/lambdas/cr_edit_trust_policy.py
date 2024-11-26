import boto3
import json
import os
import urllib3

def send_response(event, context, response_status, reason=None):
    response_body = {
        'Status': response_status,
        'Reason': reason or 'See CloudWatch Logs',
        'PhysicalResourceId': event.get('PhysicalResourceId', context.log_stream_name),
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
    }
    
    http = urllib3.PoolManager()
    try:
        http.request(
            'PUT',
            event['ResponseURL'],
            headers={'Content-Type': ''},
            body=json.dumps(response_body)
        )
    except Exception as e:
        print(f"Failed to send response: {str(e)}")

def handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    
    if event['RequestType'] == 'Delete':
        send_response(event, context, 'SUCCESS')
        return
        
    try:
        dz_role_arn = os.environ['DZ_ROLE_ARN']
        user_admin_principal = os.environ['USER_ADMIN_PRINCIPAL']
        role_name = dz_role_arn.split('/')[-1]
        
        iam = boto3.client('iam')
        existing_role = iam.get_role(RoleName=role_name)
        trust_policy = existing_role['Role']['AssumeRolePolicyDocument']
        
        trust_policy['Statement'].append({
            "Effect": "Allow",
            "Principal": {"AWS": user_admin_principal},
            "Action": "sts:AssumeRole"
        })
        
        iam.update_assume_role_policy(
            RoleName=role_name,
            PolicyDocument=json.dumps(trust_policy)
        )
        
        send_response(event, context, 'SUCCESS')
    except Exception as e:
        print(f"Error: {str(e)}")
        send_response(event, context, 'FAILED', str(e))