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

    res.json({
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

    res.status(500).json({
      success: false,
      premium: false,
      message:
        error instanceof Error
          ? error.message
          : 'Google Play verification failed',
    });
  }
});

app.listen(PORT, () => {
  console.log(`CleanCam Backend running on port ${PORT}`);
});