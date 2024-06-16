import { RemoteStateAccessConfigSchema } from '@sovarto/cdktf-state';
import { App, S3Backend } from 'cdktf';
import { LambdaStack, LambdaStackOptions } from './LambdaStack';

export function synth(stackName: string,
                            outDir: string,
                            remoteStateAccessConfig: RemoteStateAccessConfigSchema,
                            options: Omit<LambdaStackOptions, 'backendFactory'>) {
    const app = new App({ outdir: outDir });

    new LambdaStack(app, stackName, {
        ...options, backendFactory: (scope, name) => new S3Backend(scope, {
            key: `${ remoteStateAccessConfig.stateFileFolder }/${ name }.tfstate`,
            bucket: remoteStateAccessConfig.bucketName,
            region: remoteStateAccessConfig.region,
            dynamodbTable: remoteStateAccessConfig.dynamoDbTableName,
            accessKey: remoteStateAccessConfig.accessKeyId,
            secretKey: remoteStateAccessConfig.secretAccessKey
        })
    });

    app.synth();
}
