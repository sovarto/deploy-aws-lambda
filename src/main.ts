import * as core from '@actions/core';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { RemoteStateAccessConfigSchema } from '@sovarto/cdktf-state';
import { execSync } from 'child_process';
import fs from 'node:fs';
import * as path from 'node:path';
import { synth } from './cdktf';

async function uploadBuildOutputToS3(s3Bucket: string, s3Key: string, zipFilePath: string) {
    const s3Client = new S3Client();
    await s3Client.send(new PutObjectCommand({ Bucket: s3Bucket, Key: s3Key, Body: fs.readFileSync(zipFilePath) }));
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
    try {
        const lambdaName = core.getInput('lambda-name', { required: true });
        const zipFile = core.getInput('zip-file', { required: true });
        const version = core.getInput('version', {required: true});
        const apiGatewayId = core.getInput('api-gateway-id', { required: false });
        const s3Bucket = core.getInput('s3-bucket', { required: true });
        const timeout = parseInt(core.getInput('timeout', { required: true }), 10);
        const memory = parseInt(core.getInput('memory', { required: true }), 10);
        const roleArn = core.getInput('role-arn', { required: true });
        const schedulerExpression = core.getInput('scheduler-expression', { required: false });
        const environment = core.getInput('environment', { required: false });
        const remoteStateAccessToken = core.getInput('remote-state-access-token', { required: true });

        const remoteStateAccessConfig = RemoteStateAccessConfigSchema.parse(
            JSON.parse(Buffer.from(remoteStateAccessToken, 'base64').toString()));

        const zipFilePath = path.isAbsolute(zipFile) ? zipFile : path.resolve(process.env.GITHUB_WORKSPACE!, zipFile)

        const s3Key = `${lambdaName}-${version}.zip`
        await uploadBuildOutputToS3(s3Bucket, s3Key, zipFilePath);

        const outDirName = `${ lambdaName }_cdktf.out`;
        const outDir = fs.mkdtempSync(outDirName);

        synth(lambdaName,
            outDir,
            remoteStateAccessConfig, {
                apiGatewayId,
                s3Bucket,
                s3Key,
                timeout,
                memory,
                roleArn,
                schedulerExpression,
                lambdaName,
                environment: parseEnvironmentVariablesString(environment || '')
            });
        const stackDir = path.join(outDir, 'stacks', lambdaName);
        execSync(`terraform init`, { cwd: stackDir, stdio: 'inherit' });
        execSync(`terraform apply -auto-approve`, { cwd: stackDir, stdio: 'inherit' });
    } catch (error) {
        core.setFailed(formatError(error));
    }
}

function formatErrorOfUnknownType(error: unknown) {
    return `Unknown error of type '${ typeof error }${ typeof error === 'object'
                                                       ? ` / ${ error!.constructor.name }`
                                                       : '' }' occurred:\n\n${ error }`;
}

function formatError(error: unknown) {
    if (error instanceof Error) {
        let result = `${ error.name }: ${ error.message }\n\n`;
        if (error.cause) {
            result += `Cause:\n${ formatError(error.cause) }`;
        }
        if (error instanceof AggregateError) {
            result += `Errors:\n${ error.errors.map(formatError).map(x => `- ${ x }`).join('\n') }`;
        }

        return result;
    }

    return formatErrorOfUnknownType(error);
}


function parseEnvironmentVariablesString(environmentVariablesString: string) {
    const items = getEnvironmentItems(environmentVariablesString);

    return items.reduce<Record<string, string>>((acc, { name, value }) => {
        if (acc[name]) {
            throw new Error(`The environment variable '${ name }' was specified multiple times in the action inputs`);
        }
        acc[name] = value;
        return acc;
    }, {});
}

function getEnvironmentItems(environmentVariablesString: string) {
    try {
        const env: { name: string, value: string, sensitive?: boolean }[] = JSON.parse(environmentVariablesString);
        for (const item of env) {
            if (item.sensitive) {
                core.setSecret(item.value);
            }
        }
        return env;
    } catch (e) {
        const items = environmentVariablesString.split('\n').map(x => x.trim()).filter(x => !!x.length)
                                                .map(x => x.split('='));
        const invalidLines = items.filter(x => x.length === 1);
        if (invalidLines.length) {
            throw new Error(`Invalid environment variables received. Input 'environment-variables' needs to be valid JSON or it needs to be lines of the form NAME=value. The following lines are invalid:\n${ invalidLines.join(
                '\n') }`);
        }

        return items.map(([ name, ...valueParts ]) => ({ name, value: valueParts.join('=') }));
    }
}
