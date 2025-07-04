import { CognitoJwtVerifier } from 'aws-jwt-verify'

/**
 * Lambda authoriser for the WebSocket $connect route.
 *
 * Environment variables injected from the CDK stack:
 *   USER_POOL_ID – Cognito User-Pool ID  (e.g. us-east-1_Abc123)
 *   AUDIENCE     – App-client ID        (e.g. 57dkniv4aafm5bv3g3lkj5b5ui)
 *
 * The client must send an ID-token in the   Authorization   header:
 *   new WebSocket(url, undefined, { headers: { Authorization: `Bearer ${idToken}` } });
 */

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.AUDIENCE!
})

export const handler = async (event: any) => {
  // Grab the token from the query-string
  const raw = event.queryStringParameters?.token
  if (!raw) return { isAuthorized: false }

  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw

  try {
    // 2 · verify signature and standard claims
    const payload = await verifier.verify(token)
    console.log('verified')
    // 3 · allow the connection and pass useful context
    return {
      principalId: payload.sub, // anything non-empty
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: event.methodArn // arn:…/$connect
          }
        ]
      },
      context: {
        // forwarded to all routes
        sub: payload.sub,
        email: payload.email
      }
    }
  } catch (err) {
    console.error('JWT verification failed:', err)
    return { isAuthorized: false }
  }
}
