import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';

const app = express();
const PORT = process.env.PORT || 8080;

const PACKAGE_NAME = 'com.cleancam.ai';
const MONTHLY_PRODUCT_ID = 'premium_monthly';
const MONTHLY_BASE_PLAN_ID = 'monthly';

app.use(express.json());

async function getAndroidPublisher() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  return google.androidpublisher({
    version: 'v3',
    auth,
  });
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cleancam-backend',
  });
});

/**
 * Flutter -> Backend -> Google Play
 *
 * Verifies a monthly subscription purchase token.
 */
app.post('/verify-subscription', async (req, res) => {
  try {
    const { purchaseToken } = req.body;

    if (
      typeof purchaseToken !== 'string' ||
      purchaseToken.trim().length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'purchaseToken is required',
      });
    }

    const androidPublisher = await getAndroidPublisher();

    const response =
      await androidPublisher.purchases.subscriptionsv2.get({
        packageName: PACKAGE_NAME,
        token: purchaseToken.trim(),
      });

    const subscription = response.data;

    const lineItem = subscription.lineItems?.find(
      (item) =>
        item.productId === MONTHLY_PRODUCT_ID &&
        item.offerDetails?.basePlanId === MONTHLY_BASE_PLAN_ID,
    );

    if (!lineItem) {
      return res.status(403).json({
        success: false,
        premium: false,
        message: 'Invalid CleanCam monthly subscription',
      });
    }

    const isActive =
      subscription.subscriptionState ===
      'SUBSCRIPTION_STATE_ACTIVE';

    return res.json({
      success: true,
      premium: isActive,
      subscriptionState: subscription.subscriptionState,
      productId: lineItem.productId,
      basePlanId: lineItem.offerDetails?.basePlanId,
      expiryTime: lineItem.expiryTime,
      autoRenewEnabled:
        lineItem.autoRenewingPlan?.autoRenewEnabled ?? false,
      acknowledgementState:
        subscription.acknowledgementState,
      regionCode: subscription.regionCode,
    });
  } catch (error) {
    console.error('Subscription verification failed:', error);

    return res.status(500).json({
      success: false,
      premium: false,
      message:
        error instanceof Error
          ? error.message
          : 'Google Play verification failed',
    });
  }
});

/**
 * Google Play RTDN
 *
 * Google Play -> Pub/Sub -> this endpoint
 *
 * Pub/Sub sends a push envelope containing:
 * message.data = base64 encoded RTDN JSON
 */
app.post('/google-play/rtdn', async (req, res) => {
  try {
    const message = req.body?.message;

    if (!message || typeof message !== 'object') {
      console.error('RTDN: Missing Pub/Sub message');
      return res.status(400).json({
        success: false,
        message: 'Invalid Pub/Sub message',
      });
    }

    const messageId = message.messageId;

    if (typeof messageId === 'string') {
      console.log(`RTDN received: ${messageId}`);
    } else {
      console.log('RTDN received without messageId');
    }

    if (typeof message.data !== 'string') {
      console.error('RTDN: Missing message.data');

      return res.status(400).json({
        success: false,
        message: 'Missing message.data',
      });
    }

    // Pub/Sub message.data is Base64 encoded.
    const decodedData = Buffer.from(
      message.data,
      'base64',
    ).toString('utf-8');

    const notification = JSON.parse(decodedData);

    console.log(
      'RTDN notification:',
      JSON.stringify(notification),
    );

    // Make sure the notification belongs to this app.
    if (notification.packageName !== PACKAGE_NAME) {
      console.error(
        `RTDN: Unexpected packageName: ${notification.packageName}`,
      );

      // Acknowledge the message so Pub/Sub does not retry it.
      return res.status(204).send();
    }

    const subscriptionNotification =
      notification.subscriptionNotification;

    if (!subscriptionNotification) {
      console.log(
        'RTDN: No subscriptionNotification. Nothing to process.',
      );

      return res.status(204).send();
    }

    const purchaseToken =
      subscriptionNotification.purchaseToken;

    const subscriptionId =
      subscriptionNotification.subscriptionId;

    const notificationType =
      subscriptionNotification.notificationType;

    console.log(
      `RTDN subscription event: type=${notificationType}, product=${subscriptionId}`,
    );

    if (
      typeof purchaseToken !== 'string' ||
      purchaseToken.trim().length === 0
    ) {
      console.error('RTDN: Missing purchaseToken');

      return res.status(204).send();
    }

    /**
     * RTDN itself does not contain the complete subscription state.
     *
     * We therefore ask Google Play for the current authoritative state.
     */
    const androidPublisher = await getAndroidPublisher();

    const response =
      await androidPublisher.purchases.subscriptionsv2.get({
        packageName: PACKAGE_NAME,
        token: purchaseToken.trim(),
      });

    const subscription = response.data;

    const lineItem = subscription.lineItems?.find(
      (item) =>
        item.productId === MONTHLY_PRODUCT_ID &&
        item.offerDetails?.basePlanId === MONTHLY_BASE_PLAN_ID,
    );

    if (!lineItem) {
      console.error(
        'RTDN: Subscription does not match CleanCam monthly product.',
      );

      return res.status(204).send();
    }

    console.log(
      'RTDN current Google Play state:',
      JSON.stringify({
        subscriptionState:
          subscription.subscriptionState,
        productId: lineItem.productId,
        basePlanId: lineItem.offerDetails?.basePlanId,
        expiryTime: lineItem.expiryTime,
        autoRenewEnabled:
          lineItem.autoRenewingPlan?.autoRenewEnabled ?? false,
        acknowledgementState:
          subscription.acknowledgementState,
      }),
    );

    /**
     * Important:
     *
     * At this stage we only verify and log the authoritative state.
     * Persistent entitlement storage can be added separately.
     */
    return res.status(204).send();
  } catch (error) {
    console.error('RTDN processing failed:', error);

    /**
     * Return 500 so Pub/Sub retries the message.
     */
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'RTDN processing failed',
    });
  }
});

app.listen(PORT, () => {
  console.log(`CleanCam Backend running on port ${PORT}`);
});