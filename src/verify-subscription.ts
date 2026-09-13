import 'dotenv/config';
import { google } from 'googleapis';

const PACKAGE_NAME = 'com.cleancam.ai';
const PURCHASE_TOKEN = process.env.TEST_PURCHASE_TOKEN;

async function main() {
  if (!PURCHASE_TOKEN) {
    throw new Error(
      'TEST_PURCHASE_TOKEN is missing from .env',
    );
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  const authClient = await auth.getClient();

const androidPublisher = google.androidpublisher({
  version: 'v3',
  auth,
});

  const response =
    await androidPublisher.purchases.subscriptionsv2.get({
      packageName: PACKAGE_NAME,
      token: PURCHASE_TOKEN,
    });

  console.log(
    JSON.stringify(response.data, null, 2),
  );
}

main().catch((error) => {
  console.error('❌ Subscription verification failed.');

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});