import { Apigatewayv2Deployment } from '@cdktf/provider-aws/lib/apigatewayv2-deployment';
import { Apigatewayv2Integration } from '@cdktf/provider-aws/lib/apigatewayv2-integration';
import { Apigatewayv2Route } from '@cdktf/provider-aws/lib/apigatewayv2-route';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsRegion } from '@cdktf/provider-aws/lib/data-aws-region';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { TerraformBackend, TerraformStack } from 'cdktf';
import { Construct } from 'constructs';

interface Options {
    s3Bucket: string,
    s3Key: string,
    apiGatewayId: string | undefined,
    timeout: number,
    memory: number,
    roleArn: string,
    schedulerExpression: string | undefined,
    environment: Record<string, string> | undefined,
    lambdaName: string,
    backendFactory: (scope: LambdaStack, name: string) => TerraformBackend;
}

export { Options as LambdaStackOptions };

export class LambdaStack extends TerraformStack {
    constructor(scope: Construct, name: string, options: Options) {
        super(scope, name);

        options.backendFactory(this, name);
        new AwsProvider(this, 'aws');

        const lambda = new LambdaFunction(this, 'lambda', {
            s3Bucket: options.s3Bucket,
            s3Key: options.s3Key,
            timeout: options.timeout,
            memorySize: options.memory,
            functionName: options.lambdaName,
            role: options.roleArn,
            handler: 'index.handler',
            publish: true,
            runtime: 'nodejs16.x',
            environment: { variables: options.environment }
        });

        if (options.schedulerExpression) {
            const scheduler = new CloudwatchEventRule(this, 'scheduler', {
                name: 'Scheduler',
                scheduleExpression: options.schedulerExpression
            });
            new LambdaPermission(this, 'allow-cloudwatch-to-invoke', {
                functionName: lambda.functionName,
                statementId: 'CloudWatchInvoke',
                action: 'lambda:InvokeFunction',
                sourceArn: scheduler.arn,
                principal: 'events.amazonaws.com'
            });
            new CloudwatchEventTarget(this, 'invoke-lambda', {
                rule: scheduler.name,
                arn: lambda.arn
            });
        }

        if (options.apiGatewayId) {
            const integration = new Apigatewayv2Integration(this, 'integration', {
                apiId: options.apiGatewayId,
                integrationType: 'AWS_PROXY',
                connectionType: 'INTERNET',
                integrationMethod: 'POST',
                integrationUri: lambda.invokeArn
            });
            const route = new Apigatewayv2Route(this, 'route', {
                apiId: options.apiGatewayId,
                routeKey: '$default',
                target: `integrations/${ integration.id }`
            });
            new Apigatewayv2Deployment(this, 'deployment', {
                apiId: options.apiGatewayId,
                description: 'Lambda API GW deployment',
                lifecycle: {
                    createBeforeDestroy: true
                },
                dependsOn: [ route, integration ]
            });

            const callerInfo = new DataAwsCallerIdentity(this, 'identity');
            const region = new DataAwsRegion(this, 'region');

            new LambdaPermission(this, 'apigw', {
                statementId: 'AllowAPIGatewayInvoke',
                action: 'lambda:InvokeFunction',
                functionName: lambda.arn,
                principal: 'apigateway.amazonaws.com',
                sourceArn: `arn:aws:execute-api:${ region.name }:${ callerInfo.accountId }:${ options.apiGatewayId }/*/$default`
            });
        }
    }
}
