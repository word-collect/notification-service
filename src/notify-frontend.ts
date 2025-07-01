import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const TABLE = process.env.TABLE_NAME!
const apigw = new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_ENDPOINT!
})

export const handler = async (event: any) => {
  const payload = JSON.stringify(event.detail) // { s3Key, result }
  console.log('📨 AnalysisReady payload', payload) // log 1

  // 1. fetch all live connections
  const { Items } = await ddb.send(
    new ScanCommand({ TableName: TABLE, ProjectionExpression: 'connectionId' })
  )
  console.log(`🔗 pushing to ${Items?.length ?? 0} connections`) // log 2

  if (!Items?.length) return

  // 2. push in parallel; drop stale ones
  await Promise.allSettled(
    Items.map(({ connectionId }) => {
      console.log(`🔗 pushing to ${connectionId}`) // log 3
      apigw
        .send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(payload)
          })
        )
        .catch(async (err) => {
          if (err.statusCode === 410) {
            // GoneException
            await ddb.send(
              new DeleteCommand({ TableName: TABLE, Key: { connectionId } })
            )
          } else throw err
        })
    })
  )
}
