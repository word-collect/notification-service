import {
  DynamoDBDocumentClient,
  QueryCommand,
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
  console.log('EVENT-ID', event.id) // ← add this
  const { userSub, ...rest } = event.detail // userSub now included
  const eventType = event['detail-type'] ?? event.detailType ?? 'unknown'
  const payload = JSON.stringify({ userSub, eventType, ...rest })

  console.log(eventType, event, payload) // log 1

  /* 1 · fetch ONLY this user’s open connections ------------------------- */
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'userSub-index', // GSI added in the stack
      KeyConditionExpression: 'userSub = :u',
      ExpressionAttributeValues: { ':u': userSub },
      ProjectionExpression: 'connectionId'
    })
  )

  console.log(`🔗 pushing to ${Items?.length ?? 0} connections`) // log 2

  if (!Items?.length) return

  // 2. push in parallel; drop stale ones
  await Promise.allSettled(
    Items.map(async ({ connectionId }) => {
      console.log(`🔗 pushing to ${connectionId}`) // log 3
      try {
        await apigw.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(payload)
          })
        )
        console.log(`✅ posted to ${connectionId}`)
      } catch (err: any) {
        console.error(`❌ ${connectionId} ${err.name} ${err.statusCode}`)
        if (err.statusCode === 410) {
          await ddb.send(
            new DeleteCommand({ TableName: TABLE, Key: { connectionId } })
          )
        }
      }
    })
  )
}
