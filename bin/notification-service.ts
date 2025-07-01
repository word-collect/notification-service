#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { NotificationServiceStack } from '../lib/notification-service-stack'

const app = new cdk.App()

const appName = 'word-collect'
const environment = app.node.tryGetContext('environment') || 'dev'

const notificationStack = new NotificationServiceStack(
  app,
  `${appName}-${environment}-notification-stack`,
  {
    appName,
    environment,
    description: 'Notification stack for notification service',
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION
    }
  }
)

// Add tags to all stacks
const tags = {
  Environment: environment,
  Service: 'notification-service',
  Application: appName
}

Object.entries(tags).forEach(([key, value]) => {
  cdk.Tags.of(notificationStack).add(key, value)
})
