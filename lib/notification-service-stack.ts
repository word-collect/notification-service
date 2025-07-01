import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as events from 'aws-cdk-lib/aws-events'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as targets from 'aws-cdk-lib/aws-events-targets'

export interface NotificationServiceStackProps extends cdk.StackProps {
  appName: string
  environment: string
}

export class NotificationServiceStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: NotificationServiceStackProps
  ) {
    super(scope, id, props)
    const { appName, environment } = props

    /* 1 · Shared EventBridge bus (imported) */
    const eventBus = events.EventBus.fromEventBusName(
      this,
      'SharedEventBus',
      cdk.Fn.importValue(`${appName}-${environment}-event-bus-name`)
    )

    /* 2 · DynamoDB connection store */
    const connections = new dynamodb.Table(this, 'WsConnections', {
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
      // timeToLiveAttribute: { attributeName: 'ttl', enabled: true }
    })

    /* 3 · $connect / $disconnect Lambda */
    const connFn = new lambda.NodejsFunction(this, 'ConnectionFn', {
      entry: 'src/ws-handler.ts',
      environment: { TABLE_NAME: connections.tableName }
      // bundling: { target: 'es2022', format: 'esm', minify: true }
    })
    connections.grantReadWriteData(connFn)

    /* 4 · WebSocket API */
    const wsApi = new apigwv2.WebSocketApi(this, 'WsApi', {
      apiName: `${appName}-realtime`,
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          'Connect',
          connFn
        )
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          'Disconnect',
          connFn
        )
      }
    })

    const wsStage = new apigwv2.WebSocketStage(this, `${environment}Stage`, {
      webSocketApi: wsApi,
      stageName: environment,
      autoDeploy: true
    })

    const wsEndpoint = `${wsApi.apiEndpoint}/${wsStage.stageName}` // wss://…/prod

    new ssm.StringParameter(this, 'WsEndpointParam', {
      parameterName: `/${appName}/${environment}/notification-service/ws-endpoint`,
      stringValue: wsEndpoint
    })

    /* 5 · Fan-out Lambda */
    const notifyFn = new lambda.NodejsFunction(this, 'NotifyFrontendFn', {
      entry: 'src/notify-frontend.ts',
      environment: {
        TABLE_NAME: connections.tableName,
        WS_ENDPOINT: wsEndpoint
      },
      memorySize: 512,
      timeout: cdk.Duration.minutes(1)
      // bundling: { target: 'es2022', format: 'esm', minify: true }
    })
    connections.grantReadData(notifyFn)
    wsApi.grantManageConnections(notifyFn) // execute-api:ManageConnections

    /* 6 · Rule: AnalysisReady ➜ notifyFn */
    new events.Rule(this, 'AnalysisReadyRule', {
      eventBus,
      eventPattern: {
        source: ['extraction-service'],
        detailType: ['AnalysisReady']
      },
      targets: [new targets.LambdaFunction(notifyFn)]
    })
  }
}
