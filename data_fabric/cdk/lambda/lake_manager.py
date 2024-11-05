import json
import boto3
import os
from botocore.exceptions import ClientError

# Initialize AWS clients
lakeformation = boto3.client('lakeformation')
s3 = boto3.client('s3')
glue = boto3.client('glue')

# Get environment variables
DATABASE_NAME = os.environ['GLUE_DATABASE_NAME']
BUCKET_NAME = os.environ['DATA_BUCKET_NAME']
DATABASE_ARN = os.environ['DATABASE_ARN']

def index(event, context):
    """
    Main handler that routes to appropriate method based on HTTP method
    """
    try:
        print(f"Received event: {json.dumps(event, indent=2)}")
        
        http_method = event['httpMethod']
        
        if http_method == 'GET':
            # For GET, they need to provide the ARN as a query parameter
            principal_arn = event.get('queryStringParameters', {}).get('principal_arn')
            if not principal_arn:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'principal_arn query parameter is required'})
                }
            return list_objects(principal_arn)
            
        elif http_method == 'POST':
            body = json.loads(event['body'])
            principal_arn = body.get('principal_arn')
            s3_uri = body.get('s3_uri')
            
            if not principal_arn or not s3_uri:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'principal_arn and s3_uri are required in request body'})
                }
                
            return grant_access(s3_uri, principal_arn)
        else:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': f'Unsupported method: {http_method}'})
            }
            
    except Exception as e:
        print(f"Error in main handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def check_permissions(s3_uri, principal_arn):
    """
    Check permissions for a given S3 URI and principal by checking table-level permissions
    """
    try:
        # Get table name from bucket name (matching the crawler's naming)
        table_name = BUCKET_NAME.replace("-", "_")
        
        print(f"Checking table permissions for database: {DATABASE_NAME}, table: {table_name}")
        print(f"Looking for principal: {principal_arn}")
        
        response = lakeformation.list_permissions(
            Principal={
                'DataLakePrincipalIdentifier': principal_arn
            },
            Resource={
                'Table': {
                    'DatabaseName': DATABASE_NAME,
                    'Name': table_name
                }
            }
        )
        
        print(f'Permissions response: {response}')
        
        # Get all permissions for the principal
        principal_permissions = []
        for permission_entry in response.get('PrincipalResourcePermissions', []):
            # Check if this entry is for our principal
            if permission_entry['Principal']['DataLakePrincipalIdentifier'] == principal_arn:
                # Handle both Table and TableWithColumns permissions
                resource = permission_entry.get('Resource', {})
                if 'Table' in resource or 'TableWithColumns' in resource:
                    principal_permissions.extend(permission_entry.get('Permissions', []))
        
        print(f"Found permissions for principal: {principal_permissions}")
        
        # Consider access granted if they have both SELECT and DESCRIBE permissions
        has_select = any('SELECT' in perms for perms in principal_permissions)
        has_describe = any('DESCRIBE' in perms for perms in principal_permissions)
        has_access = has_select and has_describe
        
        # If we have a specific S3 URI, also check data location access
        if s3_uri and has_access:
            try:
                object_key = s3_uri.replace(f"s3://{BUCKET_NAME}/", '')
                location_response = lakeformation.list_permissions(
                    Principal={
                        'DataLakePrincipalIdentifier': principal_arn
                    },
                    Resource={
                        'DataLocation': {
                            'ResourceArn': f"arn:aws:s3:::{BUCKET_NAME}/{object_key}"
                        }
                    }
                )
                
                location_permissions = []
                for permission_entry in location_response.get('PrincipalResourcePermissions', []):
                    if permission_entry['Principal']['DataLakePrincipalIdentifier'] == principal_arn:
                        location_permissions.extend(permission_entry.get('Permissions', []))
                
                has_location_access = 'DATA_LOCATION_ACCESS' in location_permissions
                has_access = has_access and has_location_access
                principal_permissions.extend(location_permissions)
            except Exception as e:
                print(f"Error checking data location permissions: {str(e)}")
                has_access = False
        
        return {
            'has_access': has_access,
            'permissions': list(set(principal_permissions))  # Remove duplicates
        }
    except Exception as e:
        print(f"Error checking permissions: {str(e)}")
        return {
            'has_access': False,
            'permissions': []
        }

def list_objects(principal_arn):
    """
    Lists all objects in the S3 bucket with permission information
    """
    try:
        print(f"Listing objects for bucket: {BUCKET_NAME}")
        response = s3.list_objects_v2(Bucket=BUCKET_NAME)
        
        # Get permissions once for the table
        perm_info = check_permissions(None, principal_arn)
        
        objects = []
        for obj in response.get('Contents', []):
            s3_uri = f"s3://{BUCKET_NAME}/{obj['Key']}"
            print(f"Processing object: {s3_uri}")
            
            objects.append({
                's3_uri': s3_uri,
                'size': obj['Size'],
                'last_modified': obj['LastModified'].isoformat(),
                'has_access': perm_info['has_access'],
                'permissions': perm_info['permissions']
            })
        
        print(f"Found {len(objects)} objects")
        return {
            'statusCode': 200,
            'body': json.dumps({
                'objects': objects,
                'table_name': BUCKET_NAME.replace("-", "_"),
                'database_name': DATABASE_NAME
            }, default=str)
        }
        
    except Exception as e:
        print(f"Error listing objects: {str(e)}")
        raise


def grant_access(s3_uri, principal_arn):
    """
    Grants Lake Formation permissions for the specified S3 URI and associated table
    """
    try:
        print(f"Attempting to grant access for: {s3_uri}")
        print(f"Principal ARN: {principal_arn}")
        
        # Validate S3 URI format and extract key
        if not s3_uri.startswith(f"s3://{BUCKET_NAME}/"):
            print(f"Invalid S3 URI format: {s3_uri}")
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Invalid S3 URI format or bucket'})
            }
            
        object_key = s3_uri.replace(f"s3://{BUCKET_NAME}/", '')
        
        # Check if object exists
        try:
            s3.head_object(Bucket=BUCKET_NAME, Key=object_key)
            print(f"Object exists: {object_key}")
        except ClientError as e:
            print(f"Object does not exist: {object_key}")
            return {
                'statusCode': 404,
                'body': json.dumps({'error': 'Specified S3 object does not exist'})
            }
            
        # Get the table name from the path - assuming it's the first directory in the path
        table_name = BUCKET_NAME.replace("-", "_")
        print(f"Derived table name: {table_name}")
        
        # Verify table exists
        try:
            glue.get_table(DatabaseName=DATABASE_NAME, Name=table_name)
        except glue.exceptions.EntityNotFoundException:
            print(f"Table {table_name} not found in database {DATABASE_NAME}")
            return {
                'statusCode': 404,
                'body': json.dumps({'error': f'Table {table_name} not found in database {DATABASE_NAME}'})
            }
            
        # Check current permissions
        perm_info = check_permissions(s3_uri, principal_arn)
        if perm_info['has_access']:
            print(f"Access already exists with permissions: {perm_info['permissions']}")
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Access already exists',
                    's3_uri': s3_uri,
                    'permissions': perm_info['permissions']
                })
            }
        
        # Grant all necessary permissions in one go using a transaction-like approach
        try:
            # 1. Grant Data Location Access
            print("Granting DATA_LOCATION_ACCESS permission")
            lakeformation.grant_permissions(
                Principal={
                    'DataLakePrincipalIdentifier': principal_arn
                },
                Resource={
                    'DataLocation': {
                        'ResourceArn': f"arn:aws:s3:::{BUCKET_NAME}/{object_key}"
                    }
                },
                Permissions=['DATA_LOCATION_ACCESS']
            )
            
            # 2. Grant Database Access
            print(f"Granting database permissions for: {DATABASE_NAME}")
            lakeformation.grant_permissions(
                Principal={
                    'DataLakePrincipalIdentifier': principal_arn
                },
                Resource={
                    'Database': {
                        'Name': DATABASE_NAME
                    }
                },
                Permissions=['DESCRIBE']
            )
            
            # 3. Grant Table Access
            print(f"Granting table permissions for: {table_name}")
            lakeformation.grant_permissions(
                Principal={
                    'DataLakePrincipalIdentifier': principal_arn
                },
                Resource={
                    'Table': {
                        'DatabaseName': DATABASE_NAME,
                        'Name': table_name
                    }
                },
                Permissions=['SELECT', 'DESCRIBE']
            )
            
            print("Successfully granted all access")
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Access granted successfully',
                    's3_uri': s3_uri,
                    'database': DATABASE_NAME,
                    'table': table_name,
                    'permissions': ['DATA_LOCATION_ACCESS', 'SELECT', 'DESCRIBE']
                })
            }
            
        except Exception as e:
            print(f"Error during permission grants: {str(e)}")
            # Here you might want to add logic to rollback any permissions that were granted
            # before the failure occurred
            raise
            
    except Exception as e:
        print(f"Error granting access: {str(e)}")
        raise