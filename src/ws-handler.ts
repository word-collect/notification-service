import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const TABLE = process.env.TABLE_NAME!

export const handler = async (event: any) => {
  const { connectionId, routeKey } = event.requestContext

  // sub comes from the Lambda authoriser (added in stack)
  const userSub = (event.requestContext.authorizer as any)?.sub as
    | string
    | undefined

  console.log(`⚡️ ${routeKey} for ${connectionId}`) // ⇽ log 1

  if (routeKey === '$connect') {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          connectionId,
          userSub: userSub ?? 'anonymous',
          // auto-expire after 24 h in case disconnect missed
          ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24
        }
      })
    )
  }

  if (routeKey === '$disconnect') {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { connectionId }
      })
    )
  }

  return { statusCode: 200 }
}
